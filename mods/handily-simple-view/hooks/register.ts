import type {
  EngineInterface,
  Register,
  RenderElement,
  RenderPropsOf,
  RenderSurface,
  Timer,
  ToolGroupCall,
} from 'claude-code'
import type { SimpleViewCall, SimpleViewFold, SimpleViewMode } from '../types'
import { codeModeNote } from './code-mode'
import { commandLabel, programOf } from './command'
import { COPY_FAILED, copiedParts, copyRefusalParts } from './copy-toast'
import {
  KEPT_CALLS,
  callRecord,
  elapsedText,
  savedPathOf,
  showText,
  slotOf,
  type CallFacts,
} from './detail'
import {
  DRAWN_CHARACTERS_AT_MOST,
  callOutput,
  commandOutput,
  erroredCallOutput,
  hintLine,
  plural,
  type CallOutput,
} from './fold'
import { drawsGenericRow, inputSummary, isHiddenByEngine, toolLabel } from './generic'
import {
  FILE_TOOLS,
  bashChanges,
  bashEnd,
  deniedCall,
  endWord,
  errorReason,
  erroredText,
  fileEdit,
  hasErrorShape,
  isInterruption,
  isRecord,
  lineCount,
  personRejection,
  refusalLine,
  shownPath,
  type Denial,
} from './output'
import {
  READING_TOOLS,
  filePathTarget,
  readingCount,
  readingTarget,
  streamingTarget,
} from './reading'
import {
  bashRow,
  changesBlock,
  deniedResultLine,
  deniedRow,
  erroredRow,
  fileRow,
  genericRow,
  isReasonCut,
  readingRow,
  refusedRow,
  type BashState,
  type GenericReason,
  type GenericState,
  type RowButtons,
  type RowLook,
} from './row'
import { shownText } from './shown'
import { keepChangedGlyphSetting, keepGlyphSetting, showGlyphToast } from './toasting'
import {
  VIEWER_PANE,
  drawViewer,
  newViewerSite,
  clearViewer,
  pressMore,
  showInViewer,
  widestAfter,
  type OpenOutcome,
  type Seat,
  type Widest,
  type ViewedCall,
  type ViewerPort,
  type ViewerSite,
} from './viewer'

const COMMAND = 'simple'
const TICK_MS = 1000
const DEFAULT_COLUMNS = 80
const COUNT_TRIES = 5
const MODE = { plugin: 'handily-simple-view', key: 'mode' } as const
const COUNT = { plugin: 'handily-simple-view', key: 'count' } as const
const GENERATION = { plugin: 'handily-simple-view', key: 'generation' } as const
const VIEWING = { plugin: 'handily-simple-view', key: 'viewing' } as const
const QUIET_ITEMS_MODE = { plugin: 'handily-quiet-items', key: 'mode' } as const
const RESERVED_KEYS: ReadonlySet<string> = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])

const ON_TEXT =
  'on for this session. Tool calls draw as one row, except a call that asks you or shows you a plan. /simple show N prints call N in full, and /simple open N shows it in the call tab, where 1 is the last call.'
const OFF_TEXT = 'off for this session. Tool calls draw as Claude Code draws them.'
const USAGE_TEXT =
  '/simple takes on, off, show N, open N, open error, close or no argument. /simple on and /simple off set this session, /simple toggles it, /simple show N prints the N-th last tool call in full, /simple open N shows it in the call tab, /simple open error shows the last call that failed, and /simple close closes the call tab. Set the default with the plugin\'s "mode" setting.'
const NO_CALL_TEXT = '/simple show has no tool call to print yet in this session.'
const NO_CALL_OPEN_TEXT = '/simple open has no tool call to show yet in this session.'
const NO_ERROR_OPEN_TEXT =
  'No kept call failed. /simple open N shows call N, where 1 is the last call.'
const NOT_OPENED_TEXT = 'The call tab did not open'
const CLOSED_TEXT = 'The call tab is closed.'
const NOT_OPEN_TEXT = 'The call tab is not open.'
const NOT_KEPT_HINT = 'This call is no longer kept. /simple show lists the last 50 calls.'
const ERROR_TEXT_LIMIT = DRAWN_CHARACTERS_AT_MOST

type Answer = Awaited<ReturnType<EngineInterface['tool']['call']>>
type StreamingBashInput = { command?: string; description?: string; run_in_background?: boolean }
type BashInput = StreamingBashInput & { command: string }
type CallProgress = Pick<ToolGroupCall, 'isRunning' | 'isErrored' | 'isInterrupted' | 'output'>

function isStreamingBashInput(input: unknown): input is StreamingBashInput {
  return (
    isRecord(input) &&
    (input.command === undefined || typeof input.command === 'string') &&
    (input.description === undefined || typeof input.description === 'string')
  )
}

function isBashInput(input: unknown): input is BashInput {
  return isStreamingBashInput(input) && typeof input.command === 'string'
}

function isPending(call: CallProgress): boolean {
  return !call.isRunning && !call.isErrored && !call.isInterrupted && call.output === undefined
}

function bashLabel(input: StreamingBashInput): string {
  const description = input.description?.trim() ?? ''
  return description === '' ? commandLabel(input.command ?? '') : shownText(description)
}

function rangeText(kept: number): string {
  return `/simple show takes a call number from 1 to ${String(kept)}, where 1 is the last tool call.`
}

function logFailure($: EngineInterface, what: string, error: unknown): void {
  $.ui.log(`simple-view: ${what}: ${String(error)}`)
}

function isMode(word: string): word is SimpleViewMode {
  return word === 'on' || word === 'off'
}

async function setMode(
  $: EngineInterface,
  asked: SimpleViewMode | null,
  defaultMode: SimpleViewMode,
): Promise<string> {
  const { value: current = defaultMode } = await $.state.get(MODE)
  const mode: SimpleViewMode = asked ?? (current === 'on' ? 'off' : 'on')
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

type CallMemory = {
  errors: Map<string, string>
  seqs: Map<string, number>
  viewer: ViewerSite
  widest: Widest | null
}

function newMemory(): CallMemory {
  return { errors: new Map(), seqs: new Map(), viewer: newViewerSite(), widest: null }
}

function forgetCalls(memory: CallMemory): void {
  memory.errors.clear()
  memory.seqs.clear()
  clearViewer(memory.viewer)
}

function keepBounded<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key)
  map.set(key, value)
  for (const oldest of map.keys()) {
    if (map.size <= KEPT_CALLS) break
    map.delete(oldest)
  }
}

function keepError(memory: CallMemory, id: string, answer: Answer): void {
  if (answer.isError !== true && answer.deny === undefined) return
  const text = answer.text ?? answer.deny ?? ''
  keepBounded(memory.errors, id, text.slice(0, ERROR_TEXT_LIMIT))
}

async function remember(
  $: EngineInterface,
  memory: CallMemory,
  facts: Omit<CallFacts, 'seq' | 'generation'>,
): Promise<void> {
  try {
    for (let attempt = 0; attempt < COUNT_TRIES; attempt += 1) {
      const generation = await generationOf($)
      const { value: count = 0, version } = await $.state.get(COUNT)
      const { isSet } = await $.state.set(COUNT, count + 1, { ifVersion: version })
      if (!isSet) continue
      keepBounded(memory.seqs, facts.tool_use_id, count)
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

async function recordCall(
  $: EngineInterface,
  memory: CallMemory,
  { facts, startedAt, timing }: Ended,
): Promise<void> {
  let elapsedMs: number
  try {
    elapsedMs = (await $.clock.now()) - startedAt
  } catch (error) {
    logFailure($, `no time for ${facts.tool_use_id}`, error)
    return
  }
  if (timing !== null) await settleTiming($, timing, startedAt, elapsedMs)
  if (timing !== null && drawsGenericRow(facts.tool) && facts.answer.text !== undefined) {
    await keepResultLines($, timing, lineCount(facts.answer.text))
  }
  await remember($, memory, { ...facts, elapsedMs })
}

async function keepResultLines($: EngineInterface, id: string, lines: number): Promise<void> {
  try {
    await $.state.set({ plugin: 'handily-simple-view', key: 'resultLines', id }, lines)
  } catch (error) {
    logFailure($, `no result size for ${id}`, error)
  }
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
    showGlyphToast(
      $,
      result.isCopied
        ? copiedParts('the output', plural(lineCount(text), 'line'))
        : copyRefusalParts(result.reason),
    )
  } catch (error) {
    logFailure($, 'the output was not copied', error)
    showGlyphToast($, COPY_FAILED)
  }
}

async function foldOf($: EngineInterface, id: string): Promise<SimpleViewFold> {
  const { value = 'folded' } = await $.state.get({
    plugin: 'handily-simple-view',
    key: 'folds',
    id,
  })
  return value
}

async function showCall($: EngineInterface, id: string): Promise<void> {
  const { value } = await $.state.get(VIEWING)
  await $.state.set(VIEWING, { tool_use_id: id, version: (value?.version ?? 0) + 1 })
}

async function clearViewing($: EngineInterface): Promise<void> {
  const { value } = await $.state.get(VIEWING)
  if (value === undefined || value.tool_use_id === '') return
  await $.state.set(VIEWING, { tool_use_id: '', version: value.version + 1 })
}

function viewerPort($: EngineInterface, isAsked: boolean): ViewerPort {
  return {
    panes: () => $.ui.panes(),
    open: () => $.ui.open(isAsked ? { ...VIEWER_PANE, focus: true } : { ...VIEWER_PANE }),
    read: (path) => $.fs.read(path),
    show: (id) => showCall($, id),
    viewing: async () => {
      const { value } = await $.state.get(VIEWING)
      return value === undefined || value.tool_use_id === '' ? null : value.tool_use_id
    },
    clear: () => clearViewing($),
    hint: async (id, isHinted) => {
      await $.state.set(
        { plugin: 'handily-simple-view', key: 'folds', id },
        isHinted ? 'hinted' : 'folded',
      )
    },
    isHinted: async (id) => (await foldOf($, id)) === 'hinted',
    log: (text) => {
      $.ui.log(text)
    },
  }
}

type DrawSite = {
  look: RowLook
  memory: CallMemory
  seat: Seat | undefined
}

function stateWord(state: BashState): string {
  if (state.kind === 'pending') return '…'
  return state.kind === 'running' ? 'running' : endWord(state)
}

function headOf(tool: string, word: string, elapsedMs: number | null): string {
  const time = elapsedMs === null ? [] : [elapsedText(elapsedMs)]
  return [toolLabel(tool), word, ...time].join(' · ')
}

async function pressFold(
  $: EngineInterface,
  memory: { viewer: ViewerSite },
  call: ViewedCall,
  seat: Seat | undefined,
): Promise<void> {
  try {
    await pressMore(viewerPort($, false), memory.viewer, call, seat)
  } catch (error) {
    logFailure($, `the call ${call.toolUseId} did not open`, error)
  }
}

async function buttonsFor(
  $: EngineInterface,
  draw: DrawSite,
  call: ViewedCall,
  copied: CallOutput | null,
): Promise<RowButtons> {
  const fold = await foldOf($, call.toolUseId)
  const { value: viewing } = await $.state.get(VIEWING)
  const isShown = fold === 'hinted' || viewing?.tool_use_id === call.toolUseId
  return {
    label: isShown ? 'shown' : 'folded',
    actions: {
      press: () => {
        const seat =
          draw.seat === undefined ? undefined : { ...draw.seat, widest: draw.memory.widest }
        void pressFold($, draw.memory, call, seat)
      },
      copy:
        copied === null
          ? undefined
          : (surface) => {
              void copyOutput($, copied, surface)
            },
    },
  }
}

async function hintText($: EngineInterface, memory: CallMemory, id: string): Promise<string> {
  const seq = memory.seqs.get(id)
  const { value: count = 0 } = await $.state.get(COUNT)
  const back = seq === undefined ? 0 : count - seq
  if (back < 1 || back > KEPT_CALLS) return NOT_KEPT_HINT
  return `/simple open ${String(back)} shows this call in the call tab.`
}

async function withHint(
  $: EngineInterface,
  draw: DrawSite,
  id: string,
  row: RenderElement,
): Promise<RenderElement> {
  if ((await foldOf($, id)) !== 'hinted') return row
  const { Box } = draw.look.elements
  return Box({
    flexDirection: 'column',
    children: [row, hintLine(draw.look, await hintText($, draw.memory, id))],
  })
}

function pendingBashRow(look: RowLook, tool: string, input: unknown): RenderElement | null {
  if (!isStreamingBashInput(input) || input.run_in_background === true) return null
  const label = bashLabel(input)
  return bashRow(look, {
    label: label === '' ? tool : label,
    program: programOf(input.command ?? ''),
    state: { kind: 'pending' },
    elapsedMs: null,
  })
}

function keptErrorText(memory: CallMemory, props: { tool_use_id: string; output?: unknown }) {
  return erroredText(props.output, memory.errors.get(props.tool_use_id))
}

function stoppedText(
  memory: CallMemory,
  props: { tool_use_id: string; output?: unknown },
): string | null {
  const text = keptErrorText(memory, props)
  if (text === null || isInterruption(text) || personRejection(text) !== null) return null
  const isKept = memory.errors.has(props.tool_use_id)
  if (typeof props.output === 'string' && !isKept && !hasErrorShape(props.output)) return null
  return text
}

async function bashUse(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolUse'],
): Promise<RenderElement | null> {
  const { look } = draw
  if (isPending(props)) return pendingBashRow(look, props.tool, props.input)
  if (!isBashInput(props.input) || props.input.run_in_background === true) return null
  const errorText = props.isErrored ? keptErrorText(draw.memory, props) : null
  const state: BashState | null = props.isRunning
    ? { kind: 'running' }
    : bashEnd(props.isErrored ? errorText : props.output, props.isErrored)
  if (state === null) return null
  const timing = await timingOf($, props.tool_use_id)
  const view = {
    label: bashLabel(props.input),
    program: programOf(props.input.command),
    state,
    elapsedMs: timing?.elapsedMs ?? null,
  }
  if (state.kind === 'denied') {
    if (state.denier === 'classifier') return bashRow(look, view)
    return deniedRow(look, props.tool, [commandLabel(props.input.command)], state)
  }
  const isRunning = state.kind === 'running'
  let output: CallOutput | null = null
  if (!isRunning) {
    output = errorText === null ? callOutput(props.output, false) : erroredCallOutput(errorText)
  }
  if (!isRunning && output === null) return bashRow(look, view)
  const viewed: ViewedCall = {
    toolUseId: props.tool_use_id,
    head: headOf(props.tool, stateWord(state), view.elapsedMs),
    label: view.label,
    command: props.input.command,
    output: output ?? commandOutput(props.input.command),
    isErrored: props.isErrored,
    isRunning,
  }
  const buttons = await buttonsFor($, draw, viewed, output)
  return withHint($, draw, props.tool_use_id, bashRow(look, view, buttons))
}

async function rootOf($: EngineInterface, id: string): Promise<string | null> {
  try {
    return await $.session.root()
  } catch (error) {
    logFailure($, `no path for ${id}`, error)
    return null
  }
}

async function stoppedTarget(
  $: EngineInterface,
  props: RenderPropsOf['ToolUse'],
): Promise<readonly string[]> {
  const root = await rootOf($, props.tool_use_id)
  if (root === null) return []
  const target = FILE_TOOLS.has(props.tool)
    ? filePathTarget(props.input, root)
    : streamingTarget(props.tool, props.input, root)
  return target ?? []
}

function hasMoreText(look: RowLook, output: CallOutput, reason: string): boolean {
  const lines = output.lines.filter((line) => line.trim() !== '')
  return lines.length > 1 || isReasonCut(look, reason)
}

async function errorButtons(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolUse'],
  label: string,
  text: string,
): Promise<RowButtons | null> {
  const reason = errorReason(text)
  const output = erroredCallOutput(text)
  if (output === null || !hasMoreText(draw.look, output, reason)) return null
  const viewed: ViewedCall = {
    toolUseId: props.tool_use_id,
    head: headOf(props.tool, 'error', null),
    label,
    command: null,
    output,
    isErrored: true,
    isRunning: false,
  }
  return buttonsFor($, draw, viewed, output)
}

async function stoppedUse(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolUse'],
): Promise<RenderElement | null> {
  const { look } = draw
  const text = stoppedText(draw.memory, props)
  if (text === null) return null
  const denial = deniedCall(text)
  if (denial !== null) return deniedRow(look, props.tool, await stoppedTarget($, props), denial)
  const target = await stoppedTarget($, props)
  const message = refusalLine(text)
  if (message !== null) return refusedRow(look, props.tool, target, message)
  const buttons = await errorButtons($, draw, props, target.join(' '), text)
  const row = erroredRow(look, props.tool, target, errorReason(text), buttons)
  return withHint($, draw, props.tool_use_id, row)
}

async function fileUse(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolUse'],
): Promise<RenderElement | null> {
  if (props.isRunning) return null
  if (props.isErrored) return stoppedUse($, draw, props)
  const edit = fileEdit(props.tool, props.output)
  if (edit === null) return null
  const root = (await rootOf($, props.tool_use_id)) ?? ''
  return fileRow(draw.look, props.tool, shownPath(edit.path, root), edit.totals)
}

async function readingUse(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolUse'],
): Promise<RenderElement | null> {
  const { look } = draw
  if (props.isErrored) return stoppedUse($, draw, props)
  if (props.isRunning || isPending(props)) {
    const root = (await rootOf($, props.tool_use_id)) ?? ''
    const target = streamingTarget(props.tool, props.input, root)
    return target === null ? null : readingRow(look, props.tool, target, null)
  }
  const count = readingCount(props.tool, props.output)
  if (count === null) return null
  const root = (await rootOf($, props.tool_use_id)) ?? ''
  const target = readingTarget(props.tool, props.input, props.output, root)
  if (target === null) return null
  return readingRow(look, props.tool, target, count)
}

function genericState(props: RenderPropsOf['ToolUse']): GenericState {
  if (isPending(props)) return 'pending'
  if (props.isRunning) return 'running'
  return props.isErrored ? 'error' : 'done'
}

async function genericReason(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolUse'],
  summary: string,
): Promise<GenericReason | null> {
  const text = stoppedText(draw.memory, props)
  if (text === null) return null
  const refusal = refusalLine(text)
  if (refusal !== null) return { text: refusal, buttons: null }
  return { text: errorReason(text), buttons: await errorButtons($, draw, props, summary, text) }
}

async function genericUse(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolUse'],
): Promise<RenderElement> {
  const { look } = draw
  const view = {
    label: toolLabel(props.tool),
    summary: inputSummary(props.input),
    state: genericState(props),
    lines: null,
    elapsedMs: null,
    note: codeModeNote(props.tool, props.output),
  }
  if (view.state === 'pending') return genericRow(look, view)
  const id = timingKey(await generationOf($), props.tool_use_id)
  const { value: timing } = await $.state.get({ plugin: 'handily-simple-view', key: 'timing', id })
  const { value: lines = null } = await $.state.get({
    plugin: 'handily-simple-view',
    key: 'resultLines',
    id,
  })
  const drawn = { ...view, lines, elapsedMs: timing?.elapsedMs ?? null }
  if (view.state !== 'error') return genericRow(look, drawn)
  const reason = await genericReason($, draw, props, view.summary)
  return withHint($, draw, props.tool_use_id, genericRow(look, drawn, reason))
}

async function useDrawing(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolUse'],
): Promise<RenderElement | null> {
  if (props.isInterrupted) return null
  if (props.tool === 'Bash') return bashUse($, draw, props)
  if (FILE_TOOLS.has(props.tool)) return fileUse($, draw, props)
  if (READING_TOOLS.has(props.tool)) return readingUse($, draw, props)
  if (drawsGenericRow(props.tool)) return genericUse($, draw, props)
  return null
}

async function bashResult(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolResult'],
): Promise<RenderElement | null> {
  const { look } = draw
  const shown = props.isErrored ? keptErrorText(draw.memory, props) : props.output
  const end = bashEnd(shown, props.isErrored)
  if (end === null) return null
  if (end.kind !== 'done') return look.elements.Box({})
  const changes = bashChanges(props.output)
  if (changes === null) return null
  if (changes.kind === 'unreported') return look.elements.Box({})
  if (changes.kind === 'untracked') return changesBlock(look, null)
  const root = changes.files.length === 0 ? '' : await $.session.root()
  const files = changes.files.map((file) => ({ ...file, path: shownPath(file.path, root) }))
  return changesBlock(look, { files, moreFiles: changes.moreFiles })
}

function isStoppedRow(memory: CallMemory, props: RenderPropsOf['ToolResult']): boolean {
  const isFileRow = FILE_TOOLS.has(props.tool) || READING_TOOLS.has(props.tool)
  if (!isFileRow && !drawsGenericRow(props.tool)) return false
  return stoppedText(memory, props) !== null
}

function rejectionByPerson(props: RenderPropsOf['ToolResult']): Denial | null {
  if (!props.isErrored) return null
  const drawsOwnRow =
    props.tool === 'Bash' || FILE_TOOLS.has(props.tool) || READING_TOOLS.has(props.tool)
  return drawsOwnRow ? personRejection(props.output) : null
}

async function resultDrawing(
  $: EngineInterface,
  draw: DrawSite,
  props: RenderPropsOf['ToolResult'],
): Promise<RenderElement | null> {
  const { look } = draw
  const rejection = rejectionByPerson(props)
  if (rejection !== null) return deniedResultLine(look, rejection)
  if (props.tool === 'Bash') return bashResult($, draw, props)
  if (props.isErrored) return isStoppedRow(draw.memory, props) ? look.elements.Box({}) : null
  if (READING_TOOLS.has(props.tool)) {
    return readingCount(props.tool, props.output) === null ? null : look.elements.Box({})
  }
  if (drawsGenericRow(props.tool)) return look.elements.Box({})
  if (!FILE_TOOLS.has(props.tool)) return null
  return fileEdit(props.tool, props.output) === null ? null : look.elements.Box({})
}

type KeptCall = { back: number; record: SimpleViewCall }

async function keptCalls($: EngineInterface): Promise<KeptCall[]> {
  const generation = await generationOf($)
  const { value: count = 0 } = await $.state.get(COUNT)
  const kept: KeptCall[] = []
  for (let back = 1; back <= Math.min(count, KEPT_CALLS); back += 1) {
    const seq = count - back
    const { value: record } = await $.state.get({
      plugin: 'handily-simple-view',
      key: 'calls',
      id: slotOf(seq),
    })
    if (record?.generation === generation && record.seq === seq) kept.push({ back, record })
  }
  return kept
}

function parsedInput(input: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(input)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function keptView({ back, record }: KeptCall, kept: number): ViewedCall {
  const input = parsedInput(record.input)
  const isBash = record.tool === 'Bash' && input !== null && isStreamingBashInput(input)
  const word = record.end ?? (record.isErrored ? 'error' : 'done')
  const place = `call ${String(back)} of ${String(kept)}`
  const output = record.output.trimEnd()
  return {
    toolUseId: record.tool_use_id,
    head: [toolLabel(record.tool), word, elapsedText(record.elapsedMs), place].join(' · '),
    label: isBash ? bashLabel(input) : inputSummary(input),
    command: isBash ? (input.command ?? null) : null,
    output: {
      text: record.output,
      lines: output === '' ? [] : output.split(/\r?\n/),
      savedTo: savedPathOf(record.output),
    },
    isErrored: record.isErrored,
    isRunning: false,
  }
}

function openRangeText(kept: number): string {
  return `/simple open takes a call number from 1 to ${String(kept)}, where 1 is the last tool call, or the word error.`
}

function chosenCall(calls: readonly KeptCall[], raw: string | undefined): KeptCall | string {
  if (raw === 'error') return calls.find((call) => call.record.isErrored) ?? NO_ERROR_OPEN_TEXT
  const back = raw === undefined ? 1 : /^\d+$/.test(raw) ? Number(raw) : null
  const found = back === null ? undefined : calls.find((call) => call.back === back)
  if (found !== undefined) return found
  const range = openRangeText(calls.at(-1)?.back ?? 0)
  return back === null ? range : `No call ${String(raw)} is kept. ${range}`
}

async function openKept(
  $: EngineInterface,
  memory: CallMemory,
  call: KeptCall,
  kept: number,
  isAsked: boolean,
): Promise<OpenOutcome> {
  return showInViewer(viewerPort($, isAsked), memory.viewer, keptView(call, kept), isAsked)
}

async function openCommand(
  $: EngineInterface,
  memory: CallMemory,
  raw: string | undefined,
): Promise<string> {
  const calls = await keptCalls($)
  if (calls.length === 0) return NO_CALL_OPEN_TEXT
  const chosen = chosenCall(calls, raw)
  if (typeof chosen === 'string') return chosen
  const kept = calls.at(-1)?.back ?? calls.length
  const opened = await openKept($, memory, chosen, kept, true)
  if (!opened.isPlaced) return `${NOT_OPENED_TEXT}: ${opened.reason}`
  return `Call ${String(chosen.back)} of the last ${String(kept)} is in the call tab.`
}

async function closeCommand($: EngineInterface): Promise<string> {
  const panes = await $.ui.panes()
  if (!panes.some((pane) => pane.id === VIEWER_PANE.id)) return NOT_OPEN_TEXT
  await $.ui.close({ id: VIEWER_PANE.id })
  return CLOSED_TEXT
}

type Neighbours = { previous: KeptCall | null; next: KeptCall | null; kept: number }

async function errorNeighbours($: EngineInterface, id: string): Promise<Neighbours> {
  const calls = await keptCalls($)
  const kept = calls.at(-1)?.back ?? calls.length
  const here = calls.find((call) => call.record.tool_use_id === id)?.back ?? 0
  const errored = calls.filter((call) => call.record.isErrored && call.back !== here)
  return {
    previous: errored.find((call) => here === 0 || call.back > here) ?? null,
    next: here === 0 ? null : (errored.findLast((call) => call.back < here) ?? null),
    kept,
  }
}

async function viewerDrawing(
  $: EngineInterface,
  memory: CallMemory,
  e: { surface: RenderSurface; props: RenderPropsOf['Pane'] },
  elements: Parameters<typeof drawViewer>[0],
): Promise<RenderElement> {
  const { call } = memory.viewer
  const neighbours =
    call === null
      ? { previous: null, next: null, kept: 0 }
      : await errorNeighbours($, call.toolUseId)
  const go = (target: KeptCall | null) =>
    target === null
      ? null
      : () => {
          void openKept($, memory, target, neighbours.kept, false).catch((error: unknown) => {
            logFailure($, 'the call tab did not move', error)
          })
        }
  return drawViewer(
    elements,
    memory.viewer,
    { surface: e.surface, bodyColumns: e.props.bodyColumns },
    {
      copy: (surface) => {
        if (call !== null) void copyOutput($, call.output, surface)
      },
      previous: go(neighbours.previous),
      next: go(neighbours.next),
    },
  )
}

async function isSimple(
  $: EngineInterface,
  id: string,
  defaultMode: SimpleViewMode,
): Promise<boolean> {
  const { value: mode = defaultMode } = await $.state.get(MODE)
  if (mode === 'off') return false
  const { value: rows } = await $.state.get({ plugin: 'handily-quiet-items', key: 'rows', id })
  if (rows === undefined || rows.length === 0) return true
  const { value: quietMode = 'on' } = await $.state.get(QUIET_ITEMS_MODE)
  return quietMode === 'off'
}

function isEngineOwnRow(element: RenderElement): boolean {
  return element.type === 'engine'
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
  if (drawsGenericRow(call.tool) || isHiddenByEngine(call.tool)) return true
  if (call.tool !== 'Bash') return READING_TOOLS.has(call.tool)
  const { input } = call
  if (!isStreamingBashInput(input) || input.run_in_background === true) return false
  return isPending(call) || typeof input.command === 'string'
}

function shouldUnfold(props: RenderPropsOf['ToolGroup']): boolean {
  if (props.isExpanded) return false
  return (
    (props.calls.length > 0 && props.calls.every(isDrawnAsRow)) ||
    props.calls.some(isFailed) ||
    (props.isActive && props.calls.some(isRunningForeground))
  )
}

export const register: Register = (on, options) => {
  const defaultMode: SimpleViewMode = options.mode === 'off' ? 'off' : 'on'
  const memory = newMemory()
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        'handily · Set or toggle the one-row view of tool calls, or print a call in full',
      argumentHint: '[on|off|show N|open N|open error|close]',
    })
    await $.state.set({ plugin: 'handily-simple-view', key: 'ready' }, { root: $.plugin.root })
    const { value: mode, version } = await $.state.get(MODE)
    if (mode === undefined) await $.state.set(MODE, defaultMode, { ifVersion: version })
    await keepGlyphSetting($)
    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    await keepChangedGlyphSetting($, e)
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [verb, number, ...rest] = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word !== '')
    if (verb === undefined) return { text: await setMode($, null, defaultMode) }
    if (isMode(verb) && number === undefined) return { text: await setMode($, verb, defaultMode) }
    if (verb === 'show' && rest.length === 0) return { text: await show($, number) }
    if (verb === 'open' && rest.length === 0) return { text: await openCommand($, memory, number) }
    if (verb === 'close' && number === undefined) return { text: await closeCommand($) }
    return { text: USAGE_TEXT }
  })

  on('session.end', async ($, e, next) => {
    forgetCalls(memory)
    await forgetSession($)
    try {
      await clearViewing($)
    } catch (error) {
      logFailure($, 'the call tab keeps the call of the ended session', error)
    }
    return next(e)
  })

  on('ui.close', { id: VIEWER_PANE.id }, async ($, e, next) => {
    const result = await next(e)
    clearViewer(memory.viewer)
    try {
      await clearViewing($)
    } catch (error) {
      logFailure($, 'the rows keep the shown label', error)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: VIEWER_PANE.id }, async ($, e) => {
    memory.widest = widestAfter(memory.widest, e.viewport)
    await $.state.get(VIEWING)
    const { Box, Text, Button, Code, Markdown } = $.ui.resolve(e)
    return viewerDrawing($, memory, e, { Box, Text, Button, Code, Markdown })
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    if (e.agentId !== undefined) return next(e)
    const answered = async (input: typeof e) => {
      const answer = await next(input)
      keepError(memory, id, answer)
      return answer
    }
    const input = inputOf(e)
    const isTimed =
      (e.tool === 'Bash' || drawsGenericRow(e.tool)) && input.run_in_background !== true
    let startedAt: number
    let timing: string | null
    let ticker: Timer | null
    try {
      startedAt = await $.clock.now()
      timing = isTimed ? timingKey(await generationOf($), id) : null
      ticker = timing === null ? null : await startTicker($, timing, startedAt)
    } catch (error) {
      logFailure($, `no time for ${id}`, error)
      return answered(e)
    }
    let answer: Answer
    try {
      answer = await answered(e)
    } finally {
      ticker?.cancel()
    }
    await recordCall($, memory, {
      facts: { tool_use_id: id, tool: e.tool, input, answer },
      startedAt,
      timing,
    })
    return answer
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    memory.widest = widestAfter(memory.widest, e.viewport)
    if (!shouldUnfold(e.props)) return next(e)
    let isOn = false
    try {
      const { value: mode = defaultMode } = await $.state.get(MODE)
      isOn = mode === 'on'
    } catch (error) {
      logFailure($, 'the engine folds the group', error)
    }
    return next(isOn ? { ...e, props: { ...e.props, isExpanded: true } } : e)
  })

  on('ui.render', { component: ['ToolUse', 'ToolResult'] }, async ($, e, next) => {
    memory.widest = widestAfter(memory.widest, e.viewport)
    const beneath = await next(e)
    if (!isEngineOwnRow(beneath)) return beneath
    let drawn: RenderElement | null = null
    try {
      if (await isSimple($, e.props.tool_use_id, defaultMode)) {
        const draw: DrawSite = {
          memory,
          look: {
            elements: $.ui.resolve(e),
            hasToolMarker: e.surface === 'terminal',
            columns: e.viewport?.columns ?? DEFAULT_COLUMNS,
          },
          seat:
            e.viewport === undefined
              ? undefined
              : {
                  columns: e.viewport.columns,
                  rows: e.viewport.rows,
                  isFullscreen: e.viewport.isFullscreen,
                  widest: memory.widest,
                },
        }
        drawn =
          e.component === 'ToolUse'
            ? await useDrawing($, draw, e.props)
            : await resultDrawing($, draw, e.props)
      }
    } catch (error) {
      logFailure($, `the engine draws ${e.props.tool_use_id}`, error)
    }
    return drawn ?? beneath
  })
}
