import { copiedCell, plainCell, shownText, type Alignment, type Table } from './markdown'
import { cutToWidth, displayWidth, graphemesOf, padToWidth } from './width'

export const COLUMN_GAP = 3
const LONG_COLUMN_CELLS_AT_LEAST = 12
const COLUMN_CELLS_AT_LEAST = 6

export type TableLook = {
  header: string[]
  rows: string[][]
  alignments: Alignment[]
  widths: number[]
}

type CellText = (cell: string) => string

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, value) => total + value, 0)
}

function headerOf(table: Table, text: CellText): string[] {
  return table.header.map((cell, index) => text(cell) || `Column ${String(index + 1)}`)
}

function rowsOf(table: Table, text: CellText): string[][] {
  return table.rows.map((row) => row.map(text))
}

export function tableLook(table: Table): TableLook {
  const header = headerOf(table, plainCell).map(shownText)
  const rows = rowsOf(table, plainCell).map((row) => row.map(shownText))
  const widths = header.map((cell, index) =>
    Math.max(displayWidth(cell), ...rows.map((row) => displayWidth(row[index] ?? ''))),
  )
  return { header, rows, alignments: table.alignments, widths }
}

function gapsOf(columns: number): number {
  return COLUMN_GAP * Math.max(columns - 1, 0)
}

export function tableWidth(widths: readonly number[]): number {
  return sum(widths) + gapsOf(widths.length)
}

function longColumns(naturals: readonly number[], free: number) {
  let long = naturals.map((_, index) => index)
  let left = free
  for (;;) {
    const share = left / long.length
    const short = long.filter((index) => (naturals[index] ?? 0) <= share)
    if (short.length === 0 || short.length === long.length) return { long, left }
    left -= sum(short.map((index) => naturals[index] ?? 0))
    long = long.filter((index) => !short.includes(index))
  }
}

function sharedWidths(
  naturals: readonly number[],
  long: readonly number[],
  room: number,
  least: number,
): Map<number, number> {
  const widths = new Map<number, number>()
  const natural = (index: number) => naturals[index] ?? 0
  let open = [...long]
  let left = room
  for (;;) {
    const weight = sum(open.map(natural))
    const under = open.filter((index) => (left * natural(index)) / weight < least)
    if (under.length === 0 || under.length === open.length) break
    for (const index of under) widths.set(index, least)
    left -= least * under.length
    open = open.filter((index) => !under.includes(index))
  }
  const weight = sum(open.map(natural))
  const exact = open.map((index) => ({ index, share: (left * natural(index)) / weight }))
  let spare = left - sum(exact.map(({ share }) => Math.floor(share)))
  const byFraction = exact.sort((a, b) => (b.share % 1) - (a.share % 1) || a.index - b.index)
  for (const { index, share } of byFraction) {
    widths.set(index, Math.floor(share) + (spare > 0 ? 1 : 0))
    spare -= 1
  }
  return widths
}

export function columnWidths(naturals: readonly number[], room: number): number[] | null {
  const free = room - gapsOf(naturals.length)
  if (sum(naturals) <= free) return [...naturals]
  const { long, left } = longColumns(naturals, free)
  const least = Math.min(LONG_COLUMN_CELLS_AT_LEAST, Math.floor(left / long.length))
  if (least < COLUMN_CELLS_AT_LEAST) return null
  const shared = sharedWidths(naturals, long, left, least)
  return naturals.map((natural, index) => shared.get(index) ?? natural)
}

function piecesOf(word: string, width: number): string[] {
  const pieces: string[] = []
  let rest = word
  while (displayWidth(rest) > width) {
    const piece = cutToWidth(rest, width) || (graphemesOf(rest)[0] ?? rest)
    pieces.push(piece)
    rest = rest.slice(piece.length)
  }
  return [...pieces, rest]
}

export function wrapCell(text: string, width: number): string[] {
  if (displayWidth(text) <= width) return [text]
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ').filter((part) => part !== '')) {
    for (const piece of piecesOf(word, width)) {
      const joined = line === '' ? piece : `${line} ${piece}`
      if (line === '' || displayWidth(joined) <= width) {
        line = joined
        continue
      }
      lines.push(line)
      line = piece
    }
  }
  return [...lines, line]
}

function aligned(text: string, width: number, alignment: Alignment): string {
  const room = Math.max(width - displayWidth(text), 0)
  if (alignment === 'right') return ' '.repeat(room) + text
  if (alignment === 'center') return padToWidth(' '.repeat(Math.floor(room / 2)) + text, width)
  return padToWidth(text, width)
}

function lineOf(look: TableLook, widths: readonly number[], cells: readonly string[]): string {
  return cells
    .map((cell, index) => aligned(cell, widths[index] ?? 0, look.alignments[index] ?? 'left'))
    .join(' '.repeat(COLUMN_GAP))
    .trimEnd()
}

export function linesOf(
  look: TableLook,
  widths: readonly number[],
  cells: readonly string[],
): string[] {
  const wrapped = widths.map((width, index) => wrapCell(cells[index] ?? '', width))
  const height = Math.max(1, ...wrapped.map((lines) => lines.length))
  return Array.from({ length: height }, (_, line) =>
    lineOf(
      look,
      widths,
      wrapped.map((lines) => lines[line] ?? ''),
    ),
  )
}

export function headerLines(look: TableLook, widths: readonly number[]): string[] {
  return linesOf(look, widths, look.header)
}

export function rowTitle(row: readonly string[], index: number): string {
  const first = row[0] ?? ''
  return first === '' ? `Row ${String(index + 1)}` : first
}

export type Field = { label: string; value: string }

export function fieldsOf(look: TableLook, row: readonly string[]): Field[] {
  return look.header
    .slice(1)
    .map((label, index) => ({ label, value: row[index + 1] ?? '' }))
    .filter((field) => field.value !== '')
}

export function labelWidth(look: TableLook): number {
  return Math.max(0, ...look.header.slice(1).map(displayWidth)) + 1
}

export function textCopy(table: Table): string {
  const header = headerOf(table, copiedCell)
  return rowsOf(table, copiedCell)
    .map((row) =>
      header
        .map((label, index) => ({ label, value: row[index] ?? '' }))
        .filter((field) => field.value !== '')
        .map((field) => `${field.label}: ${field.value}`)
        .join('\n'),
    )
    .join('\n\n')
}
