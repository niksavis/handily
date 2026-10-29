import type {
  ContextBreakdownDetail,
  ContextCategory,
  ContextCategoryKind,
  RenderElement,
  SessionContextBreakdown,
  ThemeKey,
} from 'claude-code'
import type { BoardTrend } from '../types'
import type { PaneElements, RowLayout } from './pane'
import { type FitLine, type Part, drawFitLine, firstFitting, fitLineText } from './parts'
import { escaped } from './tasks'
import { tokensText } from './tokens'
import { turnsLeft, turnsText } from './trend'
import { fitted, padToWidth } from './width'

export const BREAKDOWN_DETAIL: ContextBreakdownDetail = 'summary'
export const PARTS_SHOWN = 7
export const SOON_TURNS = 2

const PARTS_OPEN = 'session:parts'
const PARTS_ALL = 'session:parts:all'
const SOON_COLOR: ThemeKey = 'warning'
const TURNS_SHOWN_AT_MOST = 99
const NAME_COLUMNS = 21
const NAME_COLUMNS_AT_LEAST = 8
const TOKEN_COLUMNS = 4
const PERCENT_COLUMNS = 5
const ROW_COLUMNS = NAME_COLUMNS + TOKEN_COLUMNS + PERCENT_COLUMNS
const COLUMN_GAP = 5
const TWO_COLUMNS_FROM = 2 * ROW_COLUMNS + COLUMN_GAP
const COUNTING = 'counting the parts…'
const NO_BREAKDOWN = 'no breakdown on this host'
const PARTS_FAILED = 'parts failed; /context shows them'
const PARTS_FAILED_SHORT = 'parts failed; see /context'
const AUTO_COMPACT_OFF = 'auto-compact is off'
const ESTIMATED = 'estimated; /context counts exactly'
const ESTIMATED_SHORT = 'estimated; /context exact'

export type ContextPart = { name: string; tokens: number }

export type ContextParts = {
  used: readonly ContextPart[]
  window: number
  free: number
  buffer: number
  onDemand: number
  threshold: number | undefined
  isAutoCompactOn: boolean
}

export type PartsView =
  | { kind: 'unread' }
  | { kind: 'counting' }
  | { kind: 'absent' }
  | { kind: 'failed' }
  | { kind: 'read'; parts: ContextParts }

export const UNREAD_PARTS: PartsView = { kind: 'unread' }

export const COUNTING_PARTS: PartsView = { kind: 'counting' }

export const ABSENT_PARTS: PartsView = { kind: 'absent' }

export const FAILED_PARTS: PartsView = { kind: 'failed' }

export type ContextView = { trend: BoardTrend; parts: PartsView; isPartsDue: boolean }

export type PartsPress = { layout: RowLayout; count: () => void }

function tokensOfKind(categories: readonly ContextCategory[], kind: ContextCategoryKind): number {
  return categories
    .filter((category) => category.kind === kind)
    .reduce((sum, category) => sum + category.tokens, 0)
}

export function partsOf(breakdown: SessionContextBreakdown): ContextParts {
  const { categories } = breakdown
  const used = categories
    .filter((category) => category.kind === 'used')
    .map((category) => ({ name: escaped(category.name), tokens: category.tokens }))
  return {
    used: used.sort((one, other) => other.tokens - one.tokens),
    window: breakdown.rawMaxTokens,
    free: tokensOfKind(categories, 'free'),
    buffer: tokensOfKind(categories, 'buffer'),
    onDemand: tokensOfKind(categories, 'deferred'),
    threshold: breakdown.autoCompactThreshold,
    isAutoCompactOn: breakdown.isAutoCompactEnabled,
  }
}

function plain(text: string): Part[] {
  return [{ text }]
}

function plainLine(key: string, ...forms: string[]): FitLine {
  return { key, fit: (room) => firstFitting(room, forms.map(plain)) }
}

function soonForms(turns: number): Part[][] {
  const left = turns === 0 ? ': next turn' : `: ~${turnsText(turns)}`
  const soon = { text: 'soon', color: SOON_COLOR }
  return [
    [{ text: 'auto-compact ' }, soon, { text: left }],
    [{ text: 'compact ' }, soon, { text: left }],
  ]
}

function compactForms(parts: ContextParts, trend: BoardTrend): Part[][] {
  const { threshold } = parts
  if (!parts.isAutoCompactOn || threshold === undefined) return [plain(AUTO_COMPACT_OFF)]
  const at = tokensText(threshold)
  const left = turnsLeft(threshold, trend)
  switch (left.kind) {
    case 'unknown':
      return [plain(`auto-compact at ${at}`), plain(`compact at ${at}`)]
    case 'flat':
      return [plain(`auto-compact at ${at} · no growth`), plain(`compact at ${at} · no growth`)]
    case 'left':
      if (left.turns <= SOON_TURNS) return soonForms(left.turns)
      if (left.turns > TURNS_SHOWN_AT_MOST) {
        const over = `over ${turnsText(TURNS_SHOWN_AT_MOST)}`
        return [
          plain(`auto-compact at ${at} · in ${over}`),
          plain(`compact at ${at} · ${over}`),
          plain(`compact ${at} · ${String(TURNS_SHOWN_AT_MOST)}+ turns`),
        ]
      }
      return [
        plain(`auto-compact at ${at} · in ~${turnsText(left.turns)}`),
        plain(`compact at ${at} · ~${turnsText(left.turns)}`),
        plain(`compact ${at} · ~${turnsText(left.turns)}`),
      ]
  }
}

function autoCompactLine(view: ContextView): FitLine | undefined {
  const key = 'session-auto-compact'
  const { parts } = view
  switch (parts.kind) {
    case 'unread':
      return undefined
    case 'counting':
      return plainLine(key, COUNTING)
    case 'absent':
      return plainLine(key, NO_BREAKDOWN)
    case 'failed':
      return plainLine(key, PARTS_FAILED, PARTS_FAILED_SHORT)
    case 'read': {
      const forms = compactForms(parts.parts, view.trend)
      return { key, fit: (room) => firstFitting(room, forms) }
    }
  }
}

function rowText(part: ContextPart, window: number, columns: number): string {
  const figures = TOKEN_COLUMNS + PERCENT_COLUMNS
  const hasPercent = columns - figures >= NAME_COLUMNS_AT_LEAST && window > 0
  const nameColumns = Math.min(NAME_COLUMNS, columns - (hasPercent ? figures : TOKEN_COLUMNS))
  const name = padToWidth(fitted(part.name, nameColumns - 1), nameColumns)
  const tokens = tokensText(part.tokens).padStart(TOKEN_COLUMNS)
  if (!hasPercent) return `${name}${tokens}`
  const percent = `${String(Math.round((part.tokens / window) * 100))}%`
  return `${name}${tokens}${percent.padStart(PERCENT_COLUMNS)}`
}

function partsSummaryLines(parts: ContextParts): FitLine[] {
  const free = `free ${tokensText(parts.free)}`
  const buffer = tokensText(parts.buffer)
  const onDemand = tokensText(parts.onDemand)
  return [
    parts.buffer > 0
      ? plainLine('parts-free', `${free} · compact buffer ${buffer}`, `${free} · buffer ${buffer}`)
      : plainLine('parts-free', free),
    ...(parts.onDemand > 0
      ? [
          plainLine(
            'parts-on-demand',
            `on demand ${onDemand}, not in the window`,
            `on demand ${onDemand}`,
          ),
        ]
      : []),
    plainLine('parts-estimated', ESTIMATED, ESTIMATED_SHORT),
  ]
}

function rowLines(parts: ContextParts, room: number, isAll: boolean) {
  const perLine = room >= TWO_COLUMNS_FROM ? 2 : 1
  const columns = perLine === 1 ? room : ROW_COLUMNS
  const limit = PARTS_SHOWN * perLine
  const shown = isAll ? parts.used : parts.used.slice(0, limit)
  const lines: string[] = []
  for (let at = 0; at < shown.length; at += perLine) {
    const texts = shown.slice(at, at + perLine).map((part) => rowText(part, parts.window, columns))
    lines.push(texts.join(' '.repeat(COLUMN_GAP)).trimEnd())
  }
  return { lines, hidden: parts.used.length - shown.length, isFolded: parts.used.length > limit }
}

function foldLabel(hidden: number): string {
  if (hidden === 0) return 'fewer parts'
  return hidden === 1 ? '+1 more part' : `+${String(hidden)} more parts`
}

function buttonRow(elements: PaneElements, key: string, label: string, onPress: () => void) {
  const { Box, Button } = elements
  return Box({ flexDirection: 'row', children: [Button({ key, label, onPress })] })
}

function drawPartsBlock(
  elements: PaneElements,
  parts: ContextParts,
  layout: RowLayout,
  room: number,
): RenderElement[] {
  const { Box, Text } = elements
  const rows = rowLines(parts, room, layout.expanded.has(PARTS_ALL))
  return [
    ...rows.lines.map((line, index) =>
      Box({ key: `part:${String(index)}`, children: [Text({ children: line })] }),
    ),
    rows.isFolded
      ? buttonRow(elements, PARTS_ALL, foldLabel(rows.hidden), () => {
          layout.toggle(PARTS_ALL)
        })
      : null,
    ...partsSummaryLines(parts).map((line) => drawFitLine(elements, line, room)),
  ].filter((element) => element !== null)
}

export function drawContextParts(
  elements: PaneElements,
  view: ContextView,
  press: PartsPress,
  room: number,
): RenderElement[] {
  const line = autoCompactLine(view)
  const { parts } = view
  if (parts.kind === 'absent') return line === undefined ? [] : [drawFitLine(elements, line, room)]
  const isOpen = press.layout.expanded.has(PARTS_OPEN)
  return [
    ...(line === undefined ? [] : [drawFitLine(elements, line, room)]),
    buttonRow(elements, PARTS_OPEN, isOpen ? 'hide parts' : 'context parts', () => {
      press.layout.toggle(PARTS_OPEN)
      if (!isOpen) press.count()
    }),
    ...(isOpen && parts.kind === 'read'
      ? drawPartsBlock(elements, parts.parts, press.layout, room)
      : []),
  ]
}

export function contextPartsText(view: ContextView): string[] {
  const line = autoCompactLine(view)
  const { parts } = view
  return [
    ...(line === undefined ? [] : [fitLineText(line)]),
    ...(parts.kind === 'read'
      ? [
          ...rowLines(parts.parts, ROW_COLUMNS, true).lines,
          ...partsSummaryLines(parts.parts).map(fitLineText),
        ]
      : []),
  ]
}
