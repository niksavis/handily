import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import { elapsedText } from './detail'
import type { BashEnd, FileChange, StderrSummary, Totals } from './output'

type RowElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>
type CellStyle = Omit<Parameters<RowElements['Text']>[0], 'children'>
type Cell = { text: string; style?: CellStyle; canShrink?: boolean }

export type RowLook = { elements: RowElements; hasToolMarker: boolean }

export type BashState = { kind: 'running' } | BashEnd

export type BashView = {
  label: string
  program: string
  state: BashState
  elapsedMs: number | null
}

function cell({ Box, Text }: RowElements, { text, style = {}, canShrink = false }: Cell) {
  return Box({ flexShrink: canShrink ? 1 : 0, children: Text({ ...style, children: text }) })
}

function line(look: RowLook, key: string, marker: ThemeKey, cells: Cell[]): RenderElement {
  const { elements } = look
  const columns = elements.Box({
    flexDirection: 'row',
    gap: 2,
    children: cells.filter((part) => part.text !== '').map((part) => cell(elements, part)),
  })
  if (!look.hasToolMarker) return elements.Box({ key, children: columns })
  const dot = elements.Box({
    flexShrink: 0,
    marginRight: 1,
    children: elements.Text({ color: marker, children: '●' }),
  })
  return elements.Box({ key, flexDirection: 'row', children: [dot, columns] })
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

function stateCells(state: BashState): Cell[] {
  switch (state.kind) {
    case 'running':
      return [{ text: 'running', style: { color: 'warning' } }]
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
        { text: `exit ${String(state.code)}`, style: { color: 'error' } },
        { text: state.line, style: { color: 'error', wrap: 'truncate-end' }, canShrink: true },
      ]
  }
}

const MARKERS: Readonly<Record<BashState['kind'], ThemeKey>> = {
  running: 'subtle',
  done: 'success',
  exit: 'error',
}

export function bashRow(look: RowLook, view: BashView): RenderElement {
  return line(look, 'row', MARKERS[view.state.kind], [
    { text: view.label, style: { wrap: 'truncate-end' }, canShrink: true },
    { text: view.program, style: { dimColor: true } },
    ...stateCells(view.state),
    {
      text: view.elapsedMs === null ? '' : elapsedText(view.elapsedMs),
      style: { dimColor: true },
    },
  ])
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
