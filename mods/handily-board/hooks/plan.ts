import type { BoardList, BoardPlan, BoardTask } from '../types'
import { type TaskHost, withoutFinalPeriod } from './commands'
import { type PersonReply, changedReply, unchangedReply } from './replies'
import {
  LIST_END,
  MAX_TASKS,
  MAX_TITLE_LENGTH,
  addTasks,
  doneCount,
  idsText,
  numbersText,
  oneSpaced,
  ownList,
  textFault,
} from './tasks'
import { marked, type ToastParts } from './toast'

export const PLAN_TOOL = 'ExitPlanMode'

const STEPS_AT_LEAST = 2
const CUT_MARK = '…'
const NUMBERED_ITEM = /^(\d{1,9})[.)][ \t]+(.*)$/
const FENCE = /^\s*(```|~~~)/
const INDENTED = /^[ \t]/
const LIST_MARK = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]/
const CHECKBOX = /^\[[ xX]\][ \t]+/
const LINK = /!?\[([^\]]*)\]\([^)]*\)/g
const CODE = /`([^`]*)`/g
const STRONG = /(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g
const STAR_EMPHASIS = /(^|[^\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?!\w)/g
const LINE_EMPHASIS = /(^|[^\w])_(?=\S)([^_]+?)(?<=\S)_(?!\w)/g
const NOT_ADDED = 'Plan not added'

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

export type PlanAnswer = { deny?: string; isError?: true; result?: unknown }

export function approvedPlanText(answer: PlanAnswer): string | undefined {
  if (answer.deny !== undefined || answer.isError === true) return undefined
  const { result } = answer
  if (!isRecord(result) || typeof result.plan !== 'string') return undefined
  if (result.isAgent !== false || result.awaitingLeaderApproval === true) return undefined
  return result.plan
}

function withoutMarks(text: string): string {
  return text
    .replace(CHECKBOX, '')
    .replace(LINK, '$1')
    .replace(CODE, '$1')
    .replace(STRONG, '$2')
    .replace(STAR_EMPHASIS, '$1$2')
    .replace(LINE_EMPHASIS, '$1$2')
}

type Step = { text: string; isCut: boolean }

function cleanStep(raw: string): Step {
  const text = oneSpaced(withoutMarks(raw)).trim()
  const characters = Array.from(text)
  if (characters.length <= MAX_TITLE_LENGTH) return { text, isCut: false }
  return { text: `${characters.slice(0, MAX_TITLE_LENGTH - 1).join('')}${CUT_MARK}`, isCut: true }
}

function numberedLists(text: string): string[][] {
  const lists: string[][] = []
  let current: string[] | undefined
  let isFenced = false
  let isAfterBlank = false
  const close = () => {
    if (current !== undefined) lists.push(current)
    current = undefined
  }
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      if (!INDENTED.test(line)) close()
      isFenced = !isFenced
      continue
    }
    if (isFenced) continue
    if (line.trim() === '') {
      isAfterBlank = true
      continue
    }
    const item = NUMBERED_ITEM.exec(line)
    if (item) {
      current ??= []
      current.push(item[2] ?? '')
    } else if (INDENTED.test(line)) {
      const last = current === undefined ? -1 : current.length - 1
      if (current && last >= 0 && !isAfterBlank && !LIST_MARK.test(line)) {
        current[last] = `${current[last] ?? ''} ${line.trim()}`
      }
    } else {
      close()
    }
    isAfterBlank = false
  }
  close()
  return lists
}

export type PlanSteps = { steps: string[]; cut: number[] }

function cleanSteps(items: readonly string[]): Step[] {
  return items.map(cleanStep).filter((step) => step.text !== '')
}

export function planSteps(text: string): PlanSteps {
  const steps =
    numberedLists(text)
      .map(cleanSteps)
      .find((items) => items.length >= STEPS_AT_LEAST) ?? []
  return {
    steps: steps.map((step) => step.text),
    cut: steps.flatMap((step, index) => (step.isCut ? [index + 1] : [])),
  }
}

export function newPlan(id: string, text: string, nextId: number): BoardPlan | undefined {
  const { steps, cut } = planSteps(text)
  if (steps.length < STEPS_AT_LEAST) return undefined
  return { id, steps, cut, nextId, added: null, isDismissed: false, refusal: null }
}

export function isOffered(plan: BoardPlan): boolean {
  return plan.added === null || plan.added.length === 0
}

export function tasksAfterPlan(plan: BoardPlan, list: BoardList): number {
  return ownList(list).tasks.filter((task) => task.by === 'model' && task.id >= plan.nextId).length
}

export function stepsText(count: number): string {
  return count === 1 ? '1 step' : `${String(count)} steps`
}

export function addedText(plan: BoardPlan): string {
  return idsText(plan.added ?? [])
}

export const PLAN_LOCK_MS = 10_000

export type PlanHost = {
  now: () => Promise<number>
  current: () => Promise<string | undefined>
  read: (id: string) => Promise<BoardPlan | undefined>
  edit: <T>(id: string, change: (plan: BoardPlan) => { plan: BoardPlan; value: T }) => Promise<T>
}

type Claim = { kind: 'claimed' | 'added' | 'busy'; plan: BoardPlan } | { kind: 'missing' }

type ListOutcome =
  | { kind: 'added'; tasks: BoardTask[] }
  | { kind: 'room'; room: number; done: number }
  | { kind: 'step'; step: number; fault: 'control' | 'bidi' }

function stepFault(steps: readonly string[]): ListOutcome | undefined {
  for (const [index, step] of steps.entries()) {
    const fault = textFault(step, MAX_TITLE_LENGTH)
    if (fault === 'control' || fault === 'bidi') return { kind: 'step', step: index + 1, fault }
  }
  return undefined
}

function addSteps(
  list: BoardList,
  steps: readonly string[],
): { list: BoardList; value: ListOutcome } {
  const fault = stepFault(steps)
  if (fault) return { list, value: fault }
  const room = MAX_TASKS - list.tasks.length
  if (steps.length > room) {
    return { list, value: { kind: 'room', room: Math.max(room, 0), done: doneCount(list) } }
  }
  const added = addTasks(list, steps, { by: 'model', item: null }, LIST_END)
  if ('refusal' in added)
    throw new Error(`handily-board: the plan steps were refused: ${added.refusal}`)
  return { list: added.list, value: { kind: 'added', tasks: added.tasks } }
}

const FAULT_WORDS: Record<'control' | 'bidi', string> = {
  control: 'a control character',
  bidi: 'a bidi control character',
}

function refusalLines(outcome: Exclude<ListOutcome, { kind: 'added' }>, steps: number): string[] {
  if (outcome.kind === 'step') {
    return [`step ${String(outcome.step)} has ${FAULT_WORDS[outcome.fault]}`]
  }
  const room = `room for ${String(outcome.room)} of ${stepsText(steps)}`
  if (outcome.done === 0) return [room]
  const done = outcome.done === 1 ? '1 done task' : `${String(outcome.done)} done tasks`
  return [room, `/board clear removes ${done}`]
}

function refusalText(outcome: Exclude<ListOutcome, { kind: 'added' }>, steps: number): string {
  if (outcome.kind === 'step') {
    return `Not added: step ${String(outcome.step)} has ${FAULT_WORDS[outcome.fault]}. Nothing changed.`
  }
  const fits = `Not added: the plan has ${String(steps)} steps and the list has room for ${String(outcome.room)} of ${String(MAX_TASKS)} tasks`
  if (outcome.done === 0) return `${fits}. Remove a task first.`
  const done = outcome.done === 1 ? '1 of them is done' : `${String(outcome.done)} of them are done`
  return `${fits}, and ${done}. Run /board clear to remove the done tasks, or remove one first.`
}

function refusalParts(outcome: Exclude<ListOutcome, { kind: 'added' }>, steps: number): ToastParts {
  const lead = marked('blocked', NOT_ADDED)
  if (outcome.kind === 'step') {
    return [lead, ...refusalLines(outcome, steps), 'ask Claude to write the plan again']
  }
  const [room, hint] = refusalLines(outcome, steps)
  return hint === undefined ? [lead, room ?? ''] : [lead, room ?? '', hint]
}

function cutText(cut: readonly number[]): string {
  if (cut.length === 0) return ''
  const numbers = cut.map(String).join(', ')
  return cut.length === 1
    ? ` Step ${numbers} was cut to ${String(MAX_TITLE_LENGTH)} characters.`
    : ` Steps ${numbers} were cut to ${String(MAX_TITLE_LENGTH)} characters.`
}

function toldText(noteRefusal: string | undefined): string {
  if (noteRefusal === undefined) return ' Claude is told at your next prompt.'
  return ` Claude was not told: ${withoutFinalPeriod(noteRefusal)}.`
}

const NO_PLAN = 'No approved plan with numbered steps in this session. Nothing changed.'

function isLocked(plan: BoardPlan, now: number): boolean {
  return plan.lockedAt !== undefined && now - plan.lockedAt < PLAN_LOCK_MS
}

function unlocked(plan: BoardPlan): BoardPlan {
  const free = { ...plan }
  delete free.lockedAt
  return free
}

async function claim(plans: PlanHost, id: string): Promise<Claim> {
  if ((await plans.read(id)) === undefined) return { kind: 'missing' }
  const now = await plans.now()
  return plans.edit<Claim>(id, (plan) => {
    if (!isOffered(plan)) return { plan, value: { kind: 'added', plan } }
    if (isLocked(plan, now)) return { plan, value: { kind: 'busy', plan } }
    return { plan: { ...plan, added: null, lockedAt: now }, value: { kind: 'claimed', plan } }
  })
}

export async function addPlanAsTasks(
  plans: PlanHost,
  host: TaskHost,
  id: string | undefined,
): Promise<PersonReply> {
  const current = await plans.current()
  const asked = id ?? current
  if (asked === undefined) return unchangedReply(NO_PLAN, 'no approved plan with steps')
  if (asked !== current) {
    return unchangedReply(
      'A later approved plan replaced this one. Nothing changed.',
      'a later plan replaced this one',
    )
  }
  const claimed = await claim(plans, asked)
  if (claimed.kind === 'missing') return unchangedReply(NO_PLAN, 'no approved plan with steps')
  const { plan } = claimed
  if (claimed.kind !== 'claimed') {
    const ids = addedText(plan)
    const why = ids === '' ? 'the plan is being added' : `the plan is already tasks ${ids}`
    const text =
      ids === ''
        ? 'The approved plan is being added. Nothing changed.'
        : `The approved plan is already tasks ${ids}. Nothing changed.`
    return unchangedReply(text, why)
  }
  let outcome: ListOutcome
  try {
    outcome = await host.edit((current) => addSteps(current, plan.steps))
  } catch (error) {
    await plans.edit(asked, (kept) => ({ plan: unlocked(kept), value: undefined }))
    throw error
  }
  if (outcome.kind !== 'added') {
    const lines = refusalLines(outcome, plan.steps.length)
    await plans.edit(asked, (kept) => ({
      plan: { ...unlocked(kept), refusal: lines },
      value: undefined,
    }))
    const text = refusalText(outcome, plan.steps.length)
    return { text, toastParts: refusalParts(outcome, plan.steps.length) }
  }
  const { tasks } = outcome
  const ids = tasks.map((task) => task.id)
  await plans.edit(asked, (kept) => ({
    plan: { ...unlocked(kept), added: ids, refusal: null },
    value: undefined,
  }))
  const numbers = numbersText(tasks)
  const told = tasks.map((task) => String(task.id)).join(', ')
  const noteRefusal = await host.tell({
    text: `it added tasks ${told} from the approved plan.`,
    tasks,
  })
  return changedReply(
    `Added tasks ${numbers} from the approved plan.${cutText(plan.cut)}${toldText(noteRefusal)}`,
    `added tasks ${numbers}`,
    noteRefusal,
    undefined,
  )
}

export async function dismissPlan(plans: PlanHost, id: string): Promise<void> {
  await plans.edit(id, (plan) => ({ plan: { ...plan, isDismissed: true }, value: undefined }))
}

export async function offeredPlan(plans: PlanHost): Promise<BoardPlan | undefined> {
  const id = await plans.current()
  if (id === undefined) return undefined
  const plan = await plans.read(id)
  return plan && isOffered(plan) ? plan : undefined
}

export function planListText(plan: BoardPlan): string {
  const width = String(plan.steps.length).length
  const rows = plan.steps.map(
    (step, index) => `  ${String(index + 1).padStart(width)}  ${JSON.stringify(step)}`,
  )
  return [
    `Approved plan (${stepsText(plan.steps.length)}, not added yet; /board plan adds them as tasks)`,
    ...rows,
  ].join('\n')
}
