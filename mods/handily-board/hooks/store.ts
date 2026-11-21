import type { FsEntry } from 'claude-code'
import { byAttention } from './cards'
import { isEnded, isGoneError, NO_PROCESS_CHECK, readLiveness, type Liveness } from './liveness'

export const POLL_INTERVAL_MS = 15_000
export const SESSION_FILES_AT_MOST = 200
export const ASK_FILES_AT_MOST = 50
export const FILE_BYTES_AT_MOST = 16 * 1024
export const STALE_AFTER_MS = 2 * 60 * 60_000
export const CLOCK_AHEAD_AFTER_MS = 5 * 60_000
export const WORKING_FOR_MS = 15 * 60_000
export const NOW_OLD_AFTER_MS = 15 * 60_000
export const ASK_COUNTED_FOR_MS = 24 * 60 * 60_000
export const CLOSED_SHOWN_FOR_MS = 60 * 60_000
export const STORE_PATH_AT_MOST = 4096
export const STORE_VERSION = 1

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/
const RECORD_ID = /^[a-z][a-z0-9]*-[a-z0-9]{3,12}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/
const PLATFORM = /^[a-z0-9]{1,32}$/
const CONTROL = /\p{Cc}/u
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const PERMISSION_DENIED = /\b(EACCES|EPERM)\b/
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/])/
const HOME_LEAD = /^~(?=\/|$)/
const LINUX = 'linux'
const NAME_AT_MOST = 40
const PROJECT_AT_MOST = 64
const TEXT_AT_MOST = 200
const LABEL_AT_MOST = 24
const LABELS_AT_MOST = 4
const PID_AT_MOST = 4_194_304
const SHOWN_VALUE_AT_MOST = 20

export type StoreSetting =
  | { kind: 'unset' }
  | { kind: 'refused'; reason: string }
  | { kind: 'set'; path: string; shown: string }

function refusedSetting(reason: string): StoreSetting {
  return { kind: 'refused', reason }
}

function withoutTrailingSeparator(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed === '' || /^[A-Za-z]:$/.test(trimmed) ? path : trimmed
}

export function storeSetting(value: unknown, home: string | undefined): StoreSetting {
  if (value === undefined) return { kind: 'unset' }
  if (typeof value !== 'string') return refusedSetting('it is not a text')
  if (value.trim() === '') return { kind: 'unset' }
  if (value.length > STORE_PATH_AT_MOST) {
    return refusedSetting(`it is longer than ${String(STORE_PATH_AT_MOST)} characters`)
  }
  if (CONTROL.test(value)) return refusedSetting('it holds a control character or a line break')
  let path = value
  if (HOME_LEAD.test(value)) {
    if (home === undefined || !ABSOLUTE.test(home)) {
      return refusedSetting('it starts with ~/ and HOME is not set')
    }
    path = value.replace(HOME_LEAD, () => withoutTrailingSeparator(home))
  }
  if (!ABSOLUTE.test(path)) return refusedSetting('it is a relative path')
  return { kind: 'set', path: withoutTrailingSeparator(path), shown: value }
}

export type Vendor = 'claude' | 'codex'

export type WrittenState = 'working' | 'needs-you' | 'idle'

export type ClosedBy = 'approved' | 'withdrawn'

export type StoreSession = {
  id: string
  updatedAt: number
  name: string | null
  project: string | null
  vendor: Vendor | null
  platform: string | null
  pid: number | null
  pidStart: number | null
  state: WrittenState | null
  stateAt: number | null
  now: string | null
  nowAt: number | null
  next: string | null
  waitingOn: string | null
  item: string | null
  last: string | null
  lastAt: number | null
  lastOk: boolean | null
}

export type StoreAsk = {
  record: string
  question: string | null
  options: readonly string[]
  openedAt: number | null
  closedAt: number | null
  closedBy: ClosedBy | null
}

export type Parsed<T> = { kind: 'read'; value: T } | { kind: 'refused'; reason: string }

type Field<T> = { key: string; read: (value: unknown) => T | undefined; why: string }

export type Dropped = (key: string, why: string) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function characters(text: string): number {
  return Array.from(text).length
}

function textUpTo(atMost: number): (value: unknown) => string | undefined {
  return (value) => (typeof value === 'string' && characters(value) <= atMost ? value : undefined)
}

function booleanOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return undefined
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : at
}

function oneOf<T extends string>(options: readonly T[]): (value: unknown) => T | undefined {
  return (value) => options.find((option) => option === value)
}

function integerIn(least: number, most: number): (value: unknown) => number | undefined {
  return (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= least && value <= most
      ? value
      : undefined
}

function projectOf(value: unknown): string | undefined {
  const text = textUpTo(PROJECT_AT_MOST)(value)
  return text === undefined || /[\\/]/.test(text) ? undefined : text
}

function platformOf(value: unknown): string | undefined {
  return typeof value === 'string' && PLATFORM.test(value) ? value : undefined
}

function isLabel(label: string): boolean {
  return label !== '' && characters(label) <= LABEL_AT_MOST && !HIDDEN_CHARACTER.test(label)
}

function labelsOf(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined
  const labels = value.split('|').map((label) => label.trim())
  return labels.length <= LABELS_AT_MOST && labels.every(isLabel) ? labels : undefined
}

function optional<T>(value: Record<string, unknown>, field: Field<T>, dropped: Dropped): T | null {
  const raw = value[field.key]
  if (raw === undefined || raw === null) return null
  const read = field.read(raw)
  if (read !== undefined) return read
  dropped(field.key, field.why)
  return null
}

function shownValue(value: unknown): string {
  const text = Array.from(JSON.stringify(value))
  return text.length > SHOWN_VALUE_AT_MOST
    ? `${text.slice(0, SHOWN_VALUE_AT_MOST).join('')}…`
    : text.join('')
}

function versionRefusal(value: unknown): string | null {
  if (value === STORE_VERSION) return null
  const wanted = `this board reads v ${String(STORE_VERSION)}`
  return value === undefined ? `v is missing; ${wanted}` : `v is ${shownValue(value)}; ${wanted}`
}

function parsedObject(text: string): Parsed<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'refused', reason: 'not JSON' }
  }
  if (!isRecord(parsed)) return { kind: 'refused', reason: 'not a JSON object' }
  const refusal = versionRefusal(parsed.v)
  return refusal === null ? { kind: 'read', value: parsed } : { kind: 'refused', reason: refusal }
}

export function stemOf(fileName: string): string {
  return fileName.replace(/\.json$/, '')
}

const TEXT_WHY = `it is not a text of at most ${String(TEXT_AT_MOST)} characters`
const TIME_WHY = 'it is not an ISO 8601 time with Z or an offset'

const SESSION_FIELDS = {
  name: {
    key: 'name',
    read: textUpTo(NAME_AT_MOST),
    why: `it is not a text of at most ${String(NAME_AT_MOST)} characters`,
  },
  project: {
    key: 'project',
    read: projectOf,
    why: `it is not a text of at most ${String(PROJECT_AT_MOST)} characters without / or \\`,
  },
  vendor: {
    key: 'vendor',
    read: oneOf<Vendor>(['claude', 'codex']),
    why: 'it is not claude or codex',
  },
  platform: {
    key: 'platform',
    read: platformOf,
    why: 'it is not 1 to 32 characters of a-z and 0-9',
  },
  pid: {
    key: 'pid',
    read: integerIn(1, PID_AT_MOST),
    why: `it is not an integer from 1 to ${String(PID_AT_MOST)}`,
  },
  pidStart: {
    key: 'pid_start',
    read: integerIn(0, Number.MAX_SAFE_INTEGER),
    why: 'it is not an integer of 0 or more',
  },
  state: {
    key: 'state',
    read: oneOf<WrittenState>(['working', 'needs-you', 'idle']),
    why: 'it is not working, needs-you or idle',
  },
  stateAt: { key: 'state_at', read: timeOf, why: TIME_WHY },
  now: { key: 'now', read: textUpTo(TEXT_AT_MOST), why: TEXT_WHY },
  nowAt: { key: 'now_at', read: timeOf, why: TIME_WHY },
  next: { key: 'next', read: textUpTo(TEXT_AT_MOST), why: TEXT_WHY },
  waitingOn: { key: 'waiting_on', read: textUpTo(TEXT_AT_MOST), why: TEXT_WHY },
  item: { key: 'item', read: textUpTo(TEXT_AT_MOST), why: TEXT_WHY },
  last: { key: 'last', read: textUpTo(TEXT_AT_MOST), why: TEXT_WHY },
  lastAt: { key: 'last_at', read: timeOf, why: TIME_WHY },
  lastOk: { key: 'last_ok', read: booleanOf, why: 'it is not true or false' },
} as const

function processFields(
  session: StoreSession,
  dropped: Dropped,
): Pick<StoreSession, 'pid' | 'pidStart'> {
  const { pid, pidStart, platform } = session
  if (pid === null && pidStart === null) return { pid, pidStart }
  if (pid === null || pidStart === null) {
    dropped('pid and pid_start', 'they come together')
    return { pid: null, pidStart: null }
  }
  if (platform !== LINUX) {
    dropped('pid and pid_start', 'they count only on platform linux')
    return { pid: null, pidStart: null }
  }
  return { pid, pidStart }
}

export function readSession(
  fileName: string,
  text: string,
  dropped: Dropped,
): Parsed<StoreSession> {
  const parsed = parsedObject(text)
  if (parsed.kind === 'refused') return parsed
  const value = parsed.value
  if (value.id !== stemOf(fileName)) return { kind: 'refused', reason: 'id is not the file name' }
  const updatedAt = timeOf(value.updated_at)
  if (updatedAt === undefined) {
    return { kind: 'refused', reason: 'updated_at is not an ISO 8601 time' }
  }
  const field = <T>(one: Field<T>) => optional(value, one, dropped)
  const session: StoreSession = {
    id: stemOf(fileName),
    updatedAt,
    name: field(SESSION_FIELDS.name),
    project: field(SESSION_FIELDS.project),
    vendor: field(SESSION_FIELDS.vendor),
    platform: field(SESSION_FIELDS.platform),
    pid: field(SESSION_FIELDS.pid),
    pidStart: field(SESSION_FIELDS.pidStart),
    state: field(SESSION_FIELDS.state),
    stateAt: field(SESSION_FIELDS.stateAt),
    now: field(SESSION_FIELDS.now),
    nowAt: field(SESSION_FIELDS.nowAt),
    next: field(SESSION_FIELDS.next),
    waitingOn: field(SESSION_FIELDS.waitingOn),
    item: field(SESSION_FIELDS.item),
    last: field(SESSION_FIELDS.last),
    lastAt: field(SESSION_FIELDS.lastAt),
    lastOk: field(SESSION_FIELDS.lastOk),
  }
  return { kind: 'read', value: { ...session, ...processFields(session, dropped) } }
}

const ASK_FIELDS = {
  question: { key: 'question', read: textUpTo(TEXT_AT_MOST), why: TEXT_WHY },
  options: {
    key: 'options',
    read: labelsOf,
    why: `it is not at most ${String(LABELS_AT_MOST)} labels of at most ${String(LABEL_AT_MOST)} visible characters split by |`,
  },
  openedAt: { key: 'opened_at', read: timeOf, why: TIME_WHY },
  closedAt: { key: 'closed_at', read: timeOf, why: TIME_WHY },
  closedBy: {
    key: 'closed_by',
    read: oneOf<ClosedBy>(['approved', 'withdrawn']),
    why: 'it is not approved or withdrawn',
  },
} as const

export function readAsk(fileName: string, text: string, dropped: Dropped): Parsed<StoreAsk> {
  const parsed = parsedObject(text)
  if (parsed.kind === 'refused') return parsed
  const value = parsed.value
  if (value.record !== stemOf(fileName)) {
    return { kind: 'refused', reason: 'record is not the file name' }
  }
  if (!RECORD_ID.test(stemOf(fileName))) {
    return { kind: 'refused', reason: 'record is not a record id' }
  }
  const field = <T>(one: Field<T>) => optional(value, one, dropped)
  return {
    kind: 'read',
    value: {
      record: stemOf(fileName),
      question: field(ASK_FIELDS.question),
      options: field(ASK_FIELDS.options) ?? [],
      openedAt: field(ASK_FIELDS.openedAt),
      closedAt: field(ASK_FIELDS.closedAt),
      closedBy: field(ASK_FIELDS.closedBy),
    },
  }
}

export type StoreHost = {
  list: (path: string) => Promise<readonly FsEntry[]>
  read: (path: string) => Promise<string>
  debug: (line: string) => void
}

export type Folder = 'sessions' | 'asks'

export type BadFile = { folder: Folder; name: string; reason: string }

export type FiledSession = StoreSession & { mtimeMs: number; isDead: boolean }

export type FiledAsk = StoreAsk & { mtimeMs: number }

export type Snapshot = {
  at: number
  sessions: readonly FiledSession[]
  asks: readonly FiledAsk[]
  bad: readonly BadFile[]
  overSessions: number
  overAsks: number
  canCheck: boolean
}

export type StoreOutcome =
  { kind: 'read'; snapshot: Snapshot } | { kind: 'missing' } | { kind: 'failed'; reason: string }

type Listed = { entries: readonly FsEntry[]; over: number } | null

class ListRefused extends Error {}

function reasonOf(error: unknown): string {
  return PERMISSION_DENIED.test(String(error)) ? 'permission denied' : 'the file system refused it'
}

async function listFolder(host: StoreHost, path: string, atMost: number): Promise<Listed> {
  let entries: readonly FsEntry[]
  try {
    entries = await host.list(path)
  } catch (error) {
    if (isGoneError(error)) return null
    host.debug(`handily-board: the store folder ${path} was not listed: ${String(error)}`)
    throw new ListRefused(reasonOf(error))
  }
  const named = entries
    .filter((entry) => entry.kind === 'file' && FILE_NAME.test(entry.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
  return { entries: named.slice(0, atMost), over: Math.max(named.length - atMost, 0) }
}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length
}

type FileReader<T> = (fileName: string, text: string, dropped: Dropped) => Parsed<T>

type FolderRead<T> = { read: (T & { mtimeMs: number })[]; bad: BadFile[] }

async function readFiles<T>(
  host: StoreHost,
  folder: Folder,
  path: string,
  entries: readonly FsEntry[],
  reader: FileReader<T>,
): Promise<FolderRead<T>> {
  const done: FolderRead<T> = { read: [], bad: [] }
  const refuse = (name: string, reason: string) => {
    host.debug(`handily-board: the store file ${folder}/${name} was not read: ${reason}`)
    done.bad.push({ folder, name, reason })
  }
  for (const entry of entries) {
    if (entry.size > FILE_BYTES_AT_MOST) {
      refuse(entry.name, 'over 16 KiB')
      continue
    }
    let text: string
    try {
      text = await host.read(`${path}/${entry.name}`)
    } catch (error) {
      host.debug(`handily-board: the read of ${folder}/${entry.name} failed: ${String(error)}`)
      refuse(entry.name, `not readable, ${reasonOf(error)}`)
      continue
    }
    if (bytesOf(text) > FILE_BYTES_AT_MOST) {
      refuse(entry.name, 'over 16 KiB')
      continue
    }
    const dropped: Dropped = (key, why) => {
      host.debug(`handily-board: the store file ${folder}/${entry.name} drops ${key}: ${why}`)
    }
    const parsed = reader(entry.name, text, dropped)
    if (parsed.kind === 'refused') refuse(entry.name, parsed.reason)
    else done.read.push({ ...parsed.value, mtimeMs: entry.mtimeMs })
  }
  return done
}

function checkedPid(session: StoreSession): number | null {
  if (session.platform !== LINUX || session.pidStart === null) return null
  return session.pid
}

function isDeadIn(session: StoreSession, liveness: Liveness): boolean {
  const pid = checkedPid(session)
  return pid !== null && session.pidStart !== null && isEnded(liveness, pid, session.pidStart)
}

async function livenessOf(host: StoreHost, sessions: readonly StoreSession[]): Promise<Liveness> {
  const pids = sessions.flatMap((session) => checkedPid(session) ?? [])
  try {
    return await readLiveness(host.read, pids)
  } catch (error) {
    host.debug(`handily-board: the process check failed: ${String(error)}`)
    return NO_PROCESS_CHECK
  }
}

type StoreListing = { sessions: Listed; asks: Listed }

async function listStore(host: StoreHost, path: string): Promise<StoreListing> {
  return {
    sessions: await listFolder(host, `${path}/sessions`, SESSION_FILES_AT_MOST),
    asks: await listFolder(host, `${path}/asks`, ASK_FILES_AT_MOST),
  }
}

export async function readStore(host: StoreHost, path: string, now: number): Promise<StoreOutcome> {
  let listed: StoreListing
  try {
    listed = await listStore(host, path)
  } catch (error) {
    if (error instanceof ListRefused) return { kind: 'failed', reason: error.message }
    throw error
  }
  if (listed.sessions === null && listed.asks === null) return { kind: 'missing' }
  const sessions = await readFiles(
    host,
    'sessions',
    `${path}/sessions`,
    listed.sessions?.entries ?? [],
    readSession,
  )
  const asks = await readFiles(host, 'asks', `${path}/asks`, listed.asks?.entries ?? [], readAsk)
  const liveness = await livenessOf(host, sessions.read)
  return {
    kind: 'read',
    snapshot: {
      at: now,
      sessions: sessions.read.map((session) => ({
        ...session,
        isDead: isDeadIn(session, liveness),
      })),
      asks: asks.read,
      bad: [...sessions.bad, ...asks.bad],
      overSessions: listed.sessions?.over ?? 0,
      overAsks: listed.asks?.over ?? 0,
      canCheck: liveness.canCheck,
    },
  }
}

export type DerivedState = 'dead' | 'stale' | 'needsYou' | 'working' | 'quiet'

export type AskLook = 'decide' | 'oldAsk' | 'approved' | 'withdrawn'

export type SessionRow = {
  kind: 'session'
  key: string
  session: FiledSession
  state: DerivedState
  isOwn: boolean
  ageMs: number
  isClockAhead: boolean
  nowAgeMs: number | null
  lastAgeMs: number | null
}

export type AskRow = { kind: 'ask'; key: string; ask: FiledAsk; look: AskLook; ageMs: number }

export type StoreRow = SessionRow | AskRow

function ageOf(now: number, at: number): number {
  return Math.max(now - at, 0)
}

function isClockAhead(session: StoreSession, now: number): boolean {
  return session.updatedAt - now > CLOCK_AHEAD_AFTER_MS
}

export function derivedState(session: FiledSession, now: number): DerivedState {
  if (session.isDead) return 'dead'
  const age = now - session.updatedAt
  if (age >= STALE_AFTER_MS || isClockAhead(session, now)) return 'stale'
  if (session.state === 'needs-you') return 'needsYou'
  if (session.state === 'working' && age < WORKING_FOR_MS) return 'working'
  return 'quiet'
}

function nowAgeOf(session: StoreSession, now: number): number | null {
  if (session.now === null || session.nowAt === null) return null
  const age = ageOf(now, session.nowAt)
  return age > NOW_OLD_AFTER_MS ? age : null
}

function rowSince(session: StoreSession, state: DerivedState): number {
  if (state === 'stale' || state === 'dead') return session.updatedAt
  return session.stateAt ?? session.updatedAt
}

export function sessionRow(session: FiledSession, now: number, ownId: string): SessionRow {
  const state = derivedState(session, now)
  return {
    kind: 'session',
    key: `session:${session.id}`,
    session,
    state,
    isOwn: session.id === ownId,
    ageMs: ageOf(now, rowSince(session, state)),
    isClockAhead: isClockAhead(session, now),
    nowAgeMs: nowAgeOf(session, now),
    lastAgeMs: session.lastAt === null ? null : ageOf(now, session.lastAt),
  }
}

export function askRow(ask: FiledAsk, now: number): AskRow | null {
  const key = `ask:${ask.record}`
  if (ask.closedBy !== null) {
    const age = ageOf(now, ask.closedAt ?? ask.mtimeMs)
    if (age >= CLOSED_SHOWN_FOR_MS) return null
    return { kind: 'ask', key, ask, look: ask.closedBy, ageMs: age }
  }
  const age = ageOf(now, ask.openedAt ?? ask.mtimeMs)
  return { kind: 'ask', key, ask, look: age < ASK_COUNTED_FOR_MS ? 'decide' : 'oldAsk', ageMs: age }
}

export function storeRows(snapshot: Snapshot, now: number, ownId: string): StoreRow[] {
  return [
    ...snapshot.asks.flatMap((ask) => askRow(ask, now) ?? []),
    ...snapshot.sessions.map((session) => sessionRow(session, now, ownId)),
  ].sort(byAttention)
}

export function ownSession(snapshot: Snapshot, ownId: string): FiledSession | undefined {
  return snapshot.sessions.find((session) => session.id === ownId)
}
