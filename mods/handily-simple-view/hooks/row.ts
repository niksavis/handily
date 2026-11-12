import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import { elapsedText } from './detail'
import type { BashEnd, Denial, FileChange, StderrSummary, Totals } from './output'
import { displayWidth } from './width'

type RowElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>
type CellStyle = Omit<Parameters<RowElements['Text']>[0], 'children'>
type Cell = { text: string; style?: CellStyle; canShrink?: boolean; keptCells?: number }

export type RowLook = { elements: RowElements; hasToolMarker: boolean; columns: number }

export type BashState = { kind: 'pending' } | { kind: 'running' } | BashEnd

export type BashView = {
  label: string
  program: string
  state: BashState
  elapsedMs: number | null
}

const LABEL_KEPT_CELLS = 40
const PENDING_TEXT = '…'
const MARKER_CELLS = 2
const CELL_GAP = 2
const REFUSED_WORD = 'refused'
const DENIED_WORD = 'denied'
const CLASSIFIER_DENIER = 'auto mode'
const TIME_SHOWN_FROM_MS = 1000

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
    elements.Box({ flexGrow: 1, minWidth: 2 }),
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
      return errorCells(`exit ${String(state.code)}`, state.line)
    case 'refused':
      return errorCells(REFUSED_WORD, state.line)
    case 'error':
      return errorCells(state.kind, state.line)
  }
}

function errorCells(word: string, line: string): Cell[] {
  return [
    { text: word, style: { color: 'error' } },
    { text: line, style: { color: 'error', wrap: 'truncate-end' }, canShrink: true },
  ]
}

function leastCells(cell: Cell): number {
  return cell.canShrink === true ? (cell.keptCells ?? 0) : displayWidth(cell.text)
}

function deniedCells(look: RowLook, others: readonly Cell[], denial: Denial): Cell[] {
  const word: Cell = { text: DENIED_WORD, style: { color: 'error' } }
  if (denial.reason === null) return [word, { text: CLASSIFIER_DENIER, style: { color: 'error' } }]
  const text = `${CLASSIFIER_DENIER}: ${denial.reason}`
  const drawn = [...others.filter((other) => other.text !== ''), word]
  const used =
    (look.hasToolMarker ? MARKER_CELLS : 0) +
    CELL_GAP * drawn.length +
    drawn.reduce((sum, other) => sum + leastCells(other), 0)
  const floor = displayWidth(`${CLASSIFIER_DENIER}: `)
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

function hasCutText(state: BashState): boolean {
  if (state.kind === 'done') return state.stderr !== null
  return 'line' in state && state.line !== ''
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
  actions: RenderElement | null = null,
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
  return line(look, 'row', MARKERS[view.state.kind], [label, program, ...state, time], actions)
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
): RenderElement {
  return line(look, 'row', 'error', [
    { text: tool },
    ...keptTargetCells(target),
    ...errorCells(REFUSED_WORD, message),
  ])
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
}

const GENERIC_STATES: Readonly<Record<GenericState, { marker: ThemeKey; cell: Cell }>> = {
  pending: { marker: 'subtle', cell: { text: PENDING_TEXT, style: { dimColor: true } } },
  running: { marker: 'subtle', cell: { text: 'running', style: { dimColor: true } } },
  done: { marker: 'success', cell: { text: 'done', style: { color: 'success' } } },
  error: { marker: 'error', cell: { text: 'error', style: { color: 'error' } } },
}

export function genericRow(look: RowLook, view: GenericView): RenderElement {
  const { marker, cell: stateCell } = GENERIC_STATES[view.state]
  return line(look, 'row', marker, [
    { text: view.label },
    { text: view.summary, style: { wrap: 'truncate-end' }, canShrink: true },
    stateCell,
    {
      text: view.state === 'done' && view.lines !== null ? plural(view.lines, 'line') : '',
      style: { dimColor: true },
    },
    { text: view.state === 'pending' ? '' : timeText(view.elapsedMs), style: { dimColor: true } },
  ])
}

export type ChangeLines = { files: readonly FileChange[]; moreFiles: number } | null

const RESULT_INDENT = 2

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
