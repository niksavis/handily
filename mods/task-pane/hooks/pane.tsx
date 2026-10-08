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
import { authorColumn, doneCount, priorityText, quoted, taskText, type WorkItem } from './tasks'

export const PANE_ID = 'task-pane'
const PANE_TITLE = 'Tasks'
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

type Act = (work: () => Promise<string>) => void

function actor(ui: PaneUi): Act {
  return (work) => {
    work().then(
      (reply) => {
        ui.toast(reply)
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

function drawTasks(
  elements: PaneElements,
  host: TaskHost,
  list: TaskPaneList,
  hidden: number,
  act: Act,
): RenderElement[] {
  const { Box, Text, Button } = elements
  const shown = hidden > 0 ? list.tasks.filter((task) => task.status !== 'completed') : list.tasks
  return shown.map((task) => {
    const isDone = task.status === 'completed'
    const isActive = task.status === 'in_progress'
    const label = Box({
      flexDirection: 'row',
      flexGrow: 1,
      flexShrink: 1,
      children: [
        Text({ color: isDone ? 'success' : undefined, children: `${taskMark(task)} ` }),
        Text({ dimColor: isDone, bold: isActive, children: `${String(task.id)} ` }),
        Text({ dimColor: true, children: `${authorColumn(task.by)} ` }),
        Text({ dimColor: isDone, bold: isActive, wrap: 'truncate-end', children: taskText(task) }),
      ],
    })
    const remove = Button({
      key: `rm:${String(task.id)}`,
      label: 'rm',
      onPress: () => {
        act(() => personRemove(host, String(task.id)))
      },
    })
    return Box({ flexDirection: 'row', children: [label, remove] })
  })
}

function drawTracker(
  elements: PaneElements,
  host: TaskHost,
  view: TrackerView,
  act: Act,
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
  const count = String(view.items.length)
  const rows = view.items.map((item) =>
    Box({
      flexDirection: 'row',
      children: [
        Box({
          flexDirection: 'row',
          flexGrow: 1,
          flexShrink: 1,
          children: [
            Text({ children: `  ${quoted(item.id)} ` }),
            Text({ dimColor: true, children: `${priorityText(item)} ` }),
            Text({ wrap: 'truncate-end', children: quoted(item.title) }),
          ],
        }),
        Button({
          key: `add:${item.id}`,
          label: 'add',
          onPress: () => {
            addItems([item])
          },
        }),
      ],
    }),
  )
  return [
    Text({
      dimColor: true,
      children: `Open in tracker: ${view.label} · ${String(view.openCount)} open`,
    }),
    ...rows,
    Button({
      key: 'add-all',
      label: view.items.length === 1 ? 'Add 1 as a task' : `Add ${count} as tasks`,
      onPress: () => {
        addItems(view.items)
      },
    }),
  ]
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
  const body =
    total === 0
      ? drawTracker(elements, host, await trackerView(host), act)
      : drawTasks(elements, host, list, hidden, act)
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
