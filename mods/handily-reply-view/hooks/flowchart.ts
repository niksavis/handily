import type { FlowDirection, FlowNode, FlowShape, Flowchart, Refusal, Stroke } from './mermaid'
import { wrapCell } from './table'
import { displayWidth, fitted, graphemesOf, padToWidth } from './width'

export type FlowDrawing = { kind: 'drawing'; lines: string[] }

export type LayoutMeter = { steps: number }

const MOST_ROWS = 120
const MOST_LOOPS = 3
const EDGE_LABEL_COLUMNS = 12
const ORDER_PASSES = 4
const DOWN_BOX_GAP = 2
const ACROSS_BOX_GAP = 0
const DOWN_LOOP_GAP = 7
const ACROSS_LOOP_GAP = 2
const LOOP_SPACING = 2
const LABEL_INDENT = 2
const STUB_COLUMNS = 2
const BUS_SPACING = 2
const STRAIGHT_LINK_COLUMNS = 3
const BOX_PADDING = 4
const SLIDING_WIDTH = 8
const DECISION_MARK = '◇ '
const DECISION_INDENT = '  '
const CONTROL = /\p{Cc}/gu
const BIDI_CONTROL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8
const VERTICAL = UP | DOWN
const HORIZONTAL = LEFT | RIGHT

const SOLID_GLYPHS: Readonly<Record<number, string>> = {
  [UP]: '│',
  [DOWN]: '│',
  [VERTICAL]: '│',
  [LEFT]: '─',
  [RIGHT]: '─',
  [HORIZONTAL]: '─',
  [DOWN | RIGHT]: '┌',
  [DOWN | LEFT]: '┐',
  [UP | RIGHT]: '└',
  [UP | LEFT]: '┘',
  [VERTICAL | RIGHT]: '├',
  [VERTICAL | LEFT]: '┤',
  [HORIZONTAL | DOWN]: '┬',
  [HORIZONTAL | UP]: '┴',
  [VERTICAL | HORIZONTAL]: '┼',
}

const DASHED_VERTICAL = '╎'
const DASHED_HORIZONTAL = '╌'

type Corners = readonly [string, string, string, string]

const SQUARE_CORNERS: Corners = ['┌', '┐', '└', '┘']
const ROUNDED_CORNERS: Corners = ['╭', '╮', '╰', '╯']
const BORDER_ACROSS = '─'
const BORDER_DOWN = '│'
const PORT_BELOW = '┬'
const PORT_ABOVE = '┴'
const ARROW_DOWN = '▼'
const ARROW_RIGHT = '▶'
const ARROW_LEFT = '◀'
const ARROW_UP = '▲'

type Attempt = { direction: FlowDirection; wrap: number | null; cut: number | null }

const PLAIN_LABELS = { wrap: null, cut: null } as const

const FITTED_LABELS: readonly Pick<Attempt, 'wrap' | 'cut'>[] = [
  { wrap: 16, cut: EDGE_LABEL_COLUMNS },
  { wrap: 12, cut: EDGE_LABEL_COLUMNS },
]

type Link = {
  from: number
  to: number
  stroke: Stroke
  arrow: boolean
  label: string[]
  order: number
}

type Segment = { from: number; to: number; link: Link; first: boolean }

type Graph = {
  nodes: readonly FlowNode[]
  layerOf: number[]
  layers: number[][]
  outgoing: Segment[][]
  incoming: Segment[][]
  loops: Link[]
  turns: Set<number>
}

type Shape = { lines: string[]; width: number; height: number; shape: FlowShape }

type Plan = {
  graph: Graph
  shapes: (Shape | null)[]
  labels: string[][]
  cut: number | null
  meter: LayoutMeter
}

type Placement = { ports: number[]; starts: number[] }

type Band = { tracks: Map<number, number>; trackCount: number }

type Point = { row: number; col: number }

type Owner = { from: number; to: number }

type Cell = {
  glyph: string | null
  mask: number
  solid: boolean
  across: Owner[]
  down: Owner[]
}

class DrawingFault extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

const LINES_OVERLAP = 'its lines overlap'

function refusal(reason: string): Refusal {
  return { kind: 'refused', reason, line: null, limit: null }
}

function tick(meter: LayoutMeter, steps = 1): void {
  meter.steps += steps
}

function shown(text: string): string {
  return text.replace(CONTROL, ' ').replace(BIDI_CONTROL, '')
}

function widest(lines: readonly string[]): number {
  return Math.max(0, ...lines.map(displayWidth))
}

type Linked = (from: number, to: number) => boolean

function isRelated(one: Owner, other: Owner, linked: Linked): boolean {
  if (one.from === other.from || one.to === other.to) return true
  return linked(one.from, other.to) && linked(other.from, one.to)
}

class Canvas {
  private readonly rows = new Map<number, Map<number, Cell>>()

  constructor(private readonly linked: Linked) {}

  put(row: number, col: number, text: string): void {
    let at = col
    let pending = ''
    let last: Cell | null = null
    for (const grapheme of graphemesOf(text)) {
      const columns = displayWidth(grapheme)
      if (columns === 0) {
        if (last === null) pending += grapheme
        else last.glyph = `${last.glyph ?? ''}${grapheme}`
        continue
      }
      last = this.claim(row, at, pending + grapheme)
      pending = ''
      if (columns > 1) this.claim(row, at + 1, '')
      at += columns
    }
  }

  fits(row: number, col: number, text: string): boolean {
    const columns = displayWidth(text)
    for (let at = col; at < col + columns; at++) {
      if (this.rows.get(row)?.has(at) === true) return false
    }
    return true
  }

  mark(row: number, col: number, glyph: string): void {
    const cell = this.rows.get(row)?.get(col)
    if (cell?.glyph == null) throw new DrawingFault(LINES_OVERLAP)
    cell.glyph = glyph
  }

  path(points: readonly Point[], owner: Owner, stroke: Stroke, leadIn: number, leadOut: number) {
    const walk = walkOf(points)
    walk.forEach((point, index) => {
      let bits = 0
      const before = walk[index - 1]
      const after = walk[index + 1]
      if (before !== undefined) bits |= directionOf(point, before)
      if (after !== undefined) bits |= directionOf(point, after)
      if (index === 0) bits |= leadIn
      if (index === walk.length - 1) bits |= leadOut
      this.line(point, bits, owner, stroke)
    })
  }

  get width(): number {
    let right = 0
    for (const cells of this.rows.values()) {
      for (const [col, cell] of cells) {
        if (cell.glyph !== ' ') right = Math.max(right, col + 1)
      }
    }
    return right - this.leftmost()
  }

  get height(): number {
    if (this.rows.size === 0) return 0
    const rows = [...this.rows.keys()]
    return Math.max(...rows) - Math.min(...rows) + 1
  }

  get bottom(): number {
    return Math.max(0, ...this.rows.keys())
  }

  lines(): string[] {
    if (this.rows.size === 0) return []
    const rows = [...this.rows.keys()]
    const top = Math.min(...rows)
    const left = this.leftmost()
    const lines: string[] = []
    for (let row = top; row <= Math.max(...rows); row++) {
      const cells = this.rows.get(row) ?? new Map<number, Cell>()
      const right = Math.max(left, ...cells.keys())
      let line = ''
      for (let col = left; col <= right; col++) line += glyphOf(cells.get(col))
      lines.push(line.trimEnd())
    }
    return lines
  }

  private leftmost(): number {
    let left = Infinity
    for (const cells of this.rows.values()) left = Math.min(left, ...cells.keys())
    return Number.isFinite(left) ? left : 0
  }

  private claim(row: number, col: number, glyph: string): Cell {
    if (this.rows.get(row)?.has(col) === true) throw new DrawingFault(LINES_OVERLAP)
    const cell: Cell = { glyph, mask: 0, solid: false, across: [], down: [] }
    this.cellsOf(row).set(col, cell)
    return cell
  }

  private line(point: Point, bits: number, owner: Owner, stroke: Stroke): void {
    const cells = this.cellsOf(point.row)
    const cell = cells.get(point.col) ?? {
      glyph: null,
      mask: 0,
      solid: false,
      across: [],
      down: [],
    }
    if (cell.glyph !== null) throw new DrawingFault(LINES_OVERLAP)
    if ((bits & HORIZONTAL) !== 0) this.claimAxis(cell.across, owner)
    if ((bits & VERTICAL) !== 0) this.claimAxis(cell.down, owner)
    cell.mask |= bits
    cell.solid ||= stroke === 'solid'
    cells.set(point.col, cell)
  }

  private claimAxis(owners: Owner[], owner: Owner): void {
    if (owners.some((other) => !isRelated(other, owner, this.linked))) {
      throw new DrawingFault(LINES_OVERLAP)
    }
    owners.push(owner)
  }

  private cellsOf(row: number): Map<number, Cell> {
    const known = this.rows.get(row)
    if (known !== undefined) return known
    const cells = new Map<number, Cell>()
    this.rows.set(row, cells)
    return cells
  }
}

function glyphOf(cell: Cell | undefined): string {
  if (cell === undefined) return ' '
  if (cell.glyph !== null) return cell.glyph
  if (!cell.solid && (cell.mask & HORIZONTAL) === 0) return DASHED_VERTICAL
  if (!cell.solid && (cell.mask & VERTICAL) === 0) return DASHED_HORIZONTAL
  return SOLID_GLYPHS[cell.mask] ?? ' '
}

function directionOf(from: Point, to: Point): number {
  if (to.row < from.row) return UP
  if (to.row > from.row) return DOWN
  return to.col < from.col ? LEFT : RIGHT
}

function walkOf(points: readonly Point[]): Point[] {
  const walk: Point[] = []
  for (const point of points) {
    const last = walk.at(-1)
    if (last === undefined) {
      walk.push(point)
      continue
    }
    if (last.row !== point.row && last.col !== point.col) throw new DrawingFault(LINES_OVERLAP)
    const rowStep = Math.sign(point.row - last.row)
    const colStep = Math.sign(point.col - last.col)
    let { row, col } = last
    while (row !== point.row || col !== point.col) {
      row += rowStep
      col += colStep
      walk.push({ row, col })
    }
  }
  return walk
}

function linksOf(chart: Flowchart, meter: LayoutMeter): Link[] {
  const index = new Map(chart.nodes.map((node, at) => [node.id, at]))
  const links = new Map<string, Link>()
  for (const edge of chart.edges) {
    tick(meter)
    const from = index.get(edge.from)
    const to = index.get(edge.to)
    if (from === undefined || to === undefined) throw new DrawingFault('an edge names no box')
    if (from === to) throw new DrawingFault('an edge from a box to itself does not draw yet')
    const key = `${String(from)}>${String(to)}`
    const known = links.get(key)
    if (known === undefined) {
      links.set(key, { ...edge, from, to, label: [...edge.label], order: links.size })
      continue
    }
    if (edge.stroke === 'solid') known.stroke = 'solid'
    known.arrow ||= edge.arrow
    known.label.push(...edge.label)
  }
  return [...links.values()]
}

function loopsOf(count: number, links: readonly Link[], meter: LayoutMeter): Set<Link> {
  const outgoing = Array.from({ length: count }, () => [] as Link[])
  for (const link of links) outgoing[link.from]?.push(link)
  const OPEN = 1
  const DONE = 2
  const state = new Array<number>(count).fill(0)
  const loops = new Set<Link>()
  for (let root = 0; root < count; root++) {
    if (state[root] !== 0) continue
    state[root] = OPEN
    const stack = [{ node: root, next: 0 }]
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      tick(meter)
      const link = outgoing[top.node]?.[top.next]
      if (link === undefined) {
        state[top.node] = DONE
        stack.pop()
        continue
      }
      top.next += 1
      if (state[link.to] === OPEN) loops.add(link)
      else if (state[link.to] === 0) {
        state[link.to] = OPEN
        stack.push({ node: link.to, next: 0 })
      }
    }
  }
  return loops
}

function layersOf(count: number, forward: readonly Link[], meter: LayoutMeter): number[] {
  const layer = new Array<number>(count).fill(0)
  const waiting = new Array<number>(count).fill(0)
  const outgoing = Array.from({ length: count }, () => [] as Link[])
  for (const link of forward) {
    outgoing[link.from]?.push(link)
    waiting[link.to] = (waiting[link.to] ?? 0) + 1
  }
  const ready = layer.map((_, node) => node).filter((node) => waiting[node] === 0)
  for (let at = 0; at < ready.length; at++) {
    const node = ready[at] ?? 0
    for (const link of outgoing[node] ?? []) {
      tick(meter)
      layer[link.to] = Math.max(layer[link.to] ?? 0, (layer[node] ?? 0) + 1)
      waiting[link.to] = (waiting[link.to] ?? 0) - 1
      if (waiting[link.to] === 0) ready.push(link.to)
    }
  }
  return layer
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((one, other) => one - other)
  const middle = Math.floor((sorted.length - 1) / 2)
  return mean(sorted.slice(middle, sorted.length - middle))
}

function loopSide(size: number, turning: boolean, leaving: boolean): number {
  if (!turning) return Math.floor(size / 2)
  return leaving ? size - 2 : 1
}

function orderLayers(
  layers: number[][],
  neighbours: (vertex: number, upward: boolean) => number[],
  meter: LayoutMeter,
): void {
  const position = new Map<number, number>()
  const remember = (layer: readonly number[]) => {
    layer.forEach((vertex, at) => position.set(vertex, at))
  }
  layers.forEach(remember)
  for (let pass = 0; pass < ORDER_PASSES; pass++) {
    const downward = pass % 2 === 0
    const sequence = layers.map((_, at) => at)
    if (!downward) sequence.reverse()
    for (const at of sequence) {
      const layer = layers[at] ?? []
      const key = new Map<number, number>()
      for (const vertex of layer) {
        const around = neighbours(vertex, downward).map((other) => position.get(other) ?? 0)
        tick(meter, around.length + 1)
        key.set(vertex, around.length === 0 ? (position.get(vertex) ?? 0) : mean(around))
      }
      layer.sort((one, other) => (key.get(one) ?? 0) - (key.get(other) ?? 0) || one - other)
      tick(meter, layer.length)
      remember(layer)
    }
  }
}

function keepLoopsOutside(layers: number[][], loops: readonly Link[]): void {
  const ends = new Set(loops.flatMap((link) => [link.from, link.to]))
  layers.forEach((layer, at) => {
    const inside = layer.filter((vertex) => !ends.has(vertex))
    const outside = layer.filter((vertex) => ends.has(vertex))
    if (outside.length > 1) {
      throw new DrawingFault(
        `loops at ${String(outside.length)} boxes of one level do not draw yet`,
      )
    }
    layers[at] = [...inside, ...outside]
  })
}

function graphOf(chart: Flowchart, meter: LayoutMeter): Graph {
  if (chart.nodes.length === 0) throw new DrawingFault('the flowchart has no boxes')
  const count = chart.nodes.length
  const links = linksOf(chart, meter)
  const loopSet = loopsOf(count, links, meter)
  if (loopSet.size > MOST_LOOPS) {
    throw new DrawingFault(`${String(loopSet.size)} loops back, at most ${String(MOST_LOOPS)} draw`)
  }
  const forward = links.filter((link) => !loopSet.has(link))
  const layerOf = layersOf(count, forward, meter)
  const outgoing: Segment[][] = Array.from({ length: count }, () => [])
  const incoming: Segment[][] = Array.from({ length: count }, () => [])
  const addVertex = (layer: number) => {
    layerOf.push(layer)
    outgoing.push([])
    incoming.push([])
    return layerOf.length - 1
  }
  for (const link of forward) {
    let from = link.from
    const last = layerOf[link.to] ?? 0
    for (let layer = (layerOf[from] ?? 0) + 1; layer <= last; layer++) {
      tick(meter)
      const to = layer === last ? link.to : addVertex(layer)
      const segment: Segment = { from, to, link, first: from === link.from }
      outgoing[from]?.push(segment)
      incoming[to]?.push(segment)
      from = to
    }
  }
  const layers: number[][] = []
  layerOf.forEach((layer, vertex) => {
    while (layers.length <= layer) layers.push([])
    layers[layer]?.push(vertex)
  })
  orderLayers(
    layers,
    (vertex, upward) =>
      upward
        ? (incoming[vertex] ?? []).map((segment) => segment.from)
        : (outgoing[vertex] ?? []).map((segment) => segment.to),
    meter,
  )
  const loops = [...loopSet]
  keepLoopsOutside(layers, loops)
  const leaving = new Set(loops.map((link) => link.from))
  const turns = new Set(loops.map((link) => link.to).filter((vertex) => leaving.has(vertex)))
  return { nodes: chart.nodes, layerOf, layers, outgoing, incoming, loops, turns }
}

function shapeOf(node: FlowNode, wrap: number | null, turning: boolean): Shape {
  const text = node.label
    .map(shown)
    .flatMap((line) => (wrap === null ? [line] : wrapCell(line, wrap)))
  const lines = text.length === 0 ? [''] : text
  if (turning && lines.length < 2) lines.push('')
  const marked =
    node.shape === 'decision'
      ? lines.map((line, at) => (at === 0 ? DECISION_MARK : DECISION_INDENT) + line)
      : lines
  return {
    lines: marked,
    width: widest(marked) + BOX_PADDING,
    height: marked.length + 2,
    shape: node.shape,
  }
}

function edgeLabel(label: readonly string[], cut: number | null): string[] {
  return label
    .map(shown)
    .filter((line) => line.trim() !== '')
    .map((line) => (cut === null ? line : fitted(line, cut)))
}

function labelsOf(graph: Graph, cut: number | null): string[][] {
  return graph.incoming.map((segments) =>
    edgeLabel(
      segments.filter((segment) => segment.first).flatMap((segment) => segment.link.label),
      cut,
    ),
  )
}

function planOf(graph: Graph, attempt: Attempt, meter: LayoutMeter): Plan {
  const shapes = graph.layerOf.map((_, vertex) => {
    const node = graph.nodes[vertex]
    return node === undefined ? null : shapeOf(node, attempt.wrap, graph.turns.has(vertex))
  })
  return { graph, shapes, labels: labelsOf(graph, attempt.cut), cut: attempt.cut, meter }
}

function crossSize(plan: Plan, vertex: number, direction: FlowDirection): number {
  const shape = plan.shapes[vertex]
  if (shape == null) return 1
  return direction === 'TD' ? shape.width : shape.height
}

function crossOffset(plan: Plan, vertex: number, direction: FlowDirection): number {
  return Math.floor(crossSize(plan, vertex, direction) / 2)
}

function separation(plan: Plan, above: number, below: number, direction: FlowDirection): number {
  const boxes =
    crossSize(plan, above, direction) -
    crossOffset(plan, above, direction) +
    (direction === 'TD' ? DOWN_BOX_GAP : ACROSS_BOX_GAP) +
    crossOffset(plan, below, direction)
  if (direction === 'TD') {
    const label = widest(plan.labels[above] ?? [])
    return label === 0 ? boxes : Math.max(boxes, label + LABEL_INDENT + 1)
  }
  const lines = plan.labels[below]?.length ?? 0
  return lines === 0 ? boxes : Math.max(boxes, lines + 1)
}

type Block = { first: number; sum: number; count: number }

function averageOf(block: Block): number {
  return block.sum / block.count
}

function settled(desired: readonly number[], gaps: readonly number[], meter: LayoutMeter) {
  const offsets = desired.map(() => 0)
  gaps.forEach((gap, at) => (offsets[at + 1] = (offsets[at] ?? 0) + gap))
  const blocks: Block[] = []
  desired.forEach((want, at) => {
    blocks.push({ first: at, sum: want - (offsets[at] ?? 0), count: 1 })
    let last = blocks.at(-1)
    let before = blocks.at(-2)
    while (last !== undefined && before !== undefined && averageOf(before) > averageOf(last)) {
      tick(meter)
      before.sum += last.sum
      before.count += last.count
      blocks.pop()
      last = before
      before = blocks.at(-2)
    }
  })
  const ports = offsets.slice()
  blocks.forEach((block, at) => {
    const end = blocks[at + 1]?.first ?? desired.length
    const value = Math.round(averageOf(block))
    for (let index = block.first; index < end; index++) ports[index] = value + (offsets[index] ?? 0)
  })
  return ports
}

function stacked(desired: readonly number[], gaps: readonly number[], meter: LayoutMeter) {
  const ports: number[] = []
  desired.forEach((want, at) => {
    tick(meter)
    const previous = ports[at - 1]
    ports.push(previous === undefined ? want : Math.max(want, previous + (gaps[at - 1] ?? 0)))
  })
  return ports
}

function placementOf(plan: Plan, direction: FlowDirection): Placement {
  const { graph, meter } = plan
  const ports = graph.layerOf.map(() => 0)
  graph.layers.forEach((layer, at) => {
    const gaps = layer.slice(1).map((vertex, index) => {
      return separation(plan, layer[index] ?? vertex, vertex, direction)
    })
    const packed = [0]
    gaps.forEach((gap) => packed.push((packed.at(-1) ?? 0) + gap))
    const desired = layer.map((vertex, index) => {
      const parents = (graph.incoming[vertex] ?? []).map((segment) => ports[segment.from] ?? 0)
      tick(meter, parents.length + 1)
      if (at === 0 || parents.length === 0) return packed[index] ?? 0
      return direction === 'TD' ? median(parents) : Math.floor(median(parents))
    })
    const placed =
      direction === 'TD' ? settled(desired, gaps, meter) : stacked(desired, gaps, meter)
    layer.forEach((vertex, index) => (ports[vertex] = placed[index] ?? 0))
  })
  const naturals = ports.map((port, vertex) => port - crossOffset(plan, vertex, direction))
  const slide = (vertex: number) =>
    direction === 'TD' && (plan.shapes[vertex]?.width ?? 0) >= SLIDING_WIDTH ? 1 : 0
  const shift = -Math.min(...naturals.map((start, vertex) => start + slide(vertex)))
  return {
    ports: ports.map((port) => port + shift),
    starts: naturals.map((start) => Math.max(start + shift, 0)),
  }
}

type BusItem = {
  source: number
  low: number
  high: number
  port: number
  drops: Map<number, number>
  targets: Set<number>
}

function bandOf(segments: readonly Segment[], ports: readonly number[], meter: LayoutMeter): Band {
  const bySource = new Map<number, Segment[]>()
  for (const segment of segments) {
    const known = bySource.get(segment.from) ?? []
    known.push(segment)
    bySource.set(segment.from, known)
  }
  const items: BusItem[] = []
  for (const [source, outgoing] of bySource) {
    const port = ports[source] ?? 0
    const drops = new Map(outgoing.map((segment) => [ports[segment.to] ?? 0, segment.to]))
    const only = outgoing[0]
    if (outgoing.length === 1 && only !== undefined && drops.has(port)) continue
    const columns = [port, ...drops.keys()]
    items.push({
      source,
      low: Math.min(...columns),
      high: Math.max(...columns),
      port,
      drops,
      targets: new Set(drops.values()),
    })
  }
  return tracksOf(items, meter)
}

function sharesTargets(one: BusItem, other: BusItem): boolean {
  return (
    one.targets.size === other.targets.size &&
    [...one.targets].every((target) => other.targets.has(target))
  )
}

function mustPrecede(first: BusItem, second: BusItem): boolean {
  const target = second.drops.get(first.port)
  if (target === undefined) return false
  if (!first.targets.has(target)) return true
  return [...first.targets].some((other) => !second.targets.has(other))
}

function tracksOf(items: readonly BusItem[], meter: LayoutMeter): Band {
  const waiting = new Map(items.map((item) => [item, 0]))
  const after = new Map(items.map((item) => [item, [] as BusItem[]]))
  for (const first of items) {
    for (const second of items) {
      tick(meter)
      if (first === second || !mustPrecede(first, second)) continue
      after.get(first)?.push(second)
      waiting.set(second, (waiting.get(second) ?? 0) + 1)
    }
  }
  const lowest = new Map(items.map((item) => [item, 0]))
  const used: BusItem[][] = []
  const tracks = new Map<number, number>()
  const left = new Set(items)
  while (left.size > 0) {
    const ready = [...left]
      .filter((item) => waiting.get(item) === 0)
      .sort((one, other) => one.low - other.low || one.source - other.source)[0]
    if (ready === undefined) throw new DrawingFault(LINES_OVERLAP)
    left.delete(ready)
    let track = lowest.get(ready) ?? 0
    while (
      (used[track] ?? []).some((other) => {
        tick(meter)
        return other.low <= ready.high && ready.low <= other.high && !sharesTargets(other, ready)
      })
    ) {
      track += 1
    }
    while (used.length <= track) used.push([])
    used[track]?.push(ready)
    tracks.set(ready.source, track)
    for (const next of after.get(ready) ?? []) {
      lowest.set(next, Math.max(lowest.get(next) ?? 0, track + 1))
      waiting.set(next, (waiting.get(next) ?? 0) - 1)
    }
  }
  return { tracks, trackCount: used.length }
}

function drawBox(canvas: Canvas, shape: Shape, row: number, col: number): void {
  const [topLeft, topRight, bottomLeft, bottomRight] =
    shape.shape === 'rounded' ? ROUNDED_CORNERS : SQUARE_CORNERS
  const across = BORDER_ACROSS.repeat(shape.width - 2)
  canvas.put(row, col, `${topLeft}${across}${topRight}`)
  shape.lines.forEach((line, at) => {
    const inner = padToWidth(line, shape.width - BOX_PADDING)
    canvas.put(row + 1 + at, col, `${BORDER_DOWN} ${inner} ${BORDER_DOWN}`)
  })
  canvas.put(row + shape.height - 1, col, `${bottomLeft}${across}${bottomRight}`)
}

function linkedIn(graph: Graph): Linked {
  const pairs = new Set(
    graph.outgoing.flat().map((segment) => `${String(segment.from)}>${String(segment.to)}`),
  )
  return (from, to) => pairs.has(`${String(from)}>${String(to)}`)
}

function isArrowed(graph: Graph, vertex: number): boolean {
  return (graph.incoming[vertex] ?? []).some((segment) => segment.link.arrow)
}

function segmentOwner(segment: Segment): Owner {
  return { from: segment.from, to: segment.to }
}

function loopOwner(link: Link): Owner {
  return { from: -1 - link.from, to: -1 - link.to }
}

function sourcesOf(graph: Graph, layer: readonly number[]): Segment[] {
  return layer.flatMap((vertex) => graph.outgoing[vertex] ?? [])
}

function placeText(canvas: Canvas, row: number, col: number, lines: readonly string[]): void {
  let at = row
  while (!lines.every((line, index) => canvas.fits(at + index, col, line))) at += 1
  lines.forEach((line, index) => {
    canvas.put(at + index, col, line)
  })
}

function sortedLoops(loops: readonly Link[], spanOf: (link: Link) => number): Link[] {
  return [...loops].sort((one, other) => spanOf(one) - spanOf(other) || one.order - other.order)
}

function drawDown(plan: Plan): Canvas {
  const { graph, meter } = plan
  const { ports, starts } = placementOf(plan, 'TD')
  const tops: number[] = []
  const bands: Band[] = []
  const labelRows: number[] = []
  let top = 0
  graph.layers.forEach((layer, at) => {
    tops.push(top)
    const depth = Math.max(1, ...layer.map((vertex) => plan.shapes[vertex]?.height ?? 1))
    const band = bandOf(sourcesOf(graph, layer), ports, meter)
    const next = graph.layers[at + 1] ?? []
    const rows = Math.max(0, ...next.map((vertex) => plan.labels[vertex]?.length ?? 0))
    bands.push(band)
    labelRows.push(rows)
    top += depth + band.trackCount + rows + 1
  })
  const canvas = new Canvas(linkedIn(graph))
  graph.layers.forEach((layer, at) => {
    for (const vertex of layer) {
      const shape = plan.shapes[vertex]
      if (shape != null) drawBox(canvas, shape, tops[at] ?? 0, starts[vertex] ?? 0)
    }
  })
  graph.layers.forEach((layer, at) => {
    const layerTop = tops[at] ?? 0
    const band = bands[at] ?? { tracks: new Map<number, number>(), trackCount: 0 }
    const linkTop = layerTop + Math.max(1, ...layer.map((v) => plan.shapes[v]?.height ?? 1))
    const arrowRow = linkTop + band.trackCount + (labelRows[at] ?? 0)
    const marked = new Set<number>()
    for (const segment of sourcesOf(graph, layer)) {
      tick(meter)
      const source = segment.from
      const target = segment.to
      const sourceShape = plan.shapes[source]
      const targetShape = plan.shapes[target]
      const from = ports[source] ?? 0
      const to = ports[target] ?? 0
      const startRow = sourceShape == null ? layerTop : layerTop + sourceShape.height
      if (sourceShape != null && !marked.has(source)) {
        canvas.mark(startRow - 1, from, PORT_BELOW)
        marked.add(source)
      }
      const arrowed = targetShape != null && isArrowed(graph, target)
      const endRow = arrowed ? arrowRow - 1 : arrowRow
      const track = band.tracks.get(source)
      const points =
        track === undefined
          ? [
              { row: startRow, col: from },
              { row: endRow, col: to },
            ]
          : [
              { row: startRow, col: from },
              { row: linkTop + track, col: from },
              { row: linkTop + track, col: to },
              { row: endRow, col: to },
            ]
      if (endRow >= startRow)
        canvas.path(points, segmentOwner(segment), segment.link.stroke, UP, DOWN)
    }
    for (const target of graph.layers[at + 1] ?? []) {
      const to = ports[target] ?? 0
      if (plan.shapes[target] != null) {
        if (isArrowed(graph, target)) canvas.put(arrowRow, to, ARROW_DOWN)
        else canvas.mark(arrowRow + 1, to, PORT_ABOVE)
      }
      const label = plan.labels[target] ?? []
      label.forEach((line, index) => {
        canvas.put(linkTop + band.trackCount + index, to + LABEL_INDENT, line)
      })
    }
  })
  drawDownLoops(plan, canvas, tops, starts)
  return canvas
}

function drawDownLoops(plan: Plan, canvas: Canvas, tops: number[], starts: number[]): void {
  const { graph, meter } = plan
  if (graph.loops.length === 0) return
  const rowOf = (vertex: number, leaving: boolean) =>
    (tops[graph.layerOf[vertex] ?? 0] ?? 0) +
    loopSide(plan.shapes[vertex]?.height ?? 1, graph.turns.has(vertex), leaving)
  const rightOf = (vertex: number) => (starts[vertex] ?? 0) + (plan.shapes[vertex]?.width ?? 1)
  const first = canvas.width - 1 + DOWN_LOOP_GAP
  const loops = sortedLoops(graph.loops, (link) => rowOf(link.from, true) - rowOf(link.to, false))
  const outermost = first + LOOP_SPACING * (loops.length - 1)
  const arrowed = new Set<number>()
  loops.forEach((link, index) => {
    tick(meter)
    const channel = first + LOOP_SPACING * index
    const sourceRow = rowOf(link.from, true)
    const targetRow = rowOf(link.to, false)
    const entry = rightOf(link.to)
    const points = [
      { row: sourceRow, col: rightOf(link.from) },
      { row: sourceRow, col: channel },
      { row: targetRow, col: channel },
      { row: targetRow, col: link.arrow ? entry + 1 : entry },
    ]
    canvas.path(points, loopOwner(link), link.stroke, LEFT, LEFT)
    if (link.arrow && !arrowed.has(link.to)) {
      canvas.put(targetRow, entry, ARROW_LEFT)
      arrowed.add(link.to)
    }
  })
  for (const link of loops) {
    const label = edgeLabel(link.label, plan.cut)
    if (label.length > 0) placeText(canvas, rowOf(link.from, true), outermost + LABEL_INDENT, label)
  }
}

type AcrossBand = Band & { width: number; labelStarts: Map<number, number> }

function labelStartOf(
  plan: Plan,
  band: Band,
  segments: readonly Segment[],
  target: number,
  ports: readonly number[],
): number {
  const lines = plan.labels[target] ?? []
  const port = ports[target] ?? 0
  const low = port - lines.length
  const high = port - 1
  const columns = widest(lines)
  const busColumn = (source: number) => STUB_COLUMNS + BUS_SPACING * (band.tracks.get(source) ?? 0)
  const runStarts = segments
    .filter((segment) => segment.to === target)
    .map((segment) => ((ports[segment.from] ?? 0) === port ? 0 : busColumn(segment.from)))
  let start = Math.min(...runStarts) + 1
  const sources = [...new Set(segments.map((segment) => segment.from))]
  for (let moved = true; moved;) {
    moved = false
    for (const source of sources) {
      tick(plan.meter)
      const sourcePort = ports[source] ?? 0
      const bus = band.tracks.get(source)
      const reach = bus === undefined ? Infinity : busColumn(source)
      const drops = segments
        .filter((segment) => segment.from === source)
        .map((segment) => ports[segment.to] ?? 0)
      const top = Math.min(sourcePort, ...drops)
      const bottom = Math.max(sourcePort, ...drops)
      const stubHit = sourcePort >= low && sourcePort <= high && reach >= start
      const busHit = bus !== undefined && top <= high && bottom >= low
      const busInside = busHit && reach >= start && reach < start + columns
      if (!stubHit && !busInside) continue
      if (reach === Infinity) throw new DrawingFault(LINES_OVERLAP)
      start = reach + 1
      moved = true
    }
  }
  return start
}

function acrossBandOf(
  plan: Plan,
  layer: readonly number[],
  next: readonly number[],
  ports: readonly number[],
): AcrossBand {
  const segments = sourcesOf(plan.graph, layer)
  const band = bandOf(segments, ports, plan.meter)
  const base =
    band.trackCount === 0
      ? STRAIGHT_LINK_COLUMNS
      : STUB_COLUMNS + BUS_SPACING * (band.trackCount - 1) + STRAIGHT_LINK_COLUMNS + 1
  const labelStarts = new Map<number, number>()
  let width = base
  for (const target of next) {
    const lines = plan.labels[target] ?? []
    if (lines.length === 0) continue
    const start = labelStartOf(plan, band, segments, target, ports)
    labelStarts.set(target, start)
    width = Math.max(width, start + widest(lines) + 1)
  }
  return { ...band, width, labelStarts }
}

function drawAcross(plan: Plan): Canvas {
  const { graph, meter } = plan
  const { ports, starts } = placementOf(plan, 'LR')
  const lefts: number[] = []
  const widths: number[] = []
  const bands: AcrossBand[] = []
  let left = 0
  graph.layers.forEach((layer, at) => {
    lefts.push(left)
    const width = Math.max(1, ...layer.map((vertex) => plan.shapes[vertex]?.width ?? 1))
    widths.push(width)
    const band = acrossBandOf(plan, layer, graph.layers[at + 1] ?? [], ports)
    bands.push(band)
    left += width + band.width
  })
  const canvas = new Canvas(linkedIn(graph))
  graph.layers.forEach((layer, at) => {
    for (const vertex of layer) {
      const shape = plan.shapes[vertex]
      if (shape != null) drawBox(canvas, shape, starts[vertex] ?? 0, lefts[at] ?? 0)
    }
  })
  graph.layers.forEach((layer, at) => {
    const band = bands[at]
    if (band === undefined || at === graph.layers.length - 1) return
    const layerLeft = lefts[at] ?? 0
    const linkLeft = layerLeft + (widths[at] ?? 1)
    const arrowCol = linkLeft + band.width - 1
    for (const segment of sourcesOf(graph, layer)) {
      tick(meter)
      const sourceShape = plan.shapes[segment.from]
      const from = ports[segment.from] ?? 0
      const to = ports[segment.to] ?? 0
      const startCol = sourceShape == null ? layerLeft : layerLeft + sourceShape.width
      const arrowed = plan.shapes[segment.to] != null && isArrowed(graph, segment.to)
      const endCol = arrowed ? arrowCol - 1 : arrowCol
      const track = band.tracks.get(segment.from)
      const busCol = linkLeft + STUB_COLUMNS + BUS_SPACING * (track ?? 0)
      const points =
        track === undefined
          ? [
              { row: from, col: startCol },
              { row: to, col: endCol },
            ]
          : [
              { row: from, col: startCol },
              { row: from, col: busCol },
              { row: to, col: busCol },
              { row: to, col: endCol },
            ]
      canvas.path(points, segmentOwner(segment), segment.link.stroke, LEFT, RIGHT)
    }
    for (const target of graph.layers[at + 1] ?? []) {
      const to = ports[target] ?? 0
      if (plan.shapes[target] != null && isArrowed(graph, target)) {
        canvas.put(to, arrowCol, ARROW_RIGHT)
      }
      const lines = plan.labels[target] ?? []
      const start = band.labelStarts.get(target) ?? 0
      lines.forEach((line, index) => {
        canvas.put(to - lines.length + index, linkLeft + start, line)
      })
    }
  })
  drawAcrossLoops(plan, canvas, lefts, starts)
  return canvas
}

function drawAcrossLoops(plan: Plan, canvas: Canvas, lefts: number[], starts: number[]): void {
  const { graph, meter } = plan
  if (graph.loops.length === 0) return
  const columnOf = (vertex: number, leaving: boolean) =>
    (lefts[graph.layerOf[vertex] ?? 0] ?? 0) +
    loopSide(plan.shapes[vertex]?.width ?? 1, graph.turns.has(vertex), leaving)
  const bottomOf = (vertex: number) => (starts[vertex] ?? 0) + (plan.shapes[vertex]?.height ?? 1)
  const first = canvas.bottom + ACROSS_LOOP_GAP
  const loops = sortedLoops(
    graph.loops,
    (link) => columnOf(link.from, true) - columnOf(link.to, false),
  )
  const outermost = first + LOOP_SPACING * (loops.length - 1)
  const arrowed = new Set<number>()
  const exits = new Set<number>()
  loops.forEach((link, index) => {
    tick(meter)
    const channel = first + LOOP_SPACING * index
    const exit = columnOf(link.from, true)
    const entry = columnOf(link.to, false)
    const below = bottomOf(link.to)
    if (!exits.has(link.from)) {
      canvas.mark(bottomOf(link.from) - 1, exit, PORT_BELOW)
      exits.add(link.from)
    }
    const points = [
      { row: bottomOf(link.from), col: exit },
      { row: channel, col: exit },
      { row: channel, col: entry },
      { row: link.arrow ? below + 1 : below, col: entry },
    ]
    canvas.path(points, loopOwner(link), link.stroke, UP, UP)
    if (link.arrow && !arrowed.has(link.to)) {
      canvas.put(below, entry, ARROW_UP)
      arrowed.add(link.to)
    }
  })
  for (const link of loops) {
    const label = edgeLabel(link.label, plan.cut)
    if (label.length > 0) placeText(canvas, outermost + 1, columnOf(link.from, true), label)
  }
}

function attemptsOf(direction: FlowDirection): Attempt[] {
  const plain: Attempt[] =
    direction === 'LR'
      ? [
          { direction: 'LR', ...PLAIN_LABELS },
          { direction: 'TD', ...PLAIN_LABELS },
        ]
      : [{ direction: 'TD', ...PLAIN_LABELS }]
  return [...plain, ...FITTED_LABELS.map((labels) => ({ direction: 'TD' as const, ...labels }))]
}

function drawAttempt(graph: Graph, attempt: Attempt, meter: LayoutMeter): Canvas {
  const plan = planOf(graph, attempt, meter)
  return attempt.direction === 'TD' ? drawDown(plan) : drawAcross(plan)
}

export function drawFlowchart(
  chart: Flowchart,
  width: number,
  meter: LayoutMeter = { steps: 0 },
): FlowDrawing | Refusal {
  let graph: Graph
  try {
    graph = graphOf(chart, meter)
  } catch (error) {
    if (error instanceof DrawingFault) return refusal(error.reason)
    throw error
  }
  let narrowest = Infinity
  let shortest = Infinity
  let fault: string | null = null
  for (const attempt of attemptsOf(chart.direction)) {
    let canvas: Canvas
    try {
      canvas = drawAttempt(graph, attempt, meter)
    } catch (error) {
      if (!(error instanceof DrawingFault)) throw error
      fault ??= error.reason
      continue
    }
    const fitsWidth = canvas.width <= width
    if (fitsWidth && canvas.height <= MOST_ROWS) return { kind: 'drawing', lines: canvas.lines() }
    narrowest = Math.min(narrowest, canvas.width)
    if (fitsWidth) shortest = Math.min(shortest, canvas.height)
  }
  if (Number.isFinite(shortest)) {
    return refusal(`${String(shortest)} rows, at most ${String(MOST_ROWS)} draw`)
  }
  if (Number.isFinite(narrowest)) {
    return refusal(`it takes ${String(narrowest)} columns, the screen has ${String(width)}`)
  }
  return refusal(fault ?? LINES_OVERLAP)
}
