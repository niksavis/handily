import type {
  BoardActivity,
  BoardList,
  BoardTaskClock,
  BoardToolCount,
  BoardToolSight,
} from '../types'
import { maskedCredentials } from './credentials'

export const PLAN_WARNING_CALLS = 20

const TASK_TOOL_PREFIX = 'mcp__handily-board__'
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

export const EMPTY_ACTIVITY: BoardActivity = {
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

function targetLine(input: Readonly<Record<string, unknown>>, cwd: string): string | null {
  for (const key of TARGET_KEYS) {
    const value = input[key]
    if (typeof value !== 'string') continue
    const line = firstLine(value)
    if (line !== '') return underCwd(line, cwd)
  }
  return null
}

export function toolTarget(input: Readonly<Record<string, unknown>>, cwd: string): string | null {
  const line = targetLine(input, cwd)
  return line === null ? null : maskedCredentials(line).slice(0, TARGET_CHARS_AT_MOST)
}

function counted(perTool: readonly BoardToolCount[], tool: string): BoardToolCount[] {
  if (!perTool.some((count) => count.tool === tool)) return [...perTool, { tool, calls: 1 }]
  return perTool.map((count) => (count.tool === tool ? { tool, calls: count.calls + 1 } : count))
}

export function withMainCall(
  activity: BoardActivity,
  sight: BoardToolSight,
  now: number,
): BoardActivity {
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
  clock: BoardTaskClock | undefined,
  isRunning: boolean,
  now: number,
  calls: number,
): BoardTaskClock | undefined {
  if (clock === undefined) {
    return isRunning
      ? { startedAt: now, startCalls: calls, endedAt: null, endCalls: null }
      : undefined
  }
  if (isRunning) return { ...clock, endedAt: null, endCalls: null }
  return clock.endedAt === null ? { ...clock, endedAt: now, endCalls: calls } : clock
}

export function withClocks(activity: BoardActivity, list: BoardList, now: number): BoardActivity {
  const clocks: Record<string, BoardTaskClock> = {}
  for (const task of list.tasks) {
    const key = String(task.id)
    const isRunning = task.status === 'in_progress'
    const clock = clockOf(activity.clocks[key], isRunning, now, activity.calls)
    if (clock !== undefined) clocks[key] = clock
  }
  return { ...activity, clocks }
}

export function withPlanUpdate(
  activity: BoardActivity,
  list: BoardList,
  now: number,
): BoardActivity {
  return { ...withClocks(activity, list, now), sincePlan: 0 }
}

export function planLag(activity: BoardActivity): number | undefined {
  return activity.sincePlan >= PLAN_WARNING_CALLS ? activity.sincePlan : undefined
}

export function isNoteDue(activity: BoardActivity): boolean {
  if (planLag(activity) === undefined) return false
  return activity.noteAt === null || activity.calls - activity.noteAt >= PLAN_WARNING_CALLS
}

export function planNote(lag: number, hasList: boolean): string {
  const calls = `${String(lag)} tool calls`
  if (!hasList) {
    return `[handily-board] The person sees an empty task list on the board, after ${calls} of yours. Add your plan with task_add, one task for each step, and keep it current with task_update: in_progress when you start a task, completed when it is done.`
  }
  return `[handily-board] The person sees an old plan on the board: your task list did not change in ${calls}. Keep your plan current with task_update: in_progress when you start a task, completed when it is done. Add new steps with task_add.`
}

export const PLAN_REQUEST =
  'Keep your plan for this work in the task list: add each step with task_add, and set each task to in_progress and completed with task_update as you go.'

const SECOND_MS = 1_000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

export function elapsedText(ms: number): string {
  const seconds = Math.floor(Math.max(ms, 0) / SECOND_MS)
  if (seconds < SECONDS_PER_MINUTE) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return `${String(minutes)}m`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${String(hours)}h`
  return `${String(Math.floor(hours / HOURS_PER_DAY))}d`
}

export function callsText(calls: number): string {
  return calls === 1 ? '1 tool' : `${String(calls)} tools`
}
