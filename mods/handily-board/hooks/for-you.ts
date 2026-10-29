import type { BoardList, BoardResult, BoardResultVerb, BoardTask, BoardTaskKind } from '../types'
import { type TaskHost, firstWord, isTaskNumber, taskNumber, withoutFinalPeriod } from './commands'
import { type PersonReply, refusedParts, unchangedParts } from './replies'
import {
  MAX_TITLE_LENGTH,
  addTask,
  askedTasks,
  findTask,
  isForPerson,
  quoted,
  textFault,
  textLength,
  titleRefusal,
} from './tasks'
import { TOAST_MARKS, type ToastParts } from './toast'

export const KINDS: readonly BoardTaskKind[] = ['do', 'answer', 'decide']
export const MAX_ANSWER_LENGTH = 1000
export const MAX_OPTION_LENGTH = 60
export const MAX_OPEN_FOR_PERSON = 20
const OPTIONS_AT_LEAST = 2
const OPTIONS_AT_MOST = 4
const TOLD = 'Claude is told at your next prompt.'
const NOT_SENT = 'Not sent'
export const ANSWER_EXAMPLE =
  '/board answer needs a task number and text, for example /board answer 9 Use port 8443.'
export const PICK_EXAMPLE =
  '/board pick needs a task number and an option number, for example /board pick 10 2.'

export type AssignInput = { kind: unknown; title: unknown; options: unknown; why: unknown }

export type Assignment = {
  kind: BoardTaskKind
  title: string
  options: readonly string[] | undefined
  why: string | undefined
}

function isKind(value: unknown): value is BoardTaskKind {
  return KINDS.some((kind) => kind === value)
}

function lineRefusal(name: string, text: string, most: number): string | undefined {
  switch (textFault(text, most)) {
    case 'control':
      return `${name} has a line break or a control character. Write it on one line.`
    case 'bidi':
      return `${name} has a bidi control character, which can reorder the text. Remove it.`
    case 'length':
      return `${name} has ${String(textLength(text))} characters. The limit is ${String(most)}.`
    case undefined:
      return undefined
  }
}

function optionsRefusal(options: unknown): string | undefined {
  if (!Array.isArray(options) || !options.every((one) => typeof one === 'string')) {
    return 'task_assign needs options for the kind decide: a list of 2 to 4 strings, for example {"options": ["Postgres", "SQLite"]}.'
  }
  const texts = options.map((one: string) => one.trim())
  if (texts.length < OPTIONS_AT_LEAST || texts.length > OPTIONS_AT_MOST) {
    return `task_assign needs 2 to 4 options for the kind decide; it got ${String(texts.length)}.`
  }
  for (const [index, text] of texts.entries()) {
    if (text === '') return `task_assign refused option ${String(index + 1)}: it is empty.`
    const refusal = lineRefusal('it', text, MAX_OPTION_LENGTH)
    if (refusal !== undefined) return `task_assign refused option ${String(index + 1)}: ${refusal}`
  }
  const twice = texts.find((text, index) => texts.indexOf(text) !== index)
  if (twice !== undefined) return `task_assign refused: the option ${quoted(twice)} is given twice.`
  return undefined
}

export function assignment(input: AssignInput): Assignment | { deny: string } {
  const { kind, title, options, why } = input
  if (!isKind(kind)) return { deny: 'task_assign needs kind: one of do, answer, decide.' }
  if (typeof title !== 'string' || title.trim() === '') {
    return {
      deny: 'task_assign needs a title: a non-empty string, for example {"kind": "do", "title": "Rotate the staging API key"}.',
    }
  }
  const titleFault = titleRefusal(title.trim())
  if (titleFault !== undefined) return { deny: `task_assign refused: ${titleFault}` }
  if (kind !== 'decide' && options !== undefined) {
    return { deny: 'task_assign takes options only with the kind decide.' }
  }
  if (kind === 'decide') {
    const refusal = optionsRefusal(options)
    if (refusal !== undefined) return { deny: refusal }
  }
  if (why !== undefined && typeof why !== 'string') {
    return { deny: 'task_assign needs why as a string: one line of at most 200 characters.' }
  }
  const whyRefusal =
    why === undefined ? undefined : lineRefusal('why', why.trim(), MAX_TITLE_LENGTH)
  if (whyRefusal !== undefined) return { deny: `task_assign refused: ${whyRefusal}` }
  return {
    kind,
    title: title.trim(),
    options:
      kind === 'decide' && Array.isArray(options)
        ? options.map((one: string) => one.trim())
        : undefined,
    why: why === undefined || why.trim() === '' ? undefined : why.trim(),
  }
}

export function openForPerson(list: BoardList): BoardTask[] {
  return askedTasks(list).filter((task) => task.result === undefined)
}

export type Assigned = { task: BoardTask } | { refusal: string }

export function assignTask(
  list: BoardList,
  asked: Assignment,
  now: number,
): { list: BoardList; value: Assigned } {
  if (openForPerson(list).length >= MAX_OPEN_FOR_PERSON) {
    return {
      list,
      value: {
        refusal: `${String(MAX_OPEN_FOR_PERSON)} tasks for the person are open. Wait for the answers, or withdraw one with task_update and the status removed.`,
      },
    }
  }
  const added = addTask(list, asked.title, { by: 'model', item: null })
  if ('refusal' in added) return { list, value: { refusal: added.refusal } }
  const task: BoardTask = {
    ...added.task,
    for: 'person',
    kind: asked.kind,
    askedAt: now,
    ...(asked.options === undefined ? {} : { options: asked.options }),
    ...(asked.why === undefined ? {} : { why: asked.why }),
  }
  return {
    list: {
      ...added.list,
      tasks: added.list.tasks.map((one) => (one.id === task.id ? task : one)),
    },
    value: { task },
  }
}

function withoutResult(task: BoardTask): BoardTask {
  const open = { ...task }
  delete open.result
  return open
}

export function withdrawTask(list: BoardList, id: number): BoardList {
  const task = findTask(list, id)
  if (!task) return list
  if (task.result?.isSent === true || task.isWithdrawn === true) {
    return { ...list, tasks: list.tasks.filter((one) => one.id !== id) }
  }
  const withdrawn: BoardTask = task.result
    ? { ...task, isWithdrawn: true, result: { ...task.result, isSent: true } }
    : { ...task, isWithdrawn: true }
  return { ...list, tasks: list.tasks.map((one) => (one.id === id ? withdrawn : one)) }
}

export function takeAnswers(list: BoardList): { list: BoardList; value: BoardTask[] } {
  const taken = list.tasks.filter(
    (task) => isForPerson(task) && task.result !== undefined && !task.result.isSent,
  )
  const tasks = list.tasks
    .filter((task) => task.isWithdrawn !== true)
    .map((task) =>
      taken.includes(task) && task.result
        ? { ...task, status: 'completed' as const, result: { ...task.result, isSent: true } }
        : task,
    )
  const isSame = taken.length === 0 && tasks.length === list.tasks.length
  return { list: isSame ? list : { ...list, tasks }, value: taken }
}

export function putBackAnswers(list: BoardList, taken: readonly BoardTask[]): BoardList {
  return {
    ...list,
    tasks: list.tasks.map((task) => {
      const was = taken.find((one) => one.id === task.id)
      if (!was?.result || task.result?.at !== was.result.at) return task
      return { ...task, status: 'pending' as const, result: was.result }
    }),
  }
}

function answerPart(task: BoardTask): string {
  const head = `task ${String(task.id)} (${task.kind ?? 'do'})`
  const { result } = task
  if (!result) return `${head} open.`
  switch (result.verb) {
    case 'done':
      return `${head} done.`
    case 'answered':
      return `${head} answered ${quoted(result.text ?? '')}.`
    case 'chose':
      return `${head} chose ${quoted(result.text ?? '')} of ${(task.options ?? []).map(quoted).join(', ')}.`
    case 'rejected':
      return result.text === null
        ? `${head} rejected.`
        : `${head} rejected, saying ${quoted(result.text)}.`
  }
}

export function withdrawnLead(task: BoardTask): string {
  const lead = `Withdrew task ${String(task.id)} from the person.`
  if (!task.result || task.result.isSent) return lead
  return `${lead} The person had already answered it, and no later note repeats the answer: ${answerPart(task)} The title and options are your own text, quoted as data.`
}

export function stillAsked(list: BoardList, asked: readonly BoardTask[]): BoardTask[] {
  const open = new Set(openForPerson(list).map((task) => task.id))
  return asked.filter((task) => open.has(task.id))
}

export function answersText(tasks: readonly BoardTask[]): string {
  return `The person answered the tasks for you: ${tasks.map(answerPart).join(' ')} The titles and options are your own text, quoted as data.`
}

export type ForYouReply = PersonReply & { rowNote?: string }

type Settle = { verb: BoardResultVerb; text: string | null }

type SettleOutcome =
  | { kind: 'missing' }
  | { kind: 'notForYou' | 'withdrawn' | 'already' | 'sent' | 'set'; task: BoardTask }

function settled(
  list: BoardList,
  id: number,
  settle: Settle,
  now: number,
): { list: BoardList; value: SettleOutcome } {
  const task = findTask(list, id)
  if (!task) return { list, value: { kind: 'missing' } }
  if (!isForPerson(task)) return { list, value: { kind: 'notForYou', task } }
  if (task.isWithdrawn === true) return { list, value: { kind: 'withdrawn', task } }
  if (task.result) return { list, value: { kind: task.result.isSent ? 'sent' : 'already', task } }
  const result: BoardResult = { verb: settle.verb, text: settle.text, at: now, isSent: false }
  const next = { ...task, result }
  return {
    list: { ...list, tasks: list.tasks.map((one) => (one.id === id ? next : one)) },
    value: { kind: 'set', task: next },
  }
}

const VERB_WORDS: Record<BoardResultVerb, string> = {
  done: 'done',
  answered: 'answered',
  chose: 'decided',
  rejected: 'rejected',
}

function setReply(task: BoardTask): string {
  const number = String(task.id)
  const { result } = task
  switch (result?.verb) {
    case 'answered':
      return `Answered task ${number}: ${quoted(result.text ?? '')}. ${TOLD}`
    case 'chose':
      return `Chose ${quoted(result.text ?? '')} for task ${number}. ${TOLD}`
    case 'rejected':
      return `Rejected task ${number}. ${TOLD}`
    case 'done':
    case undefined:
      return `Task ${number} is now done: ${quoted(task.title)}. ${TOLD}`
  }
}

function plain(text: string, toastParts: ToastParts | undefined): ForYouReply {
  return { text, toastParts }
}

function outcomeReply(outcome: SettleOutcome, typed: string, settle: Settle): ForYouReply {
  switch (outcome.kind) {
    case 'missing':
      return plain(
        `No task ${typed}. /board list prints the tasks for you.`,
        refusedParts(NOT_SENT, `no task ${typed} in this session`),
      )
    case 'notForYou':
      return plain(
        `Task ${typed} is not a task for you. /board list prints the tasks for you.`,
        refusedParts(NOT_SENT, `task ${typed} is not for you`),
      )
    case 'withdrawn': {
      const yours = settle.text === null ? [] : [`your answer: ${quoted(settle.text)}`]
      return plain(`${NOT_SENT}: Claude withdrew task ${typed}. Nothing changed.`, [
        `${TOAST_MARKS.toDo} ${NOT_SENT}`,
        `Claude withdrew task ${typed}`,
        ...yours,
      ])
    }
    case 'already': {
      const word = VERB_WORDS[outcome.task.result?.verb ?? 'done']
      return plain(
        `Task ${typed} is already ${word}. /board undo ${typed} opens it again.`,
        unchangedParts(`task ${typed} is already ${word}`),
      )
    }
    case 'sent':
      return plain(
        `Task ${typed} was already sent to Claude. Nothing changed.`,
        unchangedParts(`task ${typed} was already sent to Claude`),
      )
    case 'set':
      return plain(setReply(outcome.task), undefined)
  }
}

export async function settleTask(
  host: TaskHost,
  id: number,
  settle: Settle,
  now: number,
): Promise<ForYouReply> {
  const outcome = await host.edit((list) => settled(list, id, settle, now))
  return outcomeReply(outcome, String(id), settle)
}

function kindRefusal(task: BoardTask, wanted: BoardTaskKind): string | undefined {
  if (task.kind === wanted) return undefined
  const number = String(task.id)
  switch (task.kind) {
    case 'answer':
      return `Task ${number} asks for an answer. /board answer ${number} <text> answers it.`
    case 'decide':
      return `Task ${number} asks you to decide. /board pick ${number} <option number> decides it.`
    case 'do':
    case undefined:
      return wanted === 'answer'
        ? `Task ${number} is not a question for you. /board list prints the tasks for you.`
        : `Task ${number} is not a decision for you. /board list prints the tasks for you.`
  }
}

export async function personTask(host: TaskHost, id: number): Promise<BoardTask | undefined> {
  const list = (await host.read()) ?? { tasks: [], nextId: 1 }
  return findTask(list, id)
}

function answerRefusal(name: string, text: string): string | undefined {
  if (text === '') return `the ${name} is empty`
  switch (textFault(text, MAX_ANSWER_LENGTH)) {
    case 'control':
      return `the ${name} has a line break or a control character`
    case 'bidi':
      return `the ${name} has a bidi control character`
    case 'length':
      return `the ${name} has ${String(textLength(text))} characters; the limit is ${String(MAX_ANSWER_LENGTH)}`
    case undefined:
      return undefined
  }
}

function rowRefusal(why: string, hint: string): ForYouReply {
  return { text: `${NOT_SENT}: ${why}. ${hint}`, toastParts: undefined, rowNote: why }
}

async function kindChecked(
  host: TaskHost,
  id: number,
  wanted: BoardTaskKind,
): Promise<ForYouReply | undefined> {
  const task = await personTask(host, id)
  if (!task || !isForPerson(task)) return undefined
  const refusal = kindRefusal(task, wanted)
  if (refusal === undefined) return undefined
  return plain(refusal, refusedParts(NOT_SENT, withoutFinalPeriod(refusal.split('. ')[0] ?? '')))
}

export async function personDone(host: TaskHost, id: number, now: number): Promise<ForYouReply> {
  return (
    (await kindChecked(host, id, 'do')) ?? settleTask(host, id, { verb: 'done', text: null }, now)
  )
}

export async function personAnswer(
  host: TaskHost,
  id: number,
  typed: string,
  now: number,
): Promise<ForYouReply> {
  const text = typed.trim()
  const refusal = answerRefusal('answer', text)
  if (refusal !== undefined) {
    const hint = text === '' ? ANSWER_EXAMPLE : 'Nothing changed.'
    return rowRefusal(refusal, hint)
  }
  const wrong = await kindChecked(host, id, 'answer')
  if (wrong) return wrong
  return settleTask(host, id, { verb: 'answered', text }, now)
}

export async function personPick(
  host: TaskHost,
  id: number,
  choice: number,
  now: number,
): Promise<ForYouReply> {
  const wrong = await kindChecked(host, id, 'decide')
  if (wrong) return wrong
  const task = await personTask(host, id)
  const options = task?.options ?? []
  const option = options[choice - 1]
  if (task && isForPerson(task) && option === undefined) {
    const listed = options.join(', ')
    return plain(
      `Task ${String(id)} has options 1-${String(options.length)}: ${listed}. Nothing changed.`,
      unchangedParts(`task ${String(id)} has options 1-${String(options.length)}`),
    )
  }
  return settleTask(host, id, { verb: 'chose', text: option ?? null }, now)
}

export async function personReject(
  host: TaskHost,
  id: number,
  typed: string,
  now: number,
): Promise<ForYouReply> {
  const text = typed.trim()
  const refusal = text === '' ? undefined : answerRefusal('reason', text)
  if (refusal !== undefined) return rowRefusal(refusal, 'Nothing changed.')
  return settleTask(host, id, { verb: 'rejected', text: text === '' ? null : text }, now)
}

type UndoOutcome =
  { kind: 'missing' | 'notForYou' | 'open' | 'sent' } | { kind: 'undone'; task: BoardTask }

export async function personUndo(host: TaskHost, id: number): Promise<ForYouReply> {
  const outcome = await host.edit<UndoOutcome>((list) => {
    const task = findTask(list, id)
    if (!task) return { list, value: { kind: 'missing' } }
    if (!isForPerson(task)) return { list, value: { kind: 'notForYou' } }
    if (!task.result) return { list, value: { kind: 'open' } }
    if (task.result.isSent) return { list, value: { kind: 'sent' } }
    const open = withoutResult(task)
    return {
      list: { ...list, tasks: list.tasks.map((one) => (one.id === id ? open : one)) },
      value: { kind: 'undone', task: open },
    }
  })
  const number = String(id)
  switch (outcome.kind) {
    case 'missing':
      return plain(
        `No task ${number}. /board list prints the tasks for you.`,
        refusedParts('Not undone', `no task ${number} in this session`),
      )
    case 'notForYou':
      return plain(
        `Task ${number} is not a task for you. /board undo takes back an answer before your next prompt.`,
        refusedParts('Not undone', `task ${number} is not for you`),
      )
    case 'open':
      return plain(
        `Task ${number} is open. Nothing changed.`,
        unchangedParts(`task ${number} is open`),
      )
    case 'sent':
      return plain(
        `Task ${number} was already sent to Claude. Nothing changed.`,
        unchangedParts(`task ${number} was already sent to Claude`),
      )
    case 'undone':
      return plain(`Task ${number} is open again. Claude was not told yet.`, undefined)
  }
}

export function asksParts(tasks: readonly BoardTask[]): ToastParts | undefined {
  const [first] = tasks
  if (!first) return undefined
  if (tasks.length === 1) {
    return [
      `${TOAST_MARKS.waitsForYou} Claude asks you`,
      { quoted: first.title },
      'answer it on /board',
    ]
  }
  const counts = KINDS.map(
    (kind) => [kind, tasks.filter((task) => task.kind === kind).length] as const,
  )
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind} ${String(count)}`)
    .join(' · ')
  return [
    `${TOAST_MARKS.waitsForYou} Claude asks you ${String(tasks.length)} things`,
    counts,
    'answer them on /board',
  ]
}

export function personOnlyRefusal(task: BoardTask): string {
  const number = String(task.id)
  return `Task ${number} is for the person; only the person can finish it. Use status removed to withdraw it.`
}

export function forYouStatusRefusal(task: BoardTask): string {
  const number = String(task.id)
  return `Task ${number} is for you. /board done ${number}, /board answer ${number}, /board pick ${number} or /board reject ${number} answers it.`
}

export type ForYouWord = 'answer' | 'pick' | 'reject' | 'undo'

const NUMBER_NEEDED: Record<ForYouWord, string> = {
  answer: ANSWER_EXAMPLE,
  pick: PICK_EXAMPLE,
  reject:
    '/board reject needs a task number and an optional reason, for example /board reject 11 not my call.',
  undo: '/board undo needs a task number, for example /board undo 9.',
}

export async function forYouCommand(
  host: TaskHost,
  word: ForYouWord,
  text: string,
  now: number,
): Promise<string> {
  const { word: number, rest } = firstWord(text)
  const typed = taskNumber(word, number)
  if ('refusal' in typed) return isTaskNumber(number) ? typed.refusal : NUMBER_NEEDED[word]
  const { id } = typed
  switch (word) {
    case 'answer':
      return (await personAnswer(host, id, rest, now)).text
    case 'pick':
      if (!isTaskNumber(rest)) return PICK_EXAMPLE
      return (await personPick(host, id, Number(rest), now)).text
    case 'reject':
      return (await personReject(host, id, rest, now)).text
    case 'undo':
      if (rest !== '') return NUMBER_NEEDED.undo
      return (await personUndo(host, id)).text
  }
}

export async function forYouStatus(
  host: TaskHost,
  text: string,
  word: 'done' | 'start' | 'open',
  now: number,
): Promise<ForYouReply | undefined> {
  if (!isTaskNumber(text) || !Number.isSafeInteger(Number(text))) return undefined
  const id = Number(text)
  const task = await personTask(host, id)
  if (!task || !isForPerson(task)) return undefined
  if (word === 'done') return personDone(host, id, now)
  return plain(forYouStatusRefusal(task), refusedParts('Not changed', `task ${text} is for you`))
}
