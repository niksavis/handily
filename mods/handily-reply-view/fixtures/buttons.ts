import { displayWidth } from '../hooks/width'

const CHROME = '[  ]'.length
const COPY_WORD = 'copy'
const NOT_COPIED = '■ not copied'

export function copySlot(label: string, shown = label): string {
  const rest = label.slice(COPY_WORD.length)
  const widest = Math.max(label.length, `✓ copied${rest}`.length, NOT_COPIED.length) + CHROME
  return `[ ${shown} ]`.padStart(widest)
}

export function buttonsLine(...labels: string[]): string {
  return labels
    .map((label, index) =>
      label.startsWith(COPY_WORD) && index > 0 ? copySlot(label) : `[ ${label} ]`,
    )
    .join(' ')
}

export const DIAGRAM_BUTTONS = buttonsLine('copy', 'copy drawing')
export const TABLE_BUTTONS = buttonsLine('copy', 'copy as text')

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
  const buttons = displayWidth(TABLE_BUTTONS)
  const least = displayWidth(`── table · ${detail} ──`) + 2 + buttons
  const end = Math.max(width, least)
  return `${headSketch('table', 'table', end - 2 - buttons, detail)}  ${TABLE_BUTTONS}`
}

export function tableHeadUnder(rows: number, width: number): string[] {
  return [
    headSketch('table', 'table', width, rowsWord(rows)),
    `${' '.repeat(width - displayWidth(TABLE_BUTTONS))}${TABLE_BUTTONS}`,
  ]
}
