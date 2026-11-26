import type { SessionRateLimit } from 'claude-code'

export const SNAPSHOT_FORMAT = 'basicly.usage-snapshot'
export const SNAPSHOT_VERSION = 1
export const SNAPSHOT_WRITER = 'handily-board'
export const SNAPSHOT_FILE = `${SNAPSHOT_WRITER}.json`
export const SNAPSHOT_FOLDER = 'basicly/usage-snapshots'
export const XDG_FALLBACK = '.local/state'
export const READINGS_MOST = 360
export const RESET_SHIFT_S = 600
export const READING_STEP_S = 60
export const RECENT_S = 60 * 60
export const RECENT_SPAN_S = 15 * 60
export const HOLD_PERCENT = 90
export const CLOSE_PERCENT = 100
export const CLOSE_USED_PERCENT = 95

export const WINDOW_KINDS = ['five_hour', 'seven_day'] as const

export type WindowKind = (typeof WINDOW_KINDS)[number]

const WINDOW_SPAN_S: Readonly<Record<WindowKind, number>> = {
  five_hour: 5 * 60 * 60,
  seven_day: 7 * 24 * 60 * 60,
}

const AVERAGE_LEAST_S: Readonly<Record<WindowKind, number>> = {
  five_hour: 30 * 60,
  seven_day: 24 * 60 * 60,
}

export type SnapshotReading = readonly [at: number, percent: number]

export type SnapshotWindow = {
  used_percentage: number
  resets_at: number
  read_at: number
  readings: readonly SnapshotReading[]
}

export type SnapshotWindows = Readonly<Partial<Record<WindowKind, unknown>>>

export const NO_WINDOWS: SnapshotWindows = {}

export type WindowReading = { kind: WindowKind; percent: number; resetsAt: number; at: number }

export type SnapshotVariable =
  'BASICLY_USAGE_SNAPSHOT_DIR' | 'XDG_STATE_HOME' | 'HOME' | 'LOCALAPPDATA'

export type SnapshotEnv = {
  snapshotDir?: string | undefined
  stateHome?: string | undefined
  home?: string | undefined
  localAppData?: string | undefined
  isWindows?: boolean
}

export type FolderRule = { folder: string } | { refusal: string }

export type PlanWord = 'start' | 'hold' | 'close idle'

export type WindowPlan = { kind: WindowKind; projected: number | undefined; word: PlanWord }

export type Plan = { windows: readonly WindowPlan[]; word: PlanWord }

const PLAN_WORDS: readonly PlanWord[] = ['close idle', 'hold', 'start']

export function epochSeconds(ms: number): number {
  return Math.floor(ms / 1000)
}

function isKind(kind: string): kind is WindowKind {
  return (WINDOW_KINDS as readonly string[]).includes(kind)
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function given(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

export function isAbsolutePath(path: string, isWindows: boolean): boolean {
  return path.startsWith('/') || (isWindows && /^[A-Za-z]:[\\/]/u.test(path))
}

function under(base: string, rest: string): string {
  return `${base.replace(/[\\/]+$/u, '')}/${rest}`
}

export function folderRule(env: SnapshotEnv): FolderRule {
  const isWindows = env.isWindows === true
  const snapshotDir = given(env.snapshotDir)
  if (snapshotDir !== undefined) {
    return isAbsolutePath(snapshotDir, isWindows)
      ? { folder: snapshotDir.replace(/(?<=.)[\\/]+$/u, '') }
      : { refusal: 'BASICLY_USAGE_SNAPSHOT_DIR is not an absolute path' }
  }
  if (isWindows) {
    const localAppData = given(env.localAppData)
    return localAppData !== undefined && isAbsolutePath(localAppData, isWindows)
      ? { folder: under(localAppData, SNAPSHOT_FOLDER) }
      : { refusal: 'LOCALAPPDATA is not an absolute path' }
  }
  const stateHome = given(env.stateHome)
  if (stateHome !== undefined && isAbsolutePath(stateHome, isWindows)) {
    return { folder: under(stateHome, SNAPSHOT_FOLDER) }
  }
  const home = given(env.home)
  return home !== undefined && isAbsolutePath(home, isWindows)
    ? { folder: under(home, `${XDG_FALLBACK}/${SNAPSHOT_FOLDER}`) }
    : { refusal: 'no absolute XDG_STATE_HOME and no absolute HOME' }
}

export function snapshotPath(folder: string): string {
  return under(folder, SNAPSHOT_FILE)
}

export function windowReadings(limits: readonly SessionRateLimit[], atMs: number): WindowReading[] {
  const byKind = new Map<WindowKind, WindowReading>()
  for (const limit of limits) {
    if (!isKind(limit.kind) || !isPercent(limit.percentUsed) || limit.resetsAt === undefined) {
      continue
    }
    const resetMs = Date.parse(limit.resetsAt)
    if (!Number.isFinite(resetMs)) continue
    byKind.set(limit.kind, {
      kind: limit.kind,
      percent: limit.percentUsed,
      resetsAt: epochSeconds(resetMs),
      at: epochSeconds(atMs),
    })
  }
  return WINDOW_KINDS.flatMap((kind) => {
    const reading = byKind.get(kind)
    return reading === undefined ? [] : [reading]
  })
}

function isReading(value: unknown): value is SnapshotReading {
  return Array.isArray(value) && value.length === 2 && isTime(value[0]) && isPercent(value[1])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validWindow(value: unknown): SnapshotWindow | undefined {
  if (!isRecord(value)) return undefined
  const { used_percentage: used, resets_at: resetsAt, read_at: readAt, readings } = value
  const isValid =
    isPercent(used) &&
    isTime(resetsAt) &&
    Number.isInteger(resetsAt) &&
    isTime(readAt) &&
    Array.isArray(readings) &&
    readings.every(isReading)
  if (!isValid) return undefined
  return { used_percentage: used, resets_at: resetsAt, read_at: readAt, readings }
}

export function storedWindows(text: string): SnapshotWindows {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return NO_WINDOWS
  }
  if (!isRecord(parsed)) return NO_WINDOWS
  const { windows } = parsed
  const isOurs =
    parsed.format === SNAPSHOT_FORMAT &&
    parsed.version === SNAPSHOT_VERSION &&
    parsed.writer === SNAPSHOT_WRITER
  if (!isOurs || !isRecord(windows)) return NO_WINDOWS
  return Object.fromEntries(
    WINDOW_KINDS.flatMap((kind) => (kind in windows ? [[kind, windows[kind]]] : [])),
  )
}

function freshWindow(reading: WindowReading): SnapshotWindow {
  return {
    used_percentage: reading.percent,
    resets_at: reading.resetsAt,
    read_at: reading.at,
    readings: [[reading.at, reading.percent]],
  }
}

function isDropped(kept: SnapshotWindow, reading: WindowReading): boolean {
  const newest = kept.readings.at(-1)
  return (
    kept.resets_at - reading.resetsAt > RESET_SHIFT_S ||
    reading.percent < kept.used_percentage ||
    (newest !== undefined && reading.at < newest[0])
  )
}

export function mergedWindow(stored: unknown, reading: WindowReading, nowS: number): unknown {
  if (reading.resetsAt <= nowS) return stored
  const kept = validWindow(stored)
  const isNewWindow =
    kept === undefined ||
    kept.resets_at <= nowS ||
    reading.resetsAt - kept.resets_at > RESET_SHIFT_S
  if (isNewWindow) return freshWindow(reading)
  if (isDropped(kept, reading)) return stored
  const before = kept.readings.at(-2)
  const isCloseToBefore = before !== undefined && reading.at - before[0] < READING_STEP_S
  const earlier = isCloseToBefore ? kept.readings.slice(0, -1) : kept.readings
  return {
    used_percentage: reading.percent,
    resets_at: reading.resetsAt,
    read_at: reading.at,
    readings: [...earlier, [reading.at, reading.percent] as const].slice(-READINGS_MOST),
  }
}

export function mergedWindows(
  stored: SnapshotWindows,
  readings: readonly WindowReading[],
  nowS: number,
): SnapshotWindows {
  const merged: Partial<Record<WindowKind, unknown>> = { ...stored }
  for (const reading of readings) {
    merged[reading.kind] = mergedWindow(merged[reading.kind], reading, nowS)
  }
  return Object.fromEntries(
    WINDOW_KINDS.flatMap((kind) => (merged[kind] === undefined ? [] : [[kind, merged[kind]]])),
  )
}

export function isSameWindows(one: SnapshotWindows, other: SnapshotWindows): boolean {
  return JSON.stringify(one) === JSON.stringify(other)
}

export function snapshotText(windows: SnapshotWindows, nowS: number): string {
  const snapshot = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    writer: SNAPSHOT_WRITER,
    written_at: nowS,
    windows,
  }
  return `${JSON.stringify(snapshot)}\n`
}

function recentRate(window: SnapshotWindow, nowS: number): number | undefined {
  const recent = window.readings.filter(([at]) => at >= nowS - RECENT_S)
  const first = recent[0]
  const last = recent.at(-1)
  if (recent.length < 2 || first === undefined || last === undefined) return undefined
  const spanS = last[0] - first[0]
  if (spanS < RECENT_SPAN_S) return undefined
  return ((last[1] - first[1]) * 3600) / spanS
}

function averageRate(kind: WindowKind, window: SnapshotWindow, nowS: number): number {
  const sinceS = nowS - (window.resets_at - WINDOW_SPAN_S[kind])
  if (sinceS < AVERAGE_LEAST_S[kind]) return 0
  return (window.used_percentage * 3600) / sinceS
}

export function rateOf(kind: WindowKind, window: SnapshotWindow, nowS: number): number {
  const recent = kind === 'five_hour' ? recentRate(window, nowS) : undefined
  return recent ?? averageRate(kind, window, nowS)
}

export function windowPlan(kind: WindowKind, window: SnapshotWindow, nowS: number): WindowPlan {
  if (window.resets_at <= nowS) return { kind, projected: undefined, word: 'start' }
  const hoursLeft = (window.resets_at - nowS) / 3600
  const projected = window.used_percentage + rateOf(kind, window, nowS) * hoursLeft
  const isClose = projected >= CLOSE_PERCENT || window.used_percentage >= CLOSE_USED_PERCENT
  const word: PlanWord = isClose ? 'close idle' : projected >= HOLD_PERCENT ? 'hold' : 'start'
  return { kind, projected, word }
}

export function planOf(windows: SnapshotWindows, nowS: number): Plan | undefined {
  const plans = WINDOW_KINDS.flatMap((kind) => {
    const window = validWindow(windows[kind])
    return window === undefined ? [] : [windowPlan(kind, window, nowS)]
  })
  if (plans.length === 0) return undefined
  const word = PLAN_WORDS.find((one) => plans.some((plan) => plan.word === one)) ?? 'start'
  return { windows: plans, word }
}

export function planTexts(
  windows: SnapshotWindows,
  nowMs: number,
  name: (kind: string) => string,
): string[] {
  const plan = planOf(windows, epochSeconds(nowMs))
  if (plan === undefined) return []
  const percents = plan.windows.flatMap(({ kind, projected }) =>
    projected === undefined ? [] : [`${name(kind)} ~${String(Math.round(projected))}% at reset`],
  )
  return [...percents, `plan ${plan.word}`]
}

export type SnapshotHost = {
  now: () => Promise<number>
  variable: (name: SnapshotVariable) => Promise<string | undefined>
  isWindows: () => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  log: (line: string) => void
}

export type SnapshotKeep = {
  queue: Promise<unknown>
  failure: string | undefined
  windows: SnapshotWindows
}

export function snapshotKeep(): SnapshotKeep {
  return { queue: Promise.resolve(), failure: undefined, windows: NO_WINDOWS }
}

export async function snapshotEnv(host: SnapshotHost): Promise<SnapshotEnv> {
  const snapshotDir = given(await host.variable('BASICLY_USAGE_SNAPSHOT_DIR'))
  if (snapshotDir?.startsWith('/') === true) return { snapshotDir }
  const isWindows = await host.isWindows()
  if (snapshotDir !== undefined) return { snapshotDir, isWindows }
  if (isWindows) return { isWindows, localAppData: await host.variable('LOCALAPPDATA') }
  return {
    isWindows,
    stateHome: await host.variable('XDG_STATE_HOME'),
    home: await host.variable('HOME'),
  }
}

function failed(host: SnapshotHost, keep: SnapshotKeep, reason: string): void {
  if (keep.failure === reason) return
  keep.failure = reason
  host.log(`handily-board: the usage snapshot was not written: ${reason}`)
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function pathOf(host: SnapshotHost): Promise<FolderRule> {
  try {
    return folderRule(await snapshotEnv(host))
  } catch (error) {
    return { refusal: reasonOf(error) }
  }
}

async function storedOf(
  host: SnapshotHost,
  path: string,
  kept: SnapshotWindows,
): Promise<SnapshotWindows> {
  try {
    return storedWindows(await host.read(path))
  } catch {
    return kept
  }
}

async function mergeSnapshot(
  host: SnapshotHost,
  keep: SnapshotKeep,
  limits: readonly SessionRateLimit[],
): Promise<void> {
  const nowMs = await host.now()
  const readings = windowReadings(limits, nowMs)
  if (readings.length === 0) return
  const nowS = epochSeconds(nowMs)
  const rule = await pathOf(host)
  if ('refusal' in rule) {
    keep.windows = mergedWindows(keep.windows, readings, nowS)
    failed(host, keep, rule.refusal)
    return
  }
  const path = snapshotPath(rule.folder)
  const stored = await storedOf(host, path, keep.windows)
  const merged = mergedWindows(stored, readings, nowS)
  keep.windows = merged
  if (isSameWindows(stored, merged)) return
  try {
    await host.write(path, snapshotText(merged, nowS))
    keep.failure = undefined
  } catch (error) {
    failed(host, keep, reasonOf(error))
  }
}

export async function noteSnapshot(
  host: SnapshotHost,
  keep: SnapshotKeep,
  limits: readonly SessionRateLimit[],
): Promise<void> {
  const run = () => mergeSnapshot(host, keep, limits)
  const merged = keep.queue.then(run, run)
  keep.queue = merged.catch(() => undefined)
  await merged
}
