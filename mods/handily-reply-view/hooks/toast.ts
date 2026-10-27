import type { EngineInterface } from 'claude-code'
import { displayWidth, fitted, padToWidth } from './width'

export const TOAST_COLUMNS = 40

export const TOAST_MARKS = {
  doing: '▶',
  done: '✓',
  toDo: '○',
  blocked: '■',
  waitsForYou: '◆',
} as const

export type ToastPart = string | { readonly quoted: string }

export type ToastParts = readonly [ToastPart, ...ToastPart[]]

const MOST_LINES = 3
const LINE_BREAK_ROOM = 1
const QUOTE = '"'
const CUT_MARK = '…'
const BASE_MS = 2000
const MS_PER_CELL = 80
const SHORTEST_MS = 6000
const LONGEST_MS = 15000
const SHORTEST_MS_TO_ACT = 10000
const MARKS_TO_ACT: readonly string[] = [TOAST_MARKS.blocked, TOAST_MARKS.waitsForYou]
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const UNSAFE_IN_QUOTES = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

function escaped(grapheme: string): string {
  return JSON.stringify(grapheme).slice(1, -1).replace(UNSAFE_IN_QUOTES, escapedUnits)
}

function quotedToWidth(text: string, columns: number): string {
  const pieces = Array.from(GRAPHEMES.segment(text), (part) => escaped(part.segment))
  const room = columns - 2 * displayWidth(QUOTE)
  const whole = pieces.join('')
  if (displayWidth(whole) <= room) return `${QUOTE}${whole}${QUOTE}`
  let kept = ''
  for (const piece of pieces) {
    if (displayWidth(kept + piece) > room - displayWidth(CUT_MARK)) break
    kept += piece
  }
  return `${QUOTE}${kept.trimEnd()}${CUT_MARK}${QUOTE}`
}

function shownPart(part: ToastPart, columns: number): string {
  return typeof part === 'string' ? fitted(part, columns) : quotedToWidth(part.quoted, columns)
}

function shownParts(parts: ToastParts): string[] {
  if (parts.length > MOST_LINES) {
    throw new Error(
      `a toast shows at most ${String(MOST_LINES)} lines; it got ${String(parts.length)} parts`,
    )
  }
  const last = parts.length - 1
  return parts.map((part, index) =>
    shownPart(part, index === last ? TOAST_COLUMNS : TOAST_COLUMNS - LINE_BREAK_ROOM),
  )
}

export function toastText(parts: ToastParts): string {
  const shown = shownParts(parts)
  const last = shown.length - 1
  return shown
    .map((part, index) => (index === last ? part : padToWidth(part, TOAST_COLUMNS)))
    .join('')
}

function isToAct(parts: ToastParts): boolean {
  return parts.some(
    (part) => typeof part === 'string' && MARKS_TO_ACT.some((mark) => part.includes(mark)),
  )
}

export function toastMs(parts: ToastParts): number {
  const cells = shownParts(parts).reduce((sum, part) => sum + displayWidth(part), 0)
  const ms = Math.min(Math.max(BASE_MS + MS_PER_CELL * cells, SHORTEST_MS), LONGEST_MS)
  return isToAct(parts) ? Math.max(ms, SHORTEST_MS_TO_ACT) : ms
}

export function showToast($: EngineInterface, parts: ToastParts): void {
  $.ui.toast(toastText(parts), { timeoutMs: toastMs(parts) })
}
