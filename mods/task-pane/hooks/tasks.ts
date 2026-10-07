import type { PluginState } from 'claude-code'
import type { TaskPaneAuthor, TaskPaneList, TaskPaneStatus, TaskPaneTask } from '../types'

export type WorkItem = PluginState['workitems']['snapshot']['items'][number]

export const EMPTY_LIST: TaskPaneList = { tasks: [], nextId: 1 }

export const STATUSES: readonly TaskPaneStatus[] = ['pending', 'in_progress', 'completed']

const STATUS_WORDS: Record<TaskPaneStatus, string> = {
  pending: 'pending',
  in_progress: 'in progress',
  completed: 'done',
}

const STATUS_WORD_WIDTH = Math.max(...Object.values(STATUS_WORDS).map((word) => word.length))

const ITEM_ID = /^[A-Za-z][A-Za-z0-9_]*-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*$/

export function isStatus(value: unknown): value is TaskPaneStatus {
  return STATUSES.some((status) => status === value)
}

export function looksLikeItemId(text: string): boolean {
  return ITEM_ID.test(text)
}

export function statusWord(status: TaskPaneStatus): string {
  return STATUS_WORDS[status]
}

export function findTask(list: TaskPaneList, id: number): TaskPaneTask | undefined {
  return list.tasks.find((task) => task.id === id)
}

export function taskForItem(list: TaskPaneList, itemId: string): TaskPaneTask | undefined {
  return list.tasks.find((task) => task.item === itemId)
}

export function addTask(
  list: TaskPaneList,
  title: string,
  by: TaskPaneAuthor,
  item: string | null,
): { list: TaskPaneList; task: TaskPaneTask } {
  const task: TaskPaneTask = { id: list.nextId, title, status: 'pending', by, item }
  return { list: { tasks: [...list.tasks, task], nextId: list.nextId + 1 }, task }
}

export function setStatus(list: TaskPaneList, id: number, status: TaskPaneStatus): TaskPaneList {
  return {
    ...list,
    tasks: list.tasks.map((task) => (task.id === id ? { ...task, status } : task)),
  }
}

export function removeTask(list: TaskPaneList, id: number): TaskPaneList {
  return { ...list, tasks: list.tasks.filter((task) => task.id !== id) }
}

export function doneCount(list: TaskPaneList): number {
  return list.tasks.filter((task) => task.status === 'completed').length
}

export function numbersText(list: TaskPaneList): string {
  const ranges: string[] = []
  let start: number | undefined
  let previous: number | undefined
  const close = () => {
    if (start === undefined || previous === undefined) return
    ranges.push(start === previous ? String(start) : `${String(start)}-${String(previous)}`)
  }
  for (const { id } of list.tasks) {
    if (previous !== undefined && id === previous + 1) {
      previous = id
      continue
    }
    close()
    start = id
    previous = id
  }
  close()
  return ranges.join(', ')
}

export function listText(list: TaskPaneList): string {
  const width = Math.max(...list.tasks.map((task) => String(task.id).length))
  const rows = list.tasks.map((task) => {
    const number = String(task.id).padStart(width)
    const word = statusWord(task.status).padEnd(STATUS_WORD_WIDTH)
    const author = task.by === 'person' ? '  (you)' : ''
    return `  ${number}  ${word}  ${task.title}${author}`
  })
  const total = String(list.tasks.length)
  return [`Tasks (${String(doneCount(list))} of ${total} done)`, ...rows].join('\n')
}

export function openItems(items: readonly WorkItem[], limit: number): WorkItem[] {
  return items
    .filter((item) => item.status !== 'closed')
    .sort(
      (a, b) =>
        (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit)
}

export function priorityText(item: WorkItem): string {
  return item.priority === null ? 'P-' : `P${String(item.priority)}`
}
