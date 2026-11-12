import type { BoardList, BoardTask, BoardTaskKind } from '../types'
import { openForPerson } from './for-you'
import { cutToWidth } from './width'

export const WAITS_AT_MOST = 5
export const WAIT_NAME_AT_MOST = 40
export const WAIT_TEXT_AT_MOST = 80

export type WaitKind = 'permission' | BoardTaskKind

export const WAIT_KINDS: readonly WaitKind[] = ['permission', 'decide', 'answer', 'do']

export type PermissionWait = {
  kind: 'permission'
  agent: string
  tool: string
  target: string | null
  since: number
}

export type TaskWait = { kind: BoardTaskKind; title: string; since: number | null }

export type SharedWait = PermissionWait | TaskWait

export type WaitCounts = Partial<Record<WaitKind, number>>

export type SharedWaits = { waits: readonly SharedWait[]; waitsMore: WaitCounts }

export const NO_WAITS: SharedWaits = { waits: [], waitsMore: {} }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shortText(text: string, columns: number): string {
  return cutToWidth(Array.from(text).slice(0, columns).join(''), columns)
}

function isWaitKind(value: unknown): value is WaitKind {
  return WAIT_KINDS.some((kind) => kind === value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function permissionWait(
  agent: string,
  tool: string,
  target: string | null,
  since: number,
): PermissionWait {
  return {
    kind: 'permission',
    agent: shortText(agent, WAIT_NAME_AT_MOST),
    tool: shortText(tool, WAIT_NAME_AT_MOST),
    target: target === null ? null : shortText(target, WAIT_TEXT_AT_MOST),
    since,
  }
}

function taskWait(task: BoardTask): TaskWait {
  return {
    kind: task.kind ?? 'do',
    title: shortText(task.title, WAIT_TEXT_AT_MOST),
    since: task.askedAt ?? null,
  }
}

export function counted(counts: WaitCounts, kind: WaitKind, by: number): WaitCounts {
  if (by === 0) return counts
  return { ...counts, [kind]: (counts[kind] ?? 0) + by }
}

export function countOf(counts: WaitCounts): number {
  return WAIT_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0)
}

function sharedWaits(
  asks: readonly PermissionWait[],
  asksNotKept: number,
  list: BoardList,
): SharedWaits {
  const all: SharedWait[] = [...asks, ...openForPerson(list).map(taskWait)]
  const rest = all
    .slice(WAITS_AT_MOST)
    .reduce<WaitCounts>((counts, wait) => counted(counts, wait.kind, 1), {})
  return { waits: all.slice(0, WAITS_AT_MOST), waitsMore: counted(rest, 'permission', asksNotKept) }
}

export function isPermission(wait: SharedWait): wait is PermissionWait {
  return wait.kind === 'permission'
}

export function waitsOfAsks(asks: readonly PermissionWait[], list: BoardList): SharedWaits {
  return sharedWaits(asks, 0, list)
}

export function waitsOfTasks(shared: SharedWaits, list: BoardList): SharedWaits {
  return sharedWaits(shared.waits.filter(isPermission), shared.waitsMore.permission ?? 0, list)
}

export function withoutLastWait(shared: SharedWaits): SharedWaits | null {
  const last = shared.waits.at(-1)
  if (last === undefined) return null
  return { waits: shared.waits.slice(0, -1), waitsMore: counted(shared.waitsMore, last.kind, 1) }
}

function readPermission(value: Record<string, unknown>): PermissionWait | null {
  const { agent, tool, target, since } = value
  if (typeof agent !== 'string' || typeof tool !== 'string') return null
  if (target !== null && typeof target !== 'string') return null
  if (typeof since !== 'number') return null
  return { kind: 'permission', agent, tool, target, since }
}

function readWait(value: unknown): SharedWait | null {
  if (!isRecord(value) || !isWaitKind(value.kind)) return null
  if (value.kind === 'permission') return readPermission(value)
  const { title, since } = value
  if (typeof title !== 'string' || (since !== null && typeof since !== 'number')) return null
  return { kind: value.kind, title, since }
}

function readCounts(value: unknown): WaitCounts | null {
  if (!isRecord(value)) return null
  let counts: WaitCounts = {}
  for (const [kind, count] of Object.entries(value)) {
    if (!isWaitKind(kind) || !isCount(count)) return null
    counts = counted(counts, kind, count)
  }
  return counts
}

export function readWaits(value: Record<string, unknown>): SharedWaits | null {
  const { waits, waitsMore } = value
  if (waits === undefined && waitsMore === undefined) return NO_WAITS
  if (!Array.isArray(waits) || waits.length > WAITS_AT_MOST) return null
  const read = waits.map(readWait)
  const more = readCounts(waitsMore)
  if (!read.every((wait) => wait !== null) || more === null) return null
  return { waits: read, waitsMore: more }
}
