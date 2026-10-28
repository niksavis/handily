import type { PluginState } from 'claude-code'
import type { BoardList, BoardPersonChange, BoardStatus, BoardTask } from '../types'
import {
  changedReply,
  notToldParts,
  type PersonReply,
  refusedParts,
  refusedReply,
  unchangedParts,
  unchangedReply,
} from './replies'
import {
  EMPTY_LIST,
  addTask,
  findTask,
  isOpenItem,
  LIST_END,
  listText,
  looksLikeItemId,
  moveTask,
  numbersText,
  openItems,
  priorityText,
  quoted,
  removeTask,
  setStatus,
  statusLook,
  statusWord,
  TRACKER_TEXT_IS_DATA,
  taskForItem,
  taskText,
  withTrackerNotice,
  withoutDone,
  type WorkItem,
} from './tasks'
import { TOAST_MARKS, type ToastParts } from './toast'

export const OPEN_ITEMS_SHOWN = 10
const TEXT_MARKER = '--'
const NOT_ADDED = 'Not added'
const NOT_REMOVED = 'Not removed'
const NOT_CHANGED = 'Not changed'
const NOT_MOVED = 'Not moved'

export type BoardCommand =
  | { kind: 'session' }
  | { kind: 'machine' }
  | { kind: 'list' }
  | { kind: 'close' }
  | { kind: 'clear' }
  | { kind: 'stats' }
  | { kind: 'add'; text: string }
  | { kind: 'rm'; text: string }
  | { kind: 'mv'; text: string }
  | { kind: 'status'; word: StatusWord; text: string }
  | { kind: 'unknown'; word: string }

export type MoveDirection = 'up' | 'down'

export type StatusWord = 'done' | 'start' | 'open'

export const STATUS_WORDS: readonly StatusWord[] = ['done', 'start', 'open']

const STATUS_OF_WORD: Record<StatusWord, BoardStatus> = {
  done: 'completed',
  start: 'in_progress',
  open: 'pending',
}

export function statusOfWord(word: StatusWord): BoardStatus {
  return STATUS_OF_WORD[word]
}

function isStatusWord(word: string): word is StatusWord {
  return STATUS_WORDS.some((known) => known === word)
}

export type TrackerLine = { tone: 'dim' | 'warning' | 'error'; text: string }

export type TrackerView =
  { kind: 'items'; label: string; items: WorkItem[] } | { kind: 'lines'; lines: TrackerLine[] }

type ItemLookup = { item: WorkItem } | { absentFrom: string } | { refusal: string }

export type Snapshot = PluginState['handily-workitems']['snapshot']

export type ListEdit<T> = (list: BoardList) => { list: BoardList; value: T }

export type TaskHost = {
  read: () => Promise<BoardList | undefined>
  edit: <T>(change: ListEdit<T>) => Promise<T>
  snapshot: () => Promise<Snapshot | undefined>
  lines: (snapshot: Snapshot) => Promise<readonly TrackerLine[]>
  tell: (change: BoardPersonChange) => Promise<string | undefined>
  expanded: () => Promise<readonly string[]>
  editExpanded: (change: (keys: readonly string[]) => readonly string[]) => Promise<void>
}

export async function readList(host: TaskHost): Promise<BoardList> {
  return (await host.read()) ?? EMPTY_LIST
}

export async function resetList(host: TaskHost): Promise<void> {
  await host.edit(() => ({ list: EMPTY_LIST, value: undefined }))
  await host.editExpanded(() => [])
}

export function withoutFinalPeriod(text: string): string {
  return text.replace(/\.+$/, '')
}

export function parseBoardCommand(args: string): BoardCommand {
  const trimmed = args.trim()
  if (trimmed === '') return { kind: 'session' }
  const space = trimmed.search(/\s/)
  const word = space === -1 ? trimmed : trimmed.slice(0, space)
  const text = space === -1 ? '' : trimmed.slice(space).trim()
  if (word === 'add' || word === 'rm' || word === 'mv') return { kind: word, text }
  if (isStatusWord(word)) return { kind: 'status', word, text }
  if (text !== '') return { kind: 'unknown', word: trimmed }
  if (
    word === 'machine' ||
    word === 'list' ||
    word === 'close' ||
    word === 'clear' ||
    word === 'stats'
  ) {
    return { kind: word }
  }
  return { kind: 'unknown', word }
}

export function unknownReply(word: string): string {
  return `Unknown argument ${JSON.stringify(word)}. Use /board, /board machine, /board add <text|id>, /board rm <n>, /board mv <n> before <m>|top|bottom, /board done <n>, /board start <n>, /board open <n>, /board clear, /board list, /board stats or /board close.`
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
      items: openItems(snapshot.items),
    }
  }
  return { kind: 'lines', lines: [...(await host.lines(snapshot))] }
}

function asTextHint(id: string): string {
  return `Add it as text: /board add ${TEXT_MARKER} ${id}`
}

async function lookupItem(host: TaskHost, id: string): Promise<ItemLookup> {
  const snapshot = await host.snapshot()
  if (!snapshot) {
    return { refusal: `Cannot read ${id}: workitems has not read the tracker yet.` }
  }
  switch (snapshot.state) {
    case 'ok':
    case 'stale': {
      const item = snapshot.items.find((candidate) => candidate.id === id)
      if (!item) return { absentFrom: snapshot.sourceLabel }
      if (!isOpenItem(item)) {
        return { refusal: `${id} is ${item.status} in ${snapshot.sourceLabel}.` }
      }
      return { item }
    }
    case 'terminal-only':
      return {
        refusal: `Cannot read ${id} here: ${snapshot.sourceLabel} needs a terminal session.`,
      }
    case 'no-tracker':
      return {
        refusal: `Cannot read ${id}: no tracker found at the repo root (${snapshot.reason}).`,
      }
    case 'failed':
      return { refusal: `Cannot read ${id}: work items unavailable: ${snapshot.reason}` }
    case 'approval-needed':
      return {
        refusal: `Cannot read ${id}: work items need your approval to run ${snapshot.reason}.`,
      }
    case 'paused':
      return {
        refusal: `Cannot read ${id}: workitems is paused (/workitems resume reads the tracker again).`,
      }
  }
}

function changedTask(task: BoardTask): string {
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

function changedTasks(verb: 'added' | 'removed', tasks: readonly BoardTask[]): string {
  return tasks.map((task) => `it ${verb} ${changedTask(task)}`).join(' ')
}

export function personNote(changes: readonly BoardPersonChange[], list: BoardList): string {
  const current = list.tasks.length === 0 ? 'The list is now empty.' : listText(list)
  const told = changes.map((change) => change.text).join(' ')
  return withTrackerNotice(
    `[handily-board] The person changed the session task list: ${told}\n\n${current}`,
    [...changes.flatMap((change) => change.tasks), ...list.tasks],
  )
}

async function tellModel(
  host: TaskHost,
  text: string,
  tasks: readonly BoardTask[],
): Promise<string | undefined> {
  return host.tell({ text, tasks })
}

function toldSuffix(refusal: string | undefined): string {
  if (refusal === undefined) return '. Claude is told at your next prompt.'
  return `; Claude was not told: ${withoutFinalPeriod(refusal)}.`
}

export type ItemsAdded = {
  added: BoardTask[]
  existing: BoardTask[]
  refusal: string | undefined
  noteRefusal: string | undefined
}

export async function addItemsAsTasks(
  host: TaskHost,
  items: readonly WorkItem[],
): Promise<ItemsAdded> {
  const outcome = await host.edit((current) => {
    let list = current
    const added: BoardTask[] = []
    const existing: BoardTask[] = []
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
    return { list, value: { added, existing, refusal } }
  })
  const { added, existing, refusal } = outcome
  if (added.length === 0) return { added, existing, refusal, noteRefusal: undefined }
  const noteRefusal = await tellModel(host, changedTasks('added', added), added)
  return { added, existing, refusal, noteRefusal }
}

export function itemsAddedParts(outcome: ItemsAdded): ToastParts | undefined {
  const { added, existing, refusal, noteRefusal } = outcome
  if (refusal !== undefined) return refusedParts(NOT_ADDED, withoutFinalPeriod(refusal))
  if (noteRefusal !== undefined) {
    return notToldParts(`added ${String(added.length)} as ${added.length === 1 ? 'task' : 'tasks'}`)
  }
  if (added.length > 0 || existing.length === 0) return undefined
  return unchangedParts(
    existing.length === 1
      ? 'the item already is a task'
      : `${String(existing.length)} items already are tasks`,
  )
}

const NEEDS_TEXT =
  '/board add needs text or an item id, for example:\n/board add Write the summary   or   /board add handily-cd34'

function addedAsTextParts(task: BoardTask, id: string, absentFrom: string): ToastParts {
  return [
    `${TOAST_MARKS.toDo} Added task ${String(task.id)} as text`,
    `no work item ${id} in ${absentFrom}`,
  ]
}

async function addText(
  host: TaskHost,
  text: string,
  absentFrom: string | undefined,
): Promise<PersonReply> {
  const outcome = await host.edit((current) => {
    const added = addTask(current, text, { by: 'person', item: null })
    return { list: 'refusal' in added ? current : added.list, value: added }
  })
  if ('refusal' in outcome) {
    const { refusal } = outcome
    return refusedReply(`Not added: ${refusal}`, NOT_ADDED, withoutFinalPeriod(refusal))
  }
  const { task } = outcome
  const noteRefusal = await tellModel(host, changedTasks('added', [task]), [task])
  const lead = `Added task ${String(task.id)}: ${task.title}`
  const change = `added task ${String(task.id)}`
  if (absentFrom === undefined) {
    return changedReply(`${lead}${toldSuffix(noteRefusal)}`, change, noteRefusal, undefined)
  }
  const notice = `No work item ${text} in ${absentFrom}, so it is added as text`
  return changedReply(
    `${lead}. ${notice}${toldSuffix(noteRefusal)}`,
    change,
    noteRefusal,
    addedAsTextParts(task, text, absentFrom),
  )
}

async function addItem(host: TaskHost, id: string, item: WorkItem): Promise<PersonReply> {
  const { added, existing, refusal, noteRefusal } = await addItemsAsTasks(host, [item])
  const known = existing[0]
  if (known) {
    const number = String(known.id)
    const already = `${id} is already task ${number}: ${taskText(known)}. Nothing changed.`
    return unchangedReply(withTrackerNotice(already, [known]), `${id} is already task ${number}`)
  }
  const task = added[0]
  if (!task) {
    const why = refusal ?? `${id} added no task`
    return refusedReply(`Not added: ${why}`, NOT_ADDED, withoutFinalPeriod(why))
  }
  const lead = `Added task ${String(task.id)}: ${taskText(task)}`
  const reply = noteRefusal === undefined ? `${lead}.` : `${lead}${toldSuffix(noteRefusal)}`
  return changedReply(
    withTrackerNotice(reply, [task]),
    `added task ${String(task.id)}`,
    noteRefusal,
    undefined,
  )
}

export async function personAdd(host: TaskHost, input: string): Promise<PersonReply> {
  const needsText = refusedReply(NEEDS_TEXT, NOT_ADDED, 'type a text or an item id')
  if (input === TEXT_MARKER || input.startsWith(`${TEXT_MARKER} `)) {
    const text = input.slice(TEXT_MARKER.length).trim()
    return text === '' ? needsText : addText(host, text, undefined)
  }
  if (input === '') return needsText
  if (!looksLikeItemId(input)) return addText(host, input, undefined)
  const lookup = await lookupItem(host, input)
  if ('refusal' in lookup) {
    const hint = asTextHint(input)
    const { refusal } = lookup
    return refusedReply(`${refusal} ${hint}`, NOT_ADDED, withoutFinalPeriod(refusal), hint)
  }
  if ('absentFrom' in lookup) return addText(host, input, lookup.absentFrom)
  return addItem(host, input, lookup.item)
}

function missingTaskReply(id: string, list: BoardList): string {
  if (list.tasks.length === 0) {
    return `No task ${id}. This session has no tasks yet; add one with /board add <text>.`
  }
  const numbers = numbersText(list.tasks)
  const noun = list.tasks.length === 1 ? 'task' : 'tasks'
  return `No task ${id}. This session has ${noun} ${numbers}; /board list prints them.`
}

function isTaskNumber(text: string): boolean {
  return /^\d+$/.test(text)
}

function numberNeeded(word: string): string {
  return `/board ${word} needs a task number, for example /board ${word} 2.`
}

function tooLarge(text: string): string | undefined {
  if (Number.isSafeInteger(Number(text))) return undefined
  return `${text} is too large for a task number. /board list prints the task numbers.`
}

type TaskNumber = { id: number } | { refusal: string }

function taskNumber(word: string, text: string): TaskNumber {
  if (!isTaskNumber(text)) return { refusal: numberNeeded(word) }
  const refusal = tooLarge(text)
  return refusal === undefined ? { id: Number(text) } : { refusal }
}

function taskRefusal(head: string, refusal: string): PersonReply {
  return refusedReply(refusal, head, withoutFinalPeriod(refusal))
}

function missingTask(head: string, typed: string, list: BoardList): PersonReply {
  return refusedReply(missingTaskReply(typed, list), head, `no task ${typed} in this session`)
}

export async function personRemove(host: TaskHost, text: string): Promise<PersonReply> {
  const number = taskNumber('rm', text)
  if ('refusal' in number) return taskRefusal(NOT_REMOVED, number.refusal)
  const { id } = number
  const outcome = await host.edit<{ task: BoardTask | undefined; list: BoardList }>((list) => {
    const task = findTask(list, id)
    if (!task) return { list, value: { task: undefined, list } }
    const next = removeTask(list, id)
    return { list: next, value: { task, list: next } }
  })
  if (!outcome.task) return missingTask(NOT_REMOVED, text, outcome.list)
  const { task } = outcome
  const noteRefusal = await tellModel(host, changedTasks('removed', [task]), [task])
  const reply = `Removed task ${String(task.id)}: ${taskText(task)}${toldSuffix(noteRefusal)}`
  return changedReply(
    withTrackerNotice(reply, [task]),
    `removed task ${String(task.id)}`,
    noteRefusal,
    undefined,
  )
}

type StatusOutcome =
  { kind: 'missing'; list: BoardList } | { kind: 'same' | 'set'; task: BoardTask }

export async function personStatus(
  host: TaskHost,
  text: string,
  word: StatusWord,
): Promise<PersonReply> {
  const typed = taskNumber(word, text)
  if ('refusal' in typed) return taskRefusal(NOT_CHANGED, typed.refusal)
  const { id } = typed
  const status = statusOfWord(word)
  const outcome = await host.edit<StatusOutcome>((list) => {
    const task = findTask(list, id)
    if (!task) return { list, value: { kind: 'missing', list } }
    if (task.status === status) return { list, value: { kind: 'same', task } }
    return { list: setStatus(list, id, status), value: { kind: 'set', task } }
  })
  if (outcome.kind === 'missing') return missingTask(NOT_CHANGED, text, outcome.list)
  const shown = statusWord(status)
  const { task } = outcome
  const number = String(task.id)
  if (outcome.kind === 'same') {
    return unchangedReply(
      `Task ${number} is already ${shown}. Nothing changed.`,
      `task ${number} is already ${shown}`,
    )
  }
  const change = `it set the status ${status} on ${changedTask(task)}`
  const noteRefusal = await tellModel(host, change, [task])
  const reply = `Task ${number} is now ${shown}: ${taskText(task)}${toldSuffix(noteRefusal)}`
  return changedReply(
    withTrackerNotice(reply, [task]),
    `task ${number} is now ${shown}`,
    noteRefusal,
    [`${statusLook(status).mark} Task ${number} is now ${shown}`, { quoted: task.title }],
  )
}

export async function personClear(host: TaskHost): Promise<PersonReply> {
  const cleared = await host.edit((list) => {
    const done = list.tasks.filter((task) => task.status === 'completed')
    return { list: done.length === 0 ? list : withoutDone(list), value: done }
  })
  if (cleared.length === 0) {
    return unchangedReply('No done task to clear. Nothing changed.', 'no done task to clear')
  }
  const numbers = numbersText(cleared)
  const tasks = cleared.length === 1 ? 'done task' : 'done tasks'
  const noteRefusal = await tellModel(host, `it removed the ${tasks} ${numbers}.`, [])
  const lead = `Cleared ${String(cleared.length)} ${tasks}`
  return changedReply(
    `${lead}: ${numbers}${toldSuffix(noteRefusal)}`,
    lead.toLowerCase(),
    noteRefusal,
    [`${TOAST_MARKS.done} ${lead}`, `${cleared.length === 1 ? 'task' : 'tasks'} ${numbers}`],
  )
}

const PLACE_NEEDED =
  '/board mv needs a task number and a place, for example /board mv 5 before 2, /board mv 5 top or /board mv 5 bottom.'

type Place = { before: number; typed: string } | { end: 'top' | 'bottom' }

function placeOf(words: readonly string[]): Place | undefined {
  const [word, number, ...rest] = words
  if (rest.length > 0) return undefined
  if (word === 'before' && number !== undefined && isTaskNumber(number)) {
    return { before: Number(number), typed: number }
  }
  if (number !== undefined) return undefined
  return word === 'top' || word === 'bottom' ? { end: word } : undefined
}

type PlaceOutcome =
  | { kind: 'missing'; id: number; list: BoardList }
  | { kind: 'same'; list: BoardList }
  | { kind: 'moved'; list: BoardList }

function placed(list: BoardList, id: number, place: Place): PlaceOutcome {
  const target = 'before' in place ? place.before : undefined
  const missing = [id, target].find((one) => one !== undefined && !findTask(list, one))
  if (missing !== undefined) return { kind: 'missing', id: missing, list }
  const others = list.tasks.filter((task) => task.id !== id)
  const before = 'end' in place && place.end === 'top' ? others[0]?.id : target
  const moved = moveTask(list, id, before ?? LIST_END)
  const isSame = moved.tasks.every((task, index) => task.id === list.tasks[index]?.id)
  return isSame ? { kind: 'same', list } : { kind: 'moved', list: moved }
}

function placeText(place: Place): string {
  if ('before' in place) return `before task ${String(place.before)}`
  return `to the ${place.end}`
}

function alreadyText(place: Place): string {
  if ('before' in place) return placeText(place)
  return place.end === 'top' ? 'first' : 'last'
}

export async function personPlace(host: TaskHost, text: string): Promise<string> {
  const [number = '', ...words] = text.split(/\s+/)
  const place = placeOf(words)
  if (!isTaskNumber(number) || place === undefined) return PLACE_NEEDED
  const large = tooLarge(number) ?? ('before' in place ? tooLarge(place.typed) : undefined)
  if (large !== undefined) return large
  const id = Number(number)
  if ('before' in place && place.before === id) {
    return `/board mv needs two different tasks, for example /board mv ${number} before 2.`
  }
  const outcome = await host.edit((list) => {
    const moved = placed(list, id, place)
    return { list: moved.list, value: moved }
  })
  const shown = String(id)
  if (outcome.kind === 'missing') {
    const typed = outcome.id === id || !('before' in place) ? number : place.typed
    return missingTaskReply(typed, outcome.list)
  }
  const where = placeText(place)
  if (outcome.kind === 'same') {
    return `Task ${shown} is already ${alreadyText(place)}. Nothing changed.`
  }
  const noteRefusal = await tellModel(host, `it moved task ${shown} ${where}.`, [])
  return `Moved task ${shown} ${where}${toldSuffix(noteRefusal)}`
}

type MoveOutcome =
  | { kind: 'missing'; list: BoardList }
  | { kind: 'edge'; task: BoardTask }
  | { kind: 'moved'; task: BoardTask; neighbour: BoardTask; list: BoardList }

function movedInGroup(list: BoardList, id: number, direction: MoveDirection): MoveOutcome {
  const task = findTask(list, id)
  if (!task) return { kind: 'missing', list }
  const group = list.tasks.filter((other) => other.status === task.status)
  const at = group.findIndex((other) => other.id === id)
  const neighbour = direction === 'up' ? group[at - 1] : group[at + 1]
  if (!neighbour) return { kind: 'edge', task }
  const moved =
    direction === 'up' ? moveTask(list, id, neighbour.id) : moveTask(list, neighbour.id, id)
  return { kind: 'moved', task, neighbour, list: moved }
}

export async function personMove(
  host: TaskHost,
  id: number,
  direction: MoveDirection,
): Promise<PersonReply> {
  const outcome = await host.edit((list) => {
    const moved = movedInGroup(list, id, direction)
    return { list: moved.kind === 'moved' ? moved.list : list, value: moved }
  })
  const number = String(id)
  if (outcome.kind === 'missing') return missingTask(NOT_MOVED, number, outcome.list)
  const place = direction === 'up' ? 'first' : 'last'
  if (outcome.kind === 'edge') {
    return unchangedReply(
      `Task ${number} is already ${place}. Nothing changed.`,
      `task ${number} is already ${place}`,
    )
  }
  const { neighbour } = outcome
  const where = direction === 'up' ? 'before' : 'after'
  const change = `it moved task ${number} ${where} task ${String(neighbour.id)}.`
  const noteRefusal = await tellModel(host, change, [])
  return changedReply(
    `Moved task ${number} ${direction}${toldSuffix(noteRefusal)}`,
    `moved task ${number} ${direction}`,
    noteRefusal,
    undefined,
  )
}

function itemRow(item: WorkItem): string {
  return `  ${quoted(item.id)}  ${priorityText(item)}  ${quoted(item.title)}`
}

export async function emptyListReply(host: TaskHost): Promise<string> {
  const lead = 'No tasks in this session yet.'
  const view = await trackerView(host)
  if (view.kind === 'lines') return [lead, ...view.lines.map((line) => line.text)].join(' ')
  if (view.items.length === 0) return `${lead} The tracker (${view.label}) has no open items.`
  const items = view.items.slice(0, OPEN_ITEMS_SHOWN)
  const more =
    view.items.length > items.length
      ? [`  and ${String(view.items.length - items.length)} more`]
      : []
  const rows = [
    `${lead} Open in the tracker (${view.label}, ${String(view.items.length)}):`,
    ...items.map(itemRow),
    ...more,
    `Add one with /board add <id>, or press "Add ${String(items.length)} as tasks" on the board.`,
  ]
  return [rows.join('\n'), TRACKER_TEXT_IS_DATA].join('\n\n')
}

export async function listReply(host: TaskHost): Promise<string> {
  const list = await readList(host)
  if (list.tasks.length === 0) return emptyListReply(host)
  return withTrackerNotice(listText(list), list.tasks)
}
