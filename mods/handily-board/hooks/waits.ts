import type { BoardList, BoardTask, BoardTaskKind } from '../types'
import { maskedCredentials } from './credentials'
import { openForPerson } from './for-you'
import { PLAN_TOOL } from './plan'
import { cutToWidth } from './width'

export const WAITS_AT_MOST = 5
export const WAIT_NAME_AT_MOST = 40
export const WAIT_TEXT_AT_MOST = 80

export const QUESTION_TOOL = 'AskUserQuestion'

type TextAskKind = 'question' | 'waits'

export type AskKind = 'permission' | TextAskKind

export type WaitKind = AskKind | BoardTaskKind

export const WAIT_KINDS: readonly WaitKind[] = [
  'permission',
  'question',
  'waits',
  'decide',
  'answer',
  'do',
]

const ASK_KINDS: readonly AskKind[] = ['permission', 'question', 'waits']

export type PermissionWait = {
  kind: 'permission'
  agent: string
  tool: string
  target: string | null
  since: number
}

export type TextAskWait = { kind: TextAskKind; title: string; since: number }

export type AskWait = PermissionWait | TextAskWait

export type TaskWait = { kind: BoardTaskKind; title: string; since: number | null }

export type SharedWait = AskWait | TaskWait

export type AskedCall = { tool: string; target: string | null; question: string | null }

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

function isTextAskKind(kind: WaitKind): kind is TextAskKind {
  return kind === 'question' || kind === 'waits'
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

function textAsk(kind: TextAskKind, title: string, since: number): TextAskWait {
  return { kind, title: shortText(title, WAIT_TEXT_AT_MOST), since }
}

export function askedQuestion(tool: string, input: unknown): string | null {
  if (tool !== QUESTION_TOOL || !isRecord(input) || !Array.isArray(input.questions)) return null
  const first: unknown = input.questions[0]
  if (!isRecord(first) || typeof first.question !== 'string') return null
  const line = first.question.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line === '' ? null : maskedCredentials(line)
}

export function askWait(agent: string, call: AskedCall, since: number): AskWait {
  if (call.tool === QUESTION_TOOL) return textAsk('question', call.question ?? call.tool, since)
  if (call.tool === PLAN_TOOL) return textAsk('waits', call.tool, since)
  return permissionWait(agent, call.tool, call.target, since)
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
  asks: readonly AskWait[],
  asksNotKept: WaitCounts,
  list: BoardList,
): SharedWaits {
  const all: SharedWait[] = [...asks, ...openForPerson(list).map(taskWait)]
  const waitsMore = all
    .slice(WAITS_AT_MOST)
    .reduce<WaitCounts>((counts, wait) => counted(counts, wait.kind, 1), asksNotKept)
  return { waits: all.slice(0, WAITS_AT_MOST), waitsMore }
}

function isAsk(wait: SharedWait): wait is AskWait {
  return ASK_KINDS.some((kind) => kind === wait.kind)
}

function askCounts(counts: WaitCounts): WaitCounts {
  return ASK_KINDS.reduce<WaitCounts>((kept, kind) => counted(kept, kind, counts[kind] ?? 0), {})
}

export function waitsOfAsks(asks: readonly AskWait[], list: BoardList): SharedWaits {
  return sharedWaits(asks, {}, list)
}

export function waitsOfTasks(shared: SharedWaits, list: BoardList): SharedWaits {
  return sharedWaits(shared.waits.filter(isAsk), askCounts(shared.waitsMore), list)
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
  const { kind, title, since } = value
  if (kind === 'permission') return readPermission(value)
  if (typeof title !== 'string') return null
  if (isTextAskKind(kind)) return typeof since === 'number' ? { kind, title, since } : null
  if (since !== null && typeof since !== 'number') return null
  return { kind, title, since }
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
