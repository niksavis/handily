declare module 'claude-code' {
  interface PluginState {
    'handily-task-pane': { list: unknown }
  }
}

export const PROGRESS_PREFIX = 'session:'
export const EST_QUIET_MS = 5 * 60_000
export const STALE_KEEP_MS = 24 * 60 * 60_000
export const STALE_MARGIN_MS = 60_000

export type TaskView = {
  current: string | null
  done: number
  total: number
  ids: number[]
}

export type Progress = {
  sessionId: string
  cwd: string
  updatedAt: number
  isWorking: boolean
  turnStartedAt: number | null
  workedMs: number
  hasTasks: boolean
  task: string | null
  done: number
  total: number
  taskIds: number[]
  firstTaskAt: number | null
  lastAddedAt: number | null
}

type TaskEntry = { id: number; title: string; status: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTaskEntry(value: unknown): value is TaskEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.title === 'string' &&
    typeof value.status === 'string'
  )
}

export function progressKey(sessionId: string): string {
  return `${PROGRESS_PREFIX}${sessionId}`
}

export function readTaskList(value: unknown): TaskView | null {
  if (!isRecord(value) || !Array.isArray(value.tasks)) return null
  const tasks = value.tasks.filter(isTaskEntry)
  const current =
    tasks.find((task) => task.status === 'in_progress') ??
    tasks.find((task) => task.status === 'pending')
  return {
    current: current?.title ?? null,
    done: tasks.filter((task) => task.status === 'completed').length,
    total: tasks.length,
    ids: tasks.map((task) => task.id),
  }
}

export function emptyProgress(sessionId: string, cwd: string, now: number): Progress {
  return {
    sessionId,
    cwd,
    updatedAt: now,
    isWorking: false,
    turnStartedAt: null,
    workedMs: 0,
    hasTasks: false,
    task: null,
    done: 0,
    total: 0,
    taskIds: [],
    firstTaskAt: null,
    lastAddedAt: null,
  }
}

export function readProgress(value: unknown): Progress | null {
  if (!isRecord(value)) return null
  const { sessionId, updatedAt, workedMs, taskIds } = value
  if (typeof sessionId !== 'string' || typeof updatedAt !== 'number') return null
  if (typeof workedMs !== 'number' || !Array.isArray(taskIds)) return null
  return value as Progress
}

export function withTasks(progress: Progress, view: TaskView | null, now: number): Progress {
  if (view === null || view.total === 0) {
    return {
      ...progress,
      updatedAt: now,
      hasTasks: view !== null,
      task: null,
      done: 0,
      total: 0,
      taskIds: [],
      firstTaskAt: null,
      lastAddedAt: null,
    }
  }
  const isAdded = view.ids.some((id) => !progress.taskIds.includes(id))
  return {
    ...progress,
    updatedAt: now,
    hasTasks: true,
    task: view.current,
    done: view.done,
    total: view.total,
    taskIds: view.ids,
    firstTaskAt: firstTaskTime(progress, view, now),
    lastAddedAt: isAdded ? now : progress.lastAddedAt,
  }
}

function firstTaskTime(progress: Progress, view: TaskView, now: number): number | null {
  if (progress.taskIds.length > 0) return progress.firstTaskAt
  return view.done > 0 ? null : now
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
