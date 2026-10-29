import type { BoardTrend } from '../types'
import { type FitLine, type Part, firstFitting, spansWidth } from './parts'
import { tokensText } from './tokens'

export const TREND_TURNS = 20
export const PACE_TURNS = 5

const READINGS_AT_LEAST = 2
const BAR_LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const
const NO_GROWTH = 'no growth'
const NO_READING = 'trend: no context reading yet'
const NO_READING_SHORT = 'trend: no reading yet'

export const EMPTY_TREND: BoardTrend = {
  tokens: [],
  freshTokens: null,
  isAwaitingReading: false,
  isLastOpen: false,
}

export type TurnsLeft = { kind: 'unknown' } | { kind: 'flat' } | { kind: 'left'; turns: number }

function withReading(trend: BoardTrend, tokens: number): BoardTrend {
  return {
    tokens: [...trend.tokens, tokens].slice(-TREND_TURNS),
    freshTokens: null,
    isAwaitingReading: false,
    isLastOpen: true,
  }
}

function withLastReading(trend: BoardTrend, tokens: number): BoardTrend {
  if (trend.tokens.at(-1) === tokens) return trend
  return { ...trend, tokens: [...trend.tokens.slice(0, -1), tokens] }
}

export function trendMeasured(trend: BoardTrend, tokens: number): BoardTrend {
  if (trend.isAwaitingReading) return withReading(trend, tokens)
  if (trend.isLastOpen) return withLastReading(trend, tokens)
  return trend.freshTokens === tokens ? trend : { ...trend, freshTokens: tokens }
}

export function trendTurnStarted(trend: BoardTrend): BoardTrend {
  const isClosed = trend.freshTokens === null && !trend.isAwaitingReading && !trend.isLastOpen
  return isClosed
    ? trend
    : { ...trend, freshTokens: null, isAwaitingReading: false, isLastOpen: false }
}

export function trendTurnEnded(trend: BoardTrend): BoardTrend {
  if (trend.freshTokens !== null) return withReading(trend, trend.freshTokens)
  if (trend.isAwaitingReading && !trend.isLastOpen) return trend
  return { ...trend, isAwaitingReading: true, isLastOpen: false }
}

function paceOf(tokens: readonly number[]): number | undefined {
  const recent = tokens.slice(-(PACE_TURNS + 1))
  const first = recent[0]
  const last = recent.at(-1)
  if (recent.length < READINGS_AT_LEAST || first === undefined || last === undefined) {
    return undefined
  }
  return Math.round((last - first) / (recent.length - 1))
}

export function turnsLeft(threshold: number, trend: BoardTrend): TurnsLeft {
  const pace = paceOf(trend.tokens)
  const last = trend.tokens.at(-1)
  if (pace === undefined || last === undefined) return { kind: 'unknown' }
  if (pace <= 0) return { kind: 'flat' }
  return { kind: 'left', turns: Math.floor(Math.max(threshold - last, 0) / pace) }
}

export function turnsText(turns: number): string {
  return `${String(turns)} ${turns === 1 ? 'turn' : 'turns'}`
}

function barOf(tokens: number, scale: number): string {
  const raised = Math.ceil((tokens / scale) * BAR_LEVELS.length)
  const level = Math.min(Math.max(raised, 1), BAR_LEVELS.length)
  return BAR_LEVELS[level - 1] ?? ''
}

function barsOf(tokens: readonly number[], window: number | undefined): string[] {
  const scale = Math.max(window ?? Math.max(...tokens), 1)
  return tokens.map((reading) => barOf(reading, scale))
}

function plain(text: string): Part[] {
  return [{ text }]
}

function growthForms(trend: BoardTrend, window: number | undefined, room: number): Part[] {
  const pace = paceOf(trend.tokens) ?? 0
  const bars = barsOf(trend.tokens, window)
  const isGrowing = pace > 0
  const paceLong = isGrowing ? `+${tokensText(pace)} a turn` : NO_GROWTH
  const paceShort = isGrowing ? `+${tokensText(pace)}/turn` : NO_GROWTH
  const turns = turnsText(trend.tokens.length)
  const long = plain(`trend ${bars.join('')} ${turns} · ${paceLong}`)
  const short = plain(`trend ${bars.join('')} ${paceShort}`)
  const barRoom = room - spansWidth(plain(`trend  ${paceShort}`))
  const kept = bars.slice(-Math.max(barRoom, READINGS_AT_LEAST))
  return firstFitting(room, [long, short, plain(`trend ${kept.join('')} ${paceShort}`)])
}

export function trendLine(
  trend: BoardTrend,
  window: number | undefined,
  hasReading: boolean,
): FitLine {
  const fit = (room: number): Part[] => {
    if (trend.tokens.length === 0 && !hasReading) {
      return firstFitting(room, [plain(NO_READING), plain(NO_READING_SHORT)])
    }
    if (trend.tokens.length < READINGS_AT_LEAST) {
      return firstFitting(room, [plain(`trend after ${turnsText(READINGS_AT_LEAST)}`)])
    }
    return growthForms(trend, window, room)
  }
  return { key: 'session-trend', fit }
}
