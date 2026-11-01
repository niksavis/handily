import type { FileFacts } from './facts'
import { countText } from './source'
import type { FiletreeColumn } from '../types'

export const COLUMN_ORDER: readonly FiletreeColumn[] = ['changes', 'date', 'size', 'lines']

export const DEFAULT_COLUMN: FiletreeColumn = 'changes'

export const COLUMN_LABELS: Readonly<Record<FiletreeColumn, string>> = {
  changes: '+/-',
  date: 'date',
  size: 'size',
  lines: 'lines',
}

export const COLUMN_HOTKEY = 'i'

export type ColumnDraw = {
  choice: FiletreeColumn
  cycle: () => void
  factsOf: (path: string) => FileFacts
  want: (paths: readonly string[], needsLines: boolean) => void
}

export type ColumnValue = { text: string; why: string | undefined }

const UNITS = ['B', 'K', 'M', 'G'] as const
const STEP = 1024
const ONE_DECIMAL_BELOW = 10
const BINARY = 'bin'
const TOO_LARGE = 'over 4M'
const UNKNOWN = '?'

export function nextColumn(choice: FiletreeColumn): FiletreeColumn {
  const at = COLUMN_ORDER.indexOf(choice)
  return COLUMN_ORDER[(at + 1) % COLUMN_ORDER.length] ?? DEFAULT_COLUMN
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function dateText(ms: number, now: number): string {
  const at = new Date(ms)
  const today = new Date(now)
  const isThisYear = at.getFullYear() === today.getFullYear()
  const isToday =
    isThisYear && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  if (isToday) return `${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`
  if (isThisYear) return `${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`
  return String(at.getFullYear())
}

export function sizeText(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP
    unit += 1
  }
  const shown =
    unit > 0 && value < ONE_DECIMAL_BELOW
      ? (Math.floor(value * 10) / 10).toFixed(1)
      : String(Math.floor(value))
  return `${shown}${UNITS[unit] ?? ''}`
}

export function columnValue(
  choice: FiletreeColumn,
  facts: FileFacts,
  now: number,
): ColumnValue | undefined {
  if (choice === 'changes') return undefined
  const { stat, lines } = facts
  if (stat === undefined) return undefined
  if (stat.kind === 'failed') {
    return { text: UNKNOWN, why: `${COLUMN_LABELS[choice]} not shown: ${stat.reason}` }
  }
  if (choice === 'date') return { text: dateText(stat.mtimeMs, now), why: undefined }
  if (choice === 'size') return { text: sizeText(stat.size), why: undefined }
  if (lines === undefined) return undefined
  switch (lines.kind) {
    case 'lines':
      return { text: countText(lines.count), why: undefined }
    case 'binary':
      return { text: BINARY, why: 'lines not counted: a binary file' }
    case 'too-large':
      return { text: TOO_LARGE, why: 'lines not counted: over 4 MiB' }
    case 'unreadable':
      return { text: UNKNOWN, why: `lines not counted: ${lines.reason}` }
  }
}
