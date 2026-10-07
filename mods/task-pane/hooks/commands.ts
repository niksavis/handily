import type { PluginState } from 'claude-code'
import type { TaskPaneList, TaskPaneTask } from '../types'
import {
  EMPTY_LIST,
  addTask,
  findTask,
  listText,
  looksLikeItemId,
  numbersText,
  openItems,
  priorityText,
  removeTask,
  taskForItem,
  type WorkItem,
} from './tasks'

export const OPEN_ITEMS_SHOWN = 10
const EDIT_ATTEMPTS = 5

export type TaskCommand =
  | { kind: 'list' }
  | { kind: 'add'; text: string }
  | { kind: 'rm'; text: string }
  | { kind: 'pane'; text: string }
  | { kind: 'unknown'; word: string }

export type TrackerLine = { tone: 'dim' | 'warning' | 'error'; text: string }

export type TrackerView =
  | { kind: 'items'; label: string; items: WorkItem[]; openCount: number }
  | { kind: 'lines'; lines: TrackerLine[] }

type ItemLookup = { item: WorkItem } | { refusal: string }

export type Snapshot = PluginState['workitems']['snapshot']

export type TaskHost = {
  getList: () => Promise<{ value: TaskPaneList | undefined; version: number }>
  setList: (list: TaskPaneList, ifVersion?: number) => Promise<boolean>
  snapshot: () => Promise<Snapshot | undefined>
  lines: (snapshot: Snapshot) => Promise<readonly TrackerLine[]>
  note: (text: string) => Promise<string | undefined>
}

export async function readList(host: TaskHost): Promise<TaskPaneList> {
  const { value } = await host.getList()
  return value ?? EMPTY_LIST
}

export async function changeList<T>(
  host: TaskHost,
  change: (list: TaskPaneList) => { list: TaskPaneList; value: T },
): Promise<T> {
  for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt += 1) {
    const held = await host.getList()
    const current = held.value ?? EMPTY_LIST
    const outcome = change(current)
    if (outcome.list === current) return outcome.value
    if (await host.setList(outcome.list, held.version)) return outcome.value
  }
  throw new Error(
    `task-pane: the task list changed ${String(EDIT_ATTEMPTS)} times during one edit. Try again.`,
  )
}

export async function resetList(host: TaskHost): Promise<void> {
  await host.setList(EMPTY_LIST)
}

export function parseTaskCommand(args: string): TaskCommand {
  const trimmed = args.trim()
  if (trimmed === '') return { kind: 'list' }
  const space = trimmed.search(/\s/)
  const word = space === -1 ? trimmed : trimmed.slice(0, space)
  const text = space === -1 ? '' : trimmed.slice(space).trim()
  if (word === 'add' || word === 'rm' || word === 'pane') return { kind: word, text }
  return { kind: 'unknown', word }
}

export function unknownReply(word: string): string {
  return `Unknown subcommand "${word}". Use /task, /task add <text|id>, /task rm <n> or /task pane.`
}

export async function trackerView(host: TaskHost): Promise<TrackerView> {
  const snapshot = await host.snapshot()
  if (!snapshot) {
    return { kind: 'lines', lines: [{ tone: 'dim', text: 'Work items are not read yet.' }] }
  }
  if (snapshot.state === 'ok') {
    return {
      kind: 'items',
      label: snapshot.sourceLabel,
      items: openItems(snapshot.items, OPEN_ITEMS_SHOWN),
      openCount: snapshot.items.filter((item) => item.status !== 'closed').length,
    }
  }
  return { kind: 'lines', lines: [...(await host.lines(snapshot))] }
}

async function lookupItem(host: TaskHost, id: string): Promise<ItemLookup> {
  const asText = 'Add it as text: /task add <text>.'
  const snapshot = await host.snapshot()
  if (!snapshot) {
    return { refusal: `Cannot read ${id}: workitems has not read the tracker yet. ${asText}` }
  }
  switch (snapshot.state) {
    case 'ok':
    case 'stale': {
      const item = snapshot.items.find((candidate) => candidate.id === id)
      if (item) return { item }
      return { refusal: `No work item ${id} in ${snapshot.sourceLabel}. ${asText}` }
    }
    case 'terminal-only':
      return {
        refusal: `Cannot read ${id} here: ${snapshot.sourceLabel} needs a terminal session. ${asText}`,
      }
    case 'no-tracker':
      return {
        refusal: `Cannot read ${id}: no tracker found at the repo root (${snapshot.reason}). ${asText}`,
      }
    case 'failed':
      return { refusal: `Cannot read ${id}: work items unavailable: ${snapshot.reason} ${asText}` }
    case 'approval-needed':
      return {
        refusal: `Cannot read ${id}: work items need your approval to run ${snapshot.reason}. ${asText}`,
      }
  }
}

function changeSuffix(isTurnRunning: boolean): string {
  return isTurnRunning ? 'Claude sees it when this turn ends.' : 'Claude is told the list changed.'
}

async function tellModel(host: TaskHost, change: string, list: TaskPaneList): Promise<void> {
  const current = list.tasks.length === 0 ? 'The list is now empty.' : listText(list)
  const text = `[task-pane] The person changed the session task list: ${change}\n\n${current}`
  const refusal = await host.note(text)
  if (refusal !== undefined) {
    throw new Error(`task-pane: the note to Claude was refused: ${refusal}`)
  }
}

export type ItemsAdded = { added: TaskPaneTask[]; existing: TaskPaneTask[]; list: TaskPaneList }

export async function addItemsAsTasks(
  host: TaskHost,
  items: readonly WorkItem[],
): Promise<ItemsAdded> {
  const outcome = await changeList(host, (current) => {
    let list = current
    const added: TaskPaneTask[] = []
    const existing: TaskPaneTask[] = []
    for (const item of items) {
      const known = taskForItem(list, item.id)
      if (known) {
        existing.push(known)
        continue
      }
      const next = addTask(list, item.title, 'person', item.id)
      list = next.list
      added.push(next.task)
    }
    return { list, value: { added, existing, list } }
  })
  if (outcome.added.length > 0) {
    const change = outcome.added
      .map((task) => `it added task ${String(task.id)} from ${task.item ?? ''}: ${task.title}.`)
      .join(' ')
    await tellModel(host, change, outcome.list)
  }
  return outcome
}

export async function personAdd(
  host: TaskHost,
  text: string,
  isTurnRunning: boolean,
): Promise<string> {
  if (text === '') {
    return '/task add needs text or an item id, for example:\n/task add Write the summary   or   /task add handily-cd34'
  }
  if (looksLikeItemId(text)) {
    const lookup = await lookupItem(host, text)
    if ('refusal' in lookup) return lookup.refusal
    const { added, existing } = await addItemsAsTasks(host, [lookup.item])
    const known = existing[0]
    if (known)
      return `${text} is already task ${String(known.id)}: ${known.title}. Nothing changed.`
    const task = added[0]
    if (!task) throw new Error(`task-pane: adding ${text} added no task`)
    return `Added task ${String(task.id)} from ${text}: ${task.title}.`
  }
  const { task, list } = await changeList(host, (current) => {
    const added = addTask(current, text, 'person', null)
    return { list: added.list, value: added }
  })
  await tellModel(host, `it added task ${String(task.id)}: ${task.title}.`, list)
  return `Added task ${String(task.id)}: ${task.title}. ${changeSuffix(isTurnRunning)}`
}

function missingTaskReply(id: string, list: TaskPaneList): string {
  if (list.tasks.length === 0) {
    return `No task ${id}. This session has no tasks yet; add one with /task add <text>.`
  }
  const numbers = numbersText(list)
  const noun = list.tasks.length === 1 ? 'task' : 'tasks'
  return `No task ${id}. This session has ${noun} ${numbers}; run /task to list them.`
}

export async function personRemove(
  host: TaskHost,
  text: string,
  isTurnRunning: boolean,
): Promise<string> {
  if (!/^\d+$/.test(text)) return '/task rm needs a task number, for example /task rm 2.'
  const id = Number(text)
  const outcome = await changeList<{ task: TaskPaneTask | undefined; list: TaskPaneList }>(
    host,
    (list) => {
      const task = findTask(list, id)
      if (!task) return { list, value: { task: undefined, list } }
      const next = removeTask(list, id)
      return { list: next, value: { task, list: next } }
    },
  )
  if (!outcome.task) return missingTaskReply(text, outcome.list)
  const { task, list } = outcome
  await tellModel(host, `it removed task ${String(task.id)}: ${task.title}.`, list)
  return `Removed task ${String(task.id)}: ${task.title}. ${changeSuffix(isTurnRunning)}`
}

function itemRow(item: WorkItem): string {
  return `  ${item.id}  ${priorityText(item)}  ${item.title}`
}

export async function emptyListReply(host: TaskHost): Promise<string> {
  const lead = 'No tasks in this session yet.'
  const view = await trackerView(host)
  if (view.kind === 'lines') return [lead, ...view.lines.map((line) => line.text)].join(' ')
  if (view.items.length === 0) return `${lead} The tracker (${view.label}) has no open items.`
  const shown = String(view.items.length)
  const more =
    view.openCount > view.items.length
      ? [`  and ${String(view.openCount - view.items.length)} more`]
      : []
  return [
    `${lead} Open in the tracker (${view.label}, ${String(view.openCount)}):`,
    ...view.items.map(itemRow),
    ...more,
    `Add one with /task add <id>, or press "Add ${shown} as tasks" in /task pane.`,
  ].join('\n')
}

export async function listReply(host: TaskHost): Promise<string> {
  const list = await readList(host)
  if (list.tasks.length === 0) return emptyListReply(host)
  return listText(list)
}
