import type { SessionMeasureInput, SessionRateLimit, SessionUsage } from 'claude-code'
import type { SharedContext } from './progress'

export const CONTEXT_HIGH = 80

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit'])

export type TurnCounts = { edits: number; errors: number; spawned: number }

export type LastTurn = TurnCounts & { durationMs: number; heldCents: number | undefined }

export type Vitals = {
  isMeasured: boolean
  hasNoUsage: boolean
  percent: number | undefined
  tokens: number | undefined
  window: number | undefined
  limits: readonly SessionRateLimit[]
  usd: number | undefined
  turnStartUsd: number | undefined
  isTurnRunning: boolean
  turnStartedAt: number | undefined
  isTurnMeasured: boolean
  compactions: number
  turn: TurnCounts
  lastTurn: LastTurn | undefined
}

const NO_COUNTS: TurnCounts = { edits: 0, errors: 0, spawned: 0 }

export const EMPTY_VITALS: Vitals = {
  isMeasured: false,
  hasNoUsage: false,
  percent: undefined,
  tokens: undefined,
  window: undefined,
  limits: [],
  usd: undefined,
  turnStartUsd: undefined,
  isTurnRunning: false,
  turnStartedAt: undefined,
  isTurnMeasured: false,
  compactions: 0,
  turn: NO_COUNTS,
  lastTurn: undefined,
}

export type VitalsUsage = Pick<SessionUsage, 'context' | 'cost' | 'rateLimits'>

export type VitalsMeasure = Pick<SessionMeasureInput, 'context' | 'cost' | 'changed' | 'rateLimits'>

export function withUsage(vitals: Vitals, usage: VitalsUsage): Vitals {
  if (vitals.isMeasured) return vitals
  const { context } = usage
  return {
    ...vitals,
    percent: context.percent,
    tokens: context.tokens,
    window: context.window,
    limits: usage.rateLimits,
    usd: usage.cost?.usd,
  }
}

export function withoutUsage(vitals: Vitals): Vitals {
  return vitals.isMeasured ? vitals : { ...vitals, hasNoUsage: true }
}

function turnStartAfter(vitals: Vitals, usd: number | undefined): number | undefined {
  const { turnStartUsd } = vitals
  if (turnStartUsd === undefined || usd === undefined) return turnStartUsd
  const isDropped = vitals.usd !== undefined && usd < vitals.usd
  return isDropped || usd < turnStartUsd ? usd : turnStartUsd
}

function limitsAfter(
  vitals: Vitals,
  measure: VitalsMeasure,
  changed: ReadonlySet<string>,
): readonly SessionRateLimit[] {
  const isCarried = changed.has('rateLimits') || measure.rateLimits.length > 0
  return isCarried ? measure.rateLimits : vitals.limits
}

export function withMeasure(vitals: Vitals, measure: VitalsMeasure): Vitals {
  const changed = new Set(measure.changed)
  const usd = changed.has('cost') ? measure.cost?.usd : vitals.usd
  const isTurnMeasure = changed.has('cost') || changed.has('context')
  const context = changed.has('context') ? measure.context : vitals
  return {
    ...vitals,
    isMeasured: true,
    hasNoUsage: false,
    percent: context.percent,
    tokens: context.tokens,
    window: context.window,
    limits: limitsAfter(vitals, measure, changed),
    usd,
    turnStartUsd: turnStartAfter(vitals, usd),
    isTurnMeasured: vitals.isTurnMeasured || isTurnMeasure,
  }
}

export function withTurnStart(vitals: Vitals, now: number): Vitals {
  const { lastTurn } = vitals
  return {
    ...vitals,
    isTurnRunning: true,
    turnStartedAt: now,
    turnStartUsd: vitals.usd,
    isTurnMeasured: false,
    turn: NO_COUNTS,
    lastTurn: lastTurn === undefined ? undefined : { ...lastTurn, heldCents: lastCents(vitals) },
  }
}

export function withTurnEnd(vitals: Vitals, durationMs: number): Vitals {
  return {
    ...vitals,
    isTurnRunning: false,
    turn: NO_COUNTS,
    lastTurn: { ...vitals.turn, durationMs, heldCents: undefined },
  }
}

function withCount(vitals: Vitals, change: (counts: TurnCounts) => TurnCounts): Vitals {
  return vitals.isTurnRunning ? { ...vitals, turn: change(vitals.turn) } : vitals
}

export function withTurnCall(vitals: Vitals, tool: string, isError: boolean): Vitals {
  return withCount(vitals, (counts) => ({
    ...counts,
    edits: counts.edits + (EDIT_TOOLS.has(tool) && !isError ? 1 : 0),
    errors: counts.errors + (isError ? 1 : 0),
  }))
}

export function withTurnSpawn(vitals: Vitals): Vitals {
  return withCount(vitals, (counts) => ({ ...counts, spawned: counts.spawned + 1 }))
}

export function withCompaction(vitals: Vitals): Vitals {
  return { ...vitals, compactions: vitals.compactions + 1 }
}

export function withClear(vitals: Vitals): Vitals {
  return { ...EMPTY_VITALS, hasNoUsage: vitals.hasNoUsage }
}

export function cents(usd: number): number {
  return Math.round(usd * 100)
}

export function dollars(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`
}

export function isHighPercent(shown: number): boolean {
  return shown >= CONTEXT_HIGH
}

export function hasReading(vitals: Vitals): boolean {
  return !vitals.hasNoUsage && vitals.tokens !== undefined
}

export function highPercent(vitals: Vitals): number | undefined {
  if (vitals.hasNoUsage || vitals.percent === undefined) return undefined
  const shown = Math.round(vitals.percent)
  return isHighPercent(shown) ? shown : undefined
}

export function highText(shown: number): string {
  return `${String(shown)}% high`
}

export function sharedContext(vitals: Vitals): SharedContext | null {
  if (vitals.hasNoUsage || vitals.percent === undefined) return null
  const { usd } = vitals
  return { percent: Math.round(vitals.percent), cents: usd === undefined ? null : cents(usd) }
}

export function addedCents(vitals: Vitals): number | undefined {
  const { usd, turnStartUsd } = vitals
  if (usd === undefined || turnStartUsd === undefined) return undefined
  return cents(usd) - cents(turnStartUsd)
}

export function lastCents(vitals: Vitals): number | undefined {
  if (vitals.isTurnRunning) return vitals.lastTurn?.heldCents
  return vitals.isTurnMeasured ? addedCents(vitals) : undefined
}
