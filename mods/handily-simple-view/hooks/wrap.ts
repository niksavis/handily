import type { Color } from 'claude-code'
import { graphemesOf } from './width'

export type Span = { text: string; color?: Color; isBold?: boolean; isDim?: boolean }

export type StyledLine = readonly Span[]

export const WRAP_MARK = '↳ '
const WRAP_MARK_CELLS = 2
const LEAST_WRAP_COLUMNS = 8

export function plainLine(text: string, isDim = false): StyledLine {
  return [isDim ? { text, isDim } : { text }]
}

export function lineText(line: StyledLine): string {
  return line.map((span) => span.text).join('')
}

export function wrappedLine(line: StyledLine, columns: number): StyledLine[] {
  if (columns < LEAST_WRAP_COLUMNS || lineText(line) === '') return [line]
  const rows: Span[][] = []
  let row: Span[] = []
  let room = columns
  const startRow = () => {
    rows.push(row)
    row = [{ text: WRAP_MARK, isDim: true }]
    room = columns - WRAP_MARK_CELLS
  }
  for (const span of line) {
    let piece = ''
    for (const { grapheme, cells } of graphemesOf(span.text)) {
      if (cells > room) {
        if (piece !== '') row.push({ ...span, text: piece })
        piece = ''
        startRow()
      }
      piece += grapheme
      room -= cells
    }
    if (piece !== '') row.push({ ...span, text: piece })
  }
  rows.push(row)
  return rows
}
