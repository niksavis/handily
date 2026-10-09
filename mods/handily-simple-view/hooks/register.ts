import type {
  EngineInterface,
  Register,
  RenderElement,
  RenderPropsOf,
  RenderSurface,
  Timer,
  ToolGroupCall,
} from 'claude-code'
import type { SimpleViewFold, SimpleViewMode } from '../types'
import { commandLabel, programOf } from './command'
import { KEPT_CALLS, callRecord, showText, slotOf, type CallFacts } from './detail'
import {
  callOutput,
  copyRefusalText,
  foldButtons,
  outputBlock,
  plural,
  type CallOutput,
  type FoldActions,
} from './fold'
import { bashChanges, bashEnd, fileEdit, isRecord, lineCount, shownPath } from './output'
import { READING_TOOLS, readingCount, readingTarget } from './reading'
import { bashRow, changesBlock, fileRow, readingRow, type BashState, type RowLook } from './row'

const COMMAND = 'simple'
const TICK_MS = 1000
const COUNT_TRIES = 5
const DEFAULT_MODE: SimpleViewMode = 'on'
const MODE = { plugin: 'handily-simple-view', key: 'mode' } as const
const COUNT = { plugin: 'handily-simple-view', key: 'count' } as const
const GENERATION = { plugin: 'handily-simple-view', key: 'generation' } as const
const QUIET_ITEMS_MODE = { plugin: 'handily-quiet-items', key: 'mode' } as const
const RESERVED_KEYS: ReadonlySet<string> = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])
const FILE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])

const ON_TEXT =
  'on for this session. Bash, Edit, Write, Read, Grep and Glob calls draw as one row. /simple show N prints call N in full, where 1 is the last call.'
const OFF_TEXT = 'off for this session. Tool calls draw as Claude Code draws them.'
const USAGE_TEXT =
  '/simple takes no argument, or show N. /simple toggles this session; /simple show N prints the N-th last tool call in full.'
const NO_CALL_TEXT = '/simple show has no tool call to print yet in this session.'

type Answer = Awaited<ReturnType<EngineInterface['tool']['call']>>
type BashInput = { command: string; description?: string; run_in_background?: boolean }

function isBashInput(input: unknown): input is BashInput {
  return (
    isRecord(input) &&
    typeof input.command === 'string' &&
    (input.description === undefined || typeof input.description === 'string')
  )
}

function rangeText(kept: number): string {
  return `/simple show takes a call number from 1 to ${String(kept)}, where 1 is the last tool call.`
}

function logFailure($: EngineInterface, what: string, error: unknown): void {
  $.ui.log(`simple-view: ${what}: ${String(error)}`)
}

async function toggle($: EngineInterface): Promise<string> {
  const { value: current = DEFAULT_MODE } = await $.state.get(MODE)
  const mode: SimpleViewMode = current === 'on' ? 'off' : 'on'
  await $.state.set(MODE, mode)
  return mode === 'on' ? ON_TEXT : OFF_TEXT
}

async function generationOf($: EngineInterface): Promise<number> {
  const { value = 0 } = await $.state.get(GENERATION)
  return value
}

function timingKey(generation: number, toolUseId: string): string {
  return `${String(generation)}:${toolUseId}`
}

async function forgetSession($: EngineInterface): Promise<void> {
  try {
    await $.state.set(GENERATION, (await generationOf($)) + 1)
    await $.state.set(COUNT, 0)
  } catch (error) {
    logFailure($, 'the calls of the ended session stay reachable', error)
  }
}

async function show($: EngineInterface, raw: string | undefined): Promise<string> {
  const generation = await generationOf($)
  const { value: count = 0 } = await $.state.get(COUNT)
  const kept = Math.min(count, KEPT_CALLS)
  if (kept === 0) return NO_CALL_TEXT
  if (raw === undefined || !/^\d+$/.test(raw)) return rangeText(kept)
  const back = Number(raw)
  if (back < 1 || back > kept) return `No call ${raw} is kept. ${rangeText(kept)}`
  const seq = count - back
  const { value: call } = await $.state.get({
    plugin: 'handily-simple-view',
    key: 'calls',
    id: slotOf(seq),
  })
  if (call?.generation !== generation || call.seq !== seq) {
    return `No call ${raw} is kept. ${rangeText(kept)}`
  }
  return showText(call, back, kept)
}

async function tick($: EngineInterface, id: string): Promise<void> {
  try {
    const ref = { plugin: 'handily-simple-view', key: 'timing', id } as const
    const { value, version } = await $.state.get(ref)
    if (value?.isRunning !== true) return
    const now = await $.clock.now()
    await $.state.set(ref, { ...value, elapsedMs: now - value.startedAt }, { ifVersion: version })
  } catch (error) {
    logFailure($, `no running time for ${id}`, error)
  }
}

async function startTicker($: EngineInterface, id: string, startedAt: number): Promise<Timer> {
  await $.state.set(
    { plugin: 'handily-simple-view', key: 'timing', id },
    { startedAt, elapsedMs: 0, isRunning: true },
  )
  return $.clock.every(TICK_MS, () => {
    void tick($, id)
  })
}

async function settleTiming(
  $: EngineInterface,
  id: string,
  startedAt: number,
  elapsedMs: number,
): Promise<void> {
  try {
    await $.state.set(
      { plugin: 'handily-simple-view', key: 'timing', id },
      { startedAt, elapsedMs, isRunning: false },
    )
  } catch (error) {
    logFailure($, `no time for ${id}`, error)
  }
}

async function remember(
  $: EngineInterface,
  facts: Omit<CallFacts, 'seq' | 'generation'>,
): Promise<void> {
  try {
    for (let attempt = 0; attempt < COUNT_TRIES; attempt += 1) {
      const generation = await generationOf($)
      const { value: count = 0, version } = await $.state.get(COUNT)
      const { isSet } = await $.state.set(COUNT, count + 1, { ifVersion: version })
      if (!isSet) continue
      await $.state.set(
        { plugin: 'handily-simple-view', key: 'calls', id: slotOf(count) },
        callRecord({ ...facts, generation, seq: count }),
      )
      return
    }
    $.ui.log(`simple-view: /simple show misses ${facts.tool_use_id}; other calls kept the count`)
  } catch (error) {
    logFailure($, `/simple show misses ${facts.tool_use_id}`, error)
  }
}

type Ended = {
  facts: Omit<CallFacts, 'seq' | 'generation' | 'elapsedMs'>
  startedAt: number
  timing: string | null
}

async function recordCall($: EngineInterface, { facts, startedAt, timing }: Ended): Promise<void> {
  let elapsedMs: number
  try {
    elapsedMs = (await $.clock.now()) - startedAt
  } catch (error) {
    logFailure($, `no time for ${facts.tool_use_id}`, error)
    return
  }
  if (timing !== null) await settleTiming($, timing, startedAt, elapsedMs)
  await remember($, { ...facts, elapsedMs })
}

function inputOf(e: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(e).filter(([key]) => !RESERVED_KEYS.has(key)))
}

async function timingOf($: EngineInterface, toolUseId: string) {
  const id = timingKey(await generationOf($), toolUseId)
  const { value } = await $.state.get({ plugin: 'handily-simple-view', key: 'timing', id })
  return value
}

async function copyOutput(
  $: EngineInterface,
  output: CallOutput,
  surface: RenderSurface,
): Promise<void> {
  try {
    const text = output.savedTo === null ? output.text : await $.fs.read(output.savedTo)
    const result = await $.ui.copy({ text, surface })
    $.ui.toast(
      result.isCopied
        ? `Copied ${plural(lineCount(text), 'line')} of output.`
        : copyRefusalText(result.reason),
    )
  } catch (error) {
    logFailure($, 'the output was not copied', error)
    $.ui.toast('Not copied. The debug log says why.')
  }
}

function foldActions($: EngineInterface, id: string, output: CallOutput | null): FoldActions {
  return {
    fold: (next) => {
      void $.state
        .set({ plugin: 'handily-simple-view', key: 'folds', id }, next)
        .catch((error: unknown) => {
          logFailure($, `the output of ${id} did not ${next === 'folded' ? 'fold' : 'open'}`, error)
        })
    },
    copy:
      output === null
        ? undefined
        : (surface) => {
            void copyOutput($, output, surface)
          },
  }
}

function commandOutput(command: string): CallOutput {
  return { text: command, lines: command.split(/\r?\n/), savedTo: null }
}

async function foldOf($: EngineInterface, id: string): Promise<SimpleViewFold> {
  const { value = 'folded' } = await $.state.get({
    plugin: 'handily-simple-view',
    key: 'folds',
    id,
  })
  return value
}

async function bashUse(
  $: EngineInterface,
  props: RenderPropsOf['ToolUse'],
  look: RowLook,
): Promise<RenderElement | null> {
  if (!isBashInput(props.input) || props.input.run_in_background === true) return null
  const state: BashState | null = props.isRunning
    ? { kind: 'running' }
    : bashEnd(props.output, props.isErrored)
  if (state === null) return null
  const timing = await timingOf($, props.tool_use_id)
  const description = props.input.description?.trim() ?? ''
  const view = {
    label: description === '' ? commandLabel(props.input.command) : description,
    program: programOf(props.input.command),
    state,
    elapsedMs: timing?.elapsedMs ?? null,
  }
  const isRunning = state.kind === 'running'
  const output = isRunning ? null : callOutput(props.output, props.isErrored)
  if (!isRunning && output === null) return bashRow(look, view)
  const fold = await foldOf($, props.tool_use_id)
  const actions = foldActions($, props.tool_use_id, output)
  const row = bashRow(look, view, foldButtons(look, fold, actions))
  if (fold === 'folded') return row
  const opened =
    output === null
      ? outputBlock(look, commandOutput(props.input.command), 'all', actions)
      : outputBlock(look, output, fold, actions)
  const { Box } = look.elements
  return Box({ flexDirection: 'column', children: [row, opened] })
}

async function fileUse(
  $: EngineInterface,
  props: RenderPropsOf['ToolUse'],
  look: RowLook,
): Promise<RenderElement | null> {
  if (props.isRunning || props.isErrored) return null
  const edit = fileEdit(props.tool, props.output)
  if (edit === null) return null
  return fileRow(look, props.tool, shownPath(edit.path, await $.session.root()), edit.totals)
}

async function readingUse(
  $: EngineInterface,
  props: RenderPropsOf['ToolUse'],
  look: RowLook,
): Promise<RenderElement | null> {
  if (props.isRunning || props.isErrored) return null
  const count = readingCount(props.tool, props.output)
  if (count === null) return null
  const target = readingTarget(props.tool, props.input, props.output, await $.session.root())
  if (target === null) return null
  return readingRow(look, props.tool, target, count)
}

async function useDrawing(
  $: EngineInterface,
  props: RenderPropsOf['ToolUse'],
  look: RowLook,
): Promise<RenderElement | null> {
  if (props.isInterrupted) return null
  if (props.tool === 'Bash') return bashUse($, props, look)
  if (FILE_TOOLS.has(props.tool)) return fileUse($, props, look)
  if (READING_TOOLS.has(props.tool)) return readingUse($, props, look)
  return null
}

async function bashResult(
  $: EngineInterface,
  props: RenderPropsOf['ToolResult'],
  look: RowLook,
): Promise<RenderElement | null> {
  const end = bashEnd(props.output, props.isErrored)
  if (end === null) return null
  if (end.kind === 'exit') return look.elements.Box({})
  const changes = bashChanges(props.output)
  if (changes === null) return null
  if (changes.kind === 'unreported') return look.elements.Box({})
  if (changes.kind === 'untracked') return changesBlock(look, null)
  const root = changes.files.length === 0 ? '' : await $.session.root()
  const files = changes.files.map((file) => ({ ...file, path: shownPath(file.path, root) }))
  return changesBlock(look, { files, moreFiles: changes.moreFiles })
}

async function resultDrawing(
  $: EngineInterface,
  props: RenderPropsOf['ToolResult'],
  look: RowLook,
): Promise<RenderElement | null> {
  if (props.tool === 'Bash') return bashResult($, props, look)
  if (props.isErrored) return null
  if (READING_TOOLS.has(props.tool)) {
    return readingCount(props.tool, props.output) === null ? null : look.elements.Box({})
  }
  if (!FILE_TOOLS.has(props.tool)) return null
  return fileEdit(props.tool, props.output) === null ? null : look.elements.Box({})
}

async function isSimple($: EngineInterface, id: string): Promise<boolean> {
  const { value: mode = DEFAULT_MODE } = await $.state.get(MODE)
  if (mode === 'off') return false
  const { value: rows } = await $.state.get({ plugin: 'handily-quiet-items', key: 'rows', id })
  if (rows === undefined || rows.length === 0) return true
  const { value: quietMode = 'on' } = await $.state.get(QUIET_ITEMS_MODE)
  return quietMode === 'off'
}

function isFailed(call: ToolGroupCall): boolean {
  return call.isErrored && !call.isRunning
}

function isRunningForeground(call: ToolGroupCall): boolean {
  return (
    call.tool === 'Bash' &&
    call.isRunning &&
    !(isBashInput(call.input) && call.input.run_in_background === true)
  )
}

function isDrawnAsRow(call: ToolGroupCall): boolean {
  if (call.tool === 'Bash') return isBashInput(call.input) && call.input.run_in_background !== true
  return READING_TOOLS.has(call.tool)
}

function shouldUnfold(props: RenderPropsOf['ToolGroup']): boolean {
  if (props.isExpanded) return false
  return (
    (props.calls.length > 0 && props.calls.every(isDrawnAsRow)) ||
    props.calls.some(isFailed) ||
    (props.isActive && props.calls.some(isRunningForeground))
  )
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'handily · Toggle the one-row view of tool calls, or print a call in full',
      argumentHint: '[show N]',
    })
    await $.state.set({ plugin: 'handily-simple-view', key: 'ready' }, { root: $.plugin.root })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [verb, number, ...rest] = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word !== '')
    if (verb === undefined) return { text: await toggle($) }
    if (verb === 'show' && rest.length === 0) return { text: await show($, number) }
    return { text: USAGE_TEXT }
  })

  on('session.end', async ($, e, next) => {
    await forgetSession($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    if (e.agentId !== undefined) return next(e)
    const isTimed = e.tool === 'Bash' && e.run_in_background !== true
    let startedAt: number
    let timing: string | null
    let ticker: Timer | null
    try {
      startedAt = await $.clock.now()
      timing = isTimed ? timingKey(await generationOf($), id) : null
      ticker = timing === null ? null : await startTicker($, timing, startedAt)
    } catch (error) {
      logFailure($, `no time for ${id}`, error)
      return next(e)
    }
    let answer: Answer
    try {
      answer = await next(e)
    } finally {
      ticker?.cancel()
    }
    await recordCall($, {
      facts: { tool_use_id: id, tool: e.tool, input: inputOf(e), answer },
      startedAt,
      timing,
    })
    return answer
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!shouldUnfold(e.props)) return next(e)
    let isOn = false
    try {
      const { value: mode = DEFAULT_MODE } = await $.state.get(MODE)
      isOn = mode === 'on'
    } catch (error) {
      logFailure($, 'the engine folds the group', error)
    }
    return next(isOn ? { ...e, props: { ...e.props, isExpanded: true } } : e)
  })

  on('ui.render', { component: ['ToolUse', 'ToolResult'] }, async ($, e, next) => {
    let drawn: RenderElement | null = null
    try {
      if (await isSimple($, e.props.tool_use_id)) {
        const look = { elements: $.ui.resolve(e), hasToolMarker: e.surface === 'terminal' }
        drawn =
          e.component === 'ToolUse'
            ? await useDrawing($, e.props, look)
            : await resultDrawing($, e.props, look)
      }
    } catch (error) {
      logFailure($, `the engine draws ${e.props.tool_use_id}`, error)
    }
    return drawn ?? next(e)
  })
}
