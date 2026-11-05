import {
  ARROW_DOWN,
  ARROW_LEFT,
  ARROW_RIGHT,
  ARROW_UP,
  DECISION_INDENT,
  DECISION_MARK,
  ROUNDED_CORNERS,
  shownLabel,
  SQUARE_CORNERS,
  tooWide,
  widestLabel,
} from './flowchart'
import { plainLabel, prefixed, type Ink, type InkedDrawing, type Label } from './ink'
import {
  Cursor,
  DiagramFault,
  doesNotParse,
  lineFault,
  notDrawnYet,
  refuseOverLimits,
  takeLink,
  takeNodeId,
  takeShape,
  textLines,
  type FlowShape,
  type Refusal,
  type Statement,
  type Stroke,
} from './mermaid'
import { drawnOutline, part, wrappedLabel, type Part } from './outline'
import { Grid } from './sequence'
import { displayWidth } from './width'

export type BlockArrowDirection = 'right' | 'left' | 'up' | 'down' | 'x' | 'y'

export type BlockNode = {
  kind: 'node'
  id: string
  shape: FlowShape
  label: string[]
  span: number
}

export type BlockArrow = {
  kind: 'arrow'
  id: string
  direction: BlockArrowDirection
  label: string[]
  span: number
}

export type BlockSpace = { kind: 'space'; span: number }

export type BlockGroup = {
  kind: 'group'
  id: string
  span: number
  columns: number | null
  children: BlockItem[]
}

export type BlockItem = BlockNode | BlockArrow | BlockSpace | BlockGroup

export type BlockLink = {
  from: string
  to: string
  stroke: Stroke
  arrow: boolean
  label: string[]
}

export type BlockDiagram = { kind: 'block'; root: BlockGroup; links: BlockLink[] }

type Named = BlockNode | BlockArrow | BlockGroup

const HEADER = /^block/
const DRAWN_HEADER = /^block(?:-beta)?$/
const COLUMNS_WORD = /^columns(?:\s|$)/
const COLUMNS = /^columns\s+(?:(auto)|([1-9]\d*))$/
const GROUP_WORD = /^block(?::|$)/
const GROUP_OPENING = /^block(?::([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*))?(?::([1-9]\d*))?$/u
const GROUP_END = 'end'
const AUTOMATIC_GROUP = '#'
const STYLING = /^(?:style|classDef|class)\s/
const SPACE = /space(?::([1-9]\d*))?(?=\s|$)/y
const SPAN = /:([1-9]\d*)/y
const BLOCK_ARROW = /<\[\s*(?:"([^"]*)"|([^\]"]*?))\s*\]>\(\s*([a-z]+)\s*(,\s*[a-z]+\s*)?\)/y
const GAP = /\s+/y
const NO_BREAK_SPACE = /&nbsp;/g
const ARROW_DIRECTIONS: readonly BlockArrowDirection[] = ['right', 'left', 'up', 'down', 'x', 'y']
const EMPTY_DIAGRAM = 'the block diagram has no blocks'
const KEYWORDS: ReadonlySet<string> = new Set(['space', 'block'])

function isNamed(item: BlockItem): item is Named {
  return item.kind !== 'space'
}

function twoDirections(line: number): DiagramFault {
  return notDrawnYet(line, 'a block arrow with two directions')
}

function directionOf(line: number, found: RegExpExecArray): BlockArrowDirection {
  if (found[4] !== undefined) throw twoDirections(line)
  const direction = ARROW_DIRECTIONS.find((known) => known === found[3])
  if (direction === undefined) throw doesNotParse(line)
  return direction
}

function spanFault(item: Named | BlockSpace, columns: number): DiagramFault {
  const what =
    isNamed(item) && !item.id.startsWith(AUTOMATIC_GROUP) ? `block ${item.id}` : 'a block'
  const shown = item.kind === 'space' ? 'a space' : what
  return new DiagramFault({
    kind: 'refused',
    reason: `${shown} spans ${String(item.span)} columns, its row has ${String(columns)}`,
    line: null,
    limit: null,
  })
}

function refuseWideSpans(group: BlockGroup): void {
  const columns = group.columns
  for (const item of group.children) {
    if (columns !== null && item.span > columns) throw spanFault(item, columns)
    if (item.kind === 'group') refuseWideSpans(item)
  }
}

function emptyGroupFault(group: BlockGroup): DiagramFault | null {
  for (const item of group.children) {
    if (item.kind !== 'group') continue
    if (!item.children.some(isNamed)) {
      const name = item.id.startsWith(AUTOMATIC_GROUP) ? 'a group' : `group ${item.id}`
      return new DiagramFault({
        kind: 'refused',
        reason: `${name} has no blocks`,
        line: null,
        limit: null,
      })
    }
    const inner = emptyGroupFault(item)
    if (inner !== null) return inner
  }
  return null
}

function countBoxes(group: BlockGroup): number {
  return group.children.reduce((count, item) => {
    if (item.kind === 'group') return count + countBoxes(item)
    return count + (item.kind === 'space' ? 0 : 1)
  }, 0)
}

export class BlockBuilder {
  private readonly root: BlockGroup = {
    kind: 'group',
    id: '',
    span: 1,
    columns: null,
    children: [],
  }
  private readonly open: { group: BlockGroup; line: number }[] = []
  private readonly named = new Map<string, Named>()
  private readonly links: BlockLink[] = []
  private automatic = 0

  add({ line, text }: Statement): void {
    if (STYLING.test(text)) return
    if (COLUMNS_WORD.test(text)) {
      this.columns(line, text)
      return
    }
    if (text === GROUP_END) {
      if (this.open.pop() === undefined) throw doesNotParse(line)
      return
    }
    if (GROUP_WORD.test(text)) {
      this.openGroup(line, text)
      return
    }
    this.items(new Cursor(text, line))
  }

  build(): BlockDiagram | Refusal {
    const unclosed = this.open.at(0)
    if (unclosed !== undefined) {
      throw lineFault(unclosed.line, `line ${String(unclosed.line)} opens a block with no end`)
    }
    if (countBoxes(this.root) === 0) {
      return { kind: 'refused', reason: EMPTY_DIAGRAM, line: null, limit: null }
    }
    const empty = emptyGroupFault(this.root)
    if (empty !== null) throw empty
    refuseWideSpans(this.root)
    refuseOverLimits([
      ['boxes', countBoxes(this.root)],
      ['edges', this.links.length],
    ])
    return { kind: 'block', root: this.root, links: this.links }
  }

  private get current(): BlockGroup {
    return this.open.at(-1)?.group ?? this.root
  }

  private columns(line: number, text: string): void {
    const found = COLUMNS.exec(text)
    if (found === null) throw doesNotParse(line)
    this.current.columns = found[1] === undefined ? Number(found[2]) : null
  }

  private openGroup(line: number, text: string): void {
    const found = GROUP_OPENING.exec(text)
    if (found === null) throw doesNotParse(line)
    this.automatic += 1
    const id = found[1] ?? `${AUTOMATIC_GROUP}${String(this.automatic)}`
    if (this.named.has(id)) throw doesNotParse(line)
    const group: BlockGroup = {
      kind: 'group',
      id,
      span: Number(found[2] ?? 1),
      columns: null,
      children: [],
    }
    this.current.children.push(group)
    this.named.set(id, group)
    this.open.push({ group, line })
  }

  private items(cursor: Cursor): void {
    do {
      this.item(cursor)
    } while (cursor.take(GAP) !== null)
    if (!cursor.done) throw doesNotParse(cursor.line)
  }

  private item(cursor: Cursor): void {
    const space = cursor.take(SPACE)
    if (space !== null) {
      this.current.children.push({ kind: 'space', span: Number(space[1] ?? 1) })
      return
    }
    let from = this.mention(cursor)
    for (let link = takeLink(cursor); link !== null; link = takeLink(cursor)) {
      const to = this.mention(cursor)
      this.links.push({ from, to, ...link })
      from = to
    }
  }

  private mention(cursor: Cursor): string {
    const id = takeNodeId(cursor)
    if (KEYWORDS.has(id)) throw doesNotParse(cursor.line)
    const item = this.itemOf(cursor, id)
    const span = cursor.take(SPAN)?.[1]
    if (span !== undefined) {
      if (item.kind === 'group') throw doesNotParse(cursor.line)
      item.span = Number(span)
    }
    return id
  }

  private itemOf(cursor: Cursor, id: string): Named {
    const known = this.named.get(id)
    const arrow = cursor.take(BLOCK_ARROW)
    if (arrow !== null) {
      const direction = directionOf(cursor.line, arrow)
      const label = textLines(arrow[1] ?? arrow[2] ?? '')
      if (known === undefined) return this.placed({ kind: 'arrow', id, direction, label, span: 1 })
      if (known.kind !== 'arrow') throw doesNotParse(cursor.line)
      if (known.direction !== direction) throw twoDirections(cursor.line)
      known.label = label
      return known
    }
    const shaped = takeShape(cursor)
    if (known === undefined) {
      return this.placed({
        kind: 'node',
        id,
        shape: shaped?.shape ?? 'box',
        label: shaped?.label ?? [id],
        span: 1,
      })
    }
    if (shaped === null) return known
    if (known.kind !== 'node') throw doesNotParse(cursor.line)
    known.shape = shaped.shape
    known.label = shaped.label
    return known
  }

  private placed(item: BlockNode | BlockArrow): Named {
    this.current.children.push(item)
    this.named.set(item.id, item)
    return item
  }
}

export function blockBuilder(header: Statement): BlockBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (!DRAWN_HEADER.test(header.text)) throw doesNotParse(header.line)
  return new BlockBuilder()
}

const COLUMN_GAP = 2
const COMPACT_COLUMN_GAP = 1
const ROW_GAP = 1
const BOX_PADDING = 4
const FRAME_ROOM = 4
const FRAME_ROWS = 2
const FRAME_INSET = 2
const LEAST_ARROW = 3
const SPACE_ROWS = 1
const LABEL_ROOM = 4
const LABEL_GAP_ROOM = 6
const FRAME_ACROSS = '┄'
const FRAME_DOWN = '┆'
const BORDER_ACROSS = '─'
const BORDER_DOWN = '│'
const PORT_BELOW = '┬'
const PORT_ABOVE = '┴'
const STROKES: Readonly<Record<Stroke, { across: string; down: string }>> = {
  solid: { across: '─', down: '│' },
  dashed: { across: '╌', down: '╎' },
}
const LINE_INK: Ink = 'line'
const HEAD_INK: Ink = 'head'
const LABEL_INK: Ink = 'label'

type Rect = { top: number; left: number; bottom: number; right: number }

type Placed = { item: Named; rect: Rect; lines: Label[]; parents: string[]; ink: Ink }

type Slot = { item: BlockItem; row: number; col: number }

type Layout = { placed: Placed[]; height: number }

class BlockFault extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

function labelsOf(lines: readonly string[]): Label[] {
  return lines
    .map((line) => shownLabel(line.replace(NO_BREAK_SPACE, ' ')))
    .filter((line) => line.text.trim() !== '')
}

function widestWord(labels: readonly Label[]): number {
  return Math.max(0, ...labels.flatMap((label) => label.text.split(' ').map(displayWidth)))
}

function markWidth(node: BlockNode): number {
  return node.shape === 'decision' ? displayWidth(DECISION_MARK) : 0
}

function columnsOf(group: BlockGroup): number {
  return (
    group.columns ??
    Math.max(
      1,
      group.children.reduce((sum, item) => sum + item.span, 0),
    )
  )
}

function slotsOf(group: BlockGroup): Slot[] {
  const columns = columnsOf(group)
  const slots: Slot[] = []
  let row = 0
  let col = 0
  for (const item of group.children) {
    if (col + item.span > columns) {
      row += 1
      col = 0
    }
    slots.push({ item, row, col })
    col += item.span
  }
  return slots
}

function gapsBetween(gaps: readonly number[], from: number, to: number): number {
  return gaps.slice(from, to).reduce((sum, gap) => sum + gap, 0)
}

function spanWidth(slot: Slot, column: number, gaps: readonly number[]): number {
  const { col } = slot
  const { span } = slot.item
  return span * column + gapsBetween(gaps, col, col + span - 1)
}

function linkLabelWidth(link: BlockLink): number {
  return displayWidth(
    labelsOf(link.label)
      .map((label) => label.text)
      .join(' '),
  )
}

function gapsOf(group: BlockGroup, gap: number, links: readonly BlockLink[]): number[] {
  const gaps = Array.from({ length: columnsOf(group) - 1 }, () => gap)
  const slots = slotsOf(group)
  const slotOf = (id: string) => slots.find((slot) => isNamed(slot.item) && slot.item.id === id)
  for (const link of links) {
    const label = linkLabelWidth(link)
    const one = slotOf(link.from)
    const other = slotOf(link.to)
    if (label === 0 || one === undefined || other === undefined || one.row !== other.row) continue
    const [left, right] = one.col < other.col ? [one, other] : [other, one]
    if (left.col + left.item.span !== right.col) continue
    const at = right.col - 1
    gaps[at] = Math.max(gaps[at] ?? gap, label + LABEL_GAP_ROOM)
  }
  return gaps
}

function naturalWidth(item: BlockItem, links: readonly BlockLink[]): number {
  switch (item.kind) {
    case 'node':
      return widestLabel(labelsOf(item.label)) + BOX_PADDING + markWidth(item)
    case 'arrow':
      return Math.max(widestLabel(labelsOf(item.label)), LEAST_ARROW)
    case 'space':
      return 1
    case 'group':
      return FRAME_ROOM + gridWidth(item, links)
  }
}

function gridWidth(group: BlockGroup, links: readonly BlockLink[]): number {
  const gaps = gapsOf(group, COLUMN_GAP, links)
  const column = Math.max(
    1,
    ...slotsOf(group).map((slot) =>
      Math.ceil(
        (naturalWidth(slot.item, links) -
          gapsBetween(gaps, slot.col, slot.col + slot.item.span - 1)) /
          slot.item.span,
      ),
    ),
  )
  return columnsOf(group) * column + gapsBetween(gaps, 0, gaps.length)
}

function leastWidth(item: BlockItem): number {
  switch (item.kind) {
    case 'node':
      return widestWord(labelsOf(item.label)) + BOX_PADDING + markWidth(item)
    case 'arrow':
      return Math.max(widestWord(labelsOf(item.label)), item.direction === 'x' ? 2 : 1)
    case 'space':
      return 1
    case 'group':
      return FRAME_ROOM + 1
  }
}

function wrapped(labels: readonly Label[], room: number): Label[] {
  return labels.flatMap((label) => wrappedLabel(label, room))
}

function nodeLines(node: BlockNode, width: number): Label[] {
  const lines = wrapped(labelsOf(node.label), width - BOX_PADDING - markWidth(node))
  const shown = lines.length === 0 ? [plainLabel('')] : lines
  if (node.shape !== 'decision') return shown
  return shown.map((line, at) => prefixed(at === 0 ? DECISION_MARK : DECISION_INDENT, line))
}

function arrowLines(arrow: BlockArrow, width: number): Label[] {
  return wrapped(labelsOf(arrow.label), width)
}

function arrowGlyphRows(arrow: BlockArrow): number {
  return arrow.direction === 'y' ? 2 : 1
}

function rowsOf(slots: readonly Slot[]): Slot[][] {
  const rows: Slot[][] = []
  for (const slot of slots) {
    const row = rows[slot.row] ?? []
    row.push(slot)
    rows[slot.row] = row
  }
  return rows
}

class Placer {
  readonly placed: Placed[] = []
  private boxes = 0

  constructor(
    private readonly gap: number,
    private readonly links: readonly BlockLink[],
  ) {}

  grid(group: BlockGroup, left: number, top: number, width: number, parents: string[]): number {
    const gaps = gapsOf(group, this.gap, this.links)
    const column = this.columnWidth(group, width, gaps)
    let y = top
    for (const row of rowsOf(slotsOf(group))) {
      const height = this.rowHeight(row, column, gaps)
      for (const slot of row) {
        const x = left + slot.col * column + gapsBetween(gaps, 0, slot.col)
        const rect = {
          top: y,
          left: x,
          bottom: y + height - 1,
          right: x + spanWidth(slot, column, gaps) - 1,
        }
        this.place(slot.item, rect, parents)
      }
      y += height + ROW_GAP
    }
    return y - ROW_GAP - top
  }

  private columnWidth(group: BlockGroup, width: number, gaps: readonly number[]): number {
    const columns = columnsOf(group)
    const column = Math.floor((width - gapsBetween(gaps, 0, gaps.length)) / columns)
    if (column < 1) throw new BlockFault('narrow')
    return column
  }

  private rowHeight(row: readonly Slot[], column: number, gaps: readonly number[]): number {
    return Math.max(...row.map((slot) => this.heightOf(slot.item, spanWidth(slot, column, gaps))))
  }

  private gridHeight(group: BlockGroup, width: number): number {
    const gaps = gapsOf(group, this.gap, this.links)
    const column = this.columnWidth(group, width, gaps)
    const heights = rowsOf(slotsOf(group)).map((row) => this.rowHeight(row, column, gaps))
    return heights.reduce((sum, height) => sum + height, 0) + ROW_GAP * (heights.length - 1)
  }

  private heightOf(item: BlockItem, width: number): number {
    if (width < leastWidth(item)) throw new BlockFault('narrow')
    switch (item.kind) {
      case 'node':
        return nodeLines(item, width).length + 2
      case 'arrow':
        return arrowLines(item, width).length + arrowGlyphRows(item)
      case 'space':
        return SPACE_ROWS
      case 'group':
        return FRAME_ROWS + this.gridHeight(item, width - FRAME_ROOM)
    }
  }

  private place(item: BlockItem, rect: Rect, parents: string[]): void {
    const width = rect.right - rect.left + 1
    switch (item.kind) {
      case 'space':
        return
      case 'node':
        this.placed.push({ item, rect, lines: nodeLines(item, width), parents, ink: this.boxes })
        this.boxes += 1
        return
      case 'arrow':
        this.placed.push({ item, rect, lines: arrowLines(item, width), parents, ink: HEAD_INK })
        return
      case 'group':
        this.placed.push({ item, rect, lines: [], parents, ink: LINE_INK })
        this.grid(item, rect.left + FRAME_INSET, rect.top + 1, width - FRAME_ROOM, [
          ...parents,
          item.id,
        ])
    }
  }
}

function layoutOf(diagram: BlockDiagram, width: number, gap: number): Layout | null {
  try {
    const placer = new Placer(gap, diagram.links)
    const height = placer.grid(diagram.root, 0, 0, width, [])
    return { placed: placer.placed, height }
  } catch (error) {
    if (error instanceof BlockFault) return null
    throw error
  }
}

function drawFrame(grid: Grid, rect: Rect): void {
  const [topLeft, topRight, bottomLeft, bottomRight] = SQUARE_CORNERS
  const across = FRAME_ACROSS.repeat(rect.right - rect.left - 1)
  grid.put(rect.top, rect.left, `${topLeft}${across}${topRight}`, LINE_INK)
  for (let row = rect.top + 1; row < rect.bottom; row++) {
    grid.put(row, rect.left, FRAME_DOWN, LINE_INK)
    grid.put(row, rect.right, FRAME_DOWN, LINE_INK)
  }
  grid.put(rect.bottom, rect.left, `${bottomLeft}${across}${bottomRight}`, LINE_INK)
}

function centered(width: number, room: number): number {
  return Math.floor((room - width) / 2)
}

function drawNode(grid: Grid, placed: Placed, node: BlockNode): void {
  const { rect, lines, ink } = placed
  const [topLeft, topRight, bottomLeft, bottomRight] =
    node.shape === 'decision' ? SQUARE_CORNERS : ROUNDED_CORNERS
  const width = rect.right - rect.left + 1
  const across = BORDER_ACROSS.repeat(width - 2)
  grid.put(rect.top, rect.left, `${topLeft}${across}${topRight}`, ink)
  for (let row = rect.top + 1; row < rect.bottom; row++) {
    grid.put(row, rect.left, BORDER_DOWN, ink)
    grid.put(row, rect.right, BORDER_DOWN, ink)
  }
  grid.put(rect.bottom, rect.left, `${bottomLeft}${across}${bottomRight}`, ink)
  const top = rect.top + 1 + centered(lines.length, rect.bottom - rect.top - 1)
  const left = rect.left + 1 + centered(widestLabel(lines), width - 2)
  lines.forEach((line, at) => {
    grid.putLabel(top + at, left, line, 'plain')
  })
}

function arrowGlyphs(direction: BlockArrowDirection, width: number): Part[][] {
  const head = (glyph: string) => part(glyph, HEAD_INK)
  const shaft = (columns: number) => part(BORDER_ACROSS.repeat(columns), LINE_INK)
  switch (direction) {
    case 'right':
      return [[shaft(width - 1), head(ARROW_RIGHT)]]
    case 'left':
      return [[head(ARROW_LEFT), shaft(width - 1)]]
    case 'x':
      return [[head(ARROW_LEFT), shaft(width - 2), head(ARROW_RIGHT)]]
    case 'up':
      return [[head(ARROW_UP)]]
    case 'down':
      return [[head(ARROW_DOWN)]]
    case 'y':
      return [[head(ARROW_UP)], [head(ARROW_DOWN)]]
  }
}

function arrowRows(arrow: BlockArrow, lines: readonly Label[], width: number): Part[][] {
  const glyphs = arrowGlyphs(arrow.direction, width)
  const texts = lines.map((label): Part[] => [{ label, ink: 'plain' }])
  switch (arrow.direction) {
    case 'up':
      return [...glyphs, ...texts]
    case 'y':
      return [...glyphs.slice(0, 1), ...texts, ...glyphs.slice(1)]
    case 'right':
    case 'left':
    case 'x':
    case 'down':
      return [...texts, ...glyphs]
  }
}

function partsWidth(parts: readonly Part[]): number {
  return parts.reduce((sum, entry) => sum + displayWidth(entry.label.text), 0)
}

function drawArrow(grid: Grid, placed: Placed, arrow: BlockArrow): void {
  const { rect, lines } = placed
  const width = rect.right - rect.left + 1
  const rows = arrowRows(arrow, lines, width)
  const top = rect.top + centered(rows.length, rect.bottom - rect.top + 1)
  rows.forEach((parts, at) => {
    let col = rect.left + centered(partsWidth(parts), width)
    for (const entry of parts) {
      grid.putLabel(top + at, col, entry.label, entry.ink)
      col += displayWidth(entry.label.text)
    }
  })
}

type Course = {
  cells: { row: number; col: number }[]
  head: string
  ports: { row: number; col: number; glyph: string; placed: Placed }[]
  isAcross: boolean
}

function named(placed: Placed): string {
  const id = placed.item.id
  return id.startsWith(AUTOMATIC_GROUP) ? 'a block' : id
}

function linkName(from: Placed, to: Placed): string {
  return `the link from ${named(from)} to ${named(to)}`
}

function inner(placed: Placed): Rect {
  const inset = placed.item.kind === 'arrow' ? 0 : 1
  const { top, left, bottom, right } = placed.rect
  return { top: top + inset, left: left + inset, bottom: bottom - inset, right: right - inset }
}

function middle(low: number, high: number): number {
  return Math.floor((low + high) / 2)
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, at) => from + at)
}

function port(placed: Placed, row: number, col: number, glyph: string): Course['ports'] {
  return placed.item.kind === 'node' ? [{ row, col, glyph, placed }] : []
}

function downCourse(from: Placed, to: Placed, arrow: boolean): Course | null {
  const one = inner(from)
  const other = inner(to)
  const low = Math.max(one.left, other.left)
  const high = Math.min(one.right, other.right)
  if (low > high) return null
  const col = middle(low, high)
  if (from.rect.bottom < to.rect.top) {
    return {
      cells: range(from.rect.bottom + 1, to.rect.top - 1).map((row) => ({ row, col })),
      head: ARROW_DOWN,
      ports: [
        ...port(from, from.rect.bottom, col, PORT_BELOW),
        ...(arrow ? [] : port(to, to.rect.top, col, PORT_ABOVE)),
      ],
      isAcross: false,
    }
  }
  if (to.rect.bottom >= from.rect.top) return null
  return {
    cells: range(to.rect.bottom + 1, from.rect.top - 1)
      .reverse()
      .map((row) => ({ row, col })),
    head: ARROW_UP,
    ports: [
      ...port(from, from.rect.top, col, PORT_ABOVE),
      ...(arrow ? [] : port(to, to.rect.bottom, col, PORT_BELOW)),
    ],
    isAcross: false,
  }
}

function acrossCourse(from: Placed, to: Placed): Course | null {
  const one = inner(from)
  const other = inner(to)
  const low = Math.max(one.top, other.top)
  const high = Math.min(one.bottom, other.bottom)
  if (low > high) return null
  const row = middle(low, high)
  if (from.rect.right < to.rect.left) {
    return {
      cells: range(from.rect.right + 1, to.rect.left - 1).map((col) => ({ row, col })),
      head: ARROW_RIGHT,
      ports: [],
      isAcross: true,
    }
  }
  if (to.rect.right >= from.rect.left) return null
  return {
    cells: range(to.rect.right + 1, from.rect.left - 1)
      .reverse()
      .map((col) => ({ row, col })),
    head: ARROW_LEFT,
    ports: [],
    isAcross: true,
  }
}

function inside(rect: Rect, row: number, col: number): boolean {
  return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right
}

class LinkSheet {
  private readonly used = new Set<string>()
  widest = 0

  constructor(
    private readonly grid: Grid,
    private readonly placed: readonly Placed[],
    private readonly room: number,
  ) {}

  draw(link: BlockLink): void {
    const from = this.find(link.from)
    const to = this.find(link.to)
    const name = linkName(from, to)
    const related = (other: Placed) =>
      from.parents.includes(other.item.id) || to.parents.includes(other.item.id)
    if (from === to || related(from) || related(to)) throw new BlockFault(`${name} needs a bend`)
    const course = acrossCourse(from, to) ?? downCourse(from, to, link.arrow)
    if (course === null || course.cells.length === 0) throw new BlockFault(`${name} needs a bend`)
    for (const { row, col } of course.cells) this.claim(row, col, from, to, name)
    const stroke = STROKES[link.stroke]
    course.cells.forEach(({ row, col }, at) => {
      const isHead = link.arrow && at === course.cells.length - 1
      const glyph = course.isAcross ? stroke.across : stroke.down
      this.grid.put(row, col, isHead ? course.head : glyph, isHead ? HEAD_INK : LINE_INK)
    })
    for (const { row, col, glyph, placed } of course.ports) {
      this.grid.put(row, col, glyph, placed.ink)
    }
    this.label(course, labelsOf(link.label), from, to, name)
  }

  private find(id: string): Placed {
    const placed = this.placed.find((entry) => entry.item.id === id)
    if (placed === undefined) throw new BlockFault(`the link to ${id} has no block`)
    return placed
  }

  private blocker(row: number, col: number, from: Placed, to: Placed): Placed | undefined {
    return this.placed.find(
      (other) =>
        other !== from &&
        other !== to &&
        !from.parents.includes(other.item.id) &&
        !to.parents.includes(other.item.id) &&
        inside(other.rect, row, col),
    )
  }

  private isUsed(row: number, col: number): boolean {
    return this.used.has(`${String(row)}:${String(col)}`)
  }

  private claim(row: number, col: number, from: Placed, to: Placed, name: string): void {
    const crossed = this.blocker(row, col, from, to)
    if (crossed !== undefined) throw new BlockFault(`${name} crosses ${named(crossed)}`)
    if (this.isUsed(row, col)) throw new BlockFault(`${name} crosses another link`)
    this.used.add(`${String(row)}:${String(col)}`)
  }

  private isFrame(row: number, col: number): boolean {
    return this.placed.some(
      ({ item, rect }) =>
        item.kind === 'group' &&
        inside(rect, row, col) &&
        (row === rect.top || row === rect.bottom || col === rect.left || col === rect.right),
    )
  }

  private isOpen(row: number, cols: readonly number[], from: Placed, to: Placed): boolean {
    return cols.every(
      (col) =>
        col >= 0 &&
        col < this.room &&
        !this.isUsed(row, col) &&
        !this.isFrame(row, col) &&
        this.blocker(row, col, from, to) === undefined,
    )
  }

  private label(course: Course, labels: readonly Label[], from: Placed, to: Placed, name: string) {
    const text = labels.map((label) => label.text).join(' ')
    if (text === '') return
    const label = shownLabel(text)
    const columns = displayWidth(label.text)
    const room = course.cells.length
    const misfit = new BlockFault(`the label of ${name} does not fit`)
    if (course.isAcross) {
      if (room < columns + LABEL_ROOM) throw misfit
      const cells = course.cells.map((cell) => cell.col).sort((one, other) => one - other)
      const start = (cells[0] ?? 0) + centered(columns, room)
      const row = course.cells[0]?.row ?? 0
      if (range(start - 1, start + columns).some((col) => this.isFrame(row, col))) throw misfit
      this.grid.put(row, start - 1, ' ', LINE_INK)
      this.grid.putLabel(row, start, label, LABEL_INK)
      this.grid.put(row, start + columns, ' ', LINE_INK)
      return
    }
    const rows = course.cells.map((cell) => cell.row).sort((one, other) => one - other)
    const middleRow = rows[middle(0, rows.length - 1)] ?? 0
    const col = (course.cells[0]?.col ?? 0) + 2
    const cols = range(col - 1, col + columns - 1)
    const nearest = [...rows].sort(
      (one, other) => Math.abs(one - middleRow) - Math.abs(other - middleRow) || one - other,
    )
    const row = nearest.find((candidate) => this.isOpen(candidate, cols, from, to))
    if (row === undefined) throw misfit
    for (const at of cols) this.used.add(`${String(row)}:${String(at)}`)
    this.widest = Math.max(this.widest, col + columns)
    this.grid.putLabel(row, col, label, LABEL_INK)
  }
}

function drawnAt(
  diagram: BlockDiagram,
  width: number,
  gap: number,
  room: number,
): InkedDrawing | Refusal | null {
  const layout = layoutOf(diagram, width, gap)
  if (layout === null) return null
  const grid = new Grid()
  for (const placed of layout.placed) {
    if (placed.item.kind === 'group') drawFrame(grid, placed.rect)
    if (placed.item.kind === 'node') drawNode(grid, placed, placed.item)
    if (placed.item.kind === 'arrow') drawArrow(grid, placed, placed.item)
  }
  try {
    const sheet = new LinkSheet(grid, layout.placed, room)
    for (const link of diagram.links) sheet.draw(link)
    const right = Math.max(width, sheet.widest) - 1
    return drawnOutline(Array.from({ length: layout.height }, (_, row) => grid.line(row, 0, right)))
  } catch (error) {
    if (!(error instanceof BlockFault)) throw error
    return { kind: 'refused', reason: error.reason, line: null, limit: null }
  }
}

function drawnWithin(diagram: BlockDiagram, width: number): InkedDrawing | Refusal | null {
  const natural = gridWidth(diagram.root, diagram.links)
  const spaced = drawnAt(diagram, Math.min(natural, width), COLUMN_GAP, width)
  if (spaced?.kind === 'drawing' || width >= natural) return spaced
  const compact = drawnAt(diagram, width, COMPACT_COLUMN_GAP, width)
  return compact?.kind === 'drawing' ? compact : (spaced ?? compact)
}

export function drawBlock(diagram: BlockDiagram, width: number): InkedDrawing | Refusal {
  const natural = gridWidth(diagram.root, diagram.links)
  const outcome = drawnWithin(diagram, width)
  if (outcome !== null && (outcome.kind === 'drawing' || width >= natural)) return outcome
  for (let wider = width + 1; wider <= natural; wider++) {
    const attempt = drawnWithin(diagram, wider)
    if (attempt?.kind === 'drawing') return tooWide(wider, width)
    if (wider === natural && attempt !== null) return attempt
  }
  return outcome ?? tooWide(natural, width)
}
