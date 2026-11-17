import { displayWidth } from '../hooks/width'

const CHROME = '[  ]'.length
const COPY_WORD = 'copy'
const NOT_COPIED = '■ not copied'

function reserveOf(label: string): number {
  if (!label.startsWith(COPY_WORD)) return 0
  const rest = label.slice(COPY_WORD.length)
  return Math.max(`✓ copied${rest}`.length, NOT_COPIED.length) - label.length
}

export function buttonsLine(...labels: string[]): string {
  return labels.map((label) => `[ ${label} ]`).join(' ')
}

export function reservedWidth(...labels: string[]): number {
  return (
    labels.reduce((total, label) => total + label.length + CHROME, 0) +
    labels.length -
    1 +
    Math.max(0, ...labels.map(reserveOf))
  )
}

export const DIAGRAM_BUTTONS = buttonsLine('copy', 'copy drawing')
export const DIAGRAM_RESERVED = reservedWidth('copy', 'copy drawing')
export const TABLE_BUTTONS = buttonsLine('copy', 'copy as text')
export const TABLE_RESERVED = reservedWidth('copy', 'copy as text')

const KIND_MARKS = { table: '@', code: '§', diagram: '^', chart: '=' } as const

export function headSketch(
  kind: string,
  look: keyof typeof KIND_MARKS,
  columns: number,
  detail = '',
): string {
  const mark = KIND_MARKS[look]
  const rest = detail === '' ? '' : ` · ${detail}`
  const rule = '─'.repeat(Math.max(columns - displayWidth(`── ${kind}${rest} `), 2))
  return `~── ~${mark}*${kind}*${mark}~${rest} ${rule}~`
}

export function rowsWord(rows: number): string {
  return `${String(rows)} row${rows === 1 ? '' : 's'}`
}

export function tableHeadSketch(rows: number, width: number): string {
  const detail = rowsWord(rows)
  const least = displayWidth(`── table · ${detail} ──`) + 2 + TABLE_RESERVED
  const end = Math.max(width, least)
  const shown = displayWidth(TABLE_BUTTONS)
  return `${headSketch('table', 'table', end - 2 - shown, detail)}  ${TABLE_BUTTONS}`
}

export function tableHeadUnder(rows: number, width: number): string[] {
  return [
    headSketch('table', 'table', width, rowsWord(rows)),
    `${' '.repeat(width - displayWidth(TABLE_BUTTONS))}${TABLE_BUTTONS}`,
  ]
}
