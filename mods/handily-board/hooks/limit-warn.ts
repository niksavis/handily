import type { SessionRateLimit, Timer } from 'claude-code'
import { elapsedText } from './activity'
import { limitName, resetsInMs } from './details'
import {
  CLAIM_WAIT_MS,
  LEVEL_WORDS,
  type LimitReadings,
  NEW_CYCLE_FALL,
  WARN_LEVELS,
  WARN_MARK,
  type WarnLevel,
  isSameCycle,
  paceOf,
  toastPaceWords,
} from './pace'
import { type ToastLine, type ToastParts, marked } from './toast'

export const WARN_PREFIX = 'limit-warned:'

const WARN_VERSION = 1
const SAFE_KIND = /^[a-z0-9_]{1,40}$/u
const UINT32_RANGE = 2 ** 32

export type Warned = {
  v: typeof WARN_VERSION
  kind: string
  cycle: string | null
  level: WarnLevel
  at: number
  by: string
}

export type WarnHost = {
  now: () => Promise<number>
  sessionId: () => Promise<string>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  storeDelete: (key: string) => Promise<void>
  storeKeys: () => Promise<readonly string[]>
  after: (ms: number, fn: () => void) => Timer
  random: () => number
  showToast: (parts: ToastParts) => void
  debug: (line: string) => void
}

export type WarnKeep = { warned: Map<string, Warned>; claiming: Set<string> }

export function randomUnit(): number {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  return value / UINT32_RANGE
}

export function newWarnKeep(): WarnKeep {
  return { warned: new Map(), claiming: new Set() }
}

function warnKey(kind: string): string {
  return `${WARN_PREFIX}${kind}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWarnLevel(value: unknown): value is WarnLevel {
  return WARN_LEVELS.some((level) => level === value)
}

export function readWarned(value: unknown): Warned | null {
  if (!isRecord(value) || value.v !== WARN_VERSION) return null
  const { kind, cycle, level, at, by } = value
  if (typeof kind !== 'string' || !SAFE_KIND.test(kind)) return null
  if (cycle !== null && typeof cycle !== 'string') return null
  if (!isWarnLevel(level) || typeof at !== 'number' || typeof by !== 'string') return null
  return { v: WARN_VERSION, kind, cycle, level, at, by }
}

function cycleOf(limit: SessionRateLimit): string | null {
  return limit.resetsAt ?? null
}

function isPastCycle(warned: Warned, now: number): boolean {
  if (warned.cycle === null) return false
  const at = Date.parse(warned.cycle)
  return !Number.isFinite(at) || at <= now
}

function isOtherCycle(warned: Warned, limit: SessionRateLimit, now: number): boolean {
  if (isPastCycle(warned, now) || !isSameCycle(warned.cycle, cycleOf(limit))) return true
  return warned.cycle === null && limit.percentUsed <= warned.level - NEW_CYCLE_FALL
}

function levelOf(percent: number): WarnLevel | undefined {
  return WARN_LEVELS.find((level) => percent >= level)
}

function isWarnedAt(warned: Warned | undefined, level: WarnLevel): boolean {
  return warned !== undefined && warned.level >= level
}

function headLine(limit: SessionRateLimit, level: WarnLevel): ToastLine {
  const word = LEVEL_WORDS[level]
  const head = `${limitName(limit)} limit at ${String(level)}%`
  return marked(WARN_MARK, word === '' ? head : `${head} ${word}`)
}

function resetWords(limit: SessionRateLimit, now: number): string | undefined {
  const inMs = resetsInMs(limit, now)
  return inMs === undefined || inMs <= 0 ? undefined : `resets in ${elapsedText(inMs)}`
}

export function warnParts(
  limit: SessionRateLimit,
  level: WarnLevel,
  readings: LimitReadings,
  now: number,
): ToastParts {
  const tail = [toastPaceWords(paceOf(readings, limit, now)), resetWords(limit, now)]
  return [headLine(limit, level), tail.filter((part) => part !== undefined).join(' · ')]
}

type Claim = { limit: SessionRateLimit; level: WarnLevel; readings: LimitReadings }

async function readBack(host: WarnHost, keep: WarnKeep, mine: Warned, claim: Claim) {
  const kept = readWarned(await host.storeGet(warnKey(mine.kind)))
  if (kept?.by !== mine.by || kept.level !== mine.level || kept.cycle !== mine.cycle) return
  keep.warned.set(mine.kind, mine)
  host.showToast(warnParts(claim.limit, claim.level, claim.readings, mine.at))
}

function waitMs(host: WarnHost): number {
  const { least, most } = CLAIM_WAIT_MS
  return least + Math.floor(host.random() * (most - least + 1))
}

async function claimWarning(host: WarnHost, keep: WarnKeep, claim: Claim): Promise<void> {
  const { kind } = claim.limit
  const mine: Warned = {
    v: WARN_VERSION,
    kind,
    cycle: cycleOf(claim.limit),
    level: claim.level,
    at: await host.now(),
    by: await host.sessionId(),
  }
  await host.storeSet(warnKey(kind), mine)
  host.after(waitMs(host), () => {
    readBack(host, keep, mine, claim)
      .catch((error: unknown) => {
        host.debug(`handily-board: the limit warning was not read back: ${String(error)}`)
      })
      .finally(() => {
        keep.claiming.delete(kind)
      })
  })
}

async function storedFor(host: WarnHost, limit: SessionRateLimit, now: number) {
  const key = warnKey(limit.kind)
  const value = await host.storeGet(key)
  if (value === undefined) return undefined
  const stored = readWarned(value)
  if (stored !== null && stored.kind === limit.kind && !isOtherCycle(stored, limit, now)) {
    return stored
  }
  await host.storeDelete(key)
  return undefined
}

function keptFor(keep: WarnKeep, limit: SessionRateLimit, now: number): Warned | undefined {
  const kept = keep.warned.get(limit.kind)
  if (kept === undefined || !isOtherCycle(kept, limit, now)) return kept
  keep.warned.delete(limit.kind)
  return undefined
}

function hasPastReset(limit: SessionRateLimit, now: number): boolean {
  if (limit.resetsAt === undefined) return false
  const at = Date.parse(limit.resetsAt)
  return !Number.isFinite(at) || at <= now
}

async function isClaimWaiting(
  host: WarnHost,
  keep: WarnKeep,
  limit: SessionRateLimit,
  readings: LimitReadings,
): Promise<boolean> {
  const now = await host.now()
  if (hasPastReset(limit, now)) return false
  const kept = keptFor(keep, limit, now)
  const stored = await storedFor(host, limit, now)
  const level = levelOf(limit.percentUsed)
  if (level === undefined || isWarnedAt(kept, level) || isWarnedAt(stored, level)) return false
  await claimWarning(host, keep, { limit, level, readings })
  return true
}

async function warnLimit(
  host: WarnHost,
  keep: WarnKeep,
  limit: SessionRateLimit,
  readings: LimitReadings,
): Promise<void> {
  if (!SAFE_KIND.test(limit.kind) || keep.claiming.has(limit.kind)) return
  keep.claiming.add(limit.kind)
  const isWaiting = await isClaimWaiting(host, keep, limit, readings).catch((error: unknown) => {
    host.debug(`handily-board: the limit warning was not kept: ${String(error)}`)
    return false
  })
  if (!isWaiting) keep.claiming.delete(limit.kind)
}

export async function warnLimits(
  host: WarnHost,
  keep: WarnKeep,
  limits: readonly SessionRateLimit[],
  readings: LimitReadings,
): Promise<void> {
  for (const limit of limits) await warnLimit(host, keep, limit, readings)
}

function isStale(value: unknown, now: number): boolean {
  const warned = readWarned(value)
  return warned === null || isPastCycle(warned, now)
}

export async function removeStaleWarnings(host: WarnHost): Promise<void> {
  try {
    const now = await host.now()
    const keys = (await host.storeKeys()).filter((key) => key.startsWith(WARN_PREFIX))
    for (const key of keys) {
      if (isStale(await host.storeGet(key), now)) await host.storeDelete(key)
    }
  } catch (error) {
    host.debug(`handily-board: old limit warnings were not removed: ${String(error)}`)
  }
}
