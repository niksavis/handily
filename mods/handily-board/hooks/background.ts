import type { ThemeKey } from 'claude-code'
import { elapsedText } from './activity'
import { maskedCredentials } from './credentials'
import { GLYPH_SETS, type GlyphSet } from './glyphs'
import type { SignalLook, SignalLooks } from './signals'
import { escaped } from './tasks'
import { cutToWidth } from './width'

export const WAITING_COLOR: ThemeKey = 'suggestion'
export const WAITING_WORD = 'waiting'
export const NO_TURN_WORD = 'no turn'
export const STALE_AFTER_MS = 30 * 60_000
export const BACKGROUND_TICK_MS = 10_000
export const ITEM_TEXT_AT_MOST = 200
export const SHARED_TEXT_AT_MOST = 80

const WAKEUP_KIND = 'wakeup'
const AGENT_KIND = 'agent'
const OPENED_KINDS: ReadonlySet<string> = new Set(['shell', 'monitor', AGENT_KIND, 'workflow'])
const PLAIN_NUMBER = /^\d{1,2}$/u
const MINUTES_AT_MOST = 59
const HOURS_AT_MOST = 23
const SEPARATOR = ' · '

export type BackgroundItem = {
  id: string
  kind: string
  title: string
  detail: string | null
  firstSeenAt: number
  hasButton: boolean
}

export type Background =
  | { kind: 'noTurn'; isUnreported: boolean }
  | { kind: 'idle'; at: number }
  | { kind: 'waiting'; at: number; items: readonly BackgroundItem[] }

export const NO_TURN: Background = { kind: 'noTurn', isUnreported: false }

const UNREPORTED: Background = { kind: 'noTurn', isUnreported: true }

export type BackgroundKeep = {
  current: Background
  firstSeen: Map<string, number>
  hasStop: boolean
  isCarried: boolean
  beforeTurn: Background | undefined
}

export function newBackgroundKeep(): BackgroundKeep {
  return {
    current: NO_TURN,
    firstSeen: new Map(),
    hasStop: false,
    isCarried: false,
    beforeTurn: undefined,
  }
}

export type StartSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'

const CARRIED_SOURCES: ReadonlySet<string> = new Set(['resume', 'clear', 'fork'])

export function noteStartup(keep: BackgroundKeep, now: number): void {
  if (keep.hasStop || keep.isCarried || keep.current.kind !== 'noTurn') return
  keep.current = { kind: 'idle', at: now }
}

export function noteStartSource(keep: BackgroundKeep, source: string): void {
  if (!CARRIED_SOURCES.has(source) || keep.hasStop) return
  keep.isCarried = true
  if (keep.current.kind === 'idle') keep.current = NO_TURN
}

export type StopFacts = {
  agent_id?: string
  background_tasks?: readonly unknown[]
  session_crons?: readonly unknown[]
}

type Read = Omit<BackgroundItem, 'firstSeenAt'>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function shownText(text: string): string {
  const line = text.split(/\r?\n/u, 1)[0]?.trim() ?? ''
  return cutToWidth(maskedCredentials(line), ITEM_TEXT_AT_MOST)
}

function joinedDetail(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => part !== null && part.trim() !== '')
  return kept.length === 0 ? null : shownText(kept.join(' '))
}

function taskItem(value: unknown): Read | null {
  if (!isRecord(value)) return null
  const id = stringOf(value.id)
  const type = stringOf(value.type)
  if (id === null || type === null) return null
  const description = shownText(stringOf(value.description) ?? '')
  const agentType = stringOf(value.agent_type)
  const kind = type === 'subagent' ? AGENT_KIND : shownText(type)
  const hasButton = OPENED_KINDS.has(kind)
  switch (kind) {
    case 'shell':
      return {
        id,
        kind,
        title: description,
        detail: joinedDetail([stringOf(value.command)]),
        hasButton,
      }
    case 'monitor':
      return {
        id,
        kind,
        title: description,
        detail: joinedDetail([stringOf(value.server), stringOf(value.tool)]),
        hasButton,
      }
    case AGENT_KIND:
      return agentType === null
        ? { id, kind, title: description, detail: null, hasButton }
        : {
            id,
            kind,
            title: shownText(agentType),
            detail: description === '' ? null : description,
            hasButton,
          }
    case 'workflow':
      return {
        id,
        kind,
        title: description,
        detail: joinedDetail([stringOf(value.name)]),
        hasButton,
      }
    default:
      return { id, kind, title: description, detail: null, hasButton }
  }
}

function clockPart(text: string | undefined, most: number): string | null {
  if (text === undefined || !PLAIN_NUMBER.test(text)) return null
  const value = Number(text)
  return value > most ? null : String(value).padStart(2, '0')
}

export function wakeupTime(schedule: string, isRecurring: boolean): string {
  const raw = `cron ${shownText(schedule)}`
  if (isRecurring) return raw
  const [minute, hour] = schedule.trim().split(/\s+/u)
  const mm = clockPart(minute, MINUTES_AT_MOST)
  const hh = clockPart(hour, HOURS_AT_MOST)
  return mm === null || hh === null ? raw : `at ${hh}:${mm}`
}

function cronItem(value: unknown): Read | null {
  if (!isRecord(value)) return null
  const id = stringOf(value.id)
  const schedule = stringOf(value.schedule)
  if (id === null || schedule === null) return null
  const prompt = shownText(stringOf(value.prompt) ?? '')
  return {
    id: `cron:${id}`,
    kind: WAKEUP_KIND,
    title: wakeupTime(schedule, value.recurring === true),
    detail: prompt === '' ? null : prompt,
    hasButton: false,
  }
}

function readItems(values: readonly unknown[], read: (value: unknown) => Read | null): Read[] {
  return values.map(read).filter((item) => item !== null)
}

export function isMainStop(facts: StopFacts): boolean {
  return facts.agent_id === undefined
}

export function noteStop(keep: BackgroundKeep, facts: StopFacts, now: number): Background {
  const tasks = facts.background_tasks
  const crons = facts.session_crons
  keep.hasStop = true
  keep.beforeTurn = undefined
  if (!Array.isArray(tasks) || !Array.isArray(crons)) {
    keep.current = UNREPORTED
    return keep.current
  }
  const read = [...readItems(tasks, taskItem), ...readItems(crons, cronItem)]
  const ids = new Set(read.map((item) => item.id))
  for (const id of keep.firstSeen.keys()) if (!ids.has(id)) keep.firstSeen.delete(id)
  for (const item of read) if (!keep.firstSeen.has(item.id)) keep.firstSeen.set(item.id, now)
  if (read.length === 0) {
    keep.current = tasks.length + crons.length === 0 ? { kind: 'idle', at: now } : UNREPORTED
    return keep.current
  }
  const items = read
    .map((item) => ({ ...item, firstSeenAt: keep.firstSeen.get(item.id) ?? now }))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.firstSeenAt - b.item.firstSeenAt || a.index - b.index)
    .map(({ item }) => item)
  keep.current = { kind: 'waiting', at: now, items }
  return keep.current
}

export function noteTurnStart(keep: BackgroundKeep): void {
  keep.beforeTurn = keep.current.kind === 'waiting' ? keep.current : undefined
  keep.current = NO_TURN
}

export function noteAbortedTurn(keep: BackgroundKeep): boolean {
  const { beforeTurn } = keep
  keep.beforeTurn = undefined
  if (beforeTurn === undefined || keep.current.kind !== 'noTurn') return false
  keep.current = beforeTurn
  return true
}

export function forgetBackground(keep: BackgroundKeep): void {
  keep.current = NO_TURN
  keep.firstSeen.clear()
  keep.beforeTurn = undefined
}

export type TurnState = 'working' | 'waiting' | 'idle' | 'noTurn'

export function turnState(isTurnRunning: boolean, background: Background): TurnState {
  if (isTurnRunning) return 'working'
  return background.kind
}

export function isWaiting(
  background: Background,
): background is Extract<Background, { kind: 'waiting' }> {
  return background.kind === 'waiting'
}

export function isStale(background: Background, now: number): boolean {
  return isWaiting(background) && now - background.at >= STALE_AFTER_MS
}

export function oldestAt(background: Extract<Background, { kind: 'waiting' }>): number {
  return background.items[0]?.firstSeenAt ?? background.at
}

export function ageText(since: number, now: number, isUnsure: boolean): string {
  const age = elapsedText(now - since)
  return isUnsure ? `${age}?` : age
}

export function waitingAge(background: Extract<Background, { kind: 'waiting' }>, now: number) {
  return ageText(oldestAt(background), now, isStale(background, now))
}

export function notSeenText(at: number, now: number): string {
  return `not seen since ${elapsedText(now - at)}`
}

export function waitingLook(signals: SignalLooks): SignalLook {
  const set: GlyphSet =
    signals.doing.mark === GLYPH_SETS.nerd.doing ? GLYPH_SETS.nerd : GLYPH_SETS.plain
  return { mark: set.waiting, color: WAITING_COLOR }
}

export function waitingHead(
  background: Extract<Background, { kind: 'waiting' }>,
  now: number,
  signals: SignalLooks,
): string {
  const head = `${waitingLook(signals).mark} ${WAITING_WORD} ${waitingAge(background, now)}`
  return isStale(background, now) ? `${head}${SEPARATOR}${notSeenText(background.at, now)}` : head
}

export function itemWords(item: BackgroundItem): string {
  const kind = escaped(item.kind)
  return item.title === '' ? kind : `${kind} ${escaped(item.title)}`
}

export function moreText(count: number): string {
  return `+${String(count)} more in background`
}

export function inBackgroundText(count: number): string {
  return `${String(count)} in background`
}

export function waitingStatusText(
  background: Extract<Background, { kind: 'waiting' }>,
  now: number,
  signals: SignalLooks,
): string {
  const [first] = background.items
  const head = waitingHead(background, now, signals)
  if (first === undefined) return head
  const rest = background.items.length - 1
  const tail = rest > 0 ? moreText(rest) : first.detail === null ? null : escaped(first.detail)
  const words = itemWords(first)
  return [head, tail === null ? words : `${words}${SEPARATOR}${tail}`].join(SEPARATOR)
}

export function besideAskText(
  background: Extract<Background, { kind: 'waiting' }>,
  signals: SignalLooks,
): string {
  return `${waitingLook(signals).mark} +${String(background.items.length)} in background`
}

export type SharedBackground = {
  since: number
  seenAt: number
  count: number
  kind: string
  title: string
}

export function sharedBackground(background: Background): SharedBackground | null {
  if (!isWaiting(background)) return null
  const [first] = background.items
  return {
    since: oldestAt(background),
    seenAt: background.at,
    count: background.items.length,
    kind: cutToWidth(first?.kind ?? '', SHARED_TEXT_AT_MOST),
    title: cutToWidth(first?.title ?? '', SHARED_TEXT_AT_MOST),
  }
}

export function readSharedBackground(value: unknown): SharedBackground | null | undefined {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) return undefined
  const { since, seenAt, count, kind, title } = value
  if (typeof since !== 'number' || typeof seenAt !== 'number' || typeof count !== 'number') {
    return undefined
  }
  if (typeof kind !== 'string' || typeof title !== 'string') return undefined
  return { since, seenAt, count, kind, title }
}

export function sharedAge(shared: SharedBackground, now: number): string {
  return ageText(shared.since, now, now - shared.seenAt >= STALE_AFTER_MS)
}

export function sharedLine(shared: SharedBackground): string {
  const words = shared.title === '' ? shared.kind : `${shared.kind} ${shared.title}`
  const rest = shared.count - 1
  return rest > 0 ? `${words}${SEPARATOR}+${String(rest)} more` : words
}

export function isShownInBand(item: BackgroundItem): boolean {
  return item.kind !== AGENT_KIND
}
