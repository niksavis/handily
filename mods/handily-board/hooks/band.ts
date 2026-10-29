import type { PluginOptions, RenderElement, TextProps } from 'claude-code'
import type { BoardActivity, BoardList, BoardPlan, BoardTask } from '../types'
import { STALLED_AFTER_MS, elapsedText, runStart } from './activity'
import { BAR_EMPTY, BAR_FILLED, barCells } from './bar'
import type { PaneElements } from './pane'
import { isOffered, stepsText } from './plan'
import { addLabel } from './plan-view'
import { SIGNALS, type SignalLooks } from './signals'
import { doneCount, escaped, ownList } from './tasks'
import { displayWidth, fitted } from './width'

export type BandSetting = 'on' | 'off'

const BAND_SETTINGS: readonly BandSetting[] = ['on', 'off']
const BAR_FROM = 50
const TIME_FROM = 30
const TITLE_AT_LEAST = 4
const BUTTON_CHROME = 4
const BOARD_LABEL = 'board'
const NEXT_WORD = 'next'
const CUT_MARK = '…'
const SPACE_BEFORE_CUT = /\s+…$/u

export function bandSetting(options: PluginOptions): BandSetting {
  const setting = options.band ?? 'on'
  const known = BAND_SETTINGS.find((candidate) => candidate === setting)
  if (!known) {
    throw new Error(
      `handily-board: userConfig band is ${JSON.stringify(setting)}; set it to on or off in /config.`,
    )
  }
  return known
}

export type BandView =
  | { kind: 'plan'; plan: BoardPlan }
  | {
      kind: 'tasks'
      list: BoardList
      forYou: number
      activity: BoardActivity
      now: number
    }

export function bandView(
  all: BoardList,
  plan: BoardPlan | undefined,
  activity: BoardActivity,
  now: number,
): BandView | undefined {
  if (plan !== undefined && isOffered(plan) && !plan.isDismissed) return { kind: 'plan', plan }
  const list = ownList(all)
  const forYou = all.tasks.filter(
    (task) => task.for === 'person' && task.isWithdrawn !== true && task.result === undefined,
  ).length
  const isOpen = list.tasks.some((task) => task.status !== 'completed')
  if (!isOpen && forYou === 0) return undefined
  return { kind: 'tasks', list, forYou, activity, now }
}

export function isTimed(view: BandView): boolean {
  return view.kind === 'tasks' && view.list.tasks.some((task) => task.status === 'in_progress')
}

export function isEngineDrawing(drawn: RenderElement): boolean {
  return drawn.type === 'engine'
}

type BandElements = Pick<PaneElements, 'Box' | 'Text' | 'Button' | 'signals'>

export type BandActions = { open: () => void; addPlan: (id: string) => void }

type Part = { text: string } & Omit<TextProps, 'children'>

function partsWidth(parts: readonly Part[]): number {
  return parts.reduce((sum, part) => sum + displayWidth(part.text), 0)
}

function buttonWidth(label: string): number {
  return displayWidth(label) + BUTTON_CHROME
}

function timePart(task: BoardTask | undefined, view: Extract<BandView, { kind: 'tasks' }>): Part[] {
  if (task === undefined) return []
  if (task.status !== 'in_progress') return [{ text: NEXT_WORD, dimColor: true }]
  const clock = view.activity.clocks[String(task.id)]
  if (clock === undefined) return []
  const isStalled = view.now - runStart(clock) > STALLED_AFTER_MS
  const text = elapsedText(view.now - clock.startedAt)
  return [isStalled ? { text, color: 'warning' } : { text, dimColor: true }]
}

function barParts(list: BoardList): Part[] {
  const total = list.tasks.length
  if (total === 0) return []
  const doing = list.tasks.filter((task) => task.status === 'in_progress').length
  const cells = barCells(doneCount(list), doing, total)
  return [
    { text: BAR_FILLED.repeat(cells.done), color: SIGNALS.done.color },
    { text: BAR_FILLED.repeat(cells.doing), color: SIGNALS.doing.color },
    { text: BAR_EMPTY.repeat(cells.toDo), dimColor: true },
  ].filter((part) => part.text !== '')
}

function spaced(groups: readonly (readonly Part[])[]): Part[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) => (index === 0 ? [...group] : [{ text: ' ' }, ...group]))
}

function leftParts(
  view: Extract<BandView, { kind: 'tasks' }>,
  task: BoardTask | undefined,
  signals: SignalLooks,
): Part[] {
  const parts: Part[] = []
  if (view.forYou > 0) {
    const { mark, color } = signals.waitsForYou
    parts.push({ text: `${mark} ${String(view.forYou)} for you`, color })
    if (task !== undefined) parts.push({ text: ' · ', dimColor: true })
  }
  if (task === undefined) return parts
  const look = task.status === 'in_progress' ? signals.doing : signals.toDo
  parts.push({ text: `${look.mark} `, color: look.color }, { text: `${String(task.id)} ` })
  return parts
}

function moreRunning(list: BoardList): Part[] {
  const more = list.tasks.filter((task) => task.status === 'in_progress').length - 1
  return more > 0 ? [{ text: ` · +${String(more)} in progress`, dimColor: true }] : []
}

function draw(elements: BandElements, left: Part[], right: Part[], button: RenderElement) {
  const { Box, Text } = elements
  const text = (part: Part) => {
    const { text: children, ...style } = part
    return Text({ ...style, children })
  }
  return Box({
    key: 'band',
    flexDirection: 'row',
    children: [
      Box({ flexDirection: 'row', flexGrow: 1, flexShrink: 1, children: left.map(text) }),
      Box({
        flexDirection: 'row',
        flexShrink: 0,
        children: [...right.map(text), Box({ marginLeft: 1, children: [button] })],
      }),
    ],
  })
}

function drawTasks(
  elements: BandElements,
  view: Extract<BandView, { kind: 'tasks' }>,
  columns: number,
  button: RenderElement,
): RenderElement {
  const { list } = view
  const task =
    list.tasks.find((one) => one.status === 'in_progress') ??
    list.tasks.find((one) => one.status === 'pending')
  const count: Part = {
    text: `${String(doneCount(list))}/${String(list.tasks.length)}`,
    dimColor: true,
  }
  const bar = columns >= BAR_FROM ? barParts(list) : []
  const time = columns >= TIME_FROM ? timePart(task, view) : []
  const lead = leftParts(view, task, elements.signals)
  const fixed = (withTime: boolean) =>
    partsWidth(spaced([withTime ? time : [], bar, list.tasks.length > 0 ? [count] : []])) +
    1 +
    buttonWidth(BOARD_LABEL) +
    1 +
    partsWidth(lead)
  const keepsTime = columns - fixed(true) >= TITLE_AT_LEAST || task === undefined
  const right = spaced([keepsTime ? time : [], bar, list.tasks.length > 0 ? [count] : []])
  const room = Math.max(columns - fixed(keepsTime), 0)
  const more = task === undefined ? [] : moreRunning(list)
  const title = task === undefined ? '' : escaped(task.title)
  const titleParts: Part[] =
    task === undefined
      ? []
      : room >= displayWidth(title) + partsWidth(more)
        ? [{ text: title }, ...more]
        : [{ text: fitted(title, room).replace(SPACE_BEFORE_CUT, CUT_MARK) }]
  return draw(elements, [...lead, ...titleParts], right, button)
}

function drawPlan(
  elements: BandElements,
  plan: BoardPlan,
  columns: number,
  actions: BandActions,
  button: RenderElement,
): RenderElement {
  const { Box, Text, Button } = elements
  const add = Button({
    key: 'band-plan-add',
    label: addLabel(plan),
    onPress: () => {
      actions.addPlan(plan.id)
    },
  })
  const room = Math.max(columns - buttonWidth(BOARD_LABEL) - 1 - buttonWidth(addLabel(plan)) - 2, 0)
  const head = fitted(`approved · ${stepsText(plan.steps.length)}`, Math.max(room - 6, 0))
  return Box({
    key: 'band',
    flexDirection: 'row',
    children: [
      Box({
        flexDirection: 'row',
        flexGrow: 1,
        flexShrink: 1,
        children: [
          Text({ bold: true, children: 'Plan' }),
          Text({ dimColor: true, children: `  ${head}` }),
          Box({ marginLeft: 2, flexShrink: 0, children: [add] }),
        ],
      }),
      Box({ flexShrink: 0, marginLeft: 1, children: [button] }),
    ],
  })
}

export function drawBand(
  elements: BandElements,
  view: BandView,
  columns: number,
  actions: BandActions,
): RenderElement {
  const button = elements.Button({ key: 'band-board', label: BOARD_LABEL, onPress: actions.open })
  if (view.kind === 'plan') return drawPlan(elements, view.plan, columns, actions, button)
  return drawTasks(elements, view, columns, button)
}
