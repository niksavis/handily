import { MOST_ROWS, ROUNDED_CORNERS, tooWide, widestLabel } from './flowchart'
import { drawingOf, plainLabel, type Ink, type InkedDrawing, type Label, type Looks } from './ink'
import type { Refusal, Stroke } from './mermaid'
import { Grid } from './sequence'
import { displayWidth } from './width'

export type Piece = { text: string; ink: Ink; looks: Looks }

export type StackMark = 'triangle' | 'diamond' | 'hollowDiamond' | 'arrow' | 'circledPlus'

export type StackEnd = { mark: StackMark | null; text: Label | null }

export type StackLink = {
  from: number
  to: number
  stroke: Stroke
  fromEnd: StackEnd
  toEnd: StackEnd
  label: Label[]
}

export type StackBox = { title: Label[]; body: Piece[][] }

export type Stack = { boxes: StackBox[]; links: StackLink[] }

export type StackTie = { from: number; to: number; rank: number }

type Facing = 'up' | 'down' | 'left'

const MARK_GLYPHS: Readonly<Record<StackMark, Readonly<Record<Facing, string>>>> = {
  triangle: { up: '△', down: '▽', left: '◁' },
  diamond: { up: '◆', down: '◆', left: '◆' },
  hollowDiamond: { up: '◇', down: '◇', left: '◇' },
  arrow: { up: '▲', down: '▼', left: '◀' },
  circledPlus: { up: '⊕', down: '⊕', left: '⊕' },
}

const STROKES: Readonly<Record<Stroke, { across: string; down: string }>> = {
  solid: { across: '─', down: '│' },
  dashed: { across: '╌', down: '╎' },
}

const BORDER_ACROSS = '─'
const BORDER_DOWN = '│'
const RULE_LEFT = '├'
const RULE_RIGHT = '┤'
const PORT_BELOW = '┬'
const PORT_ABOVE = '┴'
const STUB_PORT = '├'
const EXIT_CORNER = '┐'
const ENTRY_CORNER = '┘'
const LABEL_GAP = 2
const STUB_ROOM = 4
const BARE_STUB_ROOM = 2
const CHANNEL_SPACING = 2

type Side = { link: StackLink; upper: number; lower: number; channel: number }

type Stub = { side: Side; end: StackEnd; text: Label | null; row: number; isUpper: boolean }

type BoxPlan = { box: StackBox; height: number; stubs: Stub[] }

type CenterRow = { glyph: string; ink: Ink; text: Label | null }

type Layout = {
  plans: BoxPlan[]
  tops: number[]
  height: number
  boxWidth: number
  channelLeft: number
  columns: number
  centers: Map<number, StackLink>
  sides: Side[]
}

export function stackOrder(count: number, ties: readonly StackTie[]): number[] {
  const children = Array.from({ length: count }, (): number[] => [])
  const owned = new Set<number>()
  for (const tie of [...ties].sort((one, other) => one.rank - other.rank)) {
    children[tie.from]?.push(tie.to)
    owned.add(tie.to)
  }
  const order: number[] = []
  const seen = new Set<number>()
  const visit = (at: number): void => {
    if (seen.has(at)) return
    seen.add(at)
    order.push(at)
    for (const child of children[at] ?? []) visit(child)
  }
  for (let at = 0; at < count; at++) if (!owned.has(at)) visit(at)
  for (let at = 0; at < count; at++) visit(at)
  return order
}

function glyphOf(mark: StackMark, facing: Facing): string {
  return MARK_GLYPHS[mark][facing]
}

function joined(labels: readonly Label[]): Label | null {
  const [first, ...rest] = labels
  if (first === undefined) return null
  return rest.reduce(
    (all, label) => ({
      text: `${all.text} ${label.text}`,
      runs: [...all.runs, ...plainLabel(' ').runs, ...label.runs],
    }),
    first,
  )
}

function endText(end: StackEnd, label: readonly Label[]): Label | null {
  return joined([...(end.text === null ? [] : [end.text]), ...label])
}

export function rowWidth(pieces: readonly Piece[]): number {
  return displayWidth(
    pieces
      .map((piece) => piece.text)
      .join('')
      .trimEnd(),
  )
}

function sidesOf(stack: Stack) {
  const centers = new Map<number, StackLink>()
  const sides: Omit<Side, 'channel'>[] = []
  for (const link of stack.links) {
    if (link.to === link.from + 1 && !centers.has(link.from)) {
      centers.set(link.from, link)
      continue
    }
    sides.push({ link, upper: Math.min(link.from, link.to), lower: Math.max(link.from, link.to) })
  }
  const ordered = sides
    .map((side, order) => ({ side, order }))
    .sort(
      (one, other) =>
        one.side.lower - one.side.upper - (other.side.lower - other.side.upper) ||
        one.order - other.order,
    )
    .map(({ side }, channel) => ({ ...side, channel }))
  return { centers, sides: ordered }
}

function stubOf(side: Side, isUpper: boolean, row: number): Stub {
  const { link } = side
  const fromIsUpper = link.from === side.upper
  const ownsLabel = fromIsUpper === isUpper
  const end = ownsLabel ? link.fromEnd : link.toEnd
  return { side, end, text: endText(end, ownsLabel ? link.label : []), row, isUpper }
}

function centerRows(link: StackLink): CenterRow[] {
  const { down } = STROKES[link.stroke]
  const { fromEnd, toEnd } = link
  return [
    fromEnd.mark === null
      ? { glyph: down, ink: 'line', text: fromEnd.text }
      : { glyph: glyphOf(fromEnd.mark, 'up'), ink: 'head', text: fromEnd.text },
    ...link.label.map((line): CenterRow => ({ glyph: down, ink: 'line', text: line })),
    toEnd.mark === null
      ? { glyph: down, ink: 'line', text: toEnd.text }
      : { glyph: glyphOf(toEnd.mark, 'down'), ink: 'head', text: toEnd.text },
  ]
}

function isLoop(side: Side): boolean {
  return side.upper === side.lower
}

function byChannel(one: Side, other: Side): number {
  return one.channel - other.channel
}

function stubOrder(sides: readonly Side[], at: number): { side: Side; isUpper: boolean }[] {
  const own = sides.filter((side) => side.upper === at || side.lower === at)
  const loops = own.filter(isLoop).sort(byChannel)
  const entries = own.filter((side) => side.lower === at && !isLoop(side)).sort(byChannel)
  const exits = own
    .filter((side) => side.upper === at && !isLoop(side))
    .sort(byChannel)
    .reverse()
  return [
    ...entries.map((side) => ({ side, isUpper: false })),
    ...[...loops].reverse().map((side) => ({ side, isUpper: true })),
    ...loops.map((side) => ({ side, isUpper: false })),
    ...exits.map((side) => ({ side, isUpper: true })),
  ]
}

function boxPlans(stack: Stack, sides: readonly Side[]): BoxPlan[] {
  return stack.boxes.map((box, at) => {
    const order = stubOrder(sides, at)
    const titleRows = Math.max(1, box.title.length)
    const ruleRows = box.body.length > 0 ? 1 : 0
    const last = titleRows + ruleRows + box.body.length
    const free = [
      ...Array.from({ length: titleRows }, (_, row) => 1 + row),
      ...box.body.map((_, row) => 1 + titleRows + ruleRows + row),
    ]
    for (let row = last + 1; free.length < order.length; row++) free.push(row)
    const stubs = order.map(({ side, isUpper }, index) => stubOf(side, isUpper, free[index] ?? 1))
    const height = Math.max(last, ...stubs.map((stub) => stub.row)) + 2
    return { box, height, stubs }
  })
}

function stubRight(stub: Stub, boxWidth: number): number {
  const text = stub.text === null ? 0 : displayWidth(stub.text.text)
  return boxWidth + (text === 0 ? BARE_STUB_ROOM : text + STUB_ROOM)
}

function layoutOf(stack: Stack): Layout {
  const { centers, sides } = sidesOf(stack)
  const plans = boxPlans(stack, sides)
  const inner = Math.max(
    ...plans.map(({ box }) => Math.max(widestLabel(box.title), ...box.body.map(rowWidth))),
  )
  const boxWidth = inner + 4
  const middle = Math.floor(boxWidth / 2)
  const tops: number[] = []
  let height = 0
  plans.forEach((plan, at) => {
    tops.push(height)
    height += plan.height
    const center = centers.get(at)
    if (at < plans.length - 1) height += center === undefined ? 1 : centerRows(center).length
  })
  const centerRight = Math.max(
    boxWidth,
    ...[...centers.values()].map(
      (link) => middle + LABEL_GAP + widestLabel(centerRows(link).flatMap((row) => row.text ?? [])),
    ),
  )
  const stubsRight = Math.max(
    0,
    ...plans.flatMap((plan) => plan.stubs.map((stub) => stubRight(stub, boxWidth))),
  )
  const channelLeft = Math.max(stubsRight, centerRight + 1)
  const columns =
    sides.length === 0 ? centerRight : channelLeft + CHANNEL_SPACING * (sides.length - 1) + 1
  return { plans, tops, height, boxWidth, channelLeft, columns, centers, sides }
}

function drawBox(grid: Grid, plan: BoxPlan, top: number, width: number, ink: Ink): void {
  const [topLeft, topRight, bottomLeft, bottomRight] = ROUNDED_CORNERS
  const across = BORDER_ACROSS.repeat(width - 2)
  const inside = ' '.repeat(width - 2)
  const { title, body } = plan.box
  grid.put(top, 0, `${topLeft}${across}${topRight}`, ink)
  for (let row = top + 1; row < top + plan.height - 1; row++) {
    grid.put(row, 0, `${BORDER_DOWN}${inside}${BORDER_DOWN}`, ink)
  }
  title.forEach((line, at) => {
    grid.putLabel(top + 1 + at, 2, line, ink)
  })
  const bodyTop = top + 1 + Math.max(1, title.length)
  if (body.length > 0) grid.put(bodyTop, 0, `${RULE_LEFT}${across}${RULE_RIGHT}`, ink)
  body.forEach((pieces, at) => {
    let col = 2
    for (const piece of pieces) {
      grid.put(bodyTop + 1 + at, col, piece.text, piece.ink, piece.looks)
      col += displayWidth(piece.text)
    }
  })
  grid.put(top + plan.height - 1, 0, `${bottomLeft}${across}${bottomRight}`, ink)
}

function drawCenter(grid: Grid, layout: Layout, at: number, link: StackLink): void {
  const middle = Math.floor(layout.boxWidth / 2)
  const bottom = (layout.tops[at] ?? 0) + (layout.plans[at]?.height ?? 0) - 1
  if (link.fromEnd.mark === null) grid.put(bottom, middle, PORT_BELOW, at)
  if (link.toEnd.mark === null) grid.put(layout.tops[at + 1] ?? 0, middle, PORT_ABOVE, at + 1)
  centerRows(link).forEach((row, index) => {
    grid.put(bottom + 1 + index, middle, row.glyph, row.ink)
    if (row.text !== null) grid.putLabel(bottom + 1 + index, middle + LABEL_GAP, row.text, 'label')
  })
}

function drawStub(grid: Grid, layout: Layout, stub: Stub, row: number, box: number): void {
  const column = layout.channelLeft + CHANNEL_SPACING * stub.side.channel
  const { across } = STROKES[stub.side.link.stroke]
  const edge = layout.boxWidth
  if (stub.end.mark === null) {
    grid.put(row, edge - 1, STUB_PORT, box)
    grid.put(row, edge, across, 'line')
  } else grid.put(row, edge, glyphOf(stub.end.mark, 'left'), 'head')
  grid.put(row, edge + 1, across.repeat(Math.max(0, column - edge - 1)), 'line')
  if (stub.text !== null) {
    grid.put(row, edge + 1, ' ', 'line')
    grid.putLabel(row, edge + 2, stub.text, 'label')
    grid.put(row, edge + 2 + displayWidth(stub.text.text), ' ', 'line')
  }
  grid.put(row, column, stub.isUpper ? EXIT_CORNER : ENTRY_CORNER, 'line')
}

function drawStubs(grid: Grid, layout: Layout): Map<Side, number[]> {
  const rows = new Map<Side, number[]>()
  layout.plans.forEach((plan, at) => {
    for (const stub of plan.stubs) {
      const row = (layout.tops[at] ?? 0) + stub.row
      drawStub(grid, layout, stub, row, at)
      rows.set(stub.side, [...(rows.get(stub.side) ?? []), row])
    }
  })
  return rows
}

function drawChannels(grid: Grid, layout: Layout, rows: ReadonlyMap<Side, number[]>): void {
  for (const side of layout.sides) {
    const ends = rows.get(side) ?? []
    const column = layout.channelLeft + CHANNEL_SPACING * side.channel
    const { down } = STROKES[side.link.stroke]
    for (let row = Math.min(...ends) + 1; row < Math.max(...ends); row++) {
      grid.put(row, column, down, 'line')
    }
  }
}

export function drawStack(stack: Stack, width: number): InkedDrawing | Refusal {
  const layout = layoutOf(stack)
  if (layout.columns > width) return tooWide(layout.columns, width)
  if (layout.height > MOST_ROWS) {
    return {
      kind: 'refused',
      reason: `${String(layout.height)} rows, at most ${String(MOST_ROWS)} draw`,
      line: null,
      limit: null,
    }
  }
  const grid = new Grid()
  layout.plans.forEach((plan, at) => {
    drawBox(grid, plan, layout.tops[at] ?? 0, layout.boxWidth, at)
  })
  layout.centers.forEach((link, at) => {
    drawCenter(grid, layout, at, link)
  })
  drawChannels(grid, layout, drawStubs(grid, layout))
  return drawingOf(
    Array.from({ length: layout.height }, (_, row) => grid.line(row, 0, layout.columns - 1)),
  )
}
