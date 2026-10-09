import { plainCell, type Alignment, type Table } from './markdown'
import { displayWidth, padToWidth } from './width'

export const COLUMN_GAP = 3

export type TableLook = {
  header: string[]
  rows: string[][]
  alignments: Alignment[]
  widths: number[]
}

export function tableLook(table: Table): TableLook {
  const header = table.header.map((cell, index) => plainCell(cell) || `Column ${String(index + 1)}`)
  const rows = table.rows.map((row) => row.map(plainCell))
  const widths = header.map((cell, index) =>
    Math.max(displayWidth(cell), ...rows.map((row) => displayWidth(row[index] ?? ''))),
  )
  return { header, rows, alignments: table.alignments, widths }
}

export function tableWidth(look: TableLook): number {
  return look.widths.reduce((sum, width) => sum + width, 0) + COLUMN_GAP * (look.widths.length - 1)
}

function aligned(text: string, width: number, alignment: Alignment): string {
  const room = Math.max(width - displayWidth(text), 0)
  if (alignment === 'right') return ' '.repeat(room) + text
  if (alignment === 'center') return padToWidth(' '.repeat(Math.floor(room / 2)) + text, width)
  return padToWidth(text, width)
}

export function lineOf(look: TableLook, cells: readonly string[]): string {
  return cells
    .map((cell, index) => aligned(cell, look.widths[index] ?? 0, look.alignments[index] ?? 'left'))
    .join(' '.repeat(COLUMN_GAP))
    .trimEnd()
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

export function textCopy(look: TableLook): string {
  return look.rows
    .map((row) =>
      look.header
        .map((label, index) => ({ label, value: row[index] ?? '' }))
        .filter((field) => field.value !== '')
        .map((field) => `${field.label}: ${field.value}`)
        .join('\n'),
    )
    .join('\n\n')
}
