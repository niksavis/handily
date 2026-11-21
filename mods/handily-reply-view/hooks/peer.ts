import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import { shownText } from './markdown'
import { displayWidth, fitted } from './width'

export const MESSAGE_PANE = { id: 'message', title: 'message' } as const
export const DOCK_FROM_COLUMNS = 110
const NAME_CELLS = 20
const NARROW_NAME_CELLS = 12
const NARROW_BELOW_COLUMNS = 60
const BUTTON_CELLS = '[ shown ]'.length
const GAP = '  '
const MARK = '>'
const RULE = '─'
const HINT_TEXT = 'ctrl+o shows the whole message.'
const EMPTY_TEXT = 'No message is shown here yet. Press more on a message row.'

export type PeerMessage = { requestId: string; name: string; lines: string[] }

export type MessageSite = {
  message: PeerMessage | null
  widest: Widest | null
  kept: PeerMessage[]
}

export const KEPT_MESSAGES = 20
const MESSAGE_NUMBER = /^[1-9]\d{0,2}$/
const MESSAGE_COMMAND = '/replies message'

export type MessageSeat = {
  columns: number
  rows: number
  isFullscreen: boolean | undefined
  widest: Widest | null
}

export type MessagePress = 'viewer' | 'hint' | 'unhint'

export type MessagePort = {
  panes: () => Promise<readonly { id: string; isShown: boolean; isPlaced: boolean }[]>
  open: () => Promise<{ isPlaced: boolean }>
  show: (requestId: string) => Promise<void>
  hint: (requestId: string, isHinted: boolean) => Promise<void>
  isHinted: (requestId: string) => Promise<boolean>
}

type PeerElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>

export type PeerRowLook = { columns: number; isShown: boolean; isHinted: boolean }

export function newMessageSite(): MessageSite {
  return { message: null, widest: null, kept: [] }
}

export function keepMessage(site: MessageSite, message: PeerMessage): void {
  const at = site.kept.findIndex((kept) => kept.requestId === message.requestId)
  if (at >= 0) {
    site.kept[at] = message
    return
  }
  const last = site.kept.at(-1)
  if (
    last !== undefined &&
    last.name === message.name &&
    last.lines.join('\n') === message.lines.join('\n')
  ) {
    site.kept[site.kept.length - 1] = message
    return
  }
  site.kept.push(message)
  if (site.kept.length > KEPT_MESSAGES) site.kept.shift()
}

export type MessagePick = { message: PeerMessage; number: number } | { text: string }

export function pickedMessage(site: MessageSite, word: string | undefined): MessagePick {
  const count = site.kept.length
  if (count === 0) {
    return {
      text: `No message from another session is kept yet in this session. ${MESSAGE_COMMAND} shows the last one once it is drawn.`,
    }
  }
  const range = `a number from 1 to ${String(count)}, where 1 is the last message`
  if (word !== undefined && !MESSAGE_NUMBER.test(word)) {
    return { text: `${MESSAGE_COMMAND} takes ${range}, not ${word}.` }
  }
  const number = word === undefined ? 1 : Number(word)
  const message = site.kept[count - number]
  if (message === undefined)
    return { text: `No message ${String(number)} is kept. ${MESSAGE_COMMAND} takes ${range}.` }
  return { message, number }
}

export async function showMessage(
  port: MessagePort,
  site: MessageSite,
  picked: { message: PeerMessage; number: number },
): Promise<string> {
  site.message = picked.message
  await port.show(picked.message.requestId)
  const { isPlaced } = await port.open()
  const which = `Message ${String(picked.number)} of the last ${String(site.kept.length)}, from ${picked.message.name},`
  return isPlaced
    ? `${which} is in the message tab.`
    : `${which} waits for the message tab, which opens when the window has room.`
}

function bodyOf(text: string, name: string): string {
  const prefix = `${name}: `
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}

export function peerMessage(requestId: string, name: string, text: string): PeerMessage {
  const body = bodyOf(text, name).replace(/\s+$/, '')
  const lines = body === '' ? [] : body.split(/\r?\n/).map((line) => shownText(line))
  return { requestId, name: shownText(name), lines }
}

function firstWords(message: PeerMessage): string {
  return (message.lines.find((line) => line.trim() !== '') ?? '').trim()
}

function lineCount(message: PeerMessage): string {
  const count = message.lines.length
  return `${String(count)} ${count === 1 ? 'line' : 'lines'}`
}

function isNarrow(columns: number): boolean {
  return columns < NARROW_BELOW_COLUMNS
}

function shownName(message: PeerMessage, columns: number): string {
  return fitted(message.name, isNarrow(columns) ? NARROW_NAME_CELLS : NAME_CELLS)
}

export function isShortMessage(message: PeerMessage, columns: number): boolean {
  if (message.lines.length > 1) return false
  const row = `${MARK} from ${shownName(message, columns)}${GAP}${firstWords(message)}`
  return displayWidth(row) <= columns
}

function head(elements: PeerElements, name: string): RenderElement[] {
  const { Text } = elements
  return [
    Text({ dimColor: true, children: `${MARK} from ` }),
    Text({ bold: true, color: 'suggestion', children: name }),
  ]
}

function button(elements: PeerElements, look: PeerRowLook, press: () => void): RenderElement {
  return elements.Button({
    key: 'message-fold',
    label: look.isShown || look.isHinted ? 'shown' : 'more',
    dimColor: !(look.isShown || look.isHinted),
    onPress: () => {
      press()
    },
  })
}

function hintLine(elements: PeerElements): RenderElement {
  return elements.Box({
    key: 'message-hint',
    paddingLeft: 2,
    children: elements.Text({ dimColor: true, children: HINT_TEXT }),
  })
}

export function peerRow(
  elements: PeerElements,
  message: PeerMessage,
  look: PeerRowLook,
  press: () => void,
): RenderElement {
  const { Box, Text } = elements
  const name = shownName(message, look.columns)
  const first = firstWords(message)
  if (isShortMessage(message, look.columns)) {
    return Box({
      key: 'message-row',
      children: Text({ children: [...head(elements, name), `${GAP}${first}`] }),
    })
  }
  const count = lineCount(message)
  const spacer = Box({ flexGrow: 1, minWidth: 2 })
  if (isNarrow(look.columns)) {
    const top = Box({
      key: 'message-row',
      flexDirection: 'row',
      children: [
        Text({
          children: [...head(elements, name), Text({ dimColor: true, children: ` · ${count}` })],
        }),
        spacer,
        button(elements, look, press),
      ],
    })
    const words = Box({
      key: 'message-words',
      paddingLeft: 2,
      children: Text({ children: fitted(first, Math.max(look.columns - 2, 1)) }),
    })
    return Box({
      flexDirection: 'column',
      children: [top, words, look.isHinted ? hintLine(elements) : null],
    })
  }
  const used = displayWidth(`${MARK} from ${name}${GAP}${GAP}${count}${GAP}`) + BUTTON_CELLS
  const shown = fitted(first, Math.max(look.columns - used, 1))
  const row = Box({
    key: 'message-row',
    flexDirection: 'row',
    children: [
      Text({
        children: [
          ...head(elements, name),
          `${GAP}${shown}${GAP}`,
          Text({ dimColor: true, children: count }),
        ],
      }),
      spacer,
      button(elements, look, press),
    ],
  })
  return Box({
    flexDirection: 'column',
    children: [row, look.isHinted ? hintLine(elements) : null],
  })
}

export type Widest = { columns: number; rows: number }

export type SeenViewport = { columns: number; rows: number; isFullscreen?: boolean }

export function widestAfter(
  widest: Widest | null,
  viewport: SeenViewport | undefined,
): Widest | null {
  if (viewport?.isFullscreen !== true) return widest
  const isNew =
    widest === null || viewport.rows !== widest.rows || viewport.columns > widest.columns
  return isNew ? { columns: viewport.columns, rows: viewport.rows } : widest
}

export function docksAt(seat: MessageSeat | undefined): boolean {
  if (seat?.isFullscreen !== true) return false
  if (seat.columns >= DOCK_FROM_COLUMNS) return true
  const { widest } = seat
  return (
    widest !== null &&
    widest.columns >= DOCK_FROM_COLUMNS &&
    seat.columns < widest.columns &&
    seat.rows === widest.rows
  )
}

export async function pressMessage(
  port: MessagePort,
  site: MessageSite,
  message: PeerMessage,
  seat: MessageSeat | undefined,
): Promise<MessagePress> {
  const pane = (await port.panes()).find((open) => open.id === MESSAGE_PANE.id)
  if (pane?.isPlaced === true || docksAt(seat)) {
    site.message = message
    await port.show(message.requestId)
    if (pane?.isPlaced === true && pane.isShown) return 'viewer'
    if ((await port.open()).isPlaced) return 'viewer'
  }
  const isHinted = !(await port.isHinted(message.requestId))
  await port.hint(message.requestId, isHinted)
  return isHinted ? 'hint' : 'unhint'
}

export function drawMessagePane(
  elements: PeerElements,
  site: MessageSite,
  bodyColumns: number,
  copy: (surface: RenderSurface) => void,
  body: RenderElement | null = null,
): RenderElement {
  const { Box, Text, Button } = elements
  const { message } = site
  if (message === null) return Box({ children: Text({ dimColor: true, children: EMPTY_TEXT }) })
  const columns = Math.max(bodyColumns, 1)
  const rule = (key: string) =>
    Box({ key, children: Text({ dimColor: true, children: RULE.repeat(columns) }) })
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        key: 'message-head',
        children: Text({
          bold: true,
          wrap: 'truncate-end',
          children: `from ${message.name} · peer session`,
        }),
      }),
      rule('message-top'),
      ...(body === null
        ? message.lines.map((line, index) =>
            Box({
              key: `message-line-${String(index)}`,
              children: Text({ children: line === '' ? ' ' : line }),
            }),
          )
        : [Box({ key: 'message-body', flexDirection: 'column', children: body })]),
      rule('message-bottom'),
      Box({
        key: 'message-buttons',
        flexDirection: 'row',
        children: Button({
          key: 'message-copy',
          label: 'copy',
          hotkey: 'c',
          onPress: (pressed) => {
            copy(pressed.surface)
          },
        }),
      }),
    ],
  })
}
