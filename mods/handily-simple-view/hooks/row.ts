import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import type { CodeModeNote } from './code-mode'
import { elapsedText } from './detail'
import { FOLD_BUTTONS_CELLS, foldButtons, type FoldActions, type FoldLabel } from './fold'
import type { BashEnd, Denial, Denier, FileChange, StderrSummary, Totals } from './output'
import { displayWidth, fitted, graphemesOf } from './width'

type RowElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>
type CellStyle = Omit<Parameters<RowElements['Text']>[0], 'children'>
type Cell = { text: string; style?: CellStyle; canShrink?: boolean; keptCells?: number }

export type RowLook = { elements: RowElements; hasToolMarker: boolean; columns: number }

export type BashState = { kind: 'pending' } | { kind: 'running' } | BashEnd

export type RowButtons = { label: FoldLabel; actions: FoldActions }

export type BashView = {
  label: string
  program: string
  state: BashState
  elapsedMs: number | null
}

const LABEL_KEPT_CELLS = 40
const LABEL_SHOWN_AT_LEAST = 8
const ACTIONS_SPACE_CELLS = 2
const PENDING_TEXT = '…'
const MARKER_CELLS = 2
const CELL_GAP = 2
const REFUSED_WORD = 'refused'
const DENIED_WORD = 'denied'
const ERROR_WORD = 'error'
const CLASSIFIER_DENIER = 'auto mode'
const RULE_DENIER = 'by a rule'
const PERSON_DENIER = 'by you'
const DENIERS: Readonly<Record<Denier, string>> = {
  classifier: CLASSIFIER_DENIER,
  rule: RULE_DENIER,
  person: PERSON_DENIER,
}
const TIME_SHOWN_FROM_MS = 1000
const RESULT_INDENT = 2
const REASON_BESIDE_FROM_COLUMNS = 60
const REASON_LINES_AT_MOST = 2
const NO_REASON_TEXT = 'no error text'
const CUT_MARK = '…'
const EXIT_NAMES: Readonly<Record<number, string>> = {
  126: 'not executable',
  127: 'command not found',
  130: 'interrupted',
  143: 'stopped',
}

function cell(
  { Box, Text }: RowElements,
  { text, style = {}, canShrink = false, keptCells }: Cell,
) {
  return Box({
    flexShrink: canShrink ? 1 : 0,
    ...(keptCells === undefined ? {} : { minWidth: keptCells }),
    children: Text({ ...style, children: text }),
  })
}

function trailing(elements: RowElements, actions: RenderElement | null): RenderElement[] {
  if (actions === null) return []
  return [
    elements.Box({ flexGrow: 1, minWidth: ACTIONS_SPACE_CELLS }),
    elements.Box({ flexShrink: 0, children: actions }),
  ]
}

function line(
  look: RowLook,
  key: string,
  marker: ThemeKey,
  cells: Cell[],
  actions: RenderElement | null = null,
): RenderElement {
  const { elements } = look
  const columns = elements.Box({
    flexDirection: 'row',
    flexShrink: 1,
    gap: CELL_GAP,
    children: cells.filter((part) => part.text !== '').map((part) => cell(elements, part)),
  })
  const parts = [columns, ...trailing(elements, actions)]
  if (!look.hasToolMarker) return elements.Box({ key, flexDirection: 'row', children: parts })
  const dot = elements.Box({
    flexShrink: 0,
    marginRight: MARKER_CELLS - 1,
    children: elements.Text({ color: marker, children: '●' }),
  })
  return elements.Box({ key, flexDirection: 'row', children: [dot, ...parts] })
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`
}

function stderrCells(stderr: StderrSummary | null): Cell[] {
  if (stderr === null) return []
  return [
    { text: plural(stderr.lines, 'stderr line'), style: { dimColor: true } },
    { text: stderr.first, style: { dimColor: true, wrap: 'truncate-end' }, canShrink: true },
  ]
}

function stateCells(state: Exclude<BashState, Denial>): Cell[] {
  switch (state.kind) {
    case 'pending':
      return [{ text: PENDING_TEXT, style: { dimColor: true } }]
    case 'running':
      return [{ text: 'running', style: { dimColor: true } }]
    case 'done':
      return [
        state.interpretation === null
          ? { text: 'exit 0', style: { color: 'success' } }
          : { text: state.interpretation, style: { dimColor: true } },
        {
          text: state.savedTo === null ? plural(state.lines, 'line') : 'output saved to a file',
          style: { dimColor: true },
        },
        ...stderrCells(state.stderr),
      ]
    case 'exit':
      return [
        errorWord(`exit ${String(state.code)}`),
        { text: EXIT_NAMES[state.code] ?? '', style: { dimColor: true } },
      ]
    case 'refused':
      return [errorWord(REFUSED_WORD)]
    case 'error':
      return [errorWord(state.kind)]
  }
}

function errorWord(word: string): Cell {
  return { text: word, style: { color: 'error' } }
}

function reasonOf(state: BashState): string | null {
  if (state.kind === 'exit' || state.kind === 'error') return state.line
  if (state.kind !== 'refused') return null
  return state.line === '' ? null : state.line
}

function underRow(look: RowLook, key: string, child: RenderElement): RenderElement {
  return look.elements.Box({
    key,
    paddingLeft: look.hasToolMarker ? RESULT_INDENT : 0,
    children: child,
  })
}

function reasonRoom(look: RowLook): number {
  return Math.max(look.columns - (look.hasToolMarker ? RESULT_INDENT : 0), 1)
}

function isNarrow(look: RowLook): boolean {
  return look.columns < REASON_BESIDE_FROM_COLUMNS
}

function cutToCells(text: string, cells: number): string {
  let kept = ''
  let used = 0
  for (const { grapheme, cells: width } of graphemesOf(text)) {
    if (used + width > cells) break
    kept += grapheme
    used += width
  }
  return kept
}

function wrappedLines(text: string, room: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ').filter((part) => part !== '')) {
    const joined = line === '' ? word : `${line} ${word}`
    if (displayWidth(joined) <= room) {
      line = joined
      continue
    }
    if (line !== '') lines.push(line)
    let rest = word
    while (displayWidth(rest) > room) {
      const head = cutToCells(rest, room)
      if (head === '') break
      lines.push(head)
      rest = rest.slice(head.length)
    }
    line = rest
  }
  if (line !== '') lines.push(line)
  return lines
}

function cutAtWord(line: string, room: number): string {
  if (displayWidth(`${line}${CUT_MARK}`) <= room) return `${line}${CUT_MARK}`
  const space = line.lastIndexOf(' ')
  if (space <= 0) return fitted(line, room)
  return `${line.slice(0, space).trimEnd()}${CUT_MARK}`
}

type ReasonLayout = { lines: string[]; isCut: boolean }

function reasonLayout(look: RowLook, reason: string): ReasonLayout {
  const room = reasonRoom(look)
  if (!isNarrow(look)) return { lines: [reason], isCut: displayWidth(reason) > room }
  const wrapped = wrappedLines(reason, room)
  if (wrapped.length <= REASON_LINES_AT_MOST) return { lines: wrapped, isCut: false }
  const kept = wrapped.slice(0, REASON_LINES_AT_MOST)
  kept[REASON_LINES_AT_MOST - 1] = cutAtWord(kept.at(-1) ?? '', room)
  return { lines: kept, isCut: true }
}

export function isReasonCut(look: RowLook, reason: string): boolean {
  return reason !== '' && reasonLayout(look, reason).isCut
}

function reasonLines(look: RowLook, reason: string): RenderElement[] {
  const { Text } = look.elements
  if (reason === '') {
    return [underRow(look, 'reason', Text({ dimColor: true, children: NO_REASON_TEXT }))]
  }
  return reasonLayout(look, reason).lines.map((text, index) =>
    underRow(
      look,
      index === 0 ? 'reason' : `reason-${String(index + 1)}`,
      Text({ color: 'error', wrap: 'truncate-end', children: text }),
    ),
  )
}

function tailLine(look: RowLook, time: Cell, actions: RenderElement | null): RenderElement | null {
  if (time.text === '' && actions === null) return null
  const { Box } = look.elements
  return underRow(
    look,
    'tail',
    Box({
      flexDirection: 'row',
      gap: CELL_GAP,
      children: [time.text === '' ? null : cell(look.elements, time), actions],
    }),
  )
}

function rowButtons(look: RowLook, buttons: RowButtons | null): RenderElement | null {
  if (buttons === null) return null
  if (!isNarrow(look)) return foldButtons(look, buttons.label, buttons.actions)
  return foldButtons(look, buttons.label, { press: buttons.actions.press })
}

function withReason(
  look: RowLook,
  marker: ThemeKey,
  cells: { leading: Cell[]; time: Cell },
  reason: string,
  buttons: RowButtons | null,
): RenderElement {
  const { Box } = look.elements
  const actions = rowButtons(look, buttons)
  const row = isNarrow(look)
    ? line(look, 'row', marker, cells.leading, actions)
    : line(look, 'row', marker, [...cells.leading, cells.time], actions)
  return Box({ flexDirection: 'column', children: [row, ...reasonLines(look, reason)] })
}

function leastCells(cell: Cell): number {
  return cell.canShrink === true ? (cell.keptCells ?? 0) : displayWidth(cell.text)
}

function deniedCells(look: RowLook, others: readonly Cell[], denial: Denial): Cell[] {
  const word: Cell = { text: DENIED_WORD, style: { color: 'error' } }
  const denier = DENIERS[denial.denier]
  if (denial.reason === null) return [word, { text: denier, style: { color: 'error' } }]
  const text = `${denier}: ${denial.reason}`
  const drawn = [...others.filter((other) => other.text !== ''), word]
  const used =
    (look.hasToolMarker ? MARKER_CELLS : 0) +
    CELL_GAP * drawn.length +
    drawn.reduce((sum, other) => sum + leastCells(other), 0)
  const floor = displayWidth(`${denier}: `)
  return [
    word,
    {
      text,
      style: { color: 'error', wrap: 'truncate-end' },
      canShrink: true,
      keptCells: Math.min(displayWidth(text), Math.max(look.columns - used, floor)),
    },
  ]
}

function fitsWithActions(look: RowLook, cells: readonly Cell[]): boolean {
  const drawn = cells.filter((part) => part.text !== '')
  const least = drawn.reduce((sum, part) => sum + leastCells(part), 0)
  const used =
    (look.hasToolMarker ? MARKER_CELLS : 0) +
    CELL_GAP * Math.max(drawn.length - 1, 0) +
    least +
    ACTIONS_SPACE_CELLS +
    FOLD_BUTTONS_CELLS
  return used <= look.columns
}

function hasCutText(state: BashState): boolean {
  return state.kind === 'done' && state.stderr !== null
}

function timeText(elapsedMs: number | null): string {
  if (elapsedMs === null || elapsedMs < TIME_SHOWN_FROM_MS) return ''
  return elapsedText(elapsedMs)
}

const MARKERS: Readonly<Record<BashState['kind'], ThemeKey>> = {
  pending: 'subtle',
  running: 'subtle',
  done: 'success',
  exit: 'error',
  refused: 'error',
  error: 'error',
  denied: 'error',
}

export function bashRow(
  look: RowLook,
  view: BashView,
  buttons: RowButtons | null = null,
): RenderElement {
  const label: Cell = {
    text: view.label,
    style: { wrap: 'truncate-end' },
    canShrink: true,
    keptCells: hasCutText(view.state)
      ? Math.min(displayWidth(view.label), LABEL_KEPT_CELLS)
      : undefined,
  }
  const program: Cell = { text: view.program, style: { dimColor: true } }
  const time: Cell = { text: timeText(view.elapsedMs), style: { dimColor: true } }
  const state =
    view.state.kind === 'denied'
      ? deniedCells(look, [label, program, time], view.state)
      : stateCells(view.state)
  const marker = MARKERS[view.state.kind]
  const reason = reasonOf(view.state)
  if (reason !== null) {
    return withReason(look, marker, { leading: [label, program, ...state], time }, reason, buttons)
  }
  const actions = buttons === null ? null : foldButtons(look, buttons.label, buttons.actions)
  const cells = [label, program, ...state, time]
  const shownLabel: Cell = {
    ...label,
    keptCells: label.keptCells ?? Math.min(displayWidth(label.text), LABEL_SHOWN_AT_LEAST),
  }
  if (actions === null || fitsWithActions(look, [shownLabel, program, ...state, time])) {
    return line(look, 'row', marker, cells, actions)
  }
  return look.elements.Box({
    flexDirection: 'column',
    children: [
      line(look, 'row', marker, [label, program, ...state]),
      tailLine(look, time, actions),
    ],
  })
}

export function totalsText({ added, removed }: Totals): string {
  return `+${String(added)} -${String(removed)}`
}

export function fileRow(
  look: RowLook,
  tool: string,
  path: string,
  totals: Totals | null,
): RenderElement {
  return line(look, 'row', 'success', [
    { text: tool },
    { text: path, style: { wrap: 'truncate-end' }, canShrink: true },
    { text: totals === null ? '' : totalsText(totals), style: { dimColor: true } },
  ])
}

export function readingRow(
  look: RowLook,
  tool: string,
  target: readonly string[],
  count: string | null,
): RenderElement {
  return line(look, 'row', count === null ? 'subtle' : 'success', [
    { text: tool },
    ...target.map((text) => ({ text, style: { wrap: 'truncate-end' as const }, canShrink: true })),
    { text: count ?? PENDING_TEXT, style: { dimColor: true } },
  ])
}

function keptTargetCells(target: readonly string[]): Cell[] {
  let room = LABEL_KEPT_CELLS
  return target.map((text) => {
    const keptCells = Math.min(displayWidth(text), room)
    room -= keptCells
    return { text, style: { wrap: 'truncate-end' }, canShrink: true, keptCells }
  })
}

export function refusedRow(
  look: RowLook,
  tool: string,
  target: readonly string[],
  message: string,
  buttons: RowButtons | null = null,
): RenderElement {
  const leading = [{ text: tool }, ...keptTargetCells(target), errorWord(REFUSED_WORD)]
  if (message === '') return line(look, 'row', 'error', leading)
  return withReason(look, 'error', { leading, time: { text: '' } }, message, buttons)
}

export function erroredRow(
  look: RowLook,
  tool: string,
  target: readonly string[],
  reason: string,
  buttons: RowButtons | null,
): RenderElement {
  const leading = [{ text: tool }, ...keptTargetCells(target), errorWord(ERROR_WORD)]
  return withReason(look, 'error', { leading, time: { text: '' } }, reason, buttons)
}

export function deniedRow(
  look: RowLook,
  tool: string,
  target: readonly string[],
  denial: Denial,
): RenderElement {
  const leading: Cell[] = [
    { text: tool },
    ...target.map((text) => ({ text, style: { wrap: 'truncate-end' as const }, canShrink: true })),
  ]
  return line(look, 'row', 'error', [...leading, ...deniedCells(look, leading, denial)])
}

export type GenericState = 'pending' | 'running' | 'done' | 'error'

export type GenericView = {
  label: string
  summary: string
  state: GenericState
  lines: number | null
  elapsedMs: number | null
  note?: CodeModeNote | null
}

const GENERIC_STATES: Readonly<Record<GenericState, { marker: ThemeKey; cell: Cell }>> = {
  pending: { marker: 'subtle', cell: { text: PENDING_TEXT, style: { dimColor: true } } },
  running: { marker: 'subtle', cell: { text: 'running', style: { dimColor: true } } },
  done: { marker: 'success', cell: { text: 'done', style: { color: 'success' } } },
  error: { marker: 'error', cell: { text: 'error', style: { color: 'error' } } },
}

export type GenericReason = { text: string; buttons: RowButtons | null }

function noteState(note: CodeModeNote): { marker: ThemeKey; cell: Cell } {
  const color: ThemeKey = note.isError ? 'error' : 'success'
  return { marker: color, cell: { text: note.text, style: { color } } }
}

export function genericRow(
  look: RowLook,
  view: GenericView,
  reason: GenericReason | null = null,
): RenderElement {
  const note = view.state === 'done' ? (view.note ?? null) : null
  const { marker, cell: stateCell } = note === null ? GENERIC_STATES[view.state] : noteState(note)
  const leading: Cell[] = [
    { text: view.label },
    { text: view.summary, style: { wrap: 'truncate-end' }, canShrink: true },
    stateCell,
    {
      text:
        view.state === 'done' && note === null && view.lines !== null
          ? plural(view.lines, 'line')
          : '',
      style: { dimColor: true },
    },
  ]
  const time: Cell = {
    text: view.state === 'pending' ? '' : timeText(view.elapsedMs),
    style: { dimColor: true },
  }
  if (view.state === 'error' && reason !== null) {
    return withReason(look, marker, { leading, time }, reason.text, reason.buttons)
  }
  return line(look, 'row', marker, [...leading, time])
}

export type ChangeLines = { files: readonly FileChange[]; moreFiles: number } | null

type ChangeLine = { text: string; isDim: boolean }

function changeLines(changes: ChangeLines): ChangeLine[] {
  if (changes === null) {
    return [{ text: 'File changes were not tracked for this call', isDim: true }]
  }
  const lines = changes.files.map((file) => ({
    text: `${file.verb} ${file.path} (${totalsText(file.totals)})`,
    isDim: false,
  }))
  if (changes.moreFiles > 0) {
    lines.push({ text: `and ${plural(changes.moreFiles, 'more changed file')}`, isDim: true })
  }
  return lines
}

export function deniedResultLine(look: RowLook, denial: Denial): RenderElement {
  return look.elements.Box({
    paddingLeft: look.hasToolMarker ? RESULT_INDENT : 0,
    children: line(
      { ...look, hasToolMarker: false },
      'row',
      'error',
      deniedCells(look, [], denial),
    ),
  })
}

export function changesBlock(look: RowLook, changes: ChangeLines): RenderElement {
  const { Box, Text } = look.elements
  return Box({
    flexDirection: 'column',
    paddingLeft: look.hasToolMarker ? RESULT_INDENT : 0,
    children: changeLines(changes).map((line, index) =>
      Box({
        key: `change-${String(index)}`,
        children: Text({ dimColor: line.isDim, wrap: 'truncate-end', children: line.text }),
      }),
    ),
  })
}
