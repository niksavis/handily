import type { BoardList, BoardStatus, BoardTask } from '../types'
import { isStatus } from './tasks'

export const PROGRESS_PREFIX = 'session:'
export const EST_QUIET_MS = 5 * 60_000
export const STALE_KEEP_MS = 24 * 60 * 60_000
export const STALE_MARGIN_MS = 60_000

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
  }
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
  return value as Progress
}

function firstTaskTime(progress: Progress, done: number, now: number): number | null {
  if (progress.taskIds.length > 0) return progress.firstTaskAt
  return done > 0 ? null : now
}

export function withTasks(progress: Progress, list: BoardList, now: number): Progress {
  const total = list.tasks.length
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
  const ids = list.tasks.map((task) => task.id)
  const done = list.tasks.filter((task) => task.status === 'completed').length
  const current = currentTask(list)
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
