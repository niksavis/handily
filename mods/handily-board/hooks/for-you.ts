import type {
  BoardCallRow,
  BoardCloseHow,
  BoardList,
  BoardResult,
  BoardResultVerb,
  BoardTask,
  BoardTaskKind,
} from '../types'
import { type TaskHost, firstWord, isTaskNumber, taskNumber, withoutFinalPeriod } from './commands'
import { type PersonReply, refusedParts, unchangedParts } from './replies'
import {
  MAX_TITLE_LENGTH,
  addTask,
  askedTasks,
  findTask,
  isForPerson,
  numbersText,
  quoted,
  textFault,
  textLength,
  titleRefusal,
} from './tasks'
import type { PromptFill } from './board'
import {
  type KeptPrompt,
  type ShortChoice,
  acceptText,
  andText,
  oneWordSaid,
  sharedOptionsText,
} from './chat'
import { marked, type ToastParts } from './toast'
import { closedRow } from './transcript'

export const KINDS: readonly BoardTaskKind[] = ['do', 'answer', 'decide']
export const MAX_ANSWER_LENGTH = 1000
export const MAX_OPTION_LENGTH = 60
export const MAX_COMMAND_LENGTH = 400
export const MAX_OPEN_FOR_PERSON = 20
export const MAX_KEPT_PROMPTS = 20
export const OPEN_LINE_AT_MOST = 5
export const CLOSE_HOWS: readonly BoardCloseHow[] = ['claude_did', 'person_did', 'not_needed']
const OPTIONS_AT_LEAST = 2
const OPTIONS_AT_MOST = 4
const COMMANDS_AT_LEAST = 1
const COMMANDS_AT_MOST = 8
const BANG = '!'
const TOLD = 'Claude is told at your next prompt.'
const NOT_SENT = 'Not sent'
export const ANSWER_EXAMPLE =
  '/board answer needs a task number and text, for example /board answer 9 Use port 8443.'
export const PICK_EXAMPLE =
  '/board pick needs a task number and an option number, for example /board pick 10 2.'

export type AssignInput = {
  kind: unknown
  title: unknown
  options: unknown
  why: unknown
  recommended: unknown
  commands: unknown
}

export type Assignment = {
  kind: BoardTaskKind
  title: string
  options: readonly string[] | undefined
  recommended: number | string | undefined
  why: string | undefined
  commands: readonly string[] | undefined
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

function commandLine(text: string): string {
  const line = text.trim()
  return line.startsWith(BANG) ? line.slice(BANG.length).trimStart() : line
}

function commandRefusal(index: number, line: string): string | undefined {
  const number = String(index + 1)
  if (line === '') return `task_assign refused command ${number}: it is empty.`
  if (textFault(line, MAX_COMMAND_LENGTH) === 'control') {
    return `task_assign refused command ${number}: it has a line break or a control character. Give each line as its own string, for example {"commands": ["npm ci", "npm test"]}.`
  }
  const refusal = lineRefusal('it', line, MAX_COMMAND_LENGTH)
  return refusal === undefined ? undefined : `task_assign refused command ${number}: ${refusal}`
}

type Commands = { value: readonly string[] | undefined } | { deny: string }

function commandsOf(kind: BoardTaskKind, commands: unknown): Commands {
  if (commands === undefined) return { value: undefined }
  if (kind !== 'do') return { deny: 'task_assign takes commands only with the kind do.' }
  if (!Array.isArray(commands) || !commands.every((one) => typeof one === 'string')) {
    return {
      deny: 'task_assign needs commands for the kind do as a list of 1 to 8 strings, one shell command line each, for example {"commands": ["git push origin main"]}.',
    }
  }
  if (commands.length < COMMANDS_AT_LEAST || commands.length > COMMANDS_AT_MOST) {
    return {
      deny: `task_assign needs 1 to 8 commands for the kind do; it got ${String(commands.length)}.`,
    }
  }
  const lines = commands.map((one: string) => commandLine(one))
  for (const [index, line] of lines.entries()) {
    const refusal = commandRefusal(index, line)
    if (refusal !== undefined) return { deny: refusal }
  }
  return { value: lines }
}

type Recommended = { value: number | string | undefined } | { deny: string }

function recommendedOption(recommended: unknown, count: number): Recommended {
  if (typeof recommended !== 'number' || !Number.isInteger(recommended)) {
    return {
      deny: `task_assign needs recommended for the kind decide as the number of an option, 1 to ${String(count)}, for example {"recommended": 1}.`,
    }
  }
  if (recommended < 1 || recommended > count) {
    return {
      deny: `task_assign refused: recommended is ${String(recommended)}, but the task has options 1 to ${String(count)}.`,
    }
  }
  return { value: recommended }
}

function recommendedAnswer(recommended: unknown): Recommended {
  if (typeof recommended !== 'string' || recommended.trim() === '') {
    return {
      deny: 'task_assign needs recommended for the kind answer as one line of at most 200 characters, for example {"recommended": "Use port 8443"}.',
    }
  }
  const text = recommended.trim()
  const refusal = lineRefusal('recommended', text, MAX_TITLE_LENGTH)
  return refusal === undefined ? { value: text } : { deny: `task_assign refused: ${refusal}` }
}

function recommendedOf(kind: BoardTaskKind, count: number, recommended: unknown): Recommended {
  if (recommended === undefined) return { value: undefined }
  switch (kind) {
    case 'do':
      return { deny: 'task_assign takes recommended only with the kind decide or answer.' }
    case 'decide':
      return recommendedOption(recommended, count)
    case 'answer':
      return recommendedAnswer(recommended)
  }
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
  const asked =
    kind === 'decide' && Array.isArray(options)
      ? options.map((one: string) => one.trim())
      : undefined
  const recommended = recommendedOf(kind, asked?.length ?? 0, input.recommended)
  if ('deny' in recommended) return recommended
  const commands = commandsOf(kind, input.commands)
  if ('deny' in commands) return commands
  return {
    kind,
    title: title.trim(),
    options: asked,
    recommended: recommended.value,
    why: why === undefined || why.trim() === '' ? undefined : why.trim(),
    commands: commands.value,
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
        refusal: `${String(MAX_OPEN_FOR_PERSON)} tasks for the person are open. Wait for the answers, or close one with task_close and how not_needed.`,
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
    ...(asked.recommended === undefined ? {} : { recommended: asked.recommended }),
    ...(asked.why === undefined ? {} : { why: asked.why }),
    ...(asked.commands === undefined ? {} : { commands: asked.commands }),
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

function withoutFresh(task: BoardTask): BoardTask {
  if (task.result?.isFresh !== true) return task
  const result = { ...task.result }
  delete result.isFresh
  return { ...task, result }
}

export type TakenAnswers = {
  answered: BoardTask[]
  folded: number[]
  reopened: BoardTask[]
}

export function isClosedByClaude(task: BoardTask): boolean {
  return task.result?.by === 'claude'
}

function isFoldedBy(task: BoardTask, isPersonPrompt: boolean): boolean {
  return task.result?.isFresh === true && (isPersonPrompt || !isClosedByClaude(task))
}

function withoutReopened(task: BoardTask): BoardTask {
  if (task.reopened === undefined) return task
  const kept = { ...task }
  delete kept.reopened
  return kept
}

export function takeAnswers(
  list: BoardList,
  isPersonPrompt: boolean,
): { list: BoardList; value: TakenAnswers } {
  const answered = list.tasks.filter(
    (task) =>
      isForPerson(task) &&
      task.result !== undefined &&
      !task.result.isSent &&
      !isClosedByClaude(task),
  )
  const folded = list.tasks.filter((task) => isFoldedBy(task, isPersonPrompt))
  const reopened = list.tasks.filter(
    (task) => task.reopened !== undefined && task.result === undefined && task.isWithdrawn !== true,
  )
  const tasks = list.tasks
    .filter((task) => task.isWithdrawn !== true)
    .map((task) => {
      const kept = withoutReopened(task)
      if (answered.includes(task) && task.result) {
        return { ...kept, status: 'completed' as const, result: { ...task.result, isSent: true } }
      }
      return folded.includes(task) ? withoutFresh(kept) : kept
    })
  const isSame =
    answered.length === 0 &&
    folded.length === 0 &&
    list.tasks.every((task) => task.reopened === undefined) &&
    tasks.length === list.tasks.length
  return {
    list: isSame ? list : { ...list, tasks },
    value: { answered, folded: folded.map((task) => task.id), reopened },
  }
}

export function isNothingTaken(taken: TakenAnswers): boolean {
  return taken.answered.length === 0 && taken.folded.length === 0 && taken.reopened.length === 0
}

export function answersToTell(taken: readonly BoardTask[], typed: string): BoardTask[] {
  return taken.filter((task) => {
    const prompt = task.result?.prompt
    return !isClosedByClaude(task) && (prompt === undefined || !typed.includes(prompt))
  })
}

export function reopenedText(task: BoardTask): string {
  const how = task.reopened ?? 'claude_did'
  return `[handily-board] The person reopened task ${String(task.id)} (${task.kind ?? 'do'}), which you closed (${how}). It waits for the person again.`
}

export function answerPrompt(task: BoardTask): string | undefined {
  const { result } = task
  if (result === undefined || result.text === null) return undefined
  const number = String(task.id)
  switch (result.verb) {
    case 'answered':
      return `Answer to task ${number}, ${quoted(task.title)}: ${result.text}`
    case 'chose':
      return `Decision on task ${number}, ${quoted(task.title)}: ${quoted(result.text)}`
    case 'done':
    case 'rejected':
    case 'dropped':
      return undefined
  }
}

export type PromptSend = { isSent: true } | { isSent: false; reason: string }

export type AnswerSender = {
  submit: (text: string) => Promise<PromptSend>
  fill: (text: string) => Promise<PromptFill>
}

type PromptMark = { prompt: string; isSent: true } | { prompt: string | undefined; isSent: false }

function promptMarked(
  list: BoardList,
  settledTask: BoardTask,
  mark: PromptMark,
): { list: BoardList; value: boolean } {
  const task = findTask(list, settledTask.id)
  const was = settledTask.result
  if (!task?.result || !was || task.result.at !== was.at || task.isWithdrawn === true) {
    return { list, value: false }
  }
  const base = {
    verb: was.verb,
    text: was.text,
    at: was.at,
    ...(was.by === undefined ? {} : { by: was.by }),
  }
  const result: BoardResult = mark.isSent
    ? { ...base, isSent: true, isFresh: true, prompt: mark.prompt }
    : { ...base, isSent: false, ...(mark.prompt === undefined ? {} : { prompt: mark.prompt }) }
  const status = mark.isSent ? ('completed' as const) : settledTask.status
  const next: BoardTask = { ...task, status, result }
  return {
    list: { ...list, tasks: list.tasks.map((one) => (one.id === task.id ? next : one)) },
    value: true,
  }
}

export async function sendAnswer(
  host: TaskHost,
  sender: AnswerSender,
  settledTask: BoardTask,
): Promise<string | undefined> {
  const prompt = answerPrompt(settledTask)
  if (prompt === undefined) return undefined
  const isMarked = await host.edit((list) =>
    promptMarked(list, settledTask, { prompt, isSent: true }),
  )
  if (!isMarked) return undefined
  const sent = await sender.submit(prompt)
  if (sent.isSent) return undefined
  const filled = await sender.fill(prompt)
  const kept = filled.isFilled ? prompt : undefined
  await host.edit((list) => promptMarked(list, settledTask, { prompt: kept, isSent: false }))
  return filled.isFilled
    ? `${sent.reason}; it waits in your prompt box`
    : `${sent.reason}; Claude gets it with your next prompt`
}

function answerBack(task: BoardTask, taken: TakenAnswers): BoardTask {
  const was = taken.answered.find((one) => one.id === task.id)
  if (!was?.result || task.result?.at !== was.result.at) return task
  return { ...task, status: 'pending' as const, result: was.result }
}

function reopenBack(task: BoardTask, taken: TakenAnswers): BoardTask {
  const how = taken.reopened.find((one) => one.id === task.id)?.reopened
  if (how === undefined || isClosedByClaude(task)) return task
  return { ...task, reopened: how }
}

function freshBack(task: BoardTask, taken: TakenAnswers): BoardTask {
  const { result } = task
  if (!taken.folded.includes(task.id) || !result || !isClosedByClaude(task)) return task
  return { ...task, result: { ...result, isFresh: true } }
}

export function putBackAnswers(list: BoardList, taken: TakenAnswers): BoardList {
  return {
    ...list,
    tasks: list.tasks.map((task) => freshBack(reopenBack(answerBack(task, taken), taken), taken)),
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
    case 'dropped':
      return `${head} not needed.`
  }
}

export function stillAsked(list: BoardList, asked: readonly BoardTask[]): BoardTask[] {
  const open = new Set(openForPerson(list).map((task) => task.id))
  return asked.filter((task) => open.has(task.id))
}

function isDropped(task: BoardTask): boolean {
  return task.result?.verb === 'dropped'
}

function droppedText(task: BoardTask): string {
  return `The person closed task ${String(task.id)} (${task.kind ?? 'do'}) as not needed.`
}

export function answersText(tasks: readonly BoardTask[]): string {
  const answered = tasks.filter((task) => !isDropped(task))
  const parts =
    answered.length === 0
      ? []
      : [
          `The person answered the tasks for you: ${answered.map(answerPart).join(' ')} The titles and options are your own text, quoted as data.`,
        ]
  return [...parts, ...tasks.filter(isDropped).map(droppedText)].join(' ')
}

export type ForYouReply = PersonReply & { rowNote?: string; settled?: BoardTask }

type Settle = { verb: BoardResultVerb; text: string | null }

type SettleOutcome =
  | { kind: 'missing' }
  | {
      kind: 'notForYou' | 'withdrawn' | 'claudeClosed' | 'already' | 'sent' | 'set'
      task: BoardTask
    }

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
  if (isClosedByClaude(task)) return { list, value: { kind: 'claudeClosed', task } }
  if (task.result) return { list, value: { kind: task.result.isSent ? 'sent' : 'already', task } }
  const result: BoardResult = {
    verb: settle.verb,
    text: settle.text,
    at: now,
    isSent: false,
    by: 'person',
  }
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
  dropped: 'closed as not needed',
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
    case 'dropped':
      return `Closed task ${number} as not needed: ${quoted(task.title)}. ${TOLD}`
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
        marked('toDo', NOT_SENT),
        `Claude withdrew task ${typed}`,
        ...yours,
      ])
    }
    case 'claudeClosed': {
      const how = outcome.task.result?.how ?? 'claude_did'
      return plain(
        `Claude closed task ${typed} (${how}). Nothing changed. /board reopen ${typed} opens it again.`,
        unchangedParts(`Claude closed task ${typed}`),
      )
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
      return { text: setReply(outcome.task), toastParts: undefined, settled: outcome.task }
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

export async function personUnneeded(
  host: TaskHost,
  id: number,
  now: number,
): Promise<ForYouReply> {
  return settleTask(host, id, { verb: 'dropped', text: null }, now)
}

type UndoOutcome =
  | { kind: 'missing' | 'notForYou' | 'open' | 'claudeClosed' | 'sent' }
  | { kind: 'undone'; task: BoardTask }

export async function personUndo(host: TaskHost, id: number): Promise<ForYouReply> {
  const outcome = await host.edit<UndoOutcome>((list) => {
    const task = findTask(list, id)
    if (!task) return { list, value: { kind: 'missing' } }
    if (!isForPerson(task)) return { list, value: { kind: 'notForYou' } }
    if (!task.result) return { list, value: { kind: 'open' } }
    if (isClosedByClaude(task)) return { list, value: { kind: 'claudeClosed' } }
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
    case 'claudeClosed':
      return plain(
        `Claude closed task ${number}. /board reopen ${number} opens it again.`,
        refusedParts('Not undone', `Claude closed task ${number}`),
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
      marked('waitsForYou', 'Claude asks you'),
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
    marked('waitsForYou', `Claude asks you ${String(tasks.length)} things`),
    counts,
    'answer them on /board',
  ]
}

export type PersonTaskChange = 'status' | 'remove' | 'title'

export type PlaceTool = 'task_add' | 'task_move'

const PLACE_REMEDY: Record<PlaceTool, string> = {
  task_add: 'task_add puts new tasks only before your own tasks.',
  task_move: 'task_move moves only your own tasks.',
}

export function personPlaceRefusal(id: number, tool: PlaceTool): string {
  return `Task ${String(id)} is for the person; its place is the order in which you asked. ${PLACE_REMEDY[tool]}`
}

export function personOnlyRefusal(task: BoardTask, change: PersonTaskChange): string {
  const number = String(task.id)
  if (task.result) {
    return `Task ${number} for the person is already closed. The person removes closed tasks with /board clear.`
  }
  if (change === 'title') {
    return `Task ${number} is a task for the person. To change it, close it with task_close how not_needed and assign the new text with task_assign.`
  }
  if (change === 'remove') {
    return `Task ${number} is for the person. To withdraw it, close it with task_close and how not_needed, with a note that says why.`
  }
  return `Task ${number} is for the person. Close it with task_close: how claude_did when you did it, person_did when the person says that they did it, or not_needed.`
}

export function forYouStatusRefusal(task: BoardTask): string {
  const number = String(task.id)
  return `Task ${number} is for you. /board done ${number}, /board answer ${number}, /board pick ${number} or /board reject ${number} answers it.`
}

export type ForYouWord = 'answer' | 'pick' | 'reject' | 'undo' | 'reopen'

const NUMBER_NEEDED: Record<ForYouWord, string> = {
  answer: ANSWER_EXAMPLE,
  pick: PICK_EXAMPLE,
  reject:
    '/board reject needs a task number and an optional reason, for example /board reject 11 not my call.',
  undo: '/board undo needs a task number, for example /board undo 9.',
  reopen: '/board reopen needs a task number, for example /board reopen 8.',
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
    case 'reopen':
      if (rest !== '') return NUMBER_NEEDED.reopen
      return (await personReopen(host, id)).text
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

type ReopenOutcome = { kind: 'missing' | 'notForYou' | 'open' | 'person' | 'reopened' }

export async function personReopen(host: TaskHost, id: number): Promise<ForYouReply> {
  const outcome = await host.edit<ReopenOutcome>((list) => {
    const task = findTask(list, id)
    if (!task) return { list, value: { kind: 'missing' } }
    if (!isForPerson(task)) return { list, value: { kind: 'notForYou' } }
    if (!task.result) return { list, value: { kind: 'open' } }
    if (!isClosedByClaude(task)) return { list, value: { kind: 'person' } }
    const how = task.result.how ?? 'claude_did'
    const open: BoardTask = { ...withoutResult(task), status: 'pending', reopened: how }
    return {
      list: { ...list, tasks: list.tasks.map((one) => (one.id === id ? open : one)) },
      value: { kind: 'reopened' },
    }
  })
  const number = String(id)
  switch (outcome.kind) {
    case 'missing':
      return plain(
        `No task ${number}. /board list prints the tasks for you.`,
        refusedParts('Not reopened', `no task ${number} in this session`),
      )
    case 'notForYou':
      return plain(
        `Task ${number} is not a task for you. /board list prints the tasks for you.`,
        refusedParts('Not reopened', `task ${number} is not for you`),
      )
    case 'open':
      return plain(
        `Task ${number} is open. Nothing changed.`,
        unchangedParts(`task ${number} is open`),
      )
    case 'person':
      return plain(
        `You closed task ${number}. /board undo ${number} takes it back before your next prompt.`,
        unchangedParts(`you closed task ${number}`),
      )
    case 'reopened':
      return plain(`Task ${number} is open again. ${TOLD}`, undefined)
  }
}

export type PromptSaid = { text: string; at: number; seq: number }

export function keptPrompts(
  kept: readonly KeptPrompt[],
  said: PromptSaid,
  list: BoardList,
): KeptPrompt[] {
  const open = openForPerson(list).map((task) => task.id)
  const oldest = open.length === 0 ? list.nextId : Math.min(...open)
  return [...kept, { ...said, after: list.nextId - 1 }]
    .filter((one) => one.after >= oldest)
    .slice(-MAX_KEPT_PROMPTS)
}

function promptHolds(kept: readonly KeptPrompt[], id: number, said: string): boolean {
  return kept.some((one) => one.after >= id && one.text.includes(said))
}

export function openTasksLine(list: BoardList, text: string): string | undefined {
  const open = openForPerson(list)
  if (open.length === 0) return undefined
  const shown = open
    .slice(0, OPEN_LINE_AT_MOST)
    .map((task) => `${String(task.id)} (${task.kind ?? 'do'}) ${quoted(task.title)}`)
    .join('; ')
  const hidden = open.length - OPEN_LINE_AT_MOST
  const more = hidden > 0 ? `; ${String(hidden)} more in task_list` : ''
  const shared = acceptText(list, text) ?? sharedOptionsText(list, text)
  const ask = shared === undefined ? '' : ` ${shared}`
  return `[handily-board] Open tasks for the person: ${shown}${more}. When this prompt says the person did, answered or decided one, close it with task_close and copy their words into said.${ask} The titles are your own text, quoted as data.`
}

export type CloseInput = {
  id: unknown
  how: unknown
  note: unknown
  said: unknown
  answer: unknown
  option: unknown
}

export type Closed = { deny: string } | { lead: string; row: BoardCallRow | undefined }

type Closing = {
  how: BoardCloseHow
  verb: BoardResultVerb
  text: string | null
  note: string | undefined
  said: string | undefined
}

const CLOSE_ID_NEEDED =
  'task_close needs id: the integer id of a task for the person that task_list shows.'
const CLOSE_HOW_NEEDED = 'task_close needs how: one of claude_did, person_did, not_needed.'
const CLOSE_SAID_NEEDED =
  'task_close needs said for how person_did: the words of the person from their prompt, copied exactly, as one line of at most 200 characters.'
const CLOSE_NOTE_NEEDED: Record<BoardCloseHow, string> = {
  claude_did:
    'task_close needs note for how claude_did: one line of at most 200 characters that says what you did.',
  not_needed:
    'task_close needs note for how not_needed: one line of at most 200 characters that says why the task is no longer needed.',
  person_did: 'task_close needs note as a string: one line of at most 200 characters.',
}

function isCloseHow(value: unknown): value is BoardCloseHow {
  return CLOSE_HOWS.some((how) => how === value)
}

function closeIdRefusal(list: BoardList, id: number): string {
  const ids = numbersText(askedTasks(list))
  const known =
    ids === '' ? 'No task is assigned to the person.' : `The tasks for the person are ${ids}.`
  return `No task ${String(id)} for the person. ${known} Call task_list to see them.`
}

function closedTaskRefusal(task: BoardTask): string | undefined {
  const { result } = task
  if (!result) return undefined
  const number = String(task.id)
  if (isClosedByClaude(task)) {
    return `task_close refused: task ${number} is already closed. You closed it (${result.how ?? 'claude_did'}). Nothing changed.`
  }
  if (result.isSent) {
    return `task_close refused: the person already closed task ${number}, and the result reached you. Nothing changed.`
  }
  return undefined
}

function howRefusal(task: BoardTask, how: BoardCloseHow): string | undefined {
  if (how !== 'claude_did') return undefined
  const number = String(task.id)
  switch (task.kind) {
    case 'decide':
      return `task_close refused: task ${number} asks the person to decide. You cannot decide it: close it with how person_did and the option the person named, or with not_needed.`
    case 'answer':
      return `task_close refused: task ${number} asks the person for an answer. You cannot answer it: close it with how person_did, the answer and said, or with not_needed and the answer in note.`
    case 'do':
    case undefined:
      return undefined
  }
}

function extraRefusal(task: BoardTask, how: BoardCloseHow, input: CloseInput): string | undefined {
  const kind = task.kind ?? 'do'
  const number = String(task.id)
  if (input.answer !== undefined && kind !== 'answer') {
    return `task_close takes answer only for a task of the kind answer; task ${number} has the kind ${kind}.`
  }
  if (input.option !== undefined && kind !== 'decide') {
    return `task_close takes option only for a task of the kind decide; task ${number} has the kind ${kind}.`
  }
  if ((input.answer !== undefined || input.option !== undefined) && how !== 'person_did') {
    return 'task_close takes answer and option only with how person_did.'
  }
  if (input.said !== undefined && how !== 'person_did') {
    return 'task_close takes said only with how person_did: the words in which the person said that they did it.'
  }
  return undefined
}

type Line = { text: string | undefined } | { deny: string }

function closeLine(value: unknown, name: string, most: number, needed: string): Line {
  if (value === undefined) return { text: undefined }
  if (typeof value !== 'string' || value.trim() === '') return { deny: needed }
  const text = value.trim()
  const refusal = lineRefusal(name, text, most)
  return refusal === undefined ? { text } : { deny: `task_close refused: ${refusal}` }
}

function optionsText(options: readonly string[]): string {
  return options.map((option, index) => `${String(index + 1)} ${quoted(option)}`).join(', ')
}

type Choice = { verb: BoardResultVerb; text: string | null }

function closedChoice(task: BoardTask, input: CloseInput): Choice | { deny: string } {
  const number = String(task.id)
  if (task.kind === 'answer') {
    const needed = `task_close needs answer for task ${number}: the answer of the person as one line of at most 1000 characters.`
    const answer = closeLine(input.answer, 'answer', MAX_ANSWER_LENGTH, needed)
    if ('deny' in answer) return answer
    return answer.text === undefined ? { deny: needed } : { verb: 'answered', text: answer.text }
  }
  if (task.kind === 'decide') {
    const options = task.options ?? []
    const { option } = input
    const chosen =
      typeof option === 'number' && Number.isInteger(option) ? options[option - 1] : undefined
    if (chosen === undefined) {
      return {
        deny: `task_close needs option for task ${number}: the number of the option that the person chose, 1 to ${String(options.length)}: ${optionsText(options)}.`,
      }
    }
    return { verb: 'chose', text: chosen }
  }
  return { verb: 'done', text: null }
}

function closing(task: BoardTask, input: CloseInput): Closing | { deny: string } {
  const { how } = input
  if (!isCloseHow(how)) return { deny: CLOSE_HOW_NEEDED }
  const wrong = howRefusal(task, how) ?? extraRefusal(task, how, input)
  if (wrong !== undefined) return { deny: wrong }
  const note = closeLine(input.note, 'note', MAX_TITLE_LENGTH, CLOSE_NOTE_NEEDED[how])
  if ('deny' in note) return note
  if (how !== 'person_did') {
    if (note.text === undefined) return { deny: CLOSE_NOTE_NEEDED[how] }
    return { how, verb: 'done', text: null, note: note.text, said: undefined }
  }
  const said = closeLine(input.said, 'said', MAX_TITLE_LENGTH, CLOSE_SAID_NEEDED)
  if ('deny' in said) return said
  if (said.text === undefined) return { deny: CLOSE_SAID_NEEDED }
  const choice = closedChoice(task, input)
  if ('deny' in choice) return choice
  return { how, ...choice, note: note.text, said: said.text }
}

function optionRefusal(task: BoardTask, said: string, option: string): string {
  const at = (task.options ?? []).indexOf(option) + 1
  return `task_close refused: the words ${quoted(said)} do not hold option ${String(at)} ${quoted(option)}. Copy the words in which the person chose it.`
}

function wholeRefusal(
  task: BoardTask,
  asked: Closing,
  said: string,
  choice: ShortChoice | undefined,
): string | undefined {
  if (asked.verb === 'answered') {
    const isOther = choice !== undefined && 'answer' in choice && asked.text !== choice.answer
    return isOther
      ? `task_close refused: ${quoted(said)} accepts only the recommended answer ${quoted(choice.answer)}; give that answer, or ask the person for theirs.`
      : undefined
  }
  const option = asked.verb === 'chose' ? asked.text : null
  if (option === null) return undefined
  const at = (task.options ?? []).indexOf(option) + 1
  const isChosen = choice !== undefined && 'option' in choice && choice.option === at
  return isChosen ? undefined : optionRefusal(task, said, option)
}

function saidRefusal(
  list: BoardList,
  task: BoardTask,
  asked: Closing,
  kept: readonly KeptPrompt[],
): string | undefined {
  const { said } = asked
  if (said === undefined) return undefined
  const number = String(task.id)
  if (!promptHolds(kept, task.id, said)) {
    return `task_close refused: no prompt of the person since task ${number} was asked holds ${quoted(said)}. Copy their words exactly, or ask the person to press done on the board.`
  }
  const option = asked.verb === 'chose' ? asked.text : null
  const word = oneWordSaid(list, task, kept, said)
  switch (word.kind) {
    case 'open':
      return `task_close refused: ${quoted(said)} alone names no task while tasks ${andText(word.ids)} are open for the person. Ask the person which task, and copy their words.`
    case 'whole':
      return wholeRefusal(task, asked, said, word.choice)
    case 'sentence':
      return option === null || said.includes(option)
        ? undefined
        : optionRefusal(task, said, option)
  }
}

function closedPart(asked: Closing): string {
  const said = asked.said === undefined ? '' : `, saying ${quoted(asked.said)}`
  switch (asked.how) {
    case 'claude_did':
      return `you did it: ${quoted(asked.note ?? '')}`
    case 'not_needed':
      return `not needed: ${quoted(asked.note ?? '')}`
    case 'person_did':
      if (asked.verb === 'answered') return `the person answered ${quoted(asked.text ?? '')}${said}`
      if (asked.verb === 'chose') return `the person chose ${quoted(asked.text ?? '')}${said}`
      return `the person did it${said}`
  }
}

function closedByPerson(
  list: BoardList,
  task: BoardTask,
  result: BoardResult,
): { list: BoardList; value: Closed } {
  const sent: BoardTask = { ...task, status: 'completed', result: { ...result, isSent: true } }
  const lead = `The person already closed task ${String(task.id)}, and no later note repeats it: ${answerPart(task)} Nothing changed. The title and options are your own text, quoted as data.`
  return {
    list: { ...list, tasks: list.tasks.map((one) => (one.id === task.id ? sent : one)) },
    value: { lead, row: undefined },
  }
}

export function closeTask(
  list: BoardList,
  input: CloseInput,
  kept: readonly KeptPrompt[],
  now: number,
): { list: BoardList; value: Closed } {
  const refused = (deny: string) => ({ list, value: { deny } })
  const { id } = input
  if (typeof id !== 'number' || !Number.isInteger(id)) return refused(CLOSE_ID_NEEDED)
  const task = findTask(list, id)
  if (!task || (isForPerson(task) && task.isWithdrawn === true)) {
    return refused(closeIdRefusal(list, id))
  }
  if (!isForPerson(task)) {
    return refused(`Task ${String(id)} is your own task. Set its status with task_update.`)
  }
  const done = closedTaskRefusal(task)
  if (done !== undefined) return refused(done)
  if (task.result) return closedByPerson(list, task, task.result)
  const asked = closing(task, input)
  if ('deny' in asked) return refused(asked.deny)
  const unheld = saidRefusal(list, task, asked, kept)
  if (unheld !== undefined) return refused(unheld)
  const result: BoardResult = {
    verb: asked.verb,
    text: asked.text,
    at: now,
    isSent: true,
    isFresh: true,
    by: 'claude',
    how: asked.how,
    ...(asked.note === undefined ? {} : { note: asked.note }),
    ...(asked.said === undefined ? {} : { said: asked.said }),
  }
  const next: BoardTask = { ...withoutReopened(task), status: 'completed', result }
  const lead = `Closed task ${String(id)} for the person (${task.kind ?? 'do'}): ${closedPart(asked)}. The title and options are your own text, quoted as data.`
  return {
    list: { ...list, tasks: list.tasks.map((one) => (one.id === id ? next : one)) },
    value: { lead, row: closedRow(next) },
  }
}
