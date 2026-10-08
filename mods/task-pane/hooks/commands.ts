import type { PluginState } from 'claude-code'
import type { TaskPaneList, TaskPaneTask } from '../types'
import {
  EMPTY_LIST,
  addTask,
  findTask,
  isOpenItem,
  listText,
  looksLikeItemId,
  numbersText,
  openItems,
  priorityText,
  quoted,
  removeTask,
  TRACKER_TEXT_IS_DATA,
  taskForItem,
  taskText,
  withTrackerNotice,
  type WorkItem,
} from './tasks'

export const OPEN_ITEMS_SHOWN = 10
const TEXT_MARKER = '--'
const TEXT_MARKER_HINT = `/task add ${TEXT_MARKER} <text>`

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

type ItemLookup = { item: WorkItem } | { absentFrom: string } | { refusal: string }

export type Snapshot = PluginState['workitems']['snapshot']

export type ListEdit<T> = (list: TaskPaneList) => { list: TaskPaneList; value: T }

export type TaskHost = {
  read: () => Promise<TaskPaneList | undefined>
  edit: <T>(change: ListEdit<T>) => Promise<T>
  snapshot: () => Promise<Snapshot | undefined>
  lines: (snapshot: Snapshot) => Promise<readonly TrackerLine[]>
  note: (text: string) => Promise<string | undefined>
  expanded: () => Promise<readonly string[]>
  editExpanded: (change: (keys: readonly string[]) => readonly string[]) => Promise<void>
}

export async function readList(host: TaskHost): Promise<TaskPaneList> {
  return (await host.read()) ?? EMPTY_LIST
}

export async function resetList(host: TaskHost): Promise<void> {
  await host.edit(() => ({ list: EMPTY_LIST, value: undefined }))
  await host.editExpanded(() => [])
}

export function withoutFinalPeriod(text: string): string {
  return text.replace(/\.+$/, '')
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
      openCount: snapshot.items.filter(isOpenItem).length,
    }
  }
  return { kind: 'lines', lines: [...(await host.lines(snapshot))] }
}

async function lookupItem(host: TaskHost, id: string): Promise<ItemLookup> {
  const asText = `Add it as text: /task add ${TEXT_MARKER} ${id}.`
  const snapshot = await host.snapshot()
  if (!snapshot) {
    return { refusal: `Cannot read ${id}: workitems has not read the tracker yet. ${asText}` }
  }
  switch (snapshot.state) {
    case 'ok':
    case 'stale': {
      const item = snapshot.items.find((candidate) => candidate.id === id)
      if (!item) return { absentFrom: snapshot.sourceLabel }
      if (!isOpenItem(item)) {
        return {
          refusal: `${id} is ${item.status} in ${snapshot.sourceLabel}. Add it as text: ${TEXT_MARKER_HINT}.`,
        }
      }
      return { item }
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

function changedTask(task: TaskPaneTask): string {
  const number = String(task.id)
  switch (task.by) {
    case 'person':
      return `task ${number} by the person: ${task.title}.`
    case 'model':
      return `task ${number} by claude, titled ${quoted(task.title)}.`
    case 'tracker':
      return `task ${number} from tracker item ${quoted(task.item)}, titled ${quoted(task.title)}.`
  }
}

async function tellModel(
  host: TaskHost,
  verb: 'added' | 'removed',
  tasks: readonly TaskPaneTask[],
  list: TaskPaneList,
): Promise<string | undefined> {
  const change = tasks.map((task) => `it ${verb} ${changedTask(task)}`).join(' ')
  const current = list.tasks.length === 0 ? 'The list is now empty.' : listText(list)
  const text = withTrackerNotice(
    `[task-pane] The person changed the session task list: ${change}\n\n${current}`,
    [...tasks, ...list.tasks],
  )
  return host.note(text)
}

function toldSuffix(refusal: string | undefined): string {
  if (refusal === undefined) return '. Claude is told the list changed.'
  return `; Claude was not told: ${withoutFinalPeriod(refusal)}.`
}

export type ItemsAdded = {
  added: TaskPaneTask[]
  existing: TaskPaneTask[]
  refusal: string | undefined
  noteRefusal: string | undefined
}

export async function addItemsAsTasks(
  host: TaskHost,
  items: readonly WorkItem[],
): Promise<ItemsAdded> {
  const outcome = await host.edit((current) => {
    let list = current
    const added: TaskPaneTask[] = []
    const existing: TaskPaneTask[] = []
    let refusal: string | undefined
    for (const item of items) {
      if (!looksLikeItemId(item.id)) {
        refusal = `${quoted(item.id)} is no tracker item id`
        continue
      }
      const known = taskForItem(list, item.id)
      if (known) {
        existing.push(known)
        continue
      }
      if (!isOpenItem(item)) {
        refusal = `${item.id} is ${item.status} in the tracker`
        continue
      }
      const next = addTask(list, item.title, { by: 'tracker', item: item.id })
      if ('refusal' in next) {
        refusal = `${item.id}: ${next.refusal}`
        break
      }
      list = next.list
      added.push(next.task)
    }
    return { list, value: { added, existing, refusal, list } }
  })
  const { added, existing, refusal, list } = outcome
  if (added.length === 0) return { added, existing, refusal, noteRefusal: undefined }
  const noteRefusal = await tellModel(host, 'added', added, list)
  return { added, existing, refusal, noteRefusal }
}

async function addText(host: TaskHost, text: string, notice: string): Promise<string> {
  const outcome = await host.edit((current) => {
    const added = addTask(current, text, { by: 'person', item: null })
    return { list: 'refusal' in added ? current : added.list, value: added }
  })
  if ('refusal' in outcome) return `Not added: ${outcome.refusal}`
  const { task, list } = outcome
  const noteRefusal = await tellModel(host, 'added', [task], list)
  const lead = `Added task ${String(task.id)}: ${task.title}`
  if (notice === '') return `${lead}${toldSuffix(noteRefusal)}`
  return `${lead}. ${withoutFinalPeriod(notice)}${toldSuffix(noteRefusal)}`
}

async function addItem(host: TaskHost, id: string, item: WorkItem): Promise<string> {
  const { added, existing, refusal, noteRefusal } = await addItemsAsTasks(host, [item])
  const known = existing[0]
  if (known) {
    const already = `${id} is already task ${String(known.id)}: ${taskText(known)}. Nothing changed.`
    return withTrackerNotice(already, [known])
  }
  const task = added[0]
  if (!task) return `Not added: ${refusal ?? `${id} added no task`}`
  const lead = `Added task ${String(task.id)}: ${taskText(task)}`
  const reply = noteRefusal === undefined ? `${lead}.` : `${lead}${toldSuffix(noteRefusal)}`
  return withTrackerNotice(reply, [task])
}

export async function personAdd(host: TaskHost, input: string): Promise<string> {
  const needsText =
    '/task add needs text or an item id, for example:\n/task add Write the summary   or   /task add handily-cd34'
  if (input === TEXT_MARKER || input.startsWith(`${TEXT_MARKER} `)) {
    const text = input.slice(TEXT_MARKER.length).trim()
    return text === '' ? needsText : addText(host, text, '')
  }
  if (input === '') return needsText
  if (!looksLikeItemId(input)) return addText(host, input, '')
  const lookup = await lookupItem(host, input)
  if ('refusal' in lookup) return lookup.refusal
  if ('absentFrom' in lookup) {
    return addText(
      host,
      input,
      `No work item ${input} in ${lookup.absentFrom}, so it is added as text.`,
    )
  }
  return addItem(host, input, lookup.item)
}

function missingTaskReply(id: string, list: TaskPaneList): string {
  if (list.tasks.length === 0) {
    return `No task ${id}. This session has no tasks yet; add one with /task add <text>.`
  }
  const numbers = numbersText(list)
  const noun = list.tasks.length === 1 ? 'task' : 'tasks'
  return `No task ${id}. This session has ${noun} ${numbers}; run /task to list them.`
}

export async function personRemove(host: TaskHost, text: string): Promise<string> {
  if (!/^\d+$/.test(text)) return '/task rm needs a task number, for example /task rm 2.'
  const id = Number(text)
  const outcome = await host.edit<{ task: TaskPaneTask | undefined; list: TaskPaneList }>(
    (list) => {
      const task = findTask(list, id)
      if (!task) return { list, value: { task: undefined, list } }
      const next = removeTask(list, id)
      return { list: next, value: { task, list: next } }
    },
  )
  if (!outcome.task) return missingTaskReply(text, outcome.list)
  const { task, list } = outcome
  const noteRefusal = await tellModel(host, 'removed', [task], list)
  const reply = `Removed task ${String(task.id)}: ${taskText(task)}${toldSuffix(noteRefusal)}`
  return withTrackerNotice(reply, [task])
}

function itemRow(item: WorkItem): string {
  return `  ${quoted(item.id)}  ${priorityText(item)}  ${quoted(item.title)}`
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
  const rows = [
    `${lead} Open in the tracker (${view.label}, ${String(view.openCount)}):`,
    ...view.items.map(itemRow),
    ...more,
    `Add one with /task add <id>, or press "Add ${shown} as tasks" in /task pane.`,
  ]
  return [rows.join('\n'), TRACKER_TEXT_IS_DATA].join('\n\n')
}

export async function listReply(host: TaskHost): Promise<string> {
  const list = await readList(host)
  if (list.tasks.length === 0) return emptyListReply(host)
  return withTrackerNotice(listText(list), list.tasks)
}
