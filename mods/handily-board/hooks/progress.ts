import type { BoardList, BoardStatus, BoardTask } from '../types'
import { isStatus, ownList } from './tasks'
import { cutToWidth } from './width'

export const PROGRESS_PREFIX = 'session:'
export const EST_QUIET_MS = 5 * 60_000
export const STALE_KEEP_MS = 24 * 60 * 60_000
export const STALE_MARGIN_MS = 60_000
export const ENTRY_BYTES_AT_MOST = 4096
export const AGENT_NAME_AT_MOST = 40
export const AGENT_TASK_AT_MOST = 80

export type AgentSummary = {
  name: string
  task: string | null
  done: number
  total: number
  isFailed: boolean
  needsYou?: true
}

export type SharedContext = { percent: number; cents: number | null }

export type Progress = {
  sessionId: string
  cwd: string
  updatedAt: number
  isWorking: boolean
  turnStartedAt: number | null
  workedMs: number
  task: string | null
  taskStatus: BoardStatus | null
  done: number
  total: number
  taskIds: number[]
  firstTaskAt: number | null
  lastAddedAt: number | null
  agents: readonly AgentSummary[]
  agentCount: number
  context: SharedContext | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === 'number'
}

export function progressKey(sessionId: string): string {
  return `${PROGRESS_PREFIX}${sessionId}`
}

export function currentTask(list: BoardList): BoardTask | undefined {
  return (
    list.tasks.find((task) => task.status === 'in_progress') ??
    list.tasks.find((task) => task.status === 'pending')
  )
}

function taskLabel(task: BoardTask): string {
  return task.by === 'tracker' ? `${task.item}: ${task.title}` : task.title
}

export function emptyProgress(sessionId: string, cwd: string, now: number): Progress {
  return {
    sessionId,
    cwd,
    updatedAt: now,
    isWorking: false,
    turnStartedAt: null,
    workedMs: 0,
    task: null,
    taskStatus: null,
    done: 0,
    total: 0,
    taskIds: [],
    firstTaskAt: null,
    lastAddedAt: null,
    agents: [],
    agentCount: 0,
    context: null,
  }
}

function readAgent(value: unknown): AgentSummary | null {
  if (!isRecord(value)) return null
  const { name, task, done, total, isFailed } = value
  if (typeof name !== 'string' || (task !== null && typeof task !== 'string')) return null
  if (typeof done !== 'number' || typeof total !== 'number' || typeof isFailed !== 'boolean') {
    return null
  }
  const agent = { name, task, done, total, isFailed }
  return value.needsYou === true ? { ...agent, needsYou: true } : agent
}

function readAgents(value: Record<string, unknown>) {
  const { agents, agentCount } = value
  if (agents === undefined && agentCount === undefined) return { agents: [], agentCount: 0 }
  if (!Array.isArray(agents) || typeof agentCount !== 'number') return null
  const read = agents.map(readAgent)
  if (!read.every((agent) => agent !== null)) return null
  return { agents: read, agentCount }
}

function readContext(value: unknown): SharedContext | null | undefined {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) return undefined
  const { percent, cents } = value
  if (typeof percent !== 'number') return undefined
  if (cents === null) return { percent, cents: null }
  return typeof cents === 'number' ? { percent, cents } : undefined
}

export function readProgress(value: unknown): Progress | null {
  if (!isRecord(value)) return null
  const { sessionId, cwd, updatedAt, workedMs, taskIds, done, total } = value
  if (typeof sessionId !== 'string' || typeof cwd !== 'string') return null
  if (typeof updatedAt !== 'number' || typeof workedMs !== 'number') return null
  if (typeof done !== 'number' || typeof total !== 'number') return null
  if (!Array.isArray(taskIds) || !taskIds.every((id) => typeof id === 'number')) return null
  if (typeof value.isWorking !== 'boolean' || !isNumberOrNull(value.turnStartedAt)) return null
  if (!isNumberOrNull(value.firstTaskAt) || !isNumberOrNull(value.lastAddedAt)) return null
  if (value.task !== null && typeof value.task !== 'string') return null
  if (value.taskStatus !== null && !isStatus(value.taskStatus)) return null
  const agents = readAgents(value)
  if (agents === null) return null
  const context = readContext(value.context)
  if (context === undefined) return null
  return { ...(value as Progress), ...agents, context }
}

export function entryBytes(progress: Progress): number {
  return new TextEncoder().encode(JSON.stringify(progress)).length
}

export function withinLimit(progress: Progress): Progress {
  let kept = progress
  while (entryBytes(kept) > ENTRY_BYTES_AT_MOST && kept.agents.length > 0) {
    kept = { ...kept, agents: kept.agents.slice(0, -1) }
  }
  const bytes = entryBytes(kept)
  if (bytes > ENTRY_BYTES_AT_MOST) {
    throw new Error(
      `the entry is ${String(bytes)} bytes with no agent, over the limit of ${String(ENTRY_BYTES_AT_MOST)}`,
    )
  }
  return kept
}

export function agentSummary(
  name: string,
  tasks: readonly BoardTask[] | null,
  isFailed: boolean,
): AgentSummary {
  const list = tasks ?? []
  const current = currentTask({ tasks: list, nextId: 0 })
  return {
    name: cutToWidth(name, AGENT_NAME_AT_MOST),
    task: current ? cutToWidth(taskLabel(current), AGENT_TASK_AT_MOST) : null,
    done: list.filter((task) => task.status === 'completed').length,
    total: list.length,
    isFailed,
  }
}

export function withAgents(
  progress: Progress,
  agents: readonly AgentSummary[],
  now: number,
): Progress {
  return { ...progress, updatedAt: now, agents, agentCount: agents.length }
}

function firstTaskTime(progress: Progress, done: number, now: number): number | null {
  if (progress.taskIds.length > 0) return progress.firstTaskAt
  return done > 0 ? null : now
}

export type ListSummary = {
  current: BoardTask | undefined
  done: number
  total: number
  ids: number[]
}

export function listSummary(all: BoardList): ListSummary {
  const list = ownList(all)
  return {
    current: currentTask(list),
    done: list.tasks.filter((task) => task.status === 'completed').length,
    total: list.tasks.length,
    ids: list.tasks.map((task) => task.id),
  }
}

export function withTasks(progress: Progress, all: BoardList, now: number): Progress {
  const { current, done, total, ids } = listSummary(all)
  if (total === 0) {
    return {
      ...progress,
      updatedAt: now,
      task: null,
      taskStatus: null,
      done: 0,
      total: 0,
      taskIds: [],
      firstTaskAt: null,
      lastAddedAt: null,
    }
  }
  const isAdded = ids.some((id) => !progress.taskIds.includes(id))
  return {
    ...progress,
    updatedAt: now,
    task: current ? taskLabel(current) : null,
    taskStatus: current?.status ?? null,
    done,
    total,
    taskIds: ids,
    firstTaskAt: firstTaskTime(progress, done, now),
    lastAddedAt: isAdded ? now : progress.lastAddedAt,
  }
}

export function withContext(
  progress: Progress,
  context: SharedContext | null,
  now: number,
): Progress {
  return { ...progress, updatedAt: now, context }
}

export function startTurn(progress: Progress, now: number): Progress {
  return { ...progress, updatedAt: now, isWorking: true, turnStartedAt: now }
}

export function completeTurn(progress: Progress, now: number): Progress {
  const span = progress.turnStartedAt === null ? 0 : Math.max(now - progress.turnStartedAt, 0)
  return {
    ...progress,
    updatedAt: now,
    isWorking: false,
    turnStartedAt: null,
    workedMs: progress.workedMs + span,
  }
}

export function workedMs(progress: Progress, now: number, openSince = -Infinity): number {
  const start = progress.turnStartedAt
  const running = start === null || start < openSince ? 0 : Math.max(now - start, 0)
  return progress.workedMs + running
}

export function estimateLeftMs(progress: Progress, now: number): number | null {
  if (progress.done < 1 || progress.done >= progress.total) return null
  if (progress.firstTaskAt === null) return null
  if (progress.lastAddedAt !== null && now - progress.lastAddedAt < EST_QUIET_MS) return null
  const spent = now - progress.firstTaskAt
  return (spent * (progress.total - progress.done)) / progress.done
}

export function isOlderThanStart(progress: Progress, startedAt: number): boolean {
  return startedAt - progress.updatedAt > STALE_MARGIN_MS
}

export function isExpired(progress: Progress, liveSessionIds: ReadonlySet<string>, now: number) {
  return !liveSessionIds.has(progress.sessionId) && now - progress.updatedAt > STALE_KEEP_MS
}
