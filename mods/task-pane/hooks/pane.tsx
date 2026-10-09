import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  PluginOptions,
  RenderElement,
  TextProps,
} from 'claude-code'
import type { TaskPaneList, TaskPaneTask } from '../types'
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
import {
  authorColumn,
  doneCount,
  escaped,
  paneTaskText,
  priorityText,
  type WorkItem,
} from './tasks'
import { cutToWidth, displayWidth, padToWidth } from './width'

export const PANE_ID = 'task-pane'
const PANE_TITLE = 'Tasks'
const ITEMS_GROUP = 'group:items'
const INLINE_ROWS_BEFORE_COLLAPSE = 6
const FRAME_ROWS = 2

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

export type PaneUi = {
  open: (
    id: string,
    title: string,
  ) => Promise<{ isPlaced: true } | { isPlaced: false; reason: string }>
  close: (id: string) => Promise<void>
  isOpen: (id: string) => Promise<boolean>
  toast: (text: string) => void
  log: (text: string) => void
}

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input: ElementConstructor<InputProps> | undefined
  placement: 'dock' | 'inline'
  bodyColumns: number
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

function taskMark(task: TaskPaneTask): string {
  if (task.status === 'completed') return '✓'
  if (task.status === 'in_progress') return '▶'
  return '○'
}

type TextStyle = Omit<TextProps, 'children'>

type Cell = { text: string; style: TextStyle }

type RowAction = { key: string; label: string; onPress: () => void }

type PaneRow = {
  key: string
  cells: readonly Cell[]
  title: string
  titleStyle: TextStyle
  action: RowAction
}

type RowLayout = {
  expanded: ReadonlySet<string>
  toggle: (rowKey: string) => void
}

const MORE_LABEL = '…'
const BUTTON_CHROME = 4
const BUTTON_GAP = 1

function actionWidth(label: string): number {
  return BUTTON_GAP + displayWidth(label) + BUTTON_CHROME
}

function column(texts: readonly string[]): number {
  return Math.max(0, ...texts.map(displayWidth)) + 1
}

function drawRow(elements: PaneElements, row: PaneRow, layout: RowLayout): RenderElement {
  const { Box, Text, Button } = elements
  const leadWidth = row.cells.reduce((sum, cell) => sum + displayWidth(cell.text), 0)
  const room = Math.max(elements.bodyColumns - leadWidth - actionWidth(row.action.label), 0)
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
        children: [
          Text({ ...row.titleStyle, wrap: 'truncate-end', children: shown }),
          isCut
            ? Button({
                key: `more:${row.key}`,
                label: MORE_LABEL,
                plain: true,
                onPress: () => {
                  layout.toggle(row.key)
                },
              })
            : null,
        ],
      }),
      Box({
        flexShrink: 0,
        marginLeft: BUTTON_GAP,
        children: [
          Button({ key: row.action.key, label: row.action.label, onPress: row.action.onPress }),
        ],
      }),
    ],
  })
  if (!isCut || !layout.expanded.has(row.key)) return line
  return Box({
    flexDirection: 'column',
    children: [
      line,
      Box({
        key: `full:${row.key}`,
        paddingLeft: leadWidth,
        children: [Text({ ...row.titleStyle, children: row.title })],
      }),
    ],
  })
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

function drawTasks(
  elements: PaneElements,
  host: TaskHost,
  list: TaskPaneList,
  hidden: number,
  act: Act,
  layout: RowLayout,
): RenderElement[] {
  const shown = hidden > 0 ? list.tasks.filter((task) => task.status !== 'completed') : list.tasks
  const numberWidth = column(shown.map((task) => String(task.id)))
  return shown.map((task) => {
    const isDone = task.status === 'completed'
    const isActive = task.status === 'in_progress'
    const id = String(task.id)
    return drawRow(
      elements,
      {
        key: `task:${id}`,
        cells: [
          { text: `${taskMark(task)} `, style: { color: isDone ? 'success' : undefined } },
          { text: padToWidth(id, numberWidth), style: { dimColor: isDone, bold: isActive } },
          { text: `${authorColumn(task.by)} `, style: { dimColor: true } },
        ],
        title: paneTaskText(task),
        titleStyle: { dimColor: isDone, bold: isActive },
        action: {
          key: `rm:${id}`,
          label: 'rm',
          onPress: () => {
            act(() => personRemove(host, id))
          },
        },
      },
      layout,
    )
  })
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

function drawFooter(
  elements: PaneElements,
  host: TaskHost,
  hidden: number,
  act: Act,
): RenderElement {
  const { Box, Text, Input } = elements
  const hiddenText =
    hidden > 0 ? Text({ dimColor: true, children: `+${String(hidden)} done hidden  ` }) : null
  const entry = Input
    ? Input({
        key: 'add',
        placeholder: 'Add a task',
        submitLabel: 'Add',
        onSubmit: (value) => {
          act(() => personAdd(host, value.trim()))
        },
      })
    : Text({ dimColor: true, children: 'Add tasks with /task add <text>.' })
  return Box({ flexDirection: 'row', children: [hiddenText, entry] })
}

export async function drawPane(
  elements: PaneElements,
  host: TaskHost,
  ui: PaneUi,
): Promise<RenderElement> {
  const { Box, Text } = elements
  const act = actor(ui)
  const list = await readList(host)
  const total = list.tasks.length
  const done = doneCount(list)
  const collapses =
    elements.placement === 'inline' && total + FRAME_ROWS > INLINE_ROWS_BEFORE_COLLAPSE
  const hidden = collapses ? done : 0
  const layout = rowLayout(host, await host.expanded(), act)
  const body =
    total === 0
      ? drawTracker(elements, host, await trackerView(host), act, layout)
      : drawTasks(elements, host, list, hidden, act, layout)
  const summary =
    total === 0 ? 'none in this session yet' : `${String(done)} of ${String(total)} done`
  const header = Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: 'Tasks' }),
      Text({ dimColor: true, children: `  ${summary}` }),
    ],
  })
  return Box({
    flexDirection: 'column',
    children: [header, ...body, Text({ children: ' ' }), drawFooter(elements, host, hidden, act)],
  })
}
