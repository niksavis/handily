import type { EngineInterface, PluginState, Register } from 'claude-code'
import type { QuietItemsMode, QuietItemsRow } from '../types'
import { drawEmpty, drawRows, rowsFromDiff } from './row'

declare module 'claude-code' {
  interface PluginState {
    'simple-view': { mode: unknown }
  }
}

type Snapshot = PluginState['workitems']['snapshot']

const COMMAND = 'quiet-items'
const DEFAULT_TITLE_LENGTH = 60
const ON_TEXT = 'quiet-items on for this session. Tracker writes draw as one row.'
const OFF_TEXT = 'quiet-items off for this session. Tracker commands draw in full.'
const NO_ARGUMENT_TEXT =
  '/quiet-items takes no argument; it toggles this session. Set the default with the plugin\'s "mode" setting.'
const FULL_TAIL = 'so tracker commands draw in full.'
const EXIT_STATUS = '$?'
const QUIET_ITEMS_MODE = { plugin: 'quiet-items', key: 'mode' } as const
const SIMPLE_VIEW_MODE = { plugin: 'simple-view', key: 'mode' } as const

type CallResult = Awaited<ReturnType<EngineInterface['tool']['call']>>
type RefreshResult = Awaited<ReturnType<EngineInterface['workitems']['refresh']>>
type Parsed = Awaited<ReturnType<EngineInterface['workitems']['classify']>>

function hasSucceeded(result: CallResult): boolean {
  if (result.deny !== undefined || result.isError === true) return false
  const output: unknown = result.result
  if (typeof output !== 'object' || output === null) return true
  if ('interrupted' in output && output.interrupted === true) return false
  return !('stderr' in output && typeof output.stderr === 'string' && output.stderr.trim() !== '')
}

function stdoutOf(result: CallResult): string {
  const output: unknown = result.result
  if (typeof output !== 'object' || output === null || !('stdout' in output)) return ''
  return typeof output.stdout === 'string' ? output.stdout : ''
}

export function hasEchoedSuccess(line: string, stdout: string): boolean {
  const printed = stdout.trimEnd().split(/\r?\n/).at(-1) ?? ''
  return printed.trimEnd() === line.replaceAll(EXIT_STATUS, '0').trimEnd()
}

function shortReason(reason: string): string {
  const [first = reason] = reason.split('. ')
  return first.replace(/\.$/, '')
}

export function onReply(snapshot: Snapshot | undefined): string {
  const prefix = 'quiet-items on for this session, but'
  if (snapshot === undefined) return `${prefix} work items have not been read yet, ${FULL_TAIL}`
  switch (snapshot.state) {
    case 'ok':
      return ON_TEXT
    case 'failed':
      return `${prefix} work items are unavailable (${shortReason(snapshot.reason)}), ${FULL_TAIL}`
    case 'terminal-only':
      return `${prefix} ${snapshot.sourceLabel} needs a terminal session here, ${FULL_TAIL}`
    case 'stale':
      return `${prefix} work items may be out of date (${shortReason(snapshot.reason)}), ${FULL_TAIL}`
    case 'approval-needed':
      return `${prefix} work items need your approval to run ${shortReason(snapshot.reason)}, ${FULL_TAIL}`
    case 'no-tracker':
      return `${prefix} no tracker was found at the repo root, ${FULL_TAIL}`
  }
}

async function drawsQuietRows($: EngineInterface, defaultMode: QuietItemsMode): Promise<boolean> {
  const { value: simpleViewMode } = await $.state.get(SIMPLE_VIEW_MODE)
  if (simpleViewMode === 'off') return false
  const { value: mode = defaultMode } = await $.state.get(QUIET_ITEMS_MODE)
  return mode !== 'off'
}

export const register: Register = (on, options) => {
  const defaultMode: QuietItemsMode = options.mode === 'off' ? 'off' : 'on'
  const titleLength =
    typeof options.titleLength === 'number' ? options.titleLength : DEFAULT_TITLE_LENGTH

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Toggle quiet tracker rows for this session',
    })
    await $.state.set({ plugin: 'quiet-items', key: 'ready' }, { root: $.plugin.root })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() !== '') return { text: NO_ARGUMENT_TEXT }
    const { value: current = defaultMode } = await $.state.get(QUIET_ITEMS_MODE)
    const mode: QuietItemsMode = current === 'on' ? 'off' : 'on'
    await $.state.set(QUIET_ITEMS_MODE, mode)
    if (mode === 'off') return { text: OFF_TEXT }
    const { value: snapshot } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
    return { text: onReply(snapshot) }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.run_in_background === true) return next(e)
    let parsed: Parsed
    try {
      parsed = await $.workitems.classify(e.command)
    } catch (error) {
      $.ui.log(
        `quiet-items: no row for ${e.tool_use_id}; the command check failed: ${String(error)}`,
      )
      return next(e)
    }
    if (parsed.kind !== 'write' && parsed.kind !== 'echoed') return next(e)
    const { value: before } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
    if (before?.state !== 'ok') return next(e)
    let reached: RefreshResult
    try {
      reached = await $.workitems.refresh()
    } catch (error) {
      $.ui.log(`quiet-items: no row for ${e.tool_use_id}; the refresh failed: ${String(error)}`)
      return next(e)
    }
    const { version } = reached
    const result = await next(e)
    if (!hasSucceeded(result)) return result
    if (parsed.kind === 'echoed' && !hasEchoedSuccess(parsed.line, stdoutOf(result))) return result
    try {
      const diff = await $.workitems.refresh({ since: version })
      const rows: QuietItemsRow[] = rowsFromDiff(diff, parsed.writes)
      if (rows.length > 0) {
        await $.state.set({ plugin: 'quiet-items', key: 'rows', id: e.tool_use_id }, rows)
      }
    } catch (error) {
      $.ui.log(`quiet-items: no row for ${e.tool_use_id}; the refresh failed: ${String(error)}`)
    }
    return result
  })

  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const { value: snapshot } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
    if (snapshot === undefined) return next(e)
    let path: string | null
    try {
      path = await $.workitems.trackerFile({ path: e.file_path, root: snapshot.root })
    } catch (error) {
      $.ui.log(
        `quiet-items: no row for ${e.tool_use_id}; the tracker file check failed: ${String(error)}`,
      )
      return next(e)
    }
    if (path === null) return next(e)
    const result = await next(e)
    if (!hasSucceeded(result)) return result
    const rows: QuietItemsRow[] = [{ kind: 'raw-edit', path, tool: e.tool }]
    try {
      await $.state.set({ plugin: 'quiet-items', key: 'rows', id: e.tool_use_id }, rows)
    } catch (error) {
      $.ui.log(`quiet-items: no row for ${e.tool_use_id}: ${String(error)}`)
    }
    return result
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    if (!(await drawsQuietRows($, defaultMode))) return next(e)
    for (const call of e.props.calls) {
      if (call.tool_use_id === undefined || call.isRunning || call.isErrored) continue
      const { value: rows } = await $.state.get({
        plugin: 'quiet-items',
        key: 'rows',
        id: call.tool_use_id,
      })
      if (rows !== undefined && rows.length > 0) {
        return next({ ...e, props: { ...e.props, isExpanded: true } })
      }
    }
    return next(e)
  })

  on('ui.render', { component: ['ToolUse', 'ToolResult'] }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    if (e.component === 'ToolUse' && (e.props.isRunning || e.props.isInterrupted)) return next(e)
    if (!(await drawsQuietRows($, defaultMode))) return next(e)
    const { value: rows } = await $.state.get({
      plugin: 'quiet-items',
      key: 'rows',
      id: e.props.tool_use_id,
    })
    if (rows === undefined || rows.length === 0) return next(e)
    const elements = $.ui.resolve(e)
    if (e.component === 'ToolResult') return drawEmpty(elements)
    return drawRows({ elements, hasToolMarker: e.surface === 'terminal' }, rows, titleLength)
  })
}
