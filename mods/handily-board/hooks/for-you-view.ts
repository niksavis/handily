import type { RenderElement, TextProps, ThemeKey } from 'claude-code'
import type { BoardList, BoardTask } from '../types'
import { elapsedText } from './activity'
import type { PaneElements, RowLayout } from './pane'
import { SIGNALS } from './signals'
import { escaped, isForPerson } from './tasks'
import { displayWidth, fitted } from './width'

export const FOR_YOU_GROUP = 'group:for-you'
export const ANSWERED_GROUP = 'group:answered'
const OPEN_SHOWN = 3
const UNDER_INDENT = 4
const KIND_WIDTH = 6
const WIDE_FROM = 36
const BUTTON_CHROME = 4
const BUTTON_GAP = 1
const OPTION_COLUMNS = 20
const PLACEHOLDER_WIDE = 'Your answer'
const PLACEHOLDER_NARROW = 'Answer'
const NOT_SENT = 'not sent:'

export type ForYouPress = {
  done: (id: number) => void
  answer: (id: number, text: string) => void
  pick: (id: number, choice: number) => void
  reject: (id: number, reason: string) => void
  undo: (id: number) => void
  clear: () => void
}

export type ForYouView = {
  list: BoardList
  now: number
  notes: ReadonlyMap<number, string>
  layout: RowLayout
  press: ForYouPress
}

type TextStyle = Omit<TextProps, 'children'>

function rejectKey(id: number): string {
  return `reject:${String(id)}`
}

function openKey(id: number): string {
  return `for:${String(id)}`
}

function isSettled(task: BoardTask): boolean {
  return task.result !== undefined
}

function markOf(task: BoardTask): { mark: string; color: ThemeKey | undefined } {
  if (task.isWithdrawn === true) return { mark: SIGNALS.toDo.mark, color: undefined }
  if (!task.result) return SIGNALS.waitsForYou
  return task.result.verb === 'rejected' ? SIGNALS.blocked : SIGNALS.done
}

function headParts(asked: readonly BoardTask[]): { text: string; style: TextStyle }[] {
  const live = asked.filter((task) => task.isWithdrawn !== true)
  const open = live.filter((task) => !isSettled(task)).length
  const toSend = live.filter((task) => task.result?.isSent === false).length
  const sent = live.filter((task) => task.result?.isSent === true).length
  const parts: { text: string; style: TextStyle }[] = []
  if (open > 0) {
    parts.push({
      text: `${SIGNALS.waitsForYou.mark} ${String(open)} open`,
      style: { color: SIGNALS.waitsForYou.color },
    })
  }
  if (toSend > 0) {
    parts.push({
      text: `${parts.length > 0 ? ' · ' : ''}${String(toSend)} to send`,
      style: { dimColor: true },
    })
  }
  if (parts.length === 0 && sent > 0) {
    parts.push({
      text: `${SIGNALS.done.mark} all ${String(sent)} answered`,
      style: { color: SIGNALS.done.color },
    })
  }
  if (parts.length === 0) parts.push({ text: 'none open', style: { dimColor: true } })
  return parts
}

function drawHead(elements: PaneElements, asked: readonly BoardTask[]): RenderElement {
  const { Box, Text } = elements
  return Box({
    key: 'for-you-head',
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: 'For you' }),
      Text({ children: '  ' }),
      ...headParts(asked).map((part) => Text({ ...part.style, children: part.text })),
    ],
  })
}

function rowLine(
  elements: PaneElements,
  task: BoardTask,
  idWidth: number,
  view: ForYouView,
): { line: RenderElement; isCut: boolean } {
  const { Box, Text, Button } = elements
  const isWide = elements.bodyColumns >= WIDE_FROM
  const { mark, color } = markOf(task)
  const isDim = task.isWithdrawn === true
  const lead = `${mark} ${String(task.id).padStart(idWidth)} `
  const kind = `${(task.kind ?? 'do').padEnd(KIND_WIDTH)}${isWide ? '  ' : ' '}`
  const room = Math.max(elements.bodyColumns - displayWidth(lead) - displayWidth(kind), 1)
  const title = escaped(task.title)
  const shown = fitted(title, room)
  return {
    isCut: shown !== title,
    line: Box({
      key: `row:for:${String(task.id)}`,
      flexDirection: 'row',
      children: [
        Text({ color, dimColor: isDim, children: `${mark} ` }),
        Text({ dimColor: isDim, children: `${String(task.id).padStart(idWidth)} ` }),
        Text({ dimColor: true, children: kind }),
        Button({
          key: `open:${openKey(task.id)}`,
          plain: true,
          onPress: () => {
            view.layout.toggle(openKey(task.id))
          },
          children: [Text({ dimColor: isDim, children: shown })],
        }),
      ],
    }),
  }
}

function packed(labels: readonly string[], room: number): number[][] {
  const lines: number[][] = []
  let width = 0
  labels.forEach((label, index) => {
    const cells = displayWidth(label) + BUTTON_CHROME
    const current = lines.at(-1)
    if (current !== undefined && width + BUTTON_GAP + cells <= room) {
      current.push(index)
      width += BUTTON_GAP + cells
      return
    }
    lines.push([index])
    width = cells
  })
  return lines
}

function buttonRow(elements: PaneElements, key: string, buttons: readonly RenderElement[]) {
  const { Box } = elements
  return Box({
    key,
    flexDirection: 'row',
    children: buttons.map((button, index) =>
      Box({ flexShrink: 0, marginLeft: index === 0 ? 0 : BUTTON_GAP, children: [button] }),
    ),
  })
}

function noteLine(elements: PaneElements, id: number, note: string): RenderElement {
  const { Box, Text } = elements
  const lead = `${SIGNALS.blocked.mark} ${NOT_SENT}`
  const room = elements.bodyColumns - UNDER_INDENT - displayWidth(lead) - 1
  return Box({
    key: `note:${String(id)}`,
    flexDirection: 'row',
    children: [
      Text({ color: SIGNALS.blocked.color, children: lead }),
      Text({ children: ` ${fitted(note, Math.max(room, 1))}` }),
    ],
  })
}

function rejectButton(elements: PaneElements, task: BoardTask, view: ForYouView): RenderElement {
  return elements.Button({
    key: `for-reject:${String(task.id)}`,
    label: 'reject',
    onPress: () => {
      view.layout.toggle(rejectKey(task.id))
    },
  })
}

function rejectingLines(
  elements: PaneElements,
  task: BoardTask,
  view: ForYouView,
): RenderElement[] {
  const { Button, Input } = elements
  const id = String(task.id)
  const cancel = Button({
    key: `for-cancel:${id}`,
    label: 'cancel',
    onPress: () => {
      view.layout.toggle(rejectKey(task.id))
    },
  })
  const confirm = Input
    ? Input({
        key: `reason:${id}`,
        placeholder: 'Why? optional',
        submitLabel: 'Reject',
        onSubmit: (value) => {
          view.press.reject(task.id, value)
        },
      })
    : Button({
        key: `for-reject-now:${id}`,
        label: 'Reject',
        onPress: () => {
          view.press.reject(task.id, '')
        },
      })
  return [confirm, cancel]
}

function openActions(elements: PaneElements, task: BoardTask, view: ForYouView): RenderElement[] {
  const { Button, Input, Text } = elements
  const id = String(task.id)
  const note = view.notes.get(task.id)
  const notes = note === undefined ? [] : [noteLine(elements, task.id, note)]
  if (view.layout.expanded.has(rejectKey(task.id))) {
    return [...rejectingLines(elements, task, view), ...notes]
  }
  const reject = rejectButton(elements, task, view)
  switch (task.kind) {
    case 'answer': {
      const placeholder = elements.bodyColumns >= WIDE_FROM ? PLACEHOLDER_WIDE : PLACEHOLDER_NARROW
      const field = Input
        ? Input({
            key: `answer:${id}`,
            placeholder,
            submitLabel: 'Send',
            onSubmit: (value) => {
              view.press.answer(task.id, value)
            },
          })
        : Text({ dimColor: true, children: `answer: /board answer ${id} <text>` })
      return [field, ...notes, reject]
    }
    case 'decide': {
      const labels = (task.options ?? []).map((option) => fitted(escaped(option), OPTION_COLUMNS))
      const room = elements.bodyColumns - UNDER_INDENT
      const lines = packed(labels, room).map((line, index) =>
        buttonRow(
          elements,
          `options:${id}:${String(index)}`,
          line.map((at) =>
            Button({
              key: `for-pick:${id}:${String(at + 1)}`,
              label: labels[at] ?? '',
              onPress: () => {
                view.press.pick(task.id, at + 1)
              },
            }),
          ),
        ),
      )
      return [...lines, ...notes, reject]
    }
    case 'do':
    case undefined: {
      const done = Button({
        key: `for-done:${id}`,
        label: 'done',
        onPress: () => {
          view.press.done(task.id)
        },
      })
      return [buttonRow(elements, `actions:${id}`, [done, reject]), ...notes]
    }
  }
}

function resultParts(task: BoardTask): { text: string; style: TextStyle }[] {
  const { result } = task
  if (!result) return []
  const text = result.text === null ? '' : `"${escaped(result.text)}"`
  switch (result.verb) {
    case 'done':
      return [{ text: 'done', style: {} }]
    case 'answered':
      return [{ text, style: { bold: true } }]
    case 'chose':
      return [{ text: `chose ${text}`, style: {} }]
    case 'rejected':
      return [
        { text: 'rejected', style: { color: SIGNALS.blocked.color } },
        ...(text === '' ? [] : [{ text: `: ${text}`, style: {} }]),
      ]
  }
}

function settledLine(elements: PaneElements, task: BoardTask, view: ForYouView): RenderElement {
  const { Box, Text, Button } = elements
  const id = String(task.id)
  const isToSend = task.result?.isSent === false
  const parts = [...resultParts(task), ...(isToSend ? [{ text: ', to send', style: {} }] : [])]
  const undoWidth = isToSend ? 'undo'.length + BUTTON_CHROME + BUTTON_GAP : 0
  let room = elements.bodyColumns - UNDER_INDENT - undoWidth
  const shown = parts.flatMap((part) => {
    if (room <= 0) return []
    const text = fitted(part.text, room)
    room -= displayWidth(text)
    return [Text({ ...part.style, children: text })]
  })
  return Box({
    key: `result:${id}`,
    flexDirection: 'row',
    children: [
      Box({ flexDirection: 'row', flexGrow: 1, flexShrink: 1, children: shown }),
      isToSend
        ? Box({
            flexShrink: 0,
            marginLeft: BUTTON_GAP,
            children: [
              Button({
                key: `for-undo:${id}`,
                label: 'undo',
                onPress: () => {
                  view.press.undo(task.id)
                },
              }),
            ],
          })
        : null,
    ],
  })
}

function openedLines(elements: PaneElements, task: BoardTask, view: ForYouView, isCut: boolean) {
  const { Text } = elements
  if (!view.layout.expanded.has(openKey(task.id))) return []
  const asked =
    task.askedAt === undefined ? 'asked' : `asked ${elapsedText(view.now - task.askedAt)} ago`
  const by = task.kind === 'decide' ? ' · options by Claude' : ''
  return [
    isCut ? Text({ children: escaped(task.title) }) : null,
    Text({ dimColor: true, children: `${asked}${by}` }),
    task.why === undefined ? null : Text({ dimColor: true, children: escaped(task.why) }),
  ].filter((line) => line !== null)
}

function drawTask(
  elements: PaneElements,
  task: BoardTask,
  idWidth: number,
  view: ForYouView,
): RenderElement {
  const { Box, Text } = elements
  const { line, isCut } = rowLine(elements, task, idWidth, view)
  const under =
    task.isWithdrawn === true
      ? [Text({ dimColor: true, children: 'withdrawn by Claude' })]
      : task.result
        ? [settledLine(elements, task, view)]
        : openActions(elements, task, view)
  return Box({
    key: `task:for:${String(task.id)}`,
    flexDirection: 'column',
    children: [
      line,
      Box({
        flexDirection: 'column',
        paddingLeft: UNDER_INDENT,
        children: [...openedLines(elements, task, view, isCut), ...under],
      }),
    ],
  })
}

export function drawForYou(elements: PaneElements, view: ForYouView): RenderElement[] {
  const { Text, Button } = elements
  const asked = view.list.tasks.filter(isForPerson)
  if (asked.length === 0) return []
  const idWidth = Math.max(...asked.map((task) => String(task.id).length))
  const open = asked.filter((task) => !isSettled(task) && task.isWithdrawn !== true)
  const toSend = asked.filter((task) => task.result?.isSent === false)
  const withdrawn = asked.filter((task) => task.isWithdrawn === true)
  const sent = asked.filter((task) => task.result?.isSent === true)
  const isAllOpenShown = view.layout.expanded.has(FOR_YOU_GROUP) || open.length <= OPEN_SHOWN
  const shownOpen = isAllOpenShown ? open : open.slice(0, OPEN_SHOWN)
  const isSentShown = view.layout.expanded.has(ANSWERED_GROUP)
  const draw = (task: BoardTask) => drawTask(elements, task, idWidth, view)
  const sentCount = String(sent.length)
  return [
    drawHead(elements, asked),
    ...shownOpen.map(draw),
    open.length > OPEN_SHOWN
      ? Button({
          key: 'for-more',
          label: isAllOpenShown
            ? `first ${String(OPEN_SHOWN)} for you`
            : `+${String(open.length - OPEN_SHOWN)} more for you`,
          onPress: () => {
            view.layout.toggle(FOR_YOU_GROUP)
          },
        })
      : null,
    ...toSend.map(draw),
    ...withdrawn.map(draw),
    toSend.length > 0
      ? Text({
          dimColor: true,
          children: fitted('Claude gets them with your next prompt.', elements.bodyColumns),
        })
      : null,
    sent.length > 0
      ? Button({
          key: 'for-answered',
          label: isSentShown ? `hide ${sentCount} answered` : `+${sentCount} answered`,
          onPress: () => {
            view.layout.toggle(ANSWERED_GROUP)
          },
        })
      : null,
    ...(isSentShown ? sent.map(draw) : []),
    isSentShown && sent.length > 0
      ? Button({ key: 'for-clear', label: 'clear done', onPress: view.press.clear })
      : null,
    Text({ dimColor: true, children: '─'.repeat(elements.bodyColumns) }),
  ].filter((element) => element !== null)
}
