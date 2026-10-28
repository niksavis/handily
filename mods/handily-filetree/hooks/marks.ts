import type { Mark, Sight, SightSource, Touch, TouchKind } from './touches'
import { displayWidth, fitted, padToWidth } from './width'

export type MarkColumn = { label: number; hasAge: boolean }

export type MarkCell = { mark: string; age: string }

const SYMBOLS: Readonly<Record<TouchKind, string>> = { edit: '✎', read: '◦' }
const VERBS: Readonly<Record<TouchKind, string>> = { edit: 'edited', read: 'read' }
const SYMBOL_COLUMNS = 1
const AGE_COLUMNS = 3
const WIDE_BODY = 70
const FULL_BODY = 36
const SHORT_BODY = 28
const WIDE_LABEL = 12
const FULL_LABEL = 9
const SHORT_LABEL = 5
const CUT_MARK = '…'
const MINUTE_S = 60
const HOUR_S = 3600
const DAY_S = 86_400
const SECOND_MS = 1000

export function markColumnOf(bodyColumns: number): MarkColumn {
  if (bodyColumns >= WIDE_BODY) return { label: WIDE_LABEL, hasAge: true }
  if (bodyColumns >= FULL_BODY) return { label: FULL_LABEL, hasAge: true }
  if (bodyColumns >= SHORT_BODY) return { label: SHORT_LABEL, hasAge: false }
  return { label: 0, hasAge: false }
}

export function markWidth(column: MarkColumn): number {
  const label = column.label === 0 ? 0 : 1 + column.label
  const age = column.hasAge ? 1 + AGE_COLUMNS : 0
  return SYMBOL_COLUMNS + label + age
}

export function ageText(ms: number): string {
  const total = Math.max(Math.floor(ms / SECOND_MS), 0)
  if (total < MINUTE_S) return `${String(total)}s`
  if (total < HOUR_S) return `${String(Math.floor(total / MINUTE_S))}m`
  if (total < DAY_S) return `${String(Math.floor(total / HOUR_S))}h`
  return `${String(Math.floor(total / DAY_S))}d`
}

export function cutLabel(label: string, width: number): string {
  if (displayWidth(label) <= width) return label
  const characters = Array.from(label)
  const room = Math.max(width - displayWidth(CUT_MARK), 0)
  const head = characters
    .slice(0, Math.ceil(room / 2))
    .join('')
    .trimEnd()
  const tail = characters
    .slice(characters.length - Math.floor(room / 2))
    .join('')
    .trimStart()
  return fitted(`${head}${CUT_MARK}${room < 2 ? '' : tail}`, width)
}

function labelText(label: string, others: number, width: number): string {
  if (others === 0) return cutLabel(label, width)
  const counted = `${label} +${String(others)}`
  if (displayWidth(counted) <= width) return counted
  const marked = `${label}+`
  if (displayWidth(marked) <= width) return marked
  return cutLabel(label, width)
}

function ageCell(column: MarkColumn, ms: number): string {
  return column.hasAge ? ` ${ageText(ms).padStart(AGE_COLUMNS)}` : ''
}

export function markCell(column: MarkColumn, mark: Mark, label: string, now: number): MarkCell {
  const symbol = SYMBOLS[mark.kind]
  const name =
    column.label === 0
      ? ''
      : ` ${padToWidth(labelText(label, mark.others, column.label), column.label)}`
  return { mark: `${symbol}${name}`, age: ageCell(column, now - mark.at) }
}

export function sightCells(
  column: MarkColumn,
  sight: Sight,
  text: { label: string; path: string; bodyColumns: number; now: number },
): MarkCell & { path: string } {
  const labelColumns = column.label === 0 ? SHORT_LABEL : column.label
  const name = `${SYMBOLS[sight.kind]} ${padToWidth(cutLabel(text.label, labelColumns), labelColumns)} `
  const age = ageCell(column, text.now - sight.at)
  const room = Math.max(text.bodyColumns - displayWidth(name) - displayWidth(age), 0)
  const path = fitted(text.path, room)
  return { mark: name, path: column.hasAge ? padToWidth(path, room) : path, age }
}

export function hiddenText(hidden: number, source: SightSource): string {
  const files = hidden === 1 ? 'file' : 'files'
  return `  and ${hidden.toLocaleString('en-US')} more ${files} from one ${source}`
}

export function isShared(touch: Touch): boolean {
  return (touch.shell?.length ?? 0) > 1
}

export function sharedLabel(touch: Touch): string {
  return `${String(touch.shell?.length ?? 1)} agents`
}

function listed(labels: readonly string[]): string {
  const last = labels.at(-1) ?? ''
  return labels.length < 2 ? last : `${labels.slice(0, -1).join(', ')} and ${last}`
}

export function touchText(touch: Touch, labelOf: (agent: string) => string, now: number): string {
  const labels = (touch.shell ?? [touch.agent]).map(labelOf)
  const age = `${ageText(now - touch.at)} ago`
  if (isShared(touch)) return `changed while Bash of ${listed(labels)} ran ${age}`
  return `${VERBS[touch.kind]} by ${listed(labels)} ${age}`
}
