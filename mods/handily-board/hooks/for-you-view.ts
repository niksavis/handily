import type { RenderElement, TextProps, ThemeKey } from 'claude-code'
import type { BoardList, BoardTask } from '../types'
import { elapsedText } from './activity'
import { wrappedText } from './frame'
import type { PaneElements, RowLayout } from './pane'
import { SIGNALS, type SignalLooks } from './signals'
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

function markOf(
  task: BoardTask,
  signals: SignalLooks,
): { mark: string; color: ThemeKey | undefined } {
  if (task.isWithdrawn === true) return { mark: signals.toDo.mark, color: undefined }
  if (!task.result) return signals.waitsForYou
  return task.result.verb === 'rejected' ? signals.blocked : signals.done
}

function headParts(
  asked: readonly BoardTask[],
  signals: SignalLooks,
): { text: string; style: TextStyle }[] {
  const live = asked.filter((task) => task.isWithdrawn !== true)
  const open = live.filter((task) => !isSettled(task)).length
  const toSend = live.filter((task) => task.result?.isSent === false).length
  const sent = live.filter((task) => task.result?.isSent === true).length
  const parts: { text: string; style: TextStyle }[] = []
  if (open > 0) {
    parts.push({
      text: `${signals.waitsForYou.mark} ${String(open)} open`,
      style: { color: signals.waitsForYou.color },
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
      text: `${signals.done.mark} all ${String(sent)} answered`,
      style: { color: signals.done.color },
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
      ...headParts(asked, elements.signals).map((part) =>
        Text({ ...part.style, children: part.text }),
      ),
    ],
  })
}

function wrappedLines(
  elements: PaneElements,
  text: string,
  room: number,
  style: TextStyle = {},
): RenderElement[] {
  return wrappedText(text, Math.max(room, 1)).map((line) =>
    elements.Text({ ...style, children: line }),
  )
}

function hanging(
  elements: PaneElements,
  key: string,
  head: { parts: readonly RenderElement[]; width: number },
  lines: readonly RenderElement[],
): RenderElement {
  const { Box, Text } = elements
  const [first, ...rest] = lines
  return Box({
    key,
    flexDirection: 'column',
    children: [
      Box({ flexDirection: 'row', children: [...head.parts, ...(first ? [first] : [])] }),
      ...rest.map((line) =>
        Box({ flexDirection: 'row', children: [Text({ children: ' '.repeat(head.width) }), line] }),
      ),
    ],
  })
}

function rowLine(
  elements: PaneElements,
  task: BoardTask,
  idWidth: number,
  view: ForYouView,
): RenderElement {
  const { Text, Button } = elements
  const isWide = elements.bodyColumns >= WIDE_FROM
  const { mark, color } = markOf(task, elements.signals)
  const isDim = task.isWithdrawn === true
  const lead = `${mark} ${String(task.id).padStart(idWidth)} `
  const kind = `${(task.kind ?? 'do').padEnd(KIND_WIDTH)}${isWide ? '  ' : ' '}`
  const room = Math.max(elements.bodyColumns - displayWidth(lead) - displayWidth(kind), 1)
  const [first = '', ...rest] = wrappedText(escaped(task.title), room)
  const head = [
    Text({ color, dimColor: isDim, children: `${mark} ` }),
    Text({ dimColor: isDim, children: `${String(task.id).padStart(idWidth)} ` }),
    Text({ dimColor: true, children: kind }),
  ]
  const button = Button({
    key: `open:${openKey(task.id)}`,
    plain: true,
    onPress: () => {
      view.layout.toggle(openKey(task.id))
    },
    children: [Text({ dimColor: isDim, children: first })],
  })
  return hanging(
    elements,
    `row:for:${String(task.id)}`,
    { parts: head, width: displayWidth(lead) + displayWidth(kind) },
    [button, ...rest.map((line) => Text({ dimColor: isDim, children: line }))],
  )
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
  const lead = `${elements.signals.blocked.mark} ${NOT_SENT} `
  const room = elements.bodyColumns - UNDER_INDENT - displayWidth(lead)
  return hanging(
    elements,
    `note:${String(id)}`,
    {
      parts: [elements.Text({ color: SIGNALS.blocked.color, children: lead })],
      width: displayWidth(lead),
    },
    wrappedLines(elements, note, room),
  )
}

function optionRows(elements: PaneElements, task: BoardTask, view: ForYouView): RenderElement[] {
  const { Box, Button } = elements
  const id = String(task.id)
  const labels = (task.options ?? []).map((option) => escaped(option))
  const room = elements.bodyColumns - UNDER_INDENT
  const pick = (at: number, label: string) =>
    Button({
      key: `for-pick:${id}:${String(at + 1)}`,
      label,
      onPress: () => {
        view.press.pick(task.id, at + 1)
      },
    })
  if (labels.every((label) => displayWidth(label) + BUTTON_CHROME <= room)) {
    return packed(labels, room).map((line, index) =>
      buttonRow(
        elements,
        `options:${id}:${String(index)}`,
        line.map((at) => pick(at, labels[at] ?? '')),
      ),
    )
  }
  return labels.map((label, at) => {
    const number = String(at + 1)
    const width = displayWidth(number) + BUTTON_CHROME + BUTTON_GAP
    return hanging(
      elements,
      `options:${id}:${String(at)}`,
      {
        parts: [
          Box({ flexShrink: 0, children: [pick(at, number)] }),
          elements.Text({ children: ' '.repeat(BUTTON_GAP) }),
        ],
        width,
      },
      wrappedLines(elements, label, room - width),
    )
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
    case 'decide':
      return [...optionRows(elements, task, view), ...notes, reject]
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

const SENT_LEAD = 'sent '
const FILLED_LEAD = 'in your prompt box: '

function sentLine(elements: PaneElements, task: BoardTask, prompt: string): RenderElement {
  const width = displayWidth(SENT_LEAD)
  return hanging(
    elements,
    `sent:${String(task.id)}`,
    { parts: [elements.Text({ color: elements.signals.done.color, children: SENT_LEAD })], width },
    wrappedLines(elements, prompt, elements.bodyColumns - UNDER_INDENT - width),
  )
}

function settledLines(elements: PaneElements, task: BoardTask, view: ForYouView): RenderElement[] {
  const { result } = task
  const note = view.notes.get(task.id)
  const notes = note === undefined ? [] : [noteLine(elements, task.id, note)]
  const prompt = result?.prompt
  if (prompt !== undefined && result?.isFresh === true) {
    return [sentLine(elements, task, prompt), ...notes]
  }
  const room = elements.bodyColumns - UNDER_INDENT
  const filled =
    prompt !== undefined && result?.isSent === false
      ? wrappedLines(elements, `${FILLED_LEAD}${prompt}`, room, { dimColor: true })
      : []
  return [...notes, ...filled, settledLine(elements, task, view)]
}

function openedLines(elements: PaneElements, task: BoardTask, view: ForYouView) {
  const { Text } = elements
  if (!view.layout.expanded.has(openKey(task.id))) return []
  const asked =
    task.askedAt === undefined ? 'asked' : `asked ${elapsedText(view.now - task.askedAt)} ago`
  const by = task.kind === 'decide' ? ' · options by Claude' : ''
  const room = elements.bodyColumns - UNDER_INDENT
  return [
    Text({ dimColor: true, children: fitted(`${asked}${by}`, room) }),
    ...(task.why === undefined
      ? []
      : wrappedLines(elements, escaped(task.why), room, { dimColor: true })),
  ]
}

function withdrawnText(task: BoardTask): string {
  return task.result ? 'withdrawn by Claude · answer sent' : 'withdrawn by Claude'
}

function drawTask(
  elements: PaneElements,
  task: BoardTask,
  idWidth: number,
  view: ForYouView,
): RenderElement {
  const { Box, Text } = elements
  const line = rowLine(elements, task, idWidth, view)
  const under =
    task.isWithdrawn === true
      ? [Text({ dimColor: true, children: withdrawnText(task) })]
      : task.result
        ? settledLines(elements, task, view)
        : openActions(elements, task, view)
  return Box({
    key: `task:for:${String(task.id)}`,
    flexDirection: 'column',
    children: [
      line,
      Box({
        flexDirection: 'column',
        paddingLeft: UNDER_INDENT,
        children: [...openedLines(elements, task, view), ...under],
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
  const isFresh = (task: BoardTask) => task.result?.isFresh === true && task.isWithdrawn !== true
  const fresh = asked.filter(isFresh)
  const sent = asked.filter(
    (task) => task.result?.isSent === true && task.isWithdrawn !== true && !isFresh(task),
  )
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
    ...fresh.map(draw),
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
