import type {
  TaskPaneActivity,
  TaskPaneAgentActivity,
  TaskPaneList,
  TaskPaneTaskClock,
  TaskPaneToolCount,
  TaskPaneToolSight,
} from '../types'
import { MAX_AGENT_LISTS } from './tasks'

export const PLAN_WARNING_CALLS = 20

const TASK_TOOL_PREFIX = 'mcp__handily-task-pane__'
const TARGET_CHARS_AT_MOST = 200
const PATH_SEPARATORS = new Set(['/', '\\'])

const TARGET_KEYS = [
  'file_path',
  'notebook_path',
  'pattern',
  'path',
  'url',
  'query',
  'description',
  'command',
  'skill',
] as const

export const EMPTY_ACTIVITY: TaskPaneActivity = {
  calls: 0,
  firstAt: null,
  last: null,
  perTool: [],
  sincePlan: 0,
  noteAt: null,
  clocks: {},
}

export function isTaskTool(tool: string): boolean {
  return tool.startsWith(TASK_TOOL_PREFIX)
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? ''
}

function underCwd(target: string, cwd: string): string {
  if (cwd === '' || !target.startsWith(cwd)) return target
  const rest = target.slice(cwd.length)
  if (!PATH_SEPARATORS.has(rest.charAt(0)) || rest.length === 1) return target
  return rest.slice(1)
}

export function toolTarget(input: Readonly<Record<string, unknown>>, cwd: string): string | null {
  for (const key of TARGET_KEYS) {
    const value = input[key]
    if (typeof value !== 'string') continue
    const line = firstLine(value)
    if (line !== '') return underCwd(line, cwd).slice(0, TARGET_CHARS_AT_MOST)
  }
  return null
}

function counted(perTool: readonly TaskPaneToolCount[], tool: string): TaskPaneToolCount[] {
  if (!perTool.some((count) => count.tool === tool)) return [...perTool, { tool, calls: 1 }]
  return perTool.map((count) => (count.tool === tool ? { tool, calls: count.calls + 1 } : count))
}

export function withMainCall(
  activity: TaskPaneActivity,
  sight: TaskPaneToolSight,
  now: number,
): TaskPaneActivity {
  return {
    ...activity,
    calls: activity.calls + 1,
    firstAt: activity.firstAt ?? now,
    last: sight,
    perTool: counted(activity.perTool, sight.tool),
    sincePlan: activity.sincePlan + 1,
  }
}

function clockOf(
  clock: TaskPaneTaskClock | undefined,
  isRunning: boolean,
  now: number,
  calls: number,
): TaskPaneTaskClock | undefined {
  if (clock === undefined) {
    return isRunning
      ? { startedAt: now, startCalls: calls, endedAt: null, endCalls: null }
      : undefined
  }
  if (isRunning) return { ...clock, endedAt: null, endCalls: null }
  return clock.endedAt === null ? { ...clock, endedAt: now, endCalls: calls } : clock
}

export function withPlanUpdate(
  activity: TaskPaneActivity,
  list: TaskPaneList,
  now: number,
): TaskPaneActivity {
  const clocks: Record<string, TaskPaneTaskClock> = {}
  for (const task of list.tasks) {
    const key = String(task.id)
    const isRunning = task.status === 'in_progress'
    const clock = clockOf(activity.clocks[key], isRunning, now, activity.calls)
    if (clock !== undefined) clocks[key] = clock
  }
  return { ...activity, sincePlan: 0, clocks }
}

export function planLag(activity: TaskPaneActivity): number | undefined {
  return activity.sincePlan >= PLAN_WARNING_CALLS ? activity.sincePlan : undefined
}

export function isNoteDue(activity: TaskPaneActivity): boolean {
  if (planLag(activity) === undefined) return false
  return activity.noteAt === null || activity.calls - activity.noteAt >= PLAN_WARNING_CALLS
}

export function planNote(lag: number, hasList: boolean): string {
  const calls = `${String(lag)} tool calls`
  if (!hasList) {
    return `[task-pane] The person sees an empty task list in the task pane, after ${calls} of yours. Add your plan with task_add, one task for each step, and keep it current with task_update: in_progress when you start a task, completed when it is done.`
  }
  return `[task-pane] The person sees an old plan in the task pane: your task list did not change in ${calls}. Keep your plan current with task_update: in_progress when you start a task, completed when it is done. Add new steps with task_add.`
}

export const PLAN_REQUEST =
  'Keep your plan for this work in the task list: add each step with task_add, and set each task to in_progress and completed with task_update as you go.'

export function withAgentCall(
  agents: readonly TaskPaneAgentActivity[],
  id: string,
  sight: TaskPaneToolSight,
): TaskPaneAgentActivity[] {
  const known = agents.find((agent) => agent.id === id)
  const others = agents.filter((agent) => agent.id !== id)
  const calls = (known?.calls ?? 0) + 1
  return [...others, { id, calls, last: sight }].slice(-MAX_AGENT_LISTS)
}

const MINUTE_MS = 60_000

export function elapsedText(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / MINUTE_MS)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${String(minutes)}m`
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function clockTime(at: number): string {
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  return `${hours}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function callsText(calls: number): string {
  return calls === 1 ? '1 tool' : `${String(calls)} tools`
}
