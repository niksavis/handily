import type { Color } from 'claude-code'
import { graphemesOf } from './width'

export type Span = { text: string; color?: Color; isBold?: boolean; isDim?: boolean }

export type StyledLine = readonly Span[]

type Cell = { grapheme: string; cells: number; span: Span }

export const WRAP_MARK = '↳ '
const WRAP_MARK_CELLS = 2
const LEAST_WRAP_COLUMNS = 8
const MARK_SPAN: Span = { text: WRAP_MARK, isDim: true }

export function plainLine(text: string, isDim = false): StyledLine {
  return [isDim ? { text, isDim } : { text }]
}

export function lineText(line: StyledLine): string {
  return line.map((span) => span.text).join('')
}

function spansOf(cells: readonly Cell[]): Span[] {
  const spans: Span[] = []
  let last: Cell | null = null
  for (const cell of cells) {
    const previous = spans.at(-1)
    if (previous !== undefined && last?.span === cell.span) previous.text += cell.grapheme
    else spans.push({ ...cell.span, text: cell.grapheme })
    last = cell
  }
  return spans
}

function widthOf(cells: readonly Cell[]): number {
  return cells.reduce((sum, cell) => sum + cell.cells, 0)
}

function fitting(row: readonly Cell[], room: number): number {
  let used = 0
  for (const [index, cell] of row.entries()) {
    used += cell.cells
    if (used > room) return Math.max(index, 1)
  }
  return row.length
}

function breakAt(row: readonly Cell[], room: number): number {
  for (let index = row.length - 1; index > 0; index -= 1) {
    if (row[index]?.grapheme === ' ' && widthOf(row.slice(0, index + 1)) <= room) return index + 1
  }
  return fitting(row, room)
}

export function wrappedLine(line: StyledLine, columns: number): StyledLine[] {
  if (columns < LEAST_WRAP_COLUMNS || lineText(line) === '') return [line]
  const rows: Cell[][] = []
  let row: Cell[] = []
  let room = columns
  for (const span of line) {
    for (const { grapheme, cells } of graphemesOf(span.text)) {
      const cell = { grapheme, cells, span }
      while (row.length > 0 && widthOf(row) + cells > room) {
        const cut = breakAt(row, room)
        rows.push(row.slice(0, cut))
        row = row.slice(cut)
        room = columns - WRAP_MARK_CELLS
      }
      row.push(cell)
    }
  }
  rows.push(row)
  return rows.map((cells, index) => (index === 0 ? spansOf(cells) : [MARK_SPAN, ...spansOf(cells)]))
}
