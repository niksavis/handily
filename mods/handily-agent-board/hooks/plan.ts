declare module 'claude-code' {
  interface PluginState {
    'handily-task-pane': { agentList: StateFamily<unknown> }
  }
}

export const FOLD_ABOVE = 5
export const FOLD_SIDE = 2

const PLAN_STATUSES = ['pending', 'in_progress', 'completed'] as const

export type PlanStatus = (typeof PLAN_STATUSES)[number]

export type PlanTask = { title: string; status: PlanStatus }

export type PlanView = {
  shown: readonly PlanTask[]
  done: number
  total: number
  isFoldable: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlanTask(value: unknown): value is PlanTask {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    PLAN_STATUSES.some((status) => status === value.status)
  )
}

const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

export function shownTitle(title: string): string {
  return title.replace(HIDDEN_CHARACTER, escapedUnits)
}

export function readPlan(value: unknown): PlanTask[] | null {
  if (!isRecord(value) || !Array.isArray(value.tasks)) return null
  const tasks = value.tasks
    .filter(isPlanTask)
    .map((task) => ({ title: shownTitle(task.title), status: task.status }))
  return tasks.length === 0 ? null : tasks
}

function anchorIndex(tasks: readonly PlanTask[]): number {
  const running = tasks.findIndex((task) => task.status === 'in_progress')
  if (running >= 0) return running
  const next = tasks.findIndex((task) => task.status === 'pending')
  return next >= 0 ? next : tasks.length - 1
}

export function planView(tasks: readonly PlanTask[], isUnfolded: boolean): PlanView {
  const isFoldable = tasks.length > FOLD_ABOVE
  const anchor = anchorIndex(tasks)
  const shown =
    isFoldable && !isUnfolded
      ? tasks.slice(Math.max(anchor - FOLD_SIDE, 0), anchor + FOLD_SIDE + 1)
      : tasks
  return {
    shown,
    done: tasks.filter((task) => task.status === 'completed').length,
    total: tasks.length,
    isFoldable,
  }
}
