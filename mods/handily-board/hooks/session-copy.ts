import type { BoardList, BoardTask, BoardTrend } from '../types'
import { isStatus } from './tasks'
import { TREND_TURNS } from './trend'

export const COPY_PREFIX = 'session-copy:'
export const COPIES_AT_MOST = 20
export const COPY_VERSION = 1

export type SessionCopy = {
  v: typeof COPY_VERSION
  sessionId: string
  transcriptPath: string
  at: number
  list: BoardList | null
  trend: BoardTrend | null
}

export type CopyPart = { list: BoardList } | { trend: BoardTrend }

export type CopyHost = {
  sessionId: () => Promise<string>
  transcriptPath: () => Promise<string>
  now: () => Promise<number>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  storeDelete: (key: string) => Promise<void>
  storeKeys: () => Promise<readonly string[]>
  debug: (line: string) => void
}

export type CopyKeep = { isSeen: boolean; triedFor: Set<string>; isFailureLogged: boolean }

export type Kept = { list: BoardList | undefined; trend: BoardTrend | undefined }

export type Restored = { list?: BoardList; trend?: BoardTrend }

type StoredCopy = { key: string; copy: SessionCopy }

type Listed = { key: string; at: number; copy: SessionCopy | null }

export function newCopyKeep(): CopyKeep {
  return { isSeen: false, triedFor: new Set(), isFailureLogged: false }
}

export function copyKey(sessionId: string): string {
  return `${COPY_PREFIX}${sessionId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSource(value: Record<string, unknown>): boolean {
  if (value.by === 'tracker') return typeof value.item === 'string'
  return (value.by === 'model' || value.by === 'person') && value.item === null
}

function isTask(value: unknown): value is BoardTask {
  return (
    isRecord(value) &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string' &&
    isStatus(value.status) &&
    isSource(value)
  )
}

function isList(value: unknown): value is BoardList {
  return (
    isRecord(value) &&
    Number.isInteger(value.nextId) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isTask)
  )
}

function isReading(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isTrend(value: unknown): value is BoardTrend {
  return (
    isRecord(value) &&
    Array.isArray(value.tokens) &&
    value.tokens.length <= TREND_TURNS &&
    value.tokens.every(isReading) &&
    (value.freshTokens === null || isReading(value.freshTokens)) &&
    typeof value.isAwaitingReading === 'boolean' &&
    typeof value.isLastOpen === 'boolean'
  )
}

function listOf(value: unknown): BoardList | null | undefined {
  if (value === null) return null
  return isList(value) ? value : undefined
}

function trendOf(value: unknown): BoardTrend | null | undefined {
  if (value === null) return null
  return isTrend(value) ? value : undefined
}

export function readCopy(value: unknown): SessionCopy | null {
  if (!isRecord(value) || value.v !== COPY_VERSION) return null
  const { sessionId, transcriptPath, at } = value
  if (typeof sessionId !== 'string' || typeof transcriptPath !== 'string') return null
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  const list = listOf(value.list)
  const trend = trendOf(value.trend)
  if (list === undefined || trend === undefined) return null
  return { v: COPY_VERSION, sessionId, transcriptPath, at, list, trend }
}

function failed(host: CopyHost, keep: CopyKeep, what: string, error: unknown): void {
  if (keep.isFailureLogged) return
  keep.isFailureLogged = true
  host.debug(`handily-board: the session copy was not ${what}: ${String(error)}`)
}

async function pathOf(host: CopyHost): Promise<string> {
  try {
    return await host.transcriptPath()
  } catch {
    return ''
  }
}

async function listedCopies(host: CopyHost): Promise<Listed[]> {
  const keys = (await host.storeKeys()).filter((key) => key.startsWith(COPY_PREFIX))
  const listed: Listed[] = []
  for (const key of keys) {
    const copy = readCopy(await host.storeGet(key))
    listed.push({ key, at: copy?.at ?? Number.NEGATIVE_INFINITY, copy })
  }
  return listed
}

async function makeRoom(host: CopyHost, key: string): Promise<void> {
  const others = (await listedCopies(host))
    .filter((listed) => listed.key !== key)
    .sort((a, b) => a.at - b.at)
  const over = others.length - (COPIES_AT_MOST - 1)
  for (const oldest of others.slice(0, Math.max(over, 0))) await host.storeDelete(oldest.key)
}

async function partsOf(
  host: CopyHost,
  key: string,
  read: () => Promise<Kept>,
): Promise<Pick<SessionCopy, 'list' | 'trend'>> {
  const kept = readCopy(await host.storeGet(key))
  if (kept !== null) return kept
  await makeRoom(host, key)
  const state = await read()
  return { list: state.list ?? null, trend: state.trend ?? null }
}

export async function keepCopy(
  host: CopyHost,
  keep: CopyKeep,
  part: CopyPart,
  read: () => Promise<Kept>,
): Promise<void> {
  try {
    const sessionId = await host.sessionId()
    const key = copyKey(sessionId)
    const kept = await partsOf(host, key, read)
    const copy: SessionCopy = {
      v: COPY_VERSION,
      sessionId,
      transcriptPath: await pathOf(host),
      at: await host.now(),
      list: 'list' in part ? part.list : kept.list,
      trend: 'trend' in part ? part.trend : kept.trend,
    }
    await host.storeSet(key, copy)
  } catch (error) {
    failed(host, keep, 'kept', error)
  }
}

async function foundCopy(
  host: CopyHost,
  sessionId: string,
  path: string,
): Promise<StoredCopy | null> {
  const key = copyKey(sessionId)
  const own = readCopy(await host.storeGet(key))
  if (own !== null) return { key, copy: own }
  if (path === '') return null
  const same = (await listedCopies(host))
    .flatMap(({ key: other, copy }) =>
      copy !== null && copy.transcriptPath === path ? [{ key: other, copy }] : [],
    )
    .sort((a, b) => b.copy.at - a.copy.at)
  return same[0] ?? null
}

async function moveCopy(
  host: CopyHost,
  found: StoredCopy,
  sessionId: string,
  path: string,
): Promise<void> {
  const key = copyKey(sessionId)
  await makeRoom(host, key)
  await host.storeSet(key, { ...found.copy, sessionId, transcriptPath: path, at: await host.now() })
  await host.storeDelete(found.key)
}

function restoredParts(kept: Kept, copy: SessionCopy): Restored {
  return {
    ...(kept.list === undefined && copy.list !== null ? { list: copy.list } : {}),
    ...(kept.trend === undefined && copy.trend !== null ? { trend: copy.trend } : {}),
  }
}

async function noteProcess(host: CopyHost, keep: CopyKeep, sessionId: string): Promise<void> {
  if (keep.isSeen) return
  keep.isSeen = true
  const path = await pathOf(host)
  host.debug(
    `handily-board: this process sees session ${sessionId}, transcript ${path === '' ? 'none' : path}`,
  )
}

export async function restoredCopy(
  host: CopyHost,
  keep: CopyKeep,
  read: () => Promise<Kept>,
): Promise<Restored> {
  try {
    const sessionId = await host.sessionId()
    await noteProcess(host, keep, sessionId)
    if (keep.triedFor.has(sessionId)) return {}
    keep.triedFor.add(sessionId)
    const kept = await read()
    if (kept.list !== undefined && kept.trend !== undefined) return {}
    const path = await pathOf(host)
    const found = await foundCopy(host, sessionId, path)
    if (found === null) return {}
    if (found.key !== copyKey(sessionId)) await moveCopy(host, found, sessionId, path)
    host.debug(
      `handily-board: the session copy of ${found.copy.sessionId} restored session ${sessionId}`,
    )
    return restoredParts(kept, found.copy)
  } catch (error) {
    failed(host, keep, 'read', error)
    return {}
  }
}

export async function deleteCopy(
  host: CopyHost,
  keep: CopyKeep,
  sessionId: string,
  reason: string,
): Promise<void> {
  try {
    await host.storeDelete(copyKey(sessionId))
    host.debug(
      `handily-board: the session copy of ${sessionId} was deleted at the end by ${reason}`,
    )
  } catch (error) {
    failed(host, keep, 'deleted', error)
  }
}
