import type { RenderElement, RenderSurface, TextProps, ThemeKey } from 'claude-code'
import type { BoardList, BoardResult, BoardResultVerb, BoardTask } from '../types'
import { elapsedText } from './activity'
import { type ChatMark, type ChatView, openText, staleFor } from './chat'
import { isClosedByClaude } from './for-you'
import { wrappedText } from './frame'
import { logTime } from './log'
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
const RECOMMENDED_MARK = '★'
const RECOMMENDED_WORD = 'recommended'
const RECOMMENDED_LEAD = 'recommended: '
const RECOMMENDED_COLOR: ThemeKey = 'suggestion'
const ACCEPT_LABEL = 'accept'
const RECOMMENDED_HOTKEYS = ['6', '7', '8', '9'] as const
const COPY_LABEL = 'copy'

export type ForYouPress = {
  done: (id: number) => void
  answer: (id: number, text: string) => void
  pick: (id: number, choice: number) => void
  reject: (id: number, reason: string) => void
  undo: (id: number) => void
  reopen: (id: number) => void
  keepOpen: (id: number) => void
  unneeded: (id: number) => void
  copy: (text: string, surface: RenderSurface) => Promise<void>
  clear: () => void
}

export type ForYouView = {
  list: BoardList
  now: number
  notes: ReadonlyMap<number, string>
  chat: ChatView
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
      text: `${signals.done.mark} all ${String(sent)} closed`,
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
  const isDim = task.isWithdrawn === true || staleFor(task, view.now, view.chat.kept) !== undefined
  const isOpen = task.result === undefined && !isDim
  const lead = `${mark} ${String(task.id).padStart(idWidth)} `
  const kind = `${(task.kind ?? 'do').padEnd(KIND_WIDTH)}${isWide ? '  ' : ' '}`
  const room = Math.max(elements.bodyColumns - displayWidth(lead) - displayWidth(kind), 1)
  const [first = '', ...rest] = wrappedText(escaped(task.title), room)
  const head = [
    Text({ color, dimColor: task.isWithdrawn === true, children: `${mark} ` }),
    Text({ dimColor: isDim, children: `${String(task.id).padStart(idWidth)} ` }),
    Text({ dimColor: true, children: kind }),
  ]
  const button = Button({
    key: `open:${openKey(task.id)}`,
    plain: true,
    onPress: () => {
      view.layout.toggle(openKey(task.id))
    },
    children: [Text({ bold: isOpen, dimColor: isDim, children: first })],
  })
  return hanging(
    elements,
    `row:for:${String(task.id)}`,
    { parts: head, width: displayWidth(lead) + displayWidth(kind) },
    [button, ...rest.map((line) => Text({ bold: isOpen, dimColor: isDim, children: line }))],
  )
}

function buttonWidth(label: string): number {
  return displayWidth(label) + BUTTON_CHROME
}

function packed(widths: readonly number[], room: number): number[][] {
  const lines: number[][] = []
  let width = 0
  widths.forEach((cells, index) => {
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

function recommendedOption(task: BoardTask): number | undefined {
  const { recommended } = task
  const count = task.options?.length ?? 0
  const isOption = typeof recommended === 'number' && recommended >= 1 && recommended <= count
  return task.kind === 'decide' && isOption ? recommended : undefined
}

function optionOrder(count: number, best: number | undefined): number[] {
  const numbers = Array.from({ length: count }, (_value, at) => at + 1)
  return best === undefined ? numbers : [best, ...numbers.filter((number) => number !== best)]
}

function recommendedAnswer(task: BoardTask): string | undefined {
  const { recommended } = task
  return task.kind === 'answer' && typeof recommended === 'string' ? recommended : undefined
}

function drawsRecommendedButton(task: BoardTask, view: ForYouView): boolean {
  if (view.layout.expanded.has(rejectKey(task.id))) return false
  return recommendedOption(task) !== undefined || recommendedAnswer(task) !== undefined
}

function recommendedHotkeys(
  open: readonly BoardTask[],
  view: ForYouView,
): ReadonlyMap<number, string> {
  const keyed = open.filter((task) => drawsRecommendedButton(task, view))
  return new Map(
    keyed.flatMap((task, index) => {
      const hotkey = RECOMMENDED_HOTKEYS[index]
      return hotkey === undefined ? [] : [[task.id, hotkey] as const]
    }),
  )
}

function hotkeyLead(hotkey: string | undefined): string {
  return hotkey === undefined ? '' : `${hotkey}: `
}

function hotkeyProp(hotkey: string | undefined): { hotkey?: string } {
  return hotkey === undefined ? {} : { hotkey }
}

function optionRows(
  elements: PaneElements,
  task: BoardTask,
  view: ForYouView,
  hotkey: string | undefined,
): RenderElement[] {
  const { Box, Button, Text } = elements
  const id = String(task.id)
  const labels = (task.options ?? []).map((option) => escaped(option))
  const best = recommendedOption(task)
  const order = optionOrder(labels.length, best)
  const room = elements.bodyColumns - UNDER_INDENT
  const lead = hotkeyLead(hotkey)
  const starred = (label: string) => `${RECOMMENDED_MARK} ${label}`
  const shown = (number: number, label: string) =>
    number === best ? `${lead}${starred(label)}` : label
  const pick = (number: number, label: string) =>
    Button({
      key: `for-pick:${id}:${String(number)}`,
      label: shown(number, label),
      ...(number === best
        ? {
            ...hotkeyProp(hotkey),
            children: [
              ...(lead === '' ? [] : [Text({ children: lead })]),
              Text({ color: RECOMMENDED_COLOR, children: starred(label) }),
            ],
          }
        : {}),
      onPress: () => {
        view.press.pick(task.id, number)
      },
    })
  const word = () => Text({ dimColor: true, children: RECOMMENDED_WORD })
  const labelOf = (number: number) => labels[number - 1] ?? ''
  const widths = order.map(
    (number) =>
      buttonWidth(shown(number, labelOf(number))) +
      (number === best ? BUTTON_GAP + displayWidth(RECOMMENDED_WORD) : 0),
  )
  if (widths.every((width) => width <= room)) {
    return packed(widths, room).map((line, index) =>
      buttonRow(
        elements,
        `options:${id}:${String(index)}`,
        line.flatMap((at) => {
          const number = order[at] ?? 0
          const button = pick(number, labelOf(number))
          return number === best ? [button, word()] : [button]
        }),
      ),
    )
  }
  return order.map((number) => {
    const width = buttonWidth(shown(number, String(number))) + BUTTON_GAP
    const lines = wrappedLines(elements, labelOf(number), room - width)
    const words =
      number === best
        ? wrappedLines(elements, RECOMMENDED_WORD, room - width, { dimColor: true })
        : []
    return hanging(
      elements,
      `options:${id}:${String(number - 1)}`,
      {
        parts: [
          Box({ flexShrink: 0, children: [pick(number, String(number))] }),
          elements.Text({ children: ' '.repeat(BUTTON_GAP) }),
        ],
        width,
      },
      [...lines, ...words],
    )
  })
}

function recommendedAnswerLines(
  elements: PaneElements,
  task: BoardTask,
  view: ForYouView,
  hotkey: string | undefined,
): RenderElement[] {
  const recommended = recommendedAnswer(task)
  if (recommended === undefined) return []
  const { Box, Button, Text } = elements
  const id = String(task.id)
  const text = `"${escaped(recommended)}"`
  const acceptLabel = `${hotkeyLead(hotkey)}${ACCEPT_LABEL}`
  const accept = Button({
    key: `for-accept:${id}`,
    label: acceptLabel,
    ...hotkeyProp(hotkey),
    onPress: () => {
      view.press.answer(task.id, recommended)
    },
  })
  const room = elements.bodyColumns - UNDER_INDENT
  const lead = Text({ dimColor: true, children: RECOMMENDED_LEAD })
  const leadWidth = displayWidth(RECOMMENDED_LEAD)
  const fits = leadWidth + displayWidth(text) + BUTTON_GAP + buttonWidth(acceptLabel) <= room
  if (fits) {
    return [
      Box({
        key: `recommended:${id}`,
        flexDirection: 'row',
        children: [
          lead,
          Text({ color: RECOMMENDED_COLOR, children: text }),
          Box({ flexShrink: 0, marginLeft: BUTTON_GAP, children: [accept] }),
        ],
      }),
    ]
  }
  return [
    hanging(
      elements,
      `recommended:${id}`,
      { parts: [lead], width: leadWidth },
      wrappedLines(elements, text, room - leadWidth, { color: RECOMMENDED_COLOR }),
    ),
    buttonRow(elements, `accept:${id}`, [accept]),
  ]
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

function openActions(
  elements: PaneElements,
  task: BoardTask,
  view: ForYouView,
  hotkey: string | undefined,
): RenderElement[] {
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
      return [...recommendedAnswerLines(elements, task, view, hotkey), field, ...notes, reject]
    }
    case 'decide':
      return [...optionRows(elements, task, view, hotkey), ...notes, reject]
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

const TO_SEND = ' · to send'

const PERSON_PHRASES: Record<BoardResultVerb, string> = {
  done: 'you: done',
  answered: 'you answered',
  chose: 'you chose',
  rejected: 'you rejected',
  dropped: 'you: not needed',
}

function claudePhrase(result: BoardResult): string {
  switch (result.how) {
    case 'not_needed':
      return 'Claude: not needed'
    case 'person_did':
      if (result.verb === 'answered') return 'Claude: you answered'
      if (result.verb === 'chose') return 'Claude: you chose'
      return 'Claude: you did it'
    case 'claude_did':
    case undefined:
      return 'Claude did it'
  }
}

function whoPhrase(result: BoardResult): string {
  if (result.by === 'claude') return claudePhrase(result)
  const phrase = PERSON_PHRASES[result.verb]
  return result.isSent ? phrase : `${phrase}${TO_SEND}`
}

function valueText(result: BoardResult): string | undefined {
  if (result.text === null || result.verb === 'done') return undefined
  return `"${escaped(result.text)}"`
}

function remarkText(result: BoardResult): string | undefined {
  if (result.by !== 'claude') return undefined
  if (result.how === 'person_did') {
    return result.said === undefined ? undefined : `you said: "${escaped(result.said)}"`
  }
  return result.note === undefined ? undefined : escaped(result.note)
}

function actionButton(
  elements: PaneElements,
  task: BoardTask,
  view: ForYouView,
): { button: RenderElement; label: string } | undefined {
  const id = String(task.id)
  if (isClosedByClaude(task)) {
    const label = 'reopen'
    const button = elements.Button({
      key: `for-reopen:${id}`,
      label,
      onPress: () => {
        view.press.reopen(task.id)
      },
    })
    return { button, label }
  }
  if (task.result?.isSent !== false) return undefined
  const label = 'undo'
  const button = elements.Button({
    key: `for-undo:${id}`,
    label,
    onPress: () => {
      view.press.undo(task.id)
    },
  })
  return { button, label }
}

function whoLine(
  elements: PaneElements,
  task: BoardTask,
  result: BoardResult,
  view: ForYouView,
): RenderElement {
  const { Box, Text } = elements
  const key = `result:${String(task.id)}`
  const phrase = whoPhrase(result)
  const style: TextStyle = result.verb === 'rejected' ? { color: SIGNALS.blocked.color } : {}
  const room = elements.bodyColumns - UNDER_INDENT
  const action = actionButton(elements, task, view)
  const buttonWidth = action === undefined ? 0 : action.label.length + BUTTON_CHROME + BUTTON_GAP
  if (action !== undefined && displayWidth(phrase) + buttonWidth <= room) {
    return Box({
      key,
      flexDirection: 'row',
      children: [
        Box({
          flexDirection: 'row',
          flexGrow: 1,
          flexShrink: 1,
          children: [Text({ ...style, children: phrase })],
        }),
        Box({ flexShrink: 0, marginLeft: BUTTON_GAP, children: [action.button] }),
      ],
    })
  }
  return Box({
    key,
    flexDirection: 'column',
    children: [
      ...wrappedLines(elements, phrase, room, style),
      ...(action === undefined ? [] : [Box({ flexDirection: 'row', children: [action.button] })]),
    ],
  })
}

function closedLines(
  elements: PaneElements,
  task: BoardTask,
  result: BoardResult,
  view: ForYouView,
): RenderElement[] {
  const room = elements.bodyColumns - UNDER_INDENT
  const value = valueText(result)
  const remark = remarkText(result)
  const valueStyle: TextStyle = result.verb === 'rejected' ? {} : { bold: true }
  return [
    whoLine(elements, task, result, view),
    ...(value === undefined ? [] : wrappedLines(elements, value, room, valueStyle)),
    ...(remark === undefined ? [] : wrappedLines(elements, remark, room, { dimColor: true })),
  ]
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
  if (!result) return []
  const note = result.isSent ? undefined : view.notes.get(task.id)
  const notes = note === undefined ? [] : [noteLine(elements, task.id, note)]
  const { prompt } = result
  if (prompt !== undefined && result.isFresh === true) {
    return [sentLine(elements, task, prompt), ...notes]
  }
  const room = elements.bodyColumns - UNDER_INDENT
  const filled =
    prompt !== undefined && !result.isSent
      ? wrappedLines(elements, `${FILLED_LEAD}${prompt}`, room, { dimColor: true })
      : []
  return [...notes, ...filled, ...closedLines(elements, task, result, view)]
}

function openedLines(elements: PaneElements, task: BoardTask, view: ForYouView) {
  if (!view.layout.expanded.has(openKey(task.id))) return []
  const asked =
    task.askedAt === undefined ? 'asked' : `asked ${elapsedText(view.now - task.askedAt)} ago`
  const by = task.kind === 'decide' ? ' · options by Claude' : ''
  const room = elements.bodyColumns - UNDER_INDENT
  return [
    ...wrappedLines(elements, `${asked}${by}`, room, { dimColor: true }),
    ...(task.why === undefined
      ? []
      : wrappedLines(elements, escaped(task.why), room, { dimColor: true })),
    ...commandRows(elements, task, view),
  ]
}

function commandRows(elements: PaneElements, task: BoardTask, view: ForYouView): RenderElement[] {
  if (task.kind !== 'do' || task.commands === undefined) return []
  const { Box, Button, Text } = elements
  const id = String(task.id)
  const room = elements.bodyColumns - UNDER_INDENT - BUTTON_GAP - displayWidth(COPY_LABEL)
  return task.commands.map((line, index) =>
    Box({
      key: `command:${id}:${String(index)}`,
      flexDirection: 'row',
      children: [
        Box({
          flexDirection: 'row',
          flexGrow: 1,
          flexShrink: 1,
          children: [
            Text({
              dimColor: true,
              mono: true,
              children: fitted(escaped(line), Math.max(room, 1)),
            }),
          ],
        }),
        Box({
          flexShrink: 0,
          marginLeft: BUTTON_GAP,
          children: [
            Button({
              key: `copy:${id}:${String(index)}`,
              label: COPY_LABEL,
              plain: true,
              onPress: (press) => view.press.copy(line, press.surface),
            }),
          ],
        }),
      ],
    }),
  )
}

type Labelled = { button: RenderElement; label: string }

function besideButtons(
  elements: PaneElements,
  key: string,
  text: string,
  buttons: readonly Labelled[],
): RenderElement[] {
  const { Box, Text } = elements
  const room = elements.bodyColumns - UNDER_INDENT
  const style: TextStyle = { dimColor: true }
  const width = buttons.reduce(
    (sum, one) => sum + BUTTON_GAP + displayWidth(one.label) + BUTTON_CHROME,
    0,
  )
  if (displayWidth(text) + width <= room) {
    return [
      Box({
        key,
        flexDirection: 'row',
        children: [
          Box({
            flexDirection: 'row',
            flexGrow: 1,
            flexShrink: 1,
            children: [Text({ ...style, children: text })],
          }),
          ...buttons.map((one) =>
            Box({ flexShrink: 0, marginLeft: BUTTON_GAP, children: [one.button] }),
          ),
        ],
      }),
    ]
  }
  const lines = packed(
    buttons.map((one) => buttonWidth(one.label)),
    room,
  )
  return [
    ...wrappedLines(elements, text, room, style),
    ...lines.map((line, index) =>
      buttonRow(
        elements,
        `${key}:${String(index)}`,
        line.flatMap((at) => buttons[at]?.button ?? []),
      ),
    ),
  ]
}

function closeLabel(elements: PaneElements, task: BoardTask, mark: ChatMark): string {
  const option = escaped(task.options?.[mark.option - 1] ?? String(mark.option))
  const label = `close as ${option}`
  const room = elements.bodyColumns - UNDER_INDENT
  return displayWidth(label) + BUTTON_CHROME <= room ? label : `close as ${String(mark.option)}`
}

function chatLines(elements: PaneElements, task: BoardTask, view: ForYouView): RenderElement[] {
  const mark = view.chat.marks.get(task.id)
  if (mark === undefined || task.kind !== 'decide') return []
  const id = String(task.id)
  const closeAs = closeLabel(elements, task, mark)
  const close = elements.Button({
    key: `for-chat-close:${id}`,
    label: closeAs,
    onPress: () => {
      view.press.pick(task.id, mark.option)
    },
  })
  const keepLabel = 'still open'
  const keep = elements.Button({
    key: `for-chat-open:${id}`,
    label: keepLabel,
    onPress: () => {
      view.press.keepOpen(task.id)
    },
  })
  const text = `answered in chat? you said "${escaped(mark.said)}" · ${logTime(mark.at, false)}`
  return besideButtons(elements, `chat:${id}`, text, [
    { button: close, label: closeAs },
    { button: keep, label: keepLabel },
  ])
}

function staleLines(elements: PaneElements, task: BoardTask, view: ForYouView): RenderElement[] {
  const open = staleFor(task, view.now, view.chat.kept)
  if (open === undefined) return []
  const id = String(task.id)
  const label = 'not needed'
  const button = elements.Button({
    key: `for-unneeded:${id}`,
    label,
    onPress: () => {
      view.press.unneeded(task.id)
    },
  })
  const text = `open ${openText(open)} · still needed?`
  return besideButtons(elements, `stale:${id}`, text, [{ button, label }])
}

function withdrawnText(task: BoardTask): string {
  return task.result ? 'withdrawn by Claude · answer sent' : 'withdrawn by Claude'
}

function drawTask(
  elements: PaneElements,
  task: BoardTask,
  idWidth: number,
  view: ForYouView,
  hotkey: string | undefined,
): RenderElement {
  const { Box, Text } = elements
  const line = rowLine(elements, task, idWidth, view)
  const under =
    task.isWithdrawn === true
      ? [Text({ dimColor: true, children: withdrawnText(task) })]
      : task.result
        ? settledLines(elements, task, view)
        : [
            ...chatLines(elements, task, view),
            ...staleLines(elements, task, view),
            ...openActions(elements, task, view, hotkey),
          ]
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
  const hotkeys = recommendedHotkeys(shownOpen, view)
  const draw = (task: BoardTask) => drawTask(elements, task, idWidth, view, hotkeys.get(task.id))
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
    ...(toSend.length > 0
      ? wrappedLines(elements, 'Claude gets them with your next prompt.', elements.bodyColumns, {
          dimColor: true,
        })
      : []),
    sent.length > 0
      ? Button({
          key: 'for-answered',
          label: isSentShown ? `hide ${sentCount} closed` : `+${sentCount} closed`,
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
