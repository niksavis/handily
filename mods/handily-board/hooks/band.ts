import type { PluginOptions, RenderElement, TextProps } from 'claude-code'
import type { BoardActivity, BoardList, BoardPlan, BoardTask } from '../types'
import { elapsedText, runTime } from './activity'
import {
  WAITS_LEAD,
  agentLook,
  callText,
  contextText,
  failedDetail,
  stateWord,
  toolText,
  waitsText,
} from './agent-rows'
import type { AgentRow } from './agents'
import { BAR_EMPTY, BAR_FILLED, barCells } from './bar'
import type { PaneElements } from './pane'
import { fitParts } from './parts'
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
const AGENTS_WORD = 'Agents'
const NO_TASK_TEXT = 'no open task'
const STRIP_ROWS_AT_MOST = 3
const STRIP_TICK_MS = 10_000
const WIDE_FROM = 50
const CONTEXT_FROM = 100
const MARK_COLUMNS = 2
const NAME_COLUMNS = 9
const STATE_COLUMNS = 9
const CONTEXT_COLUMNS = 7
const TIME_COLUMNS = 3
const GAP = 1
const OPEN_LABEL = 'open'
const NO_ANSWER = 'no answer'
const PERMISSION = 'permission'
const PART_LEAD = ' · '
const STEP_WORD = 'step'
const HEAD_KEY = 'band-head'
const FOLD_KEY = 'band-agents-more'

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
  | { kind: 'agents'; count: number }

export function bandView(
  all: BoardList,
  plan: BoardPlan | undefined,
  activity: BoardActivity,
  now: number,
  agents: number,
): BandView | undefined {
  if (plan !== undefined && isOffered(plan) && !plan.isDismissed) return { kind: 'plan', plan }
  const list = ownList(all)
  const forYou = all.tasks.filter(
    (task) => task.for === 'person' && task.isWithdrawn !== true && task.result === undefined,
  ).length
  const isOpen = list.tasks.some((task) => task.status !== 'completed')
  if (isOpen || forYou > 0) return { kind: 'tasks', list, forYou, activity, now }
  return agents > 0 ? { kind: 'agents', count: agents } : undefined
}

export function isTimed(view: BandView, agents: number): boolean {
  if (agents > 0) return true
  return view.kind === 'tasks' && view.list.tasks.some((task) => task.status === 'in_progress')
}

export type StripGroup = 'needsYou' | 'failed' | 'done' | 'running'

const STRIP_GROUPS: readonly StripGroup[] = ['needsYou', 'failed', 'done', 'running']

const GROUP_WORDS: Record<StripGroup, string> = {
  needsYou: 'needs you',
  failed: 'failed',
  done: 'done',
  running: 'running',
}

export function stripGroup(row: AgentRow): StripGroup | undefined {
  if (row.look === 'needsYou') return 'needsYou'
  if (row.look === 'failed') return row.isFailureSeen ? undefined : 'failed'
  if (row.isEnded) return row.look === 'unlisted' || row.isAnswerSeen ? undefined : 'done'
  return 'running'
}

export function hasStripFailure(rows: readonly AgentRow[]): boolean {
  return rows.some((row) => stripGroup(row) === 'failed')
}

function rankOf(row: AgentRow): number {
  const group = stripGroup(row)
  return group === undefined ? STRIP_GROUPS.length : STRIP_GROUPS.indexOf(group)
}

export function stripRows(rows: readonly AgentRow[]): AgentRow[] {
  return rows
    .filter((row) => stripGroup(row) !== undefined)
    .sort((a, b) => rankOf(a) - rankOf(b) || a.startedAt - b.startedAt)
}

export function isLiveRow(row: AgentRow): boolean {
  const group = stripGroup(row)
  return group === 'needsYou' || group === 'running'
}

export type StripKeep = { rows: Map<string, AgentRow>; at: number | undefined; isTickDue: boolean }

export function newStripKeep(): StripKeep {
  return { rows: new Map(), at: undefined, isTickDue: false }
}

export function forgetStrip(keep: StripKeep): void {
  keep.rows.clear()
  keep.at = undefined
  keep.isTickDue = false
}

function isSameState(kept: AgentRow, fresh: AgentRow): boolean {
  return kept.look === fresh.look && kept.stall?.kind === fresh.stall?.kind
}

export function heldRows(keep: StripKeep, fresh: readonly AgentRow[], now: number): AgentRow[] {
  const isDue = keep.isTickDue || keep.at === undefined || now - keep.at >= STRIP_TICK_MS
  keep.isTickDue = false
  if (isDue) keep.at = now
  const held = fresh.map((row) => {
    const kept = keep.rows.get(row.id)
    return !isDue && kept !== undefined && isSameState(kept, row) ? kept : row
  })
  keep.rows = new Map(held.map((row) => [row.id, row]))
  return held
}

export function isEngineDrawing(drawn: RenderElement): boolean {
  return drawn.type === 'engine'
}

type BandElements = Pick<PaneElements, 'Box' | 'Text' | 'Button' | 'signals'>

export type BandActions = {
  open: () => void
  addPlan: (id: string) => void
  openAgent: (row: AgentRow) => void
}

export type BandStrip = { rows: readonly AgentRow[]; maxRows: number }

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
  const { text, isStalled } = runTime(clock, view.now)
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

function textOf(elements: BandElements, part: Part): RenderElement {
  const { text: children, ...style } = part
  return elements.Text({ ...style, children })
}

function draw(
  elements: BandElements,
  left: Part[],
  right: Part[],
  button: RenderElement,
  key: string,
) {
  const { Box } = elements
  const text = (part: Part) => textOf(elements, part)
  return Box({
    key,
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
  key: string,
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
  return draw(elements, [...lead, ...titleParts], right, button, key)
}

function drawAgentsHead(
  elements: BandElements,
  count: number,
  columns: number,
  button: RenderElement,
  key: string,
): RenderElement {
  const gap = columns >= WIDE_FROM ? '  ' : ' '
  const room = Math.max(columns - buttonWidth(BOARD_LABEL) - GAP - displayWidth(AGENTS_WORD), 0)
  const tail = fitted(`${gap}${String(count)} · ${NO_TASK_TEXT}`, room)
  return draw(
    elements,
    [
      { text: AGENTS_WORD, bold: true },
      { text: tail, dimColor: true },
    ],
    [],
    button,
    key,
  )
}

function drawPlan(
  elements: BandElements,
  plan: BoardPlan,
  columns: number,
  actions: BandActions,
  button: RenderElement,
  key: string,
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
    key,
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

function planStep(row: AgentRow): string | undefined {
  const tasks = row.plan ?? []
  if (tasks.length === 0) return undefined
  const done = tasks.filter((task) => task.status === 'completed').length
  const current =
    tasks.find((task) => task.status === 'in_progress') ??
    tasks.find((task) => task.status === 'pending')
  const count = `${String(done)}/${String(tasks.length)}`
  return current === undefined ? count : `${count} ${escaped(current.title)}`
}

function runningParts(row: AgentRow, isWhole: boolean): Part[] {
  const step = planStep(row)
  const tool = toolText(row)
  const toolPart: Part[] = tool === '' ? [] : [{ text: tool, dimColor: true }]
  const lead: Part = { text: PART_LEAD, dimColor: true }
  if (row.stall?.kind === 'slow' && toolPart.length > 0) {
    const after: Part[] = step === undefined ? [] : [lead, { text: `${STEP_WORD} ${step}` }]
    return [...toolPart, ...(isWhole ? after : [])]
  }
  if (step === undefined) return toolPart
  return [{ text: step }, ...(isWhole && toolPart.length > 0 ? [lead, ...toolPart] : [])]
}

function waitsParts(row: AgentRow, isWide: boolean): Part[] {
  if (!isWide) return [{ text: row.call === null ? PERMISSION : callText(row.call) }]
  return [{ text: WAITS_LEAD, dimColor: true }, { text: waitsText(row) }]
}

function answerParts(row: AgentRow): Part[] {
  if (row.answer === null || row.answer === '') return [{ text: NO_ANSWER, dimColor: true }]
  return [{ text: escaped(row.answer) }]
}

function detailParts(row: AgentRow, columns: number): Part[] {
  switch (stripGroup(row)) {
    case 'needsYou':
      return waitsParts(row, columns >= WIDE_FROM)
    case 'failed':
      return [{ text: failedDetail(row), dimColor: true }]
    case 'done':
      return answerParts(row)
    case 'running':
    case undefined:
      return runningParts(row, columns >= CONTEXT_FROM)
  }
}

function fittedDetail(parts: readonly Part[], room: number): Part[] {
  const kept = fitParts(parts, room)
  const last = kept.at(-1)
  if (last === undefined) return kept
  return [...kept.slice(0, -1), { ...last, text: last.text.replace(SPACE_BEFORE_CUT, CUT_MARK) }]
}

function fixedBox(elements: BandElements, width: number, child: RenderElement): RenderElement {
  return elements.Box({ width, flexShrink: 0, children: [child] })
}

function drawAgentRow(
  elements: BandElements,
  row: AgentRow,
  columns: number,
  onOpen: () => void,
): RenderElement {
  const { Box, Text, Button } = elements
  const isWide = columns >= WIDE_FROM
  const hasContext = columns >= CONTEXT_FROM
  const look = agentLook(row.look, elements.signals)
  const state = stateWord(row)
  const stateWidth = isWide
    ? Math.max(STATE_COLUMNS, displayWidth(state.text))
    : displayWidth(state.text)
  const nameWidth = Math.max(NAME_COLUMNS, displayWidth(row.shownName))
  const context = contextText(row)
  const contextWidth = hasContext ? GAP + Math.max(CONTEXT_COLUMNS, displayWidth(context)) : 0
  const time = elapsedText(row.ageMs)
  const timeWidth = isWide ? GAP + Math.max(TIME_COLUMNS, displayWidth(time)) : 0
  const openWidth = GAP + displayWidth(OPEN_LABEL)
  const fixed =
    MARK_COLUMNS + nameWidth + GAP + stateWidth + GAP + contextWidth + openWidth + timeWidth
  const detail = fittedDetail(detailParts(row, columns), Math.max(columns - fixed, 0))
  return Box({
    key: `band-agent:${row.id}`,
    flexDirection: 'row',
    children: [
      fixedBox(elements, MARK_COLUMNS, Text({ color: look.color, children: `${look.mark} ` })),
      fixedBox(elements, nameWidth + GAP, Text({ bold: true, children: row.shownName })),
      fixedBox(elements, stateWidth + GAP, Text({ ...state.style, children: state.text })),
      Box({
        flexDirection: 'row',
        flexGrow: 1,
        flexShrink: 1,
        children: detail.map((part) => textOf(elements, part)),
      }),
      hasContext
        ? fixedBox(elements, contextWidth, Text({ dimColor: true, children: ` ${context}` }))
        : null,
      Box({
        flexShrink: 0,
        marginLeft: GAP,
        children: [
          Button({
            key: `band-open:${row.id}`,
            label: OPEN_LABEL,
            plain: true,
            dimColor: true,
            onPress: onOpen,
          }),
        ],
      }),
      isWide
        ? fixedBox(
            elements,
            timeWidth,
            Text({ dimColor: true, children: time.padStart(timeWidth) }),
          )
        : null,
    ],
  })
}

function countsOf(rows: readonly AgentRow[]): { group: StripGroup; count: number }[] {
  return STRIP_GROUPS.map((group) => ({
    group,
    count: rows.filter((row) => stripGroup(row) === group).length,
  })).filter(({ count }) => count > 0)
}

export function foldLabel(hidden: readonly AgentRow[], columns: number): string {
  const more = columns >= WIDE_FROM ? 'more agents' : 'more'
  const lead = `+${String(hidden.length)} ${more}`
  const counts = countsOf(hidden)
  const label = (kept: readonly { group: StripGroup; count: number }[]) =>
    [lead, ...kept.map(({ group, count }) => `${String(count)} ${GROUP_WORDS[group]}`)].join(
      PART_LEAD,
    )
  let kept = counts
  while (buttonWidth(label(kept)) > columns) {
    const cut = kept.findLastIndex(({ group }) => group !== 'needsYou')
    if (cut < 0) break
    kept = kept.filter((_, index) => index !== cut)
  }
  return label(kept)
}

export function stripShown(rows: readonly AgentRow[], maxRows: number): number {
  const most = Math.min(rows.length, STRIP_ROWS_AT_MOST)
  const needsYou = Math.min(rows.filter((row) => row.look === 'needsYou').length, most)
  for (let shown = most; shown > needsYou; shown -= 1) {
    const lines = 1 + shown + (rows.length > shown ? 1 : 0)
    if (lines <= maxRows) return shown
  }
  return needsYou
}

function drawHead(
  elements: BandElements,
  view: BandView,
  columns: number,
  actions: BandActions,
  key: string,
): RenderElement {
  const button = elements.Button({ key: 'band-board', label: BOARD_LABEL, onPress: actions.open })
  switch (view.kind) {
    case 'plan':
      return drawPlan(elements, view.plan, columns, actions, button, key)
    case 'tasks':
      return drawTasks(elements, view, columns, button, key)
    case 'agents':
      return drawAgentsHead(elements, view.count, columns, button, key)
  }
}

export function drawBand(
  elements: BandElements,
  view: BandView,
  columns: number,
  actions: BandActions,
  strip: BandStrip = { rows: [], maxRows: 0 },
): RenderElement {
  if (strip.rows.length === 0) return drawHead(elements, view, columns, actions, 'band')
  const shown = stripShown(strip.rows, strip.maxRows)
  const hidden = strip.rows.slice(shown)
  const fold =
    hidden.length === 0
      ? null
      : elements.Box({
          key: 'band-fold',
          flexDirection: 'row',
          children: [
            elements.Button({
              key: FOLD_KEY,
              label: foldLabel(hidden, columns),
              onPress: actions.open,
            }),
          ],
        })
  return elements.Box({
    key: 'band',
    flexDirection: 'column',
    children: [
      drawHead(elements, view, columns, actions, HEAD_KEY),
      ...strip.rows.slice(0, shown).map((row) =>
        drawAgentRow(elements, row, columns, () => {
          actions.openAgent(row)
        }),
      ),
      fold,
    ],
  })
}
