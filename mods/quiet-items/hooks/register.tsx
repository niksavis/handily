import type { EngineInterface, PluginState, Register } from 'claude-code'
import type { QuietItemsMode, QuietItemsRow } from '../types'
import { parseCommand, trackerFileOf } from './parse'
import { drawEmpty, drawRows, rowsFromDiff } from './row'

type Snapshot = PluginState['workitems']['snapshot']

const COMMAND = 'quiet-items'
const DEFAULT_TITLE_LENGTH = 60
const ON_TEXT = 'quiet-items on for this session. Tracker writes draw as one row.'
const OFF_TEXT = 'quiet-items off for this session. Tracker commands draw in full.'
const NO_ARGUMENT_TEXT =
  '/quiet-items takes no argument; it toggles this session. Set the default with the plugin\'s "mode" setting.'
const FULL_TAIL = 'so tracker commands draw in full.'

type CallResult = Awaited<ReturnType<EngineInterface['tool']['call']>>

function hasSucceeded(result: CallResult): boolean {
  if (result.deny !== undefined || result.isError === true) return false
  const output: unknown = result.result
  if (typeof output !== 'object' || output === null) return true
  if ('interrupted' in output && output.interrupted === true) return false
  return !('stderr' in output && typeof output.stderr === 'string' && output.stderr.trim() !== '')
}

function reachedVersion(diff: object): number | null {
  return 'version' in diff && typeof diff.version === 'number' ? diff.version : null
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

export const register: Register = (on, options) => {
  const defaultMode: QuietItemsMode = options.mode === 'off' ? 'off' : 'on'
  const titleLength =
    typeof options.titleLength === 'number' ? options.titleLength : DEFAULT_TITLE_LENGTH

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Toggle quiet tracker rows for this session',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() !== '') return { text: NO_ARGUMENT_TEXT }
    const { value: current = defaultMode } = await $.state.get({
      plugin: 'quiet-items',
      key: 'mode',
    })
    const mode: QuietItemsMode = current === 'on' ? 'off' : 'on'
    await $.state.set({ plugin: 'quiet-items', key: 'mode' }, mode)
    if (mode === 'off') return { text: OFF_TEXT }
    const { value: snapshot } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
    return { text: onReply(snapshot) }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.run_in_background === true) return next(e)
    const parsed = parseCommand(e.command, await $.workitems.writeVerbs())
    if (parsed.kind !== 'write') return next(e)
    const { value: before } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
    if (before?.state !== 'ok') return next(e)
    let since: number | null
    try {
      since = reachedVersion(await $.workitems.refresh())
    } catch (error) {
      $.ui.log(`quiet-items: no row for ${e.tool_use_id}; the refresh failed: ${String(error)}`)
      return next(e)
    }
    if (since === null) {
      $.ui.log('quiet-items: workitems refresh() returned no version; update the workitems mod')
      return next(e)
    }
    const result = await next(e)
    if (!hasSucceeded(result)) return result
    try {
      const diff = await $.workitems.refresh({ since })
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
    const path = snapshot === undefined ? null : trackerFileOf(e.file_path, snapshot.root)
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

  on('ui.render', { component: ['ToolUse', 'ToolResult'] }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    if (e.component === 'ToolUse' && (e.props.isRunning || e.props.isInterrupted)) return next(e)
    const { value: mode = defaultMode } = await $.state.get({ plugin: 'quiet-items', key: 'mode' })
    if (mode === 'off') return next(e)
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
