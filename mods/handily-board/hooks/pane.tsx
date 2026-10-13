import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RenderElement,
  TextProps,
  ThemeKey,
} from 'claude-code'
import type { BoardActivity, BoardList, BoardTask, BoardToolSight } from '../types'
import { PLAN_REQUEST, callsText, elapsedText, planLag } from './activity'
import { drawAgents } from './agent-rows'
import type { AgentRow } from './agents'
import type { PaneUi } from './board'
import {
  OPEN_ITEMS_SHOWN,
  addItemsAsTasks,
  type MoveDirection,
  type TaskHost,
  personAdd,
  personMove,
  personRemove,
  readList,
  trackerView,
  withoutFinalPeriod,
  type TrackerLine,
  type TrackerView,
} from './commands'
import { SIGNALS } from './signals'
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

const DONE_GROUP = 'group:done'
const ITEMS_GROUP = 'group:items'
const AUTHOR_COLOR: ThemeKey = 'suggestion'

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input: ElementConstructor<InputProps> | undefined
  bodyColumns: number
  isInline: boolean
}

export type PaneWork = {
  now: number
  activity: BoardActivity
  agents: readonly AgentRow[]
}

type Act = (work: () => Promise<string | undefined>) => void

function actor(ui: PaneUi): Act {
  return (work) => {
    work().then(
      (reply) => {
        if (reply !== undefined) ui.toast(reply)
      },
      (error: unknown) => {
        ui.log(`handily-board: ${String(error)}`)
        ui.toast('handily-board: the change failed; see the transcript log.')
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

type RowOpening =
  | { kind: 'none' }
  | { kind: 'cut' }
  | { kind: 'details'; lines: readonly Cell[]; actions: readonly RowAction[] }

type PaneRow = {
  key: string
  cells: readonly Cell[]
  title: string
  titleStyle: TextStyle
  detail?: Cell
  aside?: Cell
  action?: RowAction
  opening: RowOpening
  openIndent?: number
}

export type RowLayout = {
  expanded: ReadonlySet<string>
  toggle: (rowKey: string) => void
}

const MORE_LABEL = '…'
const BUTTON_CHROME = 4
const BUTTON_GAP = 1
const DETAIL_SHARE_OF_ROOM = 0.5
const DETAIL_COLUMNS_AT_LEAST = 2
const TRACKER_BUTTON_GAP = 2
const TASK_NUMBER_CELLS = 2
const TASKS_TITLE = 'Tasks'

function actionWidth(action: RowAction | undefined): number {
  return action === undefined ? 0 : BUTTON_GAP + displayWidth(action.label) + BUTTON_CHROME
}

function asideWidth(aside: Cell | undefined): number {
  return aside === undefined ? 0 : BUTTON_GAP + displayWidth(aside.text)
}

function detailRoom(detail: Cell | undefined, free: number): number {
  if (detail === undefined) return 0
  const room = Math.min(displayWidth(detail.text), Math.floor(free * DETAIL_SHARE_OF_ROOM))
  return room < DETAIL_COLUMNS_AT_LEAST ? 0 : room
}

function column(texts: readonly string[]): number {
  return Math.max(0, ...texts.map(displayWidth)) + 1
}

function callText(sight: BoardToolSight): string {
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
  const actions = opening.kind === 'details' ? opening.actions : []
  return Box({
    key: `full:${row.key}`,
    flexDirection: 'column',
    paddingLeft: leadWidth,
    children: [
      isCut ? Text({ ...row.titleStyle, children: row.title }) : null,
      ...lines.map((line) => Text({ ...line.style, children: line.text })),
      actions.length === 0 ? null : drawActions(elements, row.key, actions),
    ],
  })
}

function drawActions(
  elements: PaneElements,
  rowKey: string,
  actions: readonly RowAction[],
): RenderElement {
  const { Box, Button } = elements
  return Box({
    key: `actions:${rowKey}`,
    flexDirection: 'row',
    children: actions.map((action, index) =>
      Box({
        flexShrink: 0,
        marginLeft: index === 0 ? 0 : BUTTON_GAP,
        children: [Button({ key: action.key, label: action.label, onPress: action.onPress })],
      }),
    ),
  })
}

function drawRow(
  elements: PaneElements,
  row: PaneRow,
  layout: RowLayout,
  under: RenderElement | null = null,
): RenderElement {
  const { Box, Text, Button } = elements
  const leadWidth = cellsWidth(row.cells)
  const free = Math.max(
    elements.bodyColumns - leadWidth - asideWidth(row.aside) - actionWidth(row.action),
    0,
  )
  const detailColumns = detailRoom(row.detail, free)
  const room = detailColumns === 0 ? free : Math.max(free - detailColumns - BUTTON_GAP, 0)
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
      row.detail && detailColumns > 0
        ? Box({
            flexShrink: 0,
            marginLeft: BUTTON_GAP,
            children: [
              Text({ ...row.detail.style, children: fitted(row.detail.text, detailColumns) }),
            ],
          })
        : null,
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
  const openIndent = row.openIndent ?? leadWidth
  const opened = layout.expanded.has(row.key) ? drawOpened(elements, row, isCut, openIndent) : null
  if (opened === null && under === null) return line
  return Box({ flexDirection: 'column', children: [line, under, opened] })
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

function toolsSince(activity: BoardActivity, task: BoardTask): number | undefined {
  const clock = activity.clocks[String(task.id)]
  if (clock === undefined) return undefined
  return (clock.endCalls ?? activity.calls) - clock.startCalls
}

function clockLine(task: BoardTask, work: PaneWork): string {
  const clock = work.activity.clocks[String(task.id)]
  if (clock === undefined) {
    if (task.status === 'pending') return 'not started yet'
    if (task.status === 'completed') return 'done; never seen in progress'
    return 'in progress; its start was not seen'
  }
  const tools = `${callsText(toolsSince(work.activity, task) ?? 0)} in all`
  if (clock.endedAt === null) {
    return `started ${elapsedText(work.now - clock.startedAt)} ago · ${tools}`
  }
  return `took ${elapsedText(clock.endedAt - clock.startedAt)} · ${tools}`
}

function runningAside(task: BoardTask, work: PaneWork): Cell | undefined {
  const clock = work.activity.clocks[String(task.id)]
  if (task.status !== 'in_progress' || clock === undefined) return undefined
  return { text: elapsedText(work.now - clock.startedAt), style: { dimColor: true } }
}

function taskCells(task: BoardTask, numberWidth: number): Cell[] {
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
  task: BoardTask,
  numberWidth: number,
  work: PaneWork,
  act: Act,
  detail: Cell | undefined,
): PaneRow {
  const isDone = task.status === 'completed'
  const isActive = task.status === 'in_progress'
  const id = String(task.id)
  const aside = runningAside(task, work)
  const removal: RowAction = {
    key: `rm:${id}`,
    label: 'rm',
    onPress: () => {
      act(() => personRemove(host, id))
    },
  }
  const move = (direction: MoveDirection): RowAction => ({
    key: `${direction}:${id}`,
    label: direction,
    onPress: () => {
      act(() => personMove(host, task.id, direction))
    },
  })
  const cells = taskCells(task, numberWidth)
  return {
    key: `task:${id}`,
    cells,
    openIndent: cellsWidth(cells.slice(0, TASK_NUMBER_CELLS)),
    title: paneTaskText(task),
    titleStyle: { dimColor: isDone, bold: isActive },
    ...(detail ? { detail } : {}),
    ...(aside ? { aside } : {}),
    ...(isActive ? { action: removal } : {}),
    opening: {
      kind: 'details',
      lines: [{ text: clockLine(task, work), style: { dimColor: true } }],
      actions: isActive ? [] : [move('up'), move('down'), removal],
    },
  }
}

function lastCallText(work: PaneWork): string {
  const { last } = work.activity
  return last === null ? '▸ no tool call yet' : `▸ ${callText(last)}`
}

function inlineCallDetail(task: BoardTask, work: PaneWork): Cell {
  const since = toolsSince(work.activity, task)
  const calls = since === undefined ? '' : ` · ${callsText(since)}`
  return { text: `${lastCallText(work)}${calls}`, style: { dimColor: true } }
}

function lastCallRow(task: BoardTask, indent: number, work: PaneWork): PaneRow {
  const { activity } = work
  const since = toolsSince(activity, task)
  const title = lastCallText(work)
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
  return hasList ? `No plan update for ${calls}.` : `No plan from Claude for ${calls}.`
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
  list: BoardList,
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
  const rowOf = (task: BoardTask, detail?: Cell) =>
    taskRow(host, task, numberWidth, work, act, detail)
  const draw = (task: BoardTask) => drawRow(elements, rowOf(task), layout)
  const first = running[0]
  const doneCountText = String(done.length)
  const drawFirst = (task: BoardTask) => {
    if (elements.isInline)
      return drawRow(elements, rowOf(task, inlineCallDetail(task, work)), layout)
    const indent = cellsWidth(taskCells(task, numberWidth))
    const lastCall = drawRow(elements, lastCallRow(task, indent, work), layout)
    return drawRow(elements, rowOf(task), layout, lastCall)
  }
  return [
    running.length === 0 ? nowRow(elements, work, layout) : null,
    ...running.map((task) => (task === first ? drawFirst(task) : draw(task))),
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
  const { Box, Text, Button } = elements
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
  const foldLabel = isAllShown ? `first ${String(OPEN_ITEMS_SHOWN)}` : `all ${openCount} open`
  const addLabel = items.length === 1 ? 'Add 1 as a task' : `Add ${count} as tasks`
  const labels = isFolding ? [foldLabel, addLabel] : [addLabel]
  const buttonsWidth =
    labels.reduce((sum, label) => sum + displayWidth(label) + BUTTON_CHROME, 0) +
    (labels.length - 1) * TRACKER_BUTTON_GAP
  const isOneRow = buttonsWidth <= elements.bodyColumns
  const buttons = [
    isFolding
      ? Button({
          key: 'all-items',
          label: foldLabel,
          onPress: () => {
            layout.toggle(ITEMS_GROUP)
          },
        })
      : null,
    Button({
      key: 'add-all',
      label: addLabel,
      onPress: () => {
        addItems(items)
      },
    }),
  ].filter((button) => button !== null)
  return [
    Text({ dimColor: true, children: `Open in tracker: ${view.label} · ${openCount} open` }),
    ...rows,
    Box({
      key: 'item-actions',
      flexDirection: isOneRow ? 'row' : 'column',
      children: buttons.map((button, index) =>
        Box({
          flexShrink: 0,
          marginLeft: isOneRow && index > 0 ? TRACKER_BUTTON_GAP : 0,
          children: [button],
        }),
      ),
    }),
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
    : Text({ dimColor: true, children: 'Add tasks with /board add <text>.' })
}

function summaryText(list: BoardList, work: PaneWork): string {
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
        work.agents.length === 0 ? Text({ dimColor: true, children: 'No agents yet.' }) : null,
      ]
  const header = Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: TASKS_TITLE }),
      Text({
        dimColor: true,
        children: fitted(
          `  ${summaryText(list, work)}`,
          elements.bodyColumns - displayWidth(TASKS_TITLE),
        ),
      }),
    ],
  })
  return Box({
    flexDirection: 'column',
    children: [
      header,
      ...body,
      ...drawAgents(elements, work.agents, layout, work.now),
      Text({ children: ' ' }),
      drawFooter(elements, host, act),
    ],
  })
}
