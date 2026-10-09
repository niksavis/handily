import type {
  AgentStatus,
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  PluginOptions,
  RenderElement,
  TextProps,
  ThemeKey,
} from 'claude-code'
import type { TaskPaneActivity, TaskPaneList, TaskPaneTask, TaskPaneToolSight } from '../types'
import { PLAN_REQUEST, callsText, clockTime, elapsedText, planLag } from './activity'
import {
  OPEN_ITEMS_SHOWN,
  addItemsAsTasks,
  type TaskHost,
  personAdd,
  personRemove,
  readList,
  trackerView,
  withoutFinalPeriod,
  type TrackerLine,
  type TrackerView,
} from './commands'
import { SIGNALS, type SignalLook } from './signals'
import {
  doneCount,
  escaped,
  paneTaskText,
  priorityText,
  shownAuthor,
  statusLook,
  type WorkItem,
} from './tasks'
import { cutToWidth, displayWidth, fitted, padToWidth } from './width'

export const PANE_ID = 'task-pane'
const PANE_TITLE = 'Tasks'
const DONE_GROUP = 'group:done'
const ITEMS_GROUP = 'group:items'
const AGENT_NAME_COLUMNS_AT_MOST = 16
const AUTHOR_COLOR: ThemeKey = 'suggestion'

export type PaneMode = 'off' | 'toggle' | 'always'

const PANE_MODES: readonly PaneMode[] = ['off', 'toggle', 'always']

export function paneMode(options: PluginOptions): PaneMode {
  const mode = options.mode ?? 'toggle'
  const known = PANE_MODES.find((candidate) => candidate === mode)
  if (!known) {
    throw new Error(
      `task-pane: userConfig mode is ${JSON.stringify(mode)}; set it to off, toggle or always in /config.`,
    )
  }
  return known
}

export type PromptFill = { isFilled: boolean; refusal?: string }

export type PaneUi = {
  open: (
    id: string,
    title: string,
  ) => Promise<{ isPlaced: true } | { isPlaced: false; reason: string }>
  close: (id: string) => Promise<void>
  isOpen: (id: string) => Promise<boolean>
  fillPrompt: (text: string) => Promise<PromptFill>
  toast: (text: string) => void
  log: (text: string) => void
}

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input: ElementConstructor<InputProps> | undefined
  bodyColumns: number
}

export type AgentPlan = { done: number; total: number }

export type AgentRow = {
  id: string
  name: string
  status: AgentStatus
  plan: AgentPlan | null
  last: TaskPaneToolSight | null
}

export type PaneWork = {
  now: number
  activity: TaskPaneActivity
  agents: readonly AgentRow[]
}

export async function openPane(ui: PaneUi): Promise<string> {
  const opened = await ui.open(PANE_ID, PANE_TITLE)
  if (opened.isPlaced) return 'Task pane opened.'
  return `Task pane opened, but this session does not show it yet: ${opened.reason} /task lists the tasks.`
}

export async function paneCommand(ui: PaneUi, mode: PaneMode, text: string): Promise<string> {
  if (text !== '') return '/task pane takes no argument; run /task pane.'
  if (mode === 'toggle' && (await ui.isOpen(PANE_ID))) {
    await ui.close(PANE_ID)
    return 'Task pane closed.'
  }
  return openPane(ui)
}

type Act = (work: () => Promise<string | undefined>) => void

function actor(ui: PaneUi): Act {
  return (work) => {
    work().then(
      (reply) => {
        if (reply !== undefined) ui.toast(reply)
      },
      (error: unknown) => {
        ui.log(`task-pane: ${String(error)}`)
        ui.toast('task-pane: the change failed; see the transcript log.')
      },
    )
  }
}

function lineColor(tone: TrackerLine['tone']): 'error' | 'warning' | undefined {
  return tone === 'dim' ? undefined : tone
}

type TextStyle = Omit<TextProps, 'children'>

type Cell = { text: string; style: TextStyle }

type RowAction = { key: string; label: string; onPress: () => void }

type RowOpening = { kind: 'none' } | { kind: 'cut' } | { kind: 'details'; lines: readonly Cell[] }

type PaneRow = {
  key: string
  cells: readonly Cell[]
  title: string
  titleStyle: TextStyle
  aside?: Cell
  action?: RowAction
  opening: RowOpening
}

type RowLayout = {
  expanded: ReadonlySet<string>
  toggle: (rowKey: string) => void
}

const MORE_LABEL = '…'
const BUTTON_CHROME = 4
const BUTTON_GAP = 1

function actionWidth(action: RowAction | undefined): number {
  return action === undefined ? 0 : BUTTON_GAP + displayWidth(action.label) + BUTTON_CHROME
}

function asideWidth(aside: Cell | undefined): number {
  return aside === undefined ? 0 : BUTTON_GAP + displayWidth(aside.text)
}

function column(texts: readonly string[]): number {
  return Math.max(0, ...texts.map(displayWidth)) + 1
}

function callText(sight: TaskPaneToolSight): string {
  const tool = escaped(sight.tool)
  return sight.target === null ? tool : `${tool} ${escaped(sight.target)}`
}

function drawTitle(
  elements: PaneElements,
  row: PaneRow,
  shown: string,
  isCut: boolean,
  layout: RowLayout,
): RenderElement[] {
  const { Text, Button } = elements
  const title = Text({ ...row.titleStyle, wrap: 'truncate-end', children: shown })
  const toggle = () => {
    layout.toggle(row.key)
  }
  switch (row.opening.kind) {
    case 'none':
      return [isCut ? Text({ ...row.titleStyle, children: `${shown}${MORE_LABEL}` }) : title]
    case 'cut':
      return isCut
        ? [
            title,
            Button({ key: `more:${row.key}`, label: MORE_LABEL, plain: true, onPress: toggle }),
          ]
        : [title]
    case 'details':
      return [
        Button({
          key: `open:${row.key}`,
          plain: true,
          onPress: toggle,
          children: [title, isCut ? Text({ ...row.titleStyle, children: MORE_LABEL }) : null],
        }),
      ]
  }
}

function drawOpened(
  elements: PaneElements,
  row: PaneRow,
  isCut: boolean,
  leadWidth: number,
): RenderElement | null {
  const { Box, Text } = elements
  const { opening } = row
  if (opening.kind === 'none' || (opening.kind === 'cut' && !isCut)) return null
  const lines = opening.kind === 'details' ? opening.lines : []
  return Box({
    key: `full:${row.key}`,
    flexDirection: 'column',
    paddingLeft: leadWidth,
    children: [
      isCut ? Text({ ...row.titleStyle, children: row.title }) : null,
      ...lines.map((line) => Text({ ...line.style, children: line.text })),
    ],
  })
}

function drawRow(elements: PaneElements, row: PaneRow, layout: RowLayout): RenderElement {
  const { Box, Text, Button } = elements
  const leadWidth = cellsWidth(row.cells)
  const room = Math.max(
    elements.bodyColumns - leadWidth - asideWidth(row.aside) - actionWidth(row.action),
    0,
  )
  const isCut = displayWidth(row.title) > room
  const shown = isCut ? cutToWidth(row.title, room - displayWidth(MORE_LABEL)) : row.title
  const line = Box({
    key: `row:${row.key}`,
    flexDirection: 'row',
    children: [
      ...row.cells.map((cell) =>
        Box({
          width: displayWidth(cell.text),
          flexShrink: 0,
          children: [Text({ ...cell.style, children: cell.text })],
        }),
      ),
      Box({
        flexDirection: 'row',
        flexGrow: 1,
        flexShrink: 1,
        children: drawTitle(elements, row, shown, isCut, layout),
      }),
      row.aside
        ? Box({
            flexShrink: 0,
            marginLeft: BUTTON_GAP,
            children: [Text({ ...row.aside.style, children: row.aside.text })],
          })
        : null,
      row.action
        ? Box({
            flexShrink: 0,
            marginLeft: BUTTON_GAP,
            children: [
              Button({
                key: row.action.key,
                label: row.action.label,
                onPress: row.action.onPress,
              }),
            ],
          })
        : null,
    ],
  })
  const opened = layout.expanded.has(row.key) ? drawOpened(elements, row, isCut, leadWidth) : null
  if (opened === null) return line
  return Box({ flexDirection: 'column', children: [line, opened] })
}

function rowLayout(host: TaskHost, expanded: readonly string[], act: Act): RowLayout {
  return {
    expanded: new Set(expanded),
    toggle: (rowKey) => {
      act(async () => {
        await host.editExpanded((keys) =>
          keys.includes(rowKey) ? keys.filter((key) => key !== rowKey) : [...keys, rowKey],
        )
        return undefined
      })
    },
  }
}

function toolsSince(activity: TaskPaneActivity, task: TaskPaneTask): number | undefined {
  const clock = activity.clocks[String(task.id)]
  if (clock === undefined) return undefined
  return (clock.endCalls ?? activity.calls) - clock.startCalls
}

function clockLine(task: TaskPaneTask, work: PaneWork): string {
  const clock = work.activity.clocks[String(task.id)]
  if (clock === undefined) {
    if (task.status === 'pending') return 'not started yet'
    if (task.status === 'completed') return 'done; never seen in progress'
    return 'in progress; its start was not seen'
  }
  const tools = callsText(toolsSince(work.activity, task) ?? 0)
  const started = `started ${clockTime(clock.startedAt)} · ${tools}`
  if (clock.endedAt === null) return `${started} · ${elapsedText(work.now - clock.startedAt)}`
  return `${started} · took ${elapsedText(clock.endedAt - clock.startedAt)}`
}

function runningAside(task: TaskPaneTask, work: PaneWork): Cell | undefined {
  const clock = work.activity.clocks[String(task.id)]
  if (task.status !== 'in_progress' || clock === undefined) return undefined
  return { text: elapsedText(work.now - clock.startedAt), style: { dimColor: true } }
}

function taskCells(task: TaskPaneTask, numberWidth: number): Cell[] {
  const isDone = task.status === 'completed'
  const isActive = task.status === 'in_progress'
  const { mark, color } = statusLook(task.status)
  const author = shownAuthor(task.by)
  return [
    { text: `${mark} `, style: { color } },
    { text: padToWidth(String(task.id), numberWidth), style: { dimColor: isDone, bold: isActive } },
    ...(author === undefined ? [] : [{ text: `${author} `, style: { color: AUTHOR_COLOR } }]),
  ]
}

function cellsWidth(cells: readonly Cell[]): number {
  return cells.reduce((sum, cell) => sum + displayWidth(cell.text), 0)
}

function taskRow(
  host: TaskHost,
  task: TaskPaneTask,
  numberWidth: number,
  work: PaneWork,
  act: Act,
  layout: RowLayout,
): PaneRow {
  const isDone = task.status === 'completed'
  const isActive = task.status === 'in_progress'
  const id = String(task.id)
  const key = `task:${id}`
  const aside = runningAside(task, work)
  const removal: RowAction = {
    key: `rm:${id}`,
    label: 'rm',
    onPress: () => {
      act(() => personRemove(host, id))
    },
  }
  const isRemovable = isActive || layout.expanded.has(key)
  return {
    key,
    cells: taskCells(task, numberWidth),
    title: paneTaskText(task),
    titleStyle: { dimColor: isDone, bold: isActive },
    ...(aside ? { aside } : {}),
    ...(isRemovable ? { action: removal } : {}),
    opening: {
      kind: 'details',
      lines: [{ text: clockLine(task, work), style: { dimColor: true } }],
    },
  }
}

function lastCallRow(task: TaskPaneTask, indent: number, work: PaneWork): PaneRow {
  const { activity } = work
  const since = toolsSince(activity, task)
  const title = activity.last === null ? '▸ no tool call yet' : `▸ ${callText(activity.last)}`
  return {
    key: `work:${String(task.id)}`,
    cells: [{ text: ' '.repeat(indent), style: {} }],
    title,
    titleStyle: { dimColor: true },
    ...(since === undefined
      ? {}
      : { aside: { text: callsText(since), style: { dimColor: true } } }),
    opening: { kind: 'none' },
  }
}

function warningText(lag: number, hasList: boolean): string {
  const calls = `${String(lag)} tool calls`
  return hasList ? `No plan update for ${calls}.` : `Claude has kept no plan for ${calls}.`
}

function drawPlanWarning(
  elements: PaneElements,
  ui: PaneUi,
  work: PaneWork,
  hasList: boolean,
  act: Act,
): RenderElement[] {
  const { Box, Text, Button } = elements
  const lag = planLag(work.activity)
  if (lag === undefined) return []
  const ask = () => {
    act(async () => {
      const filled = await ui.fillPrompt(PLAN_REQUEST)
      if (filled.isFilled) return undefined
      const why = filled.refusal === undefined ? '' : ` (${filled.refusal})`
      return `The prompt box did not take the plan request${why}. Ask Claude for a plan in your next prompt.`
    })
  }
  return [
    Box({
      key: 'plan-warning',
      children: [
        Text({
          color: 'warning',
          children: fitted(warningText(lag, hasList), elements.bodyColumns),
        }),
      ],
    }),
    Button({ key: 'ask-plan', label: 'Ask Claude for a plan', onPress: ask }),
  ]
}

function drawTasks(
  elements: PaneElements,
  host: TaskHost,
  list: TaskPaneList,
  work: PaneWork,
  act: Act,
  layout: RowLayout,
): RenderElement[] {
  const { Button } = elements
  const running = list.tasks.filter((task) => task.status === 'in_progress')
  const pending = list.tasks.filter((task) => task.status === 'pending')
  const done = list.tasks.filter((task) => task.status === 'completed')
  const isDoneShown = layout.expanded.has(DONE_GROUP)
  const numberWidth = column(list.tasks.map((task) => String(task.id)))
  const draw = (task: TaskPaneTask) =>
    drawRow(elements, taskRow(host, task, numberWidth, work, act, layout), layout)
  const first = running[0]
  const doneCountText = String(done.length)
  return [
    running.length === 0 ? nowRow(elements, work, layout) : null,
    ...running.flatMap((task) =>
      task === first
        ? [
            draw(task),
            drawRow(
              elements,
              lastCallRow(task, cellsWidth(taskCells(task, numberWidth)), work),
              layout,
            ),
          ]
        : [draw(task)],
    ),
    ...pending.map(draw),
    done.length > 0
      ? Button({
          key: 'done',
          label: isDoneShown ? `hide ${doneCountText} done` : `+${doneCountText} done`,
          onPress: () => {
            layout.toggle(DONE_GROUP)
          },
        })
      : null,
    ...(isDoneShown ? done.map(draw) : []),
  ].filter((element) => element !== null)
}

function nowRow(elements: PaneElements, work: PaneWork, layout: RowLayout): RenderElement | null {
  const { activity } = work
  if (activity.last === null || activity.firstAt === null) return null
  const spent = elapsedText(work.now - activity.firstAt)
  return drawRow(
    elements,
    {
      key: 'now',
      cells: [
        { text: `${SIGNALS.doing.mark} `, style: { color: SIGNALS.doing.color } },
        { text: 'Now  ', style: { bold: true } },
      ],
      title: callText(activity.last),
      titleStyle: { dimColor: true },
      aside: { text: `${callsText(activity.calls)} · ${spent}`, style: { dimColor: true } },
      opening: { kind: 'none' },
    },
    layout,
  )
}

function drawNow(elements: PaneElements, work: PaneWork, layout: RowLayout): RenderElement[] {
  const { Box, Text } = elements
  const { activity } = work
  const now = nowRow(elements, work, layout)
  if (now === null) return []
  const counts = activity.perTool
    .map((count) => `${escaped(count.tool)} ${String(count.calls)}`)
    .join(' · ')
  const indent = displayWidth(`${SIGNALS.doing.mark} `)
  return [
    now,
    Box({
      key: 'tool-counts',
      paddingLeft: indent,
      children: [Text({ dimColor: true, children: fitted(counts, elements.bodyColumns - indent) })],
    }),
  ]
}

function drawTracker(
  elements: PaneElements,
  host: TaskHost,
  view: TrackerView,
  act: Act,
  layout: RowLayout,
): RenderElement[] {
  const { Text, Button } = elements
  if (view.kind === 'lines') {
    return view.lines.map((line) =>
      Text({ color: lineColor(line.tone), dimColor: line.tone === 'dim', children: line.text }),
    )
  }
  if (view.items.length === 0) {
    return [Text({ dimColor: true, children: `Open in tracker: ${view.label} · no open items` })]
  }
  const addItems = (items: readonly WorkItem[]) => {
    act(async () => {
      const { added, existing, refusal, noteRefusal } = await addItemsAsTasks(host, items)
      const parts = [`Added ${String(added.length)} as tasks`]
      if (existing.length > 0) parts.push(`${String(existing.length)} already were`)
      if (refusal !== undefined) parts.push(`not added: ${withoutFinalPeriod(refusal)}`)
      if (noteRefusal !== undefined) {
        parts.push(`Claude was not told: ${withoutFinalPeriod(noteRefusal)}`)
      }
      return `${parts.join('; ')}.`
    })
  }
  const openCount = String(view.items.length)
  const isAllShown = layout.expanded.has(ITEMS_GROUP)
  const items = isAllShown ? view.items : view.items.slice(0, OPEN_ITEMS_SHOWN)
  const count = String(items.length)
  const priorityWidth = column(items.map(priorityText))
  const idWidth = column(items.map((item) => escaped(item.id)))
  const rows = items.map((item) =>
    drawRow(
      elements,
      {
        key: `item:${item.id}`,
        cells: [
          { text: padToWidth(priorityText(item), priorityWidth), style: { dimColor: true } },
          { text: padToWidth(escaped(item.id), idWidth), style: {} },
        ],
        title: escaped(item.title),
        titleStyle: {},
        action: {
          key: `add:${item.id}`,
          label: 'add',
          onPress: () => {
            addItems([item])
          },
        },
        opening: { kind: 'cut' },
      },
      layout,
    ),
  )
  const isFolding = view.items.length > OPEN_ITEMS_SHOWN
  return [
    Text({ dimColor: true, children: `Open in tracker: ${view.label} · ${openCount} open` }),
    ...rows,
    isFolding
      ? Button({
          key: 'all-items',
          label: isAllShown ? `first ${String(OPEN_ITEMS_SHOWN)}` : `all ${openCount} open`,
          onPress: () => {
            layout.toggle(ITEMS_GROUP)
          },
        })
      : null,
    Button({
      key: 'add-all',
      label: items.length === 1 ? 'Add 1 as a task' : `Add ${count} as tasks`,
      onPress: () => {
        addItems(items)
      },
    }),
  ].filter((element) => element !== null)
}

function agentLook(status: AgentStatus): SignalLook {
  return status === 'pending' ? SIGNALS.toDo : SIGNALS.doing
}

function agentRow(agent: AgentRow, nameWidth: number, planWidth: number): PaneRow {
  const plan =
    agent.plan === null ? '' : `${String(agent.plan.done)} of ${String(agent.plan.total)}`
  const { mark, color } = agentLook(agent.status)
  return {
    key: `agent:${agent.id}`,
    cells: [
      { text: `${mark} `, style: { color } },
      { text: padToWidth(fitted(escaped(agent.name), nameWidth - 1), nameWidth), style: {} },
      { text: padToWidth(plan, planWidth), style: { dimColor: true } },
    ],
    title: agent.last === null ? '▸ no tool call yet' : `▸ ${callText(agent.last)}`,
    titleStyle: { dimColor: true },
    opening: { kind: 'none' },
  }
}

function drawAgents(
  elements: PaneElements,
  agents: readonly AgentRow[],
  layout: RowLayout,
): RenderElement[] {
  const { Box, Text } = elements
  if (agents.length === 0) return []
  const nameWidth = Math.min(
    column(agents.map((agent) => escaped(agent.name))),
    AGENT_NAME_COLUMNS_AT_MOST,
  )
  const planWidth = column(
    agents.map((agent) =>
      agent.plan === null ? '' : `${String(agent.plan.done)} of ${String(agent.plan.total)}`,
    ),
  )
  return [
    Box({
      key: 'agents-rule',
      children: [Text({ dimColor: true, children: '─'.repeat(elements.bodyColumns) })],
    }),
    Box({
      key: 'agents',
      flexDirection: 'row',
      children: [
        Text({ bold: true, children: 'Agents' }),
        Text({ dimColor: true, children: `  ${String(agents.length)} running` }),
      ],
    }),
    ...agents.map((agent) => drawRow(elements, agentRow(agent, nameWidth, planWidth), layout)),
  ]
}

function drawFooter(elements: PaneElements, host: TaskHost, act: Act): RenderElement {
  const { Text, Input } = elements
  return Input
    ? Input({
        key: 'add',
        placeholder: 'Add a task',
        submitLabel: 'Add',
        onSubmit: (value) => {
          act(() => personAdd(host, value.trim()))
        },
      })
    : Text({ dimColor: true, children: 'Add tasks with /task add <text>.' })
}

function summaryText(list: TaskPaneList, work: PaneWork): string {
  const { activity } = work
  const total = list.tasks.length
  if (total === 0) return activity.calls > 0 ? 'none kept by Claude' : 'none in this session yet'
  const done = `${String(doneCount(list))} of ${String(total)} done`
  if (activity.firstAt === null) return done
  return `${done} · ${elapsedText(work.now - activity.firstAt)}`
}

export async function drawPane(
  elements: PaneElements,
  host: TaskHost,
  ui: PaneUi,
  work: PaneWork,
): Promise<RenderElement> {
  const { Box, Text } = elements
  const act = actor(ui)
  const list = await readList(host)
  const hasList = list.tasks.length > 0
  const layout = rowLayout(host, await host.expanded(), act)
  const warning = drawPlanWarning(elements, ui, work, hasList, act)
  const body = hasList
    ? [...drawTasks(elements, host, list, work, act, layout), ...warning]
    : [
        ...drawNow(elements, work, layout),
        ...warning,
        ...drawTracker(elements, host, await trackerView(host), act, layout),
      ]
  const header = Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: 'Tasks' }),
      Text({ dimColor: true, children: `  ${summaryText(list, work)}` }),
    ],
  })
  return Box({
    flexDirection: 'column',
    children: [
      header,
      ...body,
      ...drawAgents(elements, work.agents, layout),
      Text({ children: ' ' }),
      drawFooter(elements, host, act),
    ],
  })
}
