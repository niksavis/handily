import { shownLabel, tooWide, widestLabel } from './flowchart'
import { plainLabel, type Ink, type InkedDrawing, type InkRun, type Label } from './ink'
import {
  doesNotParse,
  lineFault,
  notDrawnYet,
  refuseOverLimits,
  textLines,
  type Refusal,
  type Statement,
} from './mermaid'
import { drawnOutline, inkedLine, part, withLooks, wrappedLabel, type Part } from './outline'
import { sectionLine } from './timeline'
import { displayWidth } from './width'

export type KanbanCard = {
  label: string[]
  priority: string | null
  ticket: string | null
  assigned: string | null
}

export type KanbanColumn = { label: string[]; cards: KanbanCard[] }

export type Kanban = { kind: 'kanban'; columns: KanbanColumn[] }

const HEADER = /^kanban/
const DRAWN_HEADER = 'kanban'
const COMMENT = /\s*%%.*$/
const ICON = /^::icon\(/
const CLASS = /^:::/
const META_OPENING = '@{'
const META_CLOSING = '}'
const OPENINGS = ['((', '))', '{{', '(-', '(', '[', ')']
const CLOSINGS = ['))', '((', '}}', '-)', '(-', ')', ']', '(']
const SHAPE_START = /[([{)]/
const BARE_REFUSED = /[\]}]/
const INSIDE_REFUSED = /[()\]}]/
const QUOTED = /^"([^"]*)"$/
const MARKDOWN = /^"`/
const META_ITEM = /^([\w-]+)\s*:\s*(.*)$/
const META_VALUE_REFUSED = /[{}[\]]/
const QUOTED_VALUE = /^(?:"([^"]*)"|'([^']*)')$/
const SHAPE_NAME_REFUSED = /[A-Z_]/
const EMPTY_KANBAN = 'the kanban has no columns'

function splitOutsideQuotes(text: string): string[] {
  const items: string[] = []
  let item = ''
  let quote: string | null = null
  for (const character of text) {
    if (quote === null && (character === '"' || character === "'")) quote = character
    else if (character === quote) quote = null
    if (character === ',' && quote === null) {
      items.push(item.trim())
      item = ''
    } else item += character
  }
  items.push(item.trim())
  return items.filter((entry) => entry !== '')
}

function metadataOf(line: number, inner: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const item of splitOutsideQuotes(inner)) {
    const found = META_ITEM.exec(item)
    const raw = found?.[2]?.trim() ?? ''
    if (found === null || META_VALUE_REFUSED.test(raw)) throw doesNotParse(line)
    const quoted = QUOTED_VALUE.exec(raw)
    values.set(found[1] ?? '', quoted === null ? raw : (quoted[1] ?? quoted[2] ?? ''))
  }
  if (values.has('icon')) throw notDrawnYet(line, 'icons')
  const shape = values.get('shape')
  if (shape !== undefined && SHAPE_NAME_REFUSED.test(shape)) throw doesNotParse(line)
  return values
}

function insideOf(line: number, shaped: string): string {
  const opening = OPENINGS.find((candidate) => shaped.startsWith(candidate))
  const closing = CLOSINGS.find(
    (candidate) =>
      shaped.endsWith(candidate) && shaped.length >= (opening?.length ?? 0) + candidate.length,
  )
  if (opening === undefined || closing === undefined) throw doesNotParse(line)
  const inside = shaped.slice(opening.length, shaped.length - closing.length).trim()
  if (MARKDOWN.test(inside)) throw notDrawnYet(line, 'markdown strings')
  const quoted = QUOTED.exec(inside)
  if (quoted !== null) return quoted[1] ?? ''
  if (inside === '' || INSIDE_REFUSED.test(inside)) throw doesNotParse(line)
  return inside
}

function nodeOf(line: number, text: string): KanbanCard {
  const metaAt = text.indexOf(META_OPENING)
  const head = (metaAt < 0 ? text : text.slice(0, metaAt)).trim()
  const meta = metaAt < 0 ? '' : text.slice(metaAt)
  if (meta !== '' && !meta.includes(META_CLOSING)) {
    throw notDrawnYet(line, 'metadata on more than one line')
  }
  if (meta !== '' && !meta.endsWith(META_CLOSING)) throw doesNotParse(line)
  const values = metadataOf(line, meta.slice(META_OPENING.length, -META_CLOSING.length))
  const shapeAt = head.search(SHAPE_START)
  const id = (shapeAt < 0 ? head : head.slice(0, shapeAt)).trim()
  if (BARE_REFUSED.test(id)) throw doesNotParse(line)
  const label = values.get('label') ?? (shapeAt < 0 ? id : insideOf(line, head.slice(shapeAt)))
  if (label.trim() === '') throw doesNotParse(line)
  return {
    label: textLines(label),
    priority: values.get('priority') ?? null,
    ticket: values.get('ticket') ?? null,
    assigned: values.get('assigned') ?? null,
  }
}

export class KanbanBuilder {
  private columnIndent: number | null = null
  private readonly columns: KanbanColumn[] = []
  private cardCount = 0

  add({ line, text: written, indent }: Statement): void {
    const text = written.replace(COMMENT, '')
    if (text === '' || CLASS.test(text)) return
    if (ICON.test(text)) throw notDrawnYet(line, 'icons')
    const node = nodeOf(line, text)
    this.columnIndent ??= indent
    if (indent < this.columnIndent) {
      throw lineFault(line, `line ${String(line)} stands left of the first column`)
    }
    if (indent === this.columnIndent) {
      this.columns.push({ label: node.label, cards: [] })
      return
    }
    this.cardCount += 1
    this.columns.at(-1)?.cards.push(node)
  }

  build(): Kanban | Refusal {
    if (this.columns.length === 0) {
      return { kind: 'refused', reason: EMPTY_KANBAN, line: null, limit: null }
    }
    refuseOverLimits([['boxes', this.cardCount]])
    return { kind: 'kanban', columns: this.columns }
  }
}

export function kanbanBuilder(header: Statement): KanbanBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (header.text !== DRAWN_HEADER) throw doesNotParse(header.line)
  return new KanbanBuilder()
}

const COLUMN_GAP = 2
const LEAST_BOARD_CARD = 16
const LEAST_STACKED_CARD = 14
const CARD_PADDING = 4
const META_GAP = ' · '
const LINE_INK: Ink = 'line'
const TOP = ['╭', '─', '╮']
const BOTTOM = ['╰', '─', '╯']
const SIDE = '│'

type Lane = { width: number; lines: Part[][] }

function labelsOf(lines: readonly string[]): Label[] {
  const shown = lines.map(shownLabel).filter((line) => line.text.trim() !== '')
  return shown.length === 0 ? [plainLabel('')] : shown
}

function metaItems(card: KanbanCard): string[] {
  return [card.priority, card.ticket, card.assigned].filter(
    (item): item is string => item !== null && item.trim() !== '',
  )
}

function metaLines(card: KanbanCard, width: number): Label[] {
  const lines: string[] = []
  let line = ''
  for (const item of metaItems(card)) {
    const joined = line === '' ? item : `${line}${META_GAP}${item}`
    if (displayWidth(joined) <= width) line = joined
    else {
      if (line !== '') lines.push(line)
      line = item
    }
  }
  if (line !== '') lines.push(line)
  return lines.flatMap((text) => wrappedLabel(shownLabel(text), width))
}

function widthOf(parts: readonly Part[]): number {
  return parts.reduce((sum, entry) => sum + displayWidth(entry.label.text), 0)
}

function padded(parts: readonly Part[], width: number): Part[] {
  const room = width - widthOf(parts)
  return room > 0 ? [...parts, part(' '.repeat(room), 'plain')] : [...parts]
}

function rim(glyphs: readonly string[], width: number): Part[] {
  const [left = '', across = '', right = ''] = glyphs
  return [part(`${left}${across.repeat(width - 2)}${right}`, LINE_INK)]
}

function cardLines(card: KanbanCard, width: number): Part[][] {
  const inner = width - CARD_PADDING
  const text = labelsOf(card.label).flatMap((label) => wrappedLabel(label, inner))
  const rows: Part[][] = [
    ...text.map((label): Part[] => [{ label, ink: 'plain' }]),
    ...metaLines(card, inner).map((label): Part[] => [{ label, ink: LINE_INK }]),
  ]
  return [
    rim(TOP, width),
    ...rows.map((row) => [
      part(`${SIDE} `, LINE_INK),
      ...padded(row, inner),
      part(` ${SIDE}`, LINE_INK),
    ]),
    rim(BOTTOM, width),
  ]
}

function headerLines(column: KanbanColumn, ink: Ink, width: number): Part[][] {
  return labelsOf(column.label)
    .map((label) => withLooks(label, { isBold: true }))
    .flatMap((label) => wrappedLabel(label, width))
    .map((label): Part[] => [{ label, ink }])
}

function laneOf(column: KanbanColumn, ink: Ink, width: number): Lane {
  return {
    width,
    lines: [
      ...headerLines(column, ink, width),
      ...column.cards.flatMap((card) => cardLines(card, width)),
    ],
  }
}

function boardLines(kanban: Kanban, width: number): InkRun[][] | null {
  const count = kanban.columns.length
  const card = Math.floor((width - COLUMN_GAP * (count - 1)) / count)
  if (card < LEAST_BOARD_CARD) return null
  const lanes = kanban.columns.map((column, ink) => laneOf(column, ink, card))
  const rows = Math.max(...lanes.map((lane) => lane.lines.length))
  const gap = part(' '.repeat(COLUMN_GAP), 'plain')
  return Array.from({ length: rows }, (_, row) =>
    inkedLine(
      lanes.flatMap((lane, at) => [
        ...(at === 0 ? [] : [gap]),
        ...padded(lane.lines[row] ?? [], lane.width),
      ]),
    ),
  )
}

function cardWidthOf(kanban: Kanban, width: number): number {
  const cards = kanban.columns.flatMap((column) => column.cards)
  const widest = Math.max(
    0,
    ...cards.map((card) =>
      Math.max(widestLabel(labelsOf(card.label)), displayWidth(metaItems(card).join(META_GAP))),
    ),
  )
  return Math.min(width, Math.max(widest + CARD_PADDING, LEAST_BOARD_CARD))
}

function stackedLines(kanban: Kanban, width: number): InkRun[][] {
  const card = cardWidthOf(kanban, width)
  const rule = Math.max(
    card,
    ...kanban.columns.map((column) => widestLabel(labelsOf(column.label)) + 6),
  )
  return kanban.columns.flatMap((column, ink) => [
    sectionLine(column.label, ink, width, Math.min(rule, width)),
    ...column.cards.flatMap((entry) => cardLines(entry, card)).map((line) => inkedLine(line)),
  ])
}

export function drawKanban(kanban: Kanban, width: number): InkedDrawing | Refusal {
  if (width < LEAST_STACKED_CARD) return tooWide(LEAST_STACKED_CARD, width)
  return drawnOutline(boardLines(kanban, width) ?? stackedLines(kanban, width))
}
