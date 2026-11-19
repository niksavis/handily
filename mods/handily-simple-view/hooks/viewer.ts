import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import { DRAWN_CHARACTERS_AT_MOST, plural, type CallOutput } from './fold'
import { shownLine } from './shown'
import { fitted } from './width'

export const VIEWER_PANE = { id: 'call', title: 'call' } as const
export const DOCK_FROM_COLUMNS = 110
const RULE = '─'
const EMPTY_TEXT = 'No call is shown here yet. Press more on a tool row, or run /simple open.'
const UNREAD_TEXT = 'The saved output could not be read.'

export type ViewedCall = {
  toolUseId: string
  head: string
  label: string
  command: string | null
  output: CallOutput
  isErrored: boolean
}

export type ViewerSite = { call: ViewedCall | null; unread: string | null }

export type Seat = {
  columns: number
  rows: number
  isFullscreen: boolean | undefined
  widest: Widest | null
}

export type PressOutcome = 'viewer' | 'hint' | 'unhint'

export type OpenOutcome = { isPlaced: true } | { isPlaced: false; reason: string }

export type ViewerPort = {
  panes: () => Promise<readonly { id: string; isShown: boolean; isPlaced: boolean }[]>
  open: () => Promise<OpenOutcome>
  read: (path: string) => Promise<string>
  show: (toolUseId: string) => Promise<void>
  hint: (toolUseId: string, isHinted: boolean) => Promise<void>
  isHinted: (toolUseId: string) => Promise<boolean>
  log: (text: string) => void
}

export function newViewerSite(): ViewerSite {
  return { call: null, unread: null }
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

export function docksAt(seat: Seat | undefined): boolean {
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

async function loaded(port: ViewerPort, call: ViewedCall): Promise<ViewedCall | string> {
  const { savedTo } = call.output
  if (savedTo === null) return call
  try {
    const text = await port.read(savedTo)
    return { ...call, output: { text, lines: text.trimEnd().split(/\r?\n/), savedTo } }
  } catch (error) {
    port.log(`simple-view: the saved output ${savedTo} was not read: ${String(error)}`)
    return savedTo
  }
}

export async function showInViewer(
  port: ViewerPort,
  site: ViewerSite,
  call: ViewedCall,
  isAsked = false,
): Promise<OpenOutcome> {
  const pane = (await port.panes()).find((open) => open.id === VIEWER_PANE.id)
  const read = await loaded(port, call)
  site.call = typeof read === 'string' ? call : read
  site.unread = typeof read === 'string' ? read : null
  await port.show(call.toolUseId)
  if (!isAsked && pane?.isPlaced === true && pane.isShown) return { isPlaced: true }
  return port.open()
}

export async function pressMore(
  port: ViewerPort,
  site: ViewerSite,
  call: ViewedCall,
  seat: Seat | undefined,
): Promise<PressOutcome> {
  const pane = (await port.panes()).find((open) => open.id === VIEWER_PANE.id)
  if (pane?.isPlaced === true || docksAt(seat)) {
    if ((await showInViewer(port, site, call)).isPlaced) return 'viewer'
  }
  const isHinted = !(await port.isHinted(call.toolUseId))
  await port.hint(call.toolUseId, isHinted)
  return isHinted ? 'hint' : 'unhint'
}

export type ViewerElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>

export type ViewerActions = {
  copy: (surface: RenderSurface) => void
  previous: (() => void) | null
  next: (() => void) | null
}

function drawnLines(lines: readonly string[]): string[] {
  const drawn: string[] = []
  let characters = 0
  for (const line of lines) {
    const shown = shownLine(line)
    characters += shown.length + 1
    if (characters > DRAWN_CHARACTERS_AT_MOST) break
    drawn.push(shown)
  }
  return drawn
}

function bodyLines(site: ViewerSite, call: ViewedCall): { text: string; isDim: boolean }[] {
  if (site.unread !== null) {
    return [
      { text: UNREAD_TEXT, isDim: false },
      { text: shownLine(site.unread), isDim: true },
    ]
  }
  const drawn = drawnLines(call.output.lines)
  const left = call.output.lines.length - drawn.length
  const shown = drawn.map((text) => ({ text: text === '' ? ' ' : text, isDim: false }))
  if (left > 0) {
    shown.push({
      text: `… ${plural(left, 'more line')} not drawn. Copy takes all of them.`,
      isDim: true,
    })
  }
  if (call.output.lines.length === 0) shown.push({ text: 'No output.', isDim: true })
  return shown
}

export function drawViewer(
  elements: ViewerElements,
  site: ViewerSite,
  bodyColumns: number,
  actions: ViewerActions,
): RenderElement {
  const { Box, Text, Button } = elements
  const { call } = site
  if (call === null) return Box({ children: Text({ dimColor: true, children: EMPTY_TEXT }) })
  const columns = Math.max(bodyColumns, 1)
  const rule = (key: string) =>
    Box({ key, children: Text({ dimColor: true, children: RULE.repeat(columns) }) })
  const buttons = [
    Button({
      key: 'viewer-copy',
      label: 'copy',
      hotkey: 'c',
      onPress: (press) => {
        actions.copy(press.surface)
      },
    }),
    actions.previous === null
      ? null
      : Button({
          key: 'viewer-previous',
          label: '< error',
          hotkey: 'p',
          onPress: () => {
            actions.previous?.()
          },
        }),
    actions.next === null
      ? null
      : Button({
          key: 'viewer-next',
          label: 'error >',
          hotkey: 'n',
          onPress: () => {
            actions.next?.()
          },
        }),
  ]
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        key: 'viewer-head',
        children: Text({ bold: true, wrap: 'truncate-end', children: fitted(call.head, columns) }),
      }),
      call.label === ''
        ? null
        : Box({
            key: 'viewer-label',
            children: Text({ wrap: 'truncate-end', children: call.label }),
          }),
      call.command === null
        ? null
        : Box({
            key: 'viewer-command',
            children: Text({
              dimColor: true,
              wrap: 'truncate-end',
              children: `$ ${shownLine(call.command.split(/\r?\n/)[0] ?? '')}`,
            }),
          }),
      rule('viewer-top'),
      Box({
        key: 'viewer-body',
        flexDirection: 'column',
        children: bodyLines(site, call).map((line, index) =>
          Box({
            key: `viewer-line-${String(index)}`,
            children: Text({ dimColor: line.isDim, children: line.text }),
          }),
        ),
      }),
      rule('viewer-bottom'),
      Box({
        key: 'viewer-count',
        children: Text({ dimColor: true, children: plural(call.output.lines.length, 'line') }),
      }),
      Box({ key: 'viewer-buttons', flexDirection: 'row', gap: 1, children: buttons }),
    ],
  })
}
