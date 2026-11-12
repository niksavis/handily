import type { SessionRateLimit } from 'claude-code'
import { elapsedText } from './activity'
import type { ToastRole } from './toast'

export const PACE_SPAN_MS = 15 * 60_000
export const PACE_STALE_MS = 30 * 60_000
export const READING_STEP_MS = 60_000
export const READINGS_KEPT = 60
export const CYCLE_APART_MS = 10 * 60_000
export const NEW_CYCLE_FALL = 20
export const FULL_PERCENT = 100
export const WARN_MARK: ToastRole = 'waitsForYou'
export const WARN_LEVELS = [95, 80] as const
export const LEVEL_WORDS: Readonly<Record<WarnLevel, string>> = { 80: '', 95: 'nearly full' }
export const CLAIM_WAIT_MS = { least: 200, most: 800 } as const

export type WarnLevel = (typeof WARN_LEVELS)[number]

export type LimitReading = { at: number; percent: number }

export type KindReadings = { resetsAt: string | undefined; readings: readonly LimitReading[] }

export type LimitReadings = ReadonlyMap<string, KindReadings>

export const NO_READINGS: LimitReadings = new Map()

export type Pace =
  | { kind: 'full'; inMs: number }
  | { kind: 'later' }
  | { kind: 'flat' }
  | { kind: 'few' }
  | { kind: 'stale'; ageMs: number }

const NO_PACE_YET = 'no pace yet'

function timeOf(stamp: string | null | undefined): number | undefined {
  if (stamp === null || stamp === undefined) return undefined
  const at = Date.parse(stamp)
  return Number.isFinite(at) ? at : undefined
}

export function isSameCycle(
  kept: string | null | undefined,
  resetsAt: string | null | undefined,
): boolean {
  const keptAt = timeOf(kept)
  const resetAt = timeOf(resetsAt)
  if (keptAt === undefined || resetAt === undefined) return keptAt === resetAt
  return Math.abs(keptAt - resetAt) <= CYCLE_APART_MS
}

function nextReadings(
  kept: KindReadings | undefined,
  limit: SessionRateLimit,
  at: number,
): KindReadings {
  const reading = { at, percent: limit.percentUsed }
  const last = kept?.readings.at(-1)
  const isNewRun =
    kept === undefined ||
    last === undefined ||
    !isSameCycle(kept.resetsAt, limit.resetsAt) ||
    limit.percentUsed < last.percent
  if (isNewRun) return { resetsAt: limit.resetsAt, readings: [reading] }
  const before = kept.readings.at(-2)
  const isCloseToBefore = before !== undefined && at - before.at < READING_STEP_MS
  const earlier = isCloseToBefore ? kept.readings.slice(0, -1) : kept.readings
  return { resetsAt: limit.resetsAt, readings: [...earlier, reading].slice(-READINGS_KEPT) }
}

export function withReadings(
  readings: LimitReadings,
  limits: readonly SessionRateLimit[],
  at: number,
): LimitReadings {
  const next = new Map(readings)
  for (const limit of limits)
    next.set(limit.kind, nextReadings(readings.get(limit.kind), limit, at))
  return next
}

export function paceOf(readings: LimitReadings, limit: SessionRateLimit, now: number): Pace {
  const kept = readings.get(limit.kind)?.readings ?? []
  const first = kept[0]
  const last = kept.at(-1)
  if (first === undefined || last === undefined) return { kind: 'few' }
  const ageMs = now - last.at
  if (ageMs > PACE_STALE_MS) return { kind: 'stale', ageMs }
  const spanMs = last.at - first.at
  if (kept.length < 2 || spanMs < PACE_SPAN_MS) return { kind: 'few' }
  const resetAt = timeOf(limit.resetsAt)
  if (resetAt === undefined || limit.percentUsed >= FULL_PERCENT) return { kind: 'few' }
  const rise = last.percent - first.percent
  if (rise <= 0) return { kind: 'flat' }
  const fullAt = last.at + ((FULL_PERCENT - last.percent) * spanMs) / rise
  if (fullAt <= now) return { kind: 'stale', ageMs }
  return fullAt < resetAt ? { kind: 'full', inMs: fullAt - now } : { kind: 'later' }
}

export function paceWords(pace: Pace): string {
  switch (pace.kind) {
    case 'full':
      return `full ~${elapsedText(pace.inMs)}`
    case 'later':
      return 'full after reset'
    case 'flat':
      return 'no growth'
    case 'few':
      return NO_PACE_YET
    case 'stale':
      return `no reading for ${elapsedText(pace.ageMs)}`
  }
}

export function fullText(pace: Pace): string | undefined {
  return pace.kind === 'full' ? paceWords(pace) : undefined
}

export function toastPaceWords(pace: Pace): string {
  if (pace.kind === 'full') return `${paceWords(pace)} at this pace`
  return pace.kind === 'few' || pace.kind === 'stale' ? NO_PACE_YET : paceWords(pace)
}

export function detailPaceTexts(
  readings: LimitReadings,
  limits: readonly SessionRateLimit[],
  now: number,
  name: (limit: SessionRateLimit) => string,
): string[] {
  if (limits.length === 0) return []
  const paces = limits.map((limit) => ({ limit, pace: paceOf(readings, limit, now) }))
  const stale = paces.flatMap(({ pace }) => (pace.kind === 'stale' ? [pace.ageMs] : []))
  if (stale.length === paces.length) {
    return [`pace: no reading for ${elapsedText(Math.min(...stale))}`]
  }
  if (paces.every(({ pace }) => pace.kind === 'few')) {
    return [`pace after ${elapsedText(PACE_SPAN_MS)} of readings`]
  }
  return paces.map(
    ({ limit, pace }, index) => `${index === 0 ? 'pace ' : ''}${name(limit)} ${paceWords(pace)}`,
  )
}
