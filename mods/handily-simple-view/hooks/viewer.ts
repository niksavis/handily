import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import { callBody, KIND_WORDS, type BodyBlock } from './call-body'
import { plural, type CallOutput } from './fold'
import { shownLine } from './shown'
import { displayWidth, fitted } from './width'
import { plainLine, wrappedLine, type Span, type StyledLine } from './wrap'

export const VIEWER_PANE = { id: 'call', title: 'call' } as const
export const DOCK_FROM_COLUMNS = 110
const RULE = '─'
const EMPTY_TEXT =
  'No call is shown here. Press more on a tool row, or run /simple open. /simple close closes this tab.'
const UNREAD_TEXT = 'The saved output could not be read.'
const BODY_NODES_AT_MOST = 12_000
const LEAF_NODES = 2

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

export type PressOutcome = 'viewer' | 'cleared' | 'hint' | 'unhint'

export type OpenOutcome = { isPlaced: true } | { isPlaced: false; reason: string }

export type ViewerPort = {
  panes: () => Promise<readonly { id: string; isShown: boolean; isPlaced: boolean }[]>
  open: () => Promise<OpenOutcome>
  read: (path: string) => Promise<string>
  show: (toolUseId: string) => Promise<void>
  viewing: () => Promise<string | null>
  clear: () => Promise<void>
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

export function clearViewer(site: ViewerSite): void {
  site.call = null
  site.unread = null
}

async function clearShown(port: ViewerPort, site: ViewerSite, toolUseId: string): Promise<void> {
  clearViewer(site)
  await port.clear()
  if (await port.isHinted(toolUseId)) await port.hint(toolUseId, false)
}

export async function pressMore(
  port: ViewerPort,
  site: ViewerSite,
  call: ViewedCall,
  seat: Seat | undefined,
): Promise<PressOutcome> {
  const pane = (await port.panes()).find((open) => open.id === VIEWER_PANE.id)
  const isOnShow = pane?.isPlaced === true && pane.isShown
  if (isOnShow && (await port.viewing()) === call.toolUseId) {
    await clearShown(port, site, call.toolUseId)
    return 'cleared'
  }
  if (pane?.isPlaced === true || docksAt(seat)) {
    if ((await showInViewer(port, site, call)).isPlaced) return 'viewer'
  }
  const isHinted = !(await port.isHinted(call.toolUseId))
  await port.hint(call.toolUseId, isHinted)
  return isHinted ? 'hint' : 'unhint'
}

export type ViewerElements = Pick<
  Elements[RenderSurface],
  'Box' | 'Text' | 'Button' | 'Code' | 'Markdown'
>

export type ViewerActions = {
  copy: (surface: RenderSurface) => void
  previous: (() => void) | null
  next: (() => void) | null
}

function spanText(elements: ViewerElements, span: Span): RenderElement {
  return elements.Text({
    ...(span.color === undefined ? {} : { color: span.color }),
    ...(span.isBold === true ? { bold: true } : {}),
    ...(span.isDim === true ? { dimColor: true } : {}),
    children: span.text,
  })
}

function rowText(elements: ViewerElements, row: StyledLine): RenderElement {
  const [only] = row
  if (only === undefined) return elements.Text({ dimColor: false, children: ' ' })
  if (row.length === 1 && only.color === undefined && only.isBold !== true) {
    return elements.Text({
      dimColor: only.isDim === true,
      children: only.text === '' ? ' ' : only.text,
    })
  }
  return elements.Text({ children: row.map((span) => spanText(elements, span)) })
}

function unreadBlocks(unread: string): BodyBlock[] {
  return [{ kind: 'rows', lines: [plainLine(UNREAD_TEXT), plainLine(shownLine(unread), true)] }]
}

type ViewerBody = { word: string; blocks: BodyBlock[]; left: number }

function bodyBlocks(site: ViewerSite, call: ViewedCall, surface: RenderSurface): ViewerBody {
  if (site.unread !== null) return { word: '', blocks: unreadBlocks(site.unread), left: 0 }
  const body = callBody(call.command, call.output.lines, surface)
  return { word: KIND_WORDS[body.kind], blocks: body.blocks, left: body.left }
}

function rowNodes(row: StyledLine): number {
  return row.length <= 1 ? 3 : 2 + 2 * row.length
}

function blockLines(block: BodyBlock): number {
  if (block.kind === 'rows') return block.lines.length
  return (block.kind === 'code' ? block.source : block.text).split('\n').length
}

type Placed = { drawn: RenderElement[]; unshown: number }

function leafElement(elements: ViewerElements, block: BodyBlock, key: number): RenderElement {
  if (block.kind === 'code') {
    return elements.Box({
      key: `viewer-code-${String(key)}`,
      children: elements.Code({ source: block.source, path: block.path, format: 'diff' }),
    })
  }
  return elements.Box({
    key: `viewer-markdown-${String(key)}`,
    children: elements.Markdown({ text: block.kind === 'markdown' ? block.text : '' }),
  })
}

function blockElements(
  elements: ViewerElements,
  blocks: readonly BodyBlock[],
  columns: number,
  firstKey = 0,
): Placed {
  const placed: Placed = { drawn: [], unshown: 0 }
  let nodes = 0
  for (const block of blocks) {
    if (nodes > BODY_NODES_AT_MOST) {
      placed.unshown += blockLines(block)
      continue
    }
    if (block.kind !== 'rows') {
      nodes += LEAF_NODES
      placed.drawn.push(leafElement(elements, block, firstKey + placed.drawn.length))
      continue
    }
    for (const [index, line] of block.lines.entries()) {
      const rows = wrappedLine(line, columns)
      const cost = rows.reduce((sum, row) => sum + rowNodes(row), 0)
      if (nodes + cost > BODY_NODES_AT_MOST) {
        nodes = BODY_NODES_AT_MOST + 1
        placed.unshown += block.lines.length - index
        break
      }
      nodes += cost
      for (const row of rows) {
        placed.drawn.push(
          elements.Box({
            key: `viewer-line-${String(firstKey + placed.drawn.length)}`,
            children: rowText(elements, row),
          }),
        )
      }
    }
  }
  return placed
}

function noteLines(left: number, call: ViewedCall): BodyBlock {
  const notes: StyledLine[] = []
  if (left > 0) {
    notes.push(plainLine(`… ${plural(left, 'more line')} not drawn. Copy takes all of them.`, true))
  }
  if (call.output.lines.length === 0) notes.push(plainLine('No output.', true))
  return { kind: 'rows', lines: notes }
}

function bodyElements(
  elements: ViewerElements,
  body: ViewerBody,
  call: ViewedCall,
  columns: number,
): RenderElement[] {
  const placed = blockElements(elements, body.blocks, columns)
  const note = noteLines(body.left + placed.unshown, call)
  return [...placed.drawn, ...blockElements(elements, [note], columns, placed.drawn.length).drawn]
}

function topRule(word: string, columns: number): string {
  if (word === '') return RULE.repeat(columns)
  const head = `${RULE.repeat(2)} ${word} `
  return fitted(head + RULE.repeat(Math.max(columns - displayWidth(head), 0)), columns)
}

export type ViewerSeat = { surface: RenderSurface; bodyColumns: number }

export function drawViewer(
  elements: ViewerElements,
  site: ViewerSite,
  seat: ViewerSeat,
  actions: ViewerActions,
): RenderElement {
  const { Box, Text, Button } = elements
  const { call } = site
  if (call === null) return Box({ children: Text({ dimColor: true, children: EMPTY_TEXT }) })
  const columns = Math.max(seat.bodyColumns, 1)
  const body = bodyBlocks(site, call, seat.surface)
  const rule = (key: string, word: string) =>
    Box({ key, children: Text({ dimColor: true, children: topRule(word, columns) }) })
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
      rule('viewer-top', body.word),
      Box({
        key: 'viewer-body',
        flexDirection: 'column',
        children: bodyElements(elements, body, call, columns),
      }),
      rule('viewer-bottom', ''),
      Box({
        key: 'viewer-count',
        children: Text({ dimColor: true, children: plural(call.output.lines.length, 'line') }),
      }),
      Box({ key: 'viewer-buttons', flexDirection: 'row', gap: 1, children: buttons }),
    ],
  })
}
