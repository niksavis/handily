import {
  BLANK,
  drawingOf,
  fittedLabel,
  inkRunsOf,
  markedLabel,
  PLAIN_LOOKS,
  plainLabel,
  prefixed,
  relabelled,
  textsOf,
  type Ink,
  type InkedCell,
  type InkedDrawing,
  type InkRun,
  type Label,
  type Looks,
} from './ink'
import type { FlowDirection, FlowNode, FlowShape, Flowchart, Refusal, Stroke } from './mermaid'
import { wrapWords } from './table'
import { displayWidth, graphemesOf } from './width'

export type FlowDrawing = InkedDrawing

export type LayoutMeter = { steps: number }

export const MOST_ROWS = 120
const MOST_LOOPS = 3
const EDGE_LABEL_COLUMNS = 12
const EDGE_WRAP_COLUMNS = 8
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
const ENTRY_SPACING = 2
const DOWN_ENTRY_ROOM = 5
const ACROSS_ENTRY_ROOM = 4
const NO_GROUP = -1
const DOWN_FRAME_TOP_ROWS = 2
const DOWN_FRAME_ROOM = 1
const ACROSS_FRAME_ROOM = 2
const FRAME_TITLE_INDENT = 2
const TITLE_PADDING = 4
const NARROW_TEXT = /^[\x20-\x7e\u2500-\u257f]*$/
const FRAME_INSETS: Readonly<Record<FlowDirection, number>> = { TD: 2, LR: 1 }
const FRAME_GAPS: Readonly<Record<FlowDirection, number>> = { TD: 1, LR: 0 }
const FRAME_ACROSS = '┄'
const FRAME_DOWN = '┆'
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

const SOLID_VERTICAL = '│'

const SOLID_GLYPHS: Readonly<Record<number, string>> = {
  [UP]: SOLID_VERTICAL,
  [DOWN]: SOLID_VERTICAL,
  [VERTICAL]: SOLID_VERTICAL,
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
export const ROUNDED_CORNERS: Corners = ['╭', '╮', '╰', '╯']
const TOO_WIDE_REMEDY = 'Widen the window or shorten the labels'
const BORDER_ACROSS = '─'
const BORDER_DOWN = '│'
const PORT_BELOW = '┬'
const PORT_ABOVE = '┴'
const ARROW_DOWN = '▼'
const ARROW_RIGHT = '▶'
const ARROW_LEFT = '◀'
const ARROW_UP = '▲'

type Attempt = {
  direction: FlowDirection
  wrap: number | null
  cut: number | null
  edgeWrap: number | null
  breaksWords: boolean
  compact: boolean
  perRow: number
}

type LabelRule = Pick<Attempt, 'wrap' | 'cut' | 'edgeWrap' | 'breaksWords'>

const PLAIN_LABELS: LabelRule = { wrap: null, cut: null, edgeWrap: null, breaksWords: false }

const FITTED_LABELS: readonly LabelRule[] = [
  { wrap: 16, cut: EDGE_LABEL_COLUMNS, edgeWrap: null, breaksWords: false },
  { wrap: 12, cut: EDGE_LABEL_COLUMNS, edgeWrap: null, breaksWords: false },
]

const WRAPPED_EDGE_LABELS: LabelRule = {
  wrap: 12,
  cut: null,
  edgeWrap: EDGE_WRAP_COLUMNS,
  breaksWords: false,
}

function brokenLabels(rules: readonly LabelRule[], longest: number): LabelRule[] {
  return rules
    .filter((rule) => rule.wrap !== null && longest > rule.wrap)
    .map((rule) => ({ ...rule, breaksWords: true }))
}

type Link = {
  from: number
  to: number
  stroke: Stroke
  arrow: boolean
  label: string[]
  order: number
}

type Segment = { from: number; to: number; link: Link; first: boolean }

type Cluster = { label: string[]; first: number; last: number; rank: number }

type Graph = {
  nodes: readonly FlowNode[]
  layerOf: number[]
  groupOf: number[]
  clusters: Cluster[]
  layers: number[][]
  outgoing: Segment[][]
  incoming: Segment[][]
  loops: Link[]
  turns: Set<number>
  real: Set<string>
  reach: Map<number, string>
}

type Shape = { lines: Label[]; width: number; height: number; shape: FlowShape }

type Entry = { label: Label[]; arrow: boolean; offset: number; sharing: string | null }

type Plan = {
  graph: Graph
  shapes: (Shape | null)[]
  entries: Entry[][]
  entryOf: Map<Segment, Entry>
  titles: Label[]
  writtenTitles: Label[]
  cut: number | null
  edgeWrap: number | null
  breaksWords: boolean
  compact: boolean
  meter: LayoutMeter
}

type Placement = { ports: number[]; starts: number[] }

type Extent = { lo: number; hi: number }

type Unit = Extent & { cluster: Cluster | null }

type Frame = {
  top: number
  left: number
  bottom: number
  right: number
  title: Label
  written: Label
}

type Band = { tracks: Map<number, number>; trackCount: number }

type Point = { row: number; col: number }

type Trace = { link: Link; bits: number; solid: boolean }

type Cell = { glyph: string | null; traces: Trace[]; ink: Ink; looks: Looks; border: boolean }

class DrawingFault extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

const LINES_OVERLAP = 'its lines overlap'
const GROUP_ORDER = 'its loops and its subgraphs cannot keep one order'

function refusal(reason: string): Refusal {
  return { kind: 'refused', reason, line: null, limit: null }
}

export function tooWide(columns: number, width: number): Refusal {
  return refusal(
    `it takes ${String(columns)} columns, the screen has ${String(width)}. ${TOO_WIDE_REMEDY}`,
  )
}

export function tick(meter: LayoutMeter, steps = 1): void {
  meter.steps += steps
}

export function shown(text: string): string {
  return text.replace(CONTROL, ' ').replace(BIDI_CONTROL, '')
}

export function widest(lines: readonly string[]): number {
  return Math.max(0, ...lines.map(displayWidth))
}

export function shownLabel(line: string): Label {
  return markedLabel(shown(line))
}

function pairKey(from: number, to: number): string {
  return `${String(from)}>${String(to)}`
}

function maskOf(cell: Cell): number {
  return cell.traces.reduce((mask, trace) => mask | trace.bits, 0)
}

function isCrossing(cell: Cell): boolean {
  const across = cell.traces.filter((trace) => (trace.bits & HORIZONTAL) !== 0)
  const down = cell.traces.filter((trace) => (trace.bits & VERTICAL) !== 0)
  return across.length > 0 && down.length > 0 && !cell.traces.some(isTurning)
}

function isTurning(trace: Trace): boolean {
  return (trace.bits & HORIZONTAL) !== 0 && (trace.bits & VERTICAL) !== 0
}

class Networks {
  private readonly parent = new Map<Link, Link>()

  join(links: readonly Link[]): void {
    const [first, ...rest] = links
    if (first === undefined) return
    for (const link of rest) this.parent.set(this.root(link), this.root(first))
  }

  groups(): Link[][] {
    const groups = new Map<Link, Link[]>()
    for (const link of this.parent.keys()) {
      const root = this.root(link)
      groups.set(root, [...(groups.get(root) ?? []), link])
    }
    return [...groups.values()]
  }

  private root(link: Link): Link {
    let at = link
    for (let up = this.parent.get(at); up !== undefined && up !== at; up = this.parent.get(at)) {
      at = up
    }
    if (!this.parent.has(at)) this.parent.set(at, at)
    return at
  }
}

function columnsOfText(text: string): number {
  return NARROW_TEXT.test(text) ? text.length : displayWidth(text)
}

class Canvas {
  private readonly rows = new Map<number, Map<number, Cell>>()

  put(row: number, col: number, text: string, ink: Ink, looks: Looks = PLAIN_LOOKS): void {
    if (NARROW_TEXT.test(text)) {
      for (let at = 0; at < text.length; at++)
        this.claim(row, col + at, text.charAt(at), ink, looks)
      return
    }
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
      last = this.claim(row, at, pending + grapheme, ink, looks)
      pending = ''
      if (columns > 1) this.claim(row, at + 1, '', ink, looks)
      at += columns
    }
  }

  putLabel(row: number, col: number, label: Label, ink: Ink): void {
    let at = col
    for (const run of label.runs) {
      this.put(row, at, run.text, ink, run.looks)
      at += columnsOfText(run.text)
    }
  }

  isFree(row: number, col: number): boolean {
    return this.rows.get(row)?.has(col) !== true
  }

  fits(row: number, col: number, text: string): boolean {
    const columns = columnsOfText(text)
    for (let at = col; at < col + columns; at++) {
      if (this.rows.get(row)?.has(at) === true) return false
    }
    return true
  }

  border(row: number, col: number, glyph: string): void {
    const cell = this.rows.get(row)?.get(col)
    if (cell?.glyph === null) return
    if (cell !== undefined) throw new DrawingFault(LINES_OVERLAP)
    this.cellsOf(row).set(col, { glyph, traces: [], ink: 'line', looks: PLAIN_LOOKS, border: true })
  }

  mark(row: number, col: number, glyph: string): void {
    const cell = this.rows.get(row)?.get(col)
    if (cell?.glyph == null) throw new DrawingFault(LINES_OVERLAP)
    cell.glyph = glyph
  }

  path(points: readonly Point[], link: Link, stroke: Stroke, leadIn: number, leadOut: number) {
    const walk = walkOf(points)
    walk.forEach((point, index) => {
      let bits = 0
      const before = walk[index - 1]
      const after = walk[index + 1]
      if (before !== undefined) bits |= directionOf(point, before)
      if (after !== undefined) bits |= directionOf(point, after)
      if (index === 0) bits |= leadIn
      if (index === walk.length - 1) bits |= leadOut
      this.line(point, { link, bits, solid: stroke === 'solid' })
    })
  }

  falseLinks(real: ReadonlySet<string>, meter: LayoutMeter): Link[] {
    const networks = new Networks()
    for (const cells of this.rows.values()) {
      for (const cell of cells.values()) {
        tick(meter)
        const links = cell.traces.map((trace) => trace.link)
        if (!isCrossing(cell)) {
          networks.join(links)
          continue
        }
        networks.join(
          cell.traces.filter((trace) => (trace.bits & HORIZONTAL) !== 0).map((t) => t.link),
        )
        networks.join(
          cell.traces.filter((trace) => (trace.bits & VERTICAL) !== 0).map((t) => t.link),
        )
      }
    }
    return networks.groups().flatMap((group) => {
      const sources = new Set(group.map((link) => link.from))
      const targets = new Set(group.map((link) => link.to))
      tick(meter, sources.size * targets.size)
      const wrong = [...sources].some((from) =>
        [...targets].some((to) => !real.has(pairKey(from, to))),
      )
      return wrong ? group : []
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

  inkedLines(): InkRun[][] {
    if (this.rows.size === 0) return []
    const rows = [...this.rows.keys()]
    const top = Math.min(...rows)
    const left = this.leftmost()
    const lines: InkRun[][] = []
    for (let row = top; row <= Math.max(...rows); row++) {
      const cells = this.rows.get(row) ?? new Map<number, Cell>()
      const right = Math.max(left, ...cells.keys())
      const inked: InkedCell[] = []
      for (let col = left; col <= right; col++) inked.push(inkedOf(cells.get(col)))
      lines.push(inkRunsOf(inked))
    }
    return lines
  }

  private leftmost(): number {
    let left = Infinity
    for (const cells of this.rows.values()) left = Math.min(left, ...cells.keys())
    return Number.isFinite(left) ? left : 0
  }

  private claim(row: number, col: number, glyph: string, ink: Ink, looks: Looks): Cell {
    const known = this.rows.get(row)?.get(col)
    if (known !== undefined && !known.border) throw new DrawingFault(LINES_OVERLAP)
    const cell: Cell = { glyph, traces: [], ink, looks, border: false }
    this.cellsOf(row).set(col, cell)
    return cell
  }

  private line(point: Point, trace: Trace): void {
    const cells = this.cellsOf(point.row)
    const known = cells.get(point.col)
    const cell: Cell =
      known === undefined || known.border
        ? { glyph: null, traces: [], ink: 'line', looks: PLAIN_LOOKS, border: false }
        : known
    if (cell.glyph !== null) throw new DrawingFault(LINES_OVERLAP)
    cell.traces.push(trace)
    cells.set(point.col, cell)
  }

  private cellsOf(row: number): Map<number, Cell> {
    const known = this.rows.get(row)
    if (known !== undefined) return known
    const cells = new Map<number, Cell>()
    this.rows.set(row, cells)
    return cells
  }
}

function inkedOf(cell: Cell | undefined): InkedCell {
  return cell === undefined ? BLANK : { glyph: glyphOf(cell), ink: cell.ink, looks: cell.looks }
}

function glyphOf(cell: Cell): string {
  if (cell.glyph !== null) return cell.glyph
  if (isCrossing(cell)) {
    const solid = cell.traces.some((trace) => (trace.bits & VERTICAL) !== 0 && trace.solid)
    return solid ? SOLID_VERTICAL : DASHED_VERTICAL
  }
  const mask = maskOf(cell)
  const solid = cell.traces.some((trace) => trace.solid)
  if (!solid && (mask & HORIZONTAL) === 0) return DASHED_VERTICAL
  if (!solid && (mask & VERTICAL) === 0) return DASHED_HORIZONTAL
  return SOLID_GLYPHS[mask] ?? ' '
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

type Run = { sum: number; group: number; vertices: number[] }

function keyOf(run: Run): number {
  return run.sum / run.vertices.length
}

function clusteredLayer(
  layer: readonly number[],
  groupOf: readonly number[],
  rank: readonly number[],
  ends: ReadonlySet<number>,
): number[] {
  const runs: Run[] = []
  const blocks = new Map<number, Run>()
  layer.forEach((vertex, at) => {
    const group = groupOf[vertex] ?? NO_GROUP
    const known = blocks.get(group)
    if (known !== undefined) {
      known.sum += at
      known.vertices.push(vertex)
      return
    }
    const run = { sum: at, group, vertices: [vertex] }
    runs.push(run)
    if (group !== NO_GROUP) blocks.set(group, run)
  })
  runs.sort((one, other) => keyOf(one) - keyOf(other))
  const slots = runs.flatMap((run, at) => (run.group === NO_GROUP ? [] : [at]))
  const ranked = slots
    .flatMap((slot) => runs[slot] ?? [])
    .sort((one, other) => (rank[one.group] ?? 0) - (rank[other.group] ?? 0))
  slots.forEach((slot, at) => {
    const run = ranked[at]
    if (run !== undefined) runs[slot] = run
  })
  const looped = runs.findIndex((run) => run.vertices.some((vertex) => ends.has(vertex)))
  const [last] = looped < 0 ? [] : runs.splice(looped, 1)
  if (last !== undefined) {
    last.vertices.sort((one, other) => Number(ends.has(one)) - Number(ends.has(other)))
    runs.push(last)
  }
  return runs.flatMap((run) => run.vertices)
}

function loopEndsBefore(
  layers: readonly number[][],
  groupOf: readonly number[],
  count: number,
  ends: ReadonlySet<number>,
): Set<number>[] {
  const before = Array.from({ length: count }, () => new Set<number>())
  for (const layer of layers) {
    const looped = groupOf[layer.find((vertex) => ends.has(vertex)) ?? NO_GROUP] ?? NO_GROUP
    if (looped === NO_GROUP) continue
    for (const vertex of layer) {
      const group = groupOf[vertex] ?? NO_GROUP
      if (group !== NO_GROUP && group !== looped) before[looped]?.add(group)
    }
  }
  return before
}

function clusterRanks(
  layers: readonly number[][],
  groupOf: readonly number[],
  count: number,
  ends: ReadonlySet<number>,
  meter: LayoutMeter,
): number[] {
  const sums = new Array<number>(count).fill(0)
  const sizes = new Array<number>(count).fill(0)
  for (const layer of layers) {
    layer.forEach((vertex, at) => {
      tick(meter)
      const group = groupOf[vertex] ?? NO_GROUP
      if (group === NO_GROUP) return
      sums[group] = (sums[group] ?? 0) + (at + 1) / (layer.length + 1)
      sizes[group] = (sizes[group] ?? 0) + 1
    })
  }
  const place = (group: number) => (sums[group] ?? 0) / Math.max(1, sizes[group] ?? 0)
  const before = loopEndsBefore(layers, groupOf, count, ends)
  const rank = new Array<number>(count).fill(NO_GROUP)
  for (let at = 0; at < count; at++) {
    tick(meter, count)
    const ready = sums
      .map((_, group) => group)
      .filter(
        (group) =>
          rank[group] === NO_GROUP &&
          [...(before[group] ?? [])].every((other) => rank[other] !== NO_GROUP),
      )
      .sort((one, other) => place(one) - place(other) || one - other)[0]
    if (ready === undefined) throw new DrawingFault(GROUP_ORDER)
    rank[ready] = at
  }
  return rank
}

function clustersOf(
  chart: Flowchart,
  layers: number[][],
  layerOf: readonly number[],
  groupOf: readonly number[],
  loops: readonly Link[],
  meter: LayoutMeter,
): Cluster[] {
  const groups = chart.groups ?? []
  if (groups.length === 0) return []
  const ends = new Set(loops.flatMap((link) => [link.from, link.to]))
  const rank = clusterRanks(layers, groupOf, groups.length, ends, meter)
  layers.forEach((layer, at) => {
    tick(meter, layer.length)
    layers[at] = clusteredLayer(layer, groupOf, rank, ends)
  })
  return groups.map((group, at) => {
    const spanned = layerOf.filter((_, vertex) => groupOf[vertex] === at)
    return {
      label: group.label,
      first: Math.min(...spanned),
      last: Math.max(...spanned),
      rank: rank[at] ?? at,
    }
  })
}

function membershipsOf(chart: Flowchart): number[] {
  const index = new Map(chart.nodes.map((node, at) => [node.id, at]))
  const groupOf = chart.nodes.map(() => NO_GROUP)
  ;(chart.groups ?? []).forEach((group, at) => {
    for (const id of group.nodes) {
      const node = index.get(id)
      if (node === undefined) throw new DrawingFault('a subgraph names no box')
      groupOf[node] = at
    }
  })
  return groupOf
}

function layersByIndex(layerOf: readonly number[]): number[][] {
  const layers: number[][] = []
  layerOf.forEach((layer, vertex) => {
    while (layers.length <= layer) layers.push([])
    layers[layer]?.push(vertex)
  })
  return layers
}

function widestLayer(layerOf: readonly number[]): number {
  return Math.max(0, ...layersByIndex(layerOf).map((layer) => layer.length))
}

function settleUnlinked(
  layerOf: number[],
  groupOf: readonly number[],
  linked: ReadonlySet<number>,
): void {
  const homes = new Map<number, number>()
  let next = 0
  layerOf.forEach((layer, vertex) => {
    if (!linked.has(vertex)) return
    next = Math.max(next, layer + 1)
    const group = groupOf[vertex] ?? NO_GROUP
    if (group !== NO_GROUP) homes.set(group, Math.min(homes.get(group) ?? layer, layer))
  })
  layerOf.forEach((_, vertex) => {
    if (linked.has(vertex)) return
    const group = groupOf[vertex] ?? NO_GROUP
    const home = homes.get(group) ?? next++
    homes.set(group, home)
    layerOf[vertex] = home
  })
}

function wrapLayers(layerOf: number[], groupOf: readonly number[], perRow: number): void {
  const rank = (vertex: number) => {
    const group = groupOf[vertex] ?? NO_GROUP
    return group === NO_GROUP ? Number.MAX_SAFE_INTEGER : group
  }
  let row = 0
  for (const layer of layersByIndex(layerOf)) {
    const ordered = [...layer].sort((one, other) => rank(one) - rank(other) || one - other)
    ordered.forEach((vertex, at) => {
      layerOf[vertex] = row + Math.floor(at / perRow)
    })
    row += Math.max(1, Math.ceil(ordered.length / perRow))
  }
}

function graphOf(chart: Flowchart, meter: LayoutMeter, perRow = Infinity): Graph {
  if (chart.nodes.length === 0) throw new DrawingFault('the flowchart has no boxes')
  const count = chart.nodes.length
  const groupOf = membershipsOf(chart)
  const links = linksOf(chart, meter)
  const loopSet = loopsOf(count, links, meter)
  if (loopSet.size > MOST_LOOPS) {
    throw new DrawingFault(`${String(loopSet.size)} loops back, at most ${String(MOST_LOOPS)} draw`)
  }
  const forward = links.filter((link) => !loopSet.has(link))
  const layerOf = layersOf(count, forward, meter)
  if (Number.isFinite(perRow)) {
    settleUnlinked(layerOf, groupOf, new Set(links.flatMap((link) => [link.from, link.to])))
    wrapLayers(layerOf, groupOf, perRow)
  }
  const outgoing: Segment[][] = Array.from({ length: count }, () => [])
  const incoming: Segment[][] = Array.from({ length: count }, () => [])
  const addVertex = (layer: number, group: number) => {
    layerOf.push(layer)
    groupOf.push(group)
    outgoing.push([])
    incoming.push([])
    return layerOf.length - 1
  }
  for (const link of forward) {
    let from = link.from
    const last = layerOf[link.to] ?? 0
    const shared =
      groupOf[link.from] === groupOf[link.to] ? (groupOf[link.from] ?? NO_GROUP) : NO_GROUP
    for (let layer = (layerOf[from] ?? 0) + 1; layer <= last; layer++) {
      tick(meter)
      const to = layer === last ? link.to : addVertex(layer, shared)
      const segment: Segment = { from, to, link, first: from === link.from }
      outgoing[from]?.push(segment)
      incoming[to]?.push(segment)
      from = to
    }
  }
  const layers = layersByIndex(layerOf)
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
  const clusters = clustersOf(chart, layers, layerOf, groupOf, loops, meter)
  const leaving = new Set(loops.map((link) => link.from))
  const turns = new Set(loops.map((link) => link.to).filter((vertex) => leaving.has(vertex)))
  const real = new Set(links.map((link) => pairKey(link.from, link.to)))
  const reach = new Map(
    chart.nodes.map((_, node) => {
      const targets = forward.filter((link) => link.from === node).map((link) => link.to)
      return [node, targets.sort((one, other) => one - other).join(' ')]
    }),
  )
  return {
    nodes: chart.nodes,
    layerOf,
    groupOf,
    clusters,
    layers,
    outgoing,
    incoming,
    loops,
    turns,
    real,
    reach,
  }
}

function pointShape(node: FlowNode): Shape {
  const lines = [shownLabel(node.label[0] ?? '')]
  return { lines, width: widestLabel(lines), height: 1, shape: node.shape }
}

function shapeOf(node: FlowNode, wrap: number | null, wordRoom: number, turning: boolean): Shape {
  if (node.shape === 'point') return pointShape(node)
  const text = node.label
    .map(shownLabel)
    .flatMap((line) => (wrap === null ? [line] : wrappedLabel(line, wrap, wordRoom)))
  const lines = text.length === 0 ? [plainLabel('')] : text
  if (turning && lines.length < 2) lines.push(plainLabel(''))
  const marked =
    node.shape === 'decision'
      ? lines.map((line, at) => prefixed(at === 0 ? DECISION_MARK : DECISION_INDENT, line))
      : lines
  return {
    lines: marked,
    width: widest(textsOf(marked)) + BOX_PADDING,
    height: marked.length + 2,
    shape: node.shape,
  }
}

function edgeLabel(
  label: readonly string[],
  rule: Pick<LabelRule, 'cut' | 'edgeWrap' | 'breaksWords'>,
): Label[] {
  const { cut, edgeWrap, breaksWords } = rule
  return label
    .map(shownLabel)
    .filter((line) => line.text.trim() !== '')
    .flatMap((line) => {
      if (edgeWrap !== null) return wrappedLabel(line, edgeWrap, breaksWords ? edgeWrap : Infinity)
      return [cut === null ? line : fittedLabel(line, cut)]
    })
}

export function wrappedLabel(label: Label, width: number, longestWord = Infinity): Label[] {
  return relabelled(label, wrapWords(label.text, width, Math.max(width, longestWord)))
}

export function longestWord(nodes: readonly FlowNode[]): number {
  return Math.max(
    0,
    ...nodes.flatMap((node) =>
      node.label.flatMap((line) => shownLabel(line).text.split(' ').map(displayWidth)),
    ),
  )
}

export function widestLabel(labels: readonly Label[] | undefined): number {
  return widest(textsOf(labels ?? []))
}

function entryGap(entries: readonly Entry[], at: number, direction: FlowDirection): number {
  if (direction === 'LR') return (entries[at + 1]?.label.length ?? 0) + 1
  const label = widestLabel(entries[at]?.label)
  return label === 0 ? ENTRY_SPACING : label + LABEL_INDENT + 1
}

function spreadEntries(entries: readonly Entry[], direction: FlowDirection): number {
  const gaps = entries.slice(1).map((_, at) => entryGap(entries, at, direction))
  const span = gaps.reduce((total, gap) => total + gap, 0)
  let offset = -Math.floor(span / 2)
  entries.forEach((entry, at) => {
    entry.offset = offset
    offset += gaps[at] ?? 0
  })
  return span
}

function grown(shape: Shape, direction: FlowDirection, span: number): Shape {
  if (direction === 'TD') return { ...shape, width: Math.max(shape.width, span + DOWN_ENTRY_ROOM) }
  const height = Math.max(shape.height, span + ACROSS_ENTRY_ROOM)
  const lines = [...shape.lines]
  while (lines.length < height - 2) lines.push(plainLabel(''))
  return { ...shape, lines, height }
}

function entriesOf(
  graph: Graph,
  vertex: number,
  rank: ReadonlyMap<number, number>,
  attempt: Attempt,
  split: ReadonlySet<number>,
): Map<Segment, Entry> {
  const segments = [...(graph.incoming[vertex] ?? [])].sort(
    (one, other) =>
      (rank.get(one.from) ?? 0) - (rank.get(other.from) ?? 0) || one.from - other.from,
  )
  const entries = new Map<Segment, Entry>()
  for (const segment of segments) {
    const label = segment.first ? edgeLabel(segment.link.label, attempt) : []
    const arrow = segment.link.arrow
    const sharing =
      label.length === 0 && !split.has(vertex)
        ? `${String(arrow)} ${graph.reach.get(segment.link.from) ?? ''}`
        : null
    const shared = [...entries.values()].find(
      (entry) => sharing !== null && entry.sharing === sharing,
    )
    entries.set(segment, shared ?? { label, arrow, offset: 0, sharing })
  }
  return entries
}

type ShapeCache = Map<string, Shape>

function wordRoomOf(attempt: Attempt, width: number, levelSize: number): number {
  if (!attempt.breaksWords || attempt.wrap === null) return Infinity
  return Math.max(attempt.wrap, Math.floor(width / Math.max(levelSize, 1)) - BOX_PADDING - 1)
}

function cachedShape(
  cache: ShapeCache,
  node: FlowNode,
  vertex: number,
  wrap: number | null,
  wordRoom: number,
  turning: boolean,
): Shape {
  const key = `${String(vertex)} ${String(wrap)} ${String(wordRoom)} ${String(turning)}`
  const known = cache.get(key)
  if (known !== undefined) return known
  const made = shapeOf(node, wrap, wordRoom, turning)
  cache.set(key, made)
  return made
}

function planOf(
  graph: Graph,
  attempt: Attempt,
  split: ReadonlySet<number>,
  meter: LayoutMeter,
  cache: ShapeCache,
  width: number,
): Plan {
  const rank = new Map(graph.layers.flatMap((layer) => layer.map((vertex, at) => [vertex, at])))
  const entryOf = new Map<Segment, Entry>()
  const entries = graph.layerOf.map((_, vertex) => {
    const owned = entriesOf(graph, vertex, rank, attempt, split)
    tick(meter, owned.size + 1)
    owned.forEach((entry, segment) => entryOf.set(segment, entry))
    return [...new Set(owned.values())]
  })
  const shapes = graph.layerOf.map((_, vertex) => {
    const node = graph.nodes[vertex]
    if (node === undefined) return null
    const levelSize = graph.layers[graph.layerOf[vertex] ?? 0]?.length ?? 1
    const wordRoom = wordRoomOf(attempt, width, levelSize)
    const shape = cachedShape(cache, node, vertex, attempt.wrap, wordRoom, graph.turns.has(vertex))
    const own = entries[vertex] ?? []
    const span = spreadEntries(own, attempt.direction)
    return own.length > 1 ? grown(shape, attempt.direction, span) : shape
  })
  const titles = graph.clusters.map((cluster) => titleOf(cluster.label, attempt.wrap))
  const writtenTitles = graph.clusters.map((cluster) => titleOf(cluster.label, null))
  return {
    graph,
    shapes,
    entries,
    entryOf,
    titles,
    writtenTitles,
    cut: attempt.cut,
    edgeWrap: attempt.edgeWrap,
    breaksWords: attempt.breaksWords,
    compact: attempt.compact,
    meter,
  }
}

function titleOf(label: readonly string[], wrap: number | null): Label {
  const written = shownLabel(label.join(' ').trim())
  const title = wrap === null ? written : fittedLabel(written, wrap)
  return {
    ...title,
    runs: title.runs.map((run) => ({ ...run, looks: { ...run.looks, isBold: true } })),
  }
}

function titleColumns(title: Label): number {
  return title.text === '' ? 0 : displayWidth(title.text) + 2
}

function entryAt(plan: Plan, ports: readonly number[], segment: Segment): number {
  return (ports[segment.to] ?? 0) + (plan.entryOf.get(segment)?.offset ?? 0)
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
  const last = plan.entries[above]?.at(-1)
  const first = plan.entries[below]?.[0]
  const between = (first?.offset ?? 0) - (last?.offset ?? 0)
  if (direction === 'TD') {
    const label = widestLabel(last?.label)
    return Math.max(boxes, (label === 0 ? 1 : label + LABEL_INDENT + 1) - between)
  }
  return Math.max(boxes, (first?.label.length ?? 0) + 1 - between)
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
      const above = layer[index] ?? vertex
      return Math.max(
        separation(plan, above, vertex, direction),
        frameSeparation(plan, above, vertex, direction),
      )
    })
    const packed = [0]
    gaps.forEach((gap) => packed.push((packed.at(-1) ?? 0) + gap))
    const wanted = layer.map((vertex, index) => {
      const parents = (graph.incoming[vertex] ?? []).map((segment) => ports[segment.from] ?? 0)
      tick(meter, parents.length + 1)
      if (at === 0 || parents.length === 0) return packed[index] ?? 0
      return direction === 'TD' ? median(parents) : Math.floor(median(parents))
    })
    const old = graph.clusters.length === 0 ? null : framedUnits(plan, direction, ports, at - 1)
    const desired = old === null ? wanted : packedInFrames(plan, direction, old, at, wanted, gaps)
    const settledPorts =
      direction === 'TD' ? settled(desired, gaps, meter) : stacked(desired, gaps, meter)
    const placed =
      old === null ? settledPorts : raised(settledPorts, floorsOf(plan, direction, old, at), gaps)
    layer.forEach((vertex, index) => (ports[vertex] = placed[index] ?? 0))
    if (graph.clusters.length > 0) separateFrames(plan, direction, ports, at)
  })
  if (graph.clusters.length > 0 && plan.compact) compactFrames(plan, direction, ports)
  const naturals = ports.map((port, vertex) => port - crossOffset(plan, vertex, direction))
  const slide = (vertex: number) =>
    direction === 'TD' && (plan.shapes[vertex]?.width ?? 0) >= SLIDING_WIDTH ? 1 : 0
  const frameStarts = graph.clusters.map(
    (_, group) => frameExtent(plan, direction, group, ports, (vertex) => naturals[vertex] ?? 0).lo,
  )
  const shift = -Math.min(...naturals.map((start, vertex) => start + slide(vertex)), ...frameStarts)
  return {
    ports: ports.map((port) => port + shift),
    starts: naturals.map((start) => Math.max(start + shift, 0)),
  }
}

function vertexExtent(
  plan: Plan,
  direction: FlowDirection,
  vertex: number,
  port: number,
  start: number,
): Extent {
  let lo = start
  let hi = start + crossSize(plan, vertex, direction) - 1
  for (const entry of plan.entries[vertex] ?? []) {
    if (entry.label.length === 0) continue
    const at = port + entry.offset
    if (direction === 'TD') hi = Math.max(hi, at + LABEL_INDENT + widestLabel(entry.label) - 1)
    else lo = Math.min(lo, at - entry.label.length)
  }
  return { lo, hi }
}

function membersOf(graph: Graph, group: number, through: number): number[] {
  return graph.layerOf.flatMap((layer, vertex) =>
    graph.groupOf[vertex] === group && layer <= through ? [vertex] : [],
  )
}

function titleEnd(
  plan: Plan,
  group: number,
  members: readonly number[],
  ports: readonly number[],
  lo: number,
): number {
  const columns = titleColumns(plan.titles[group] ?? plainLabel(''))
  const first = plan.graph.clusters[group]?.first
  const crossings = members
    .filter((vertex) => plan.graph.layerOf[vertex] === first)
    .flatMap((vertex) =>
      entriesIn(plan, vertex).map((entry) => (ports[vertex] ?? 0) + entry.offset),
    )
    .sort((one, other) => one - other)
  let slot = lo + FRAME_TITLE_INDENT
  for (const col of crossings) {
    if (col > slot + columns) break
    if (col >= slot - 1) slot = col + FRAME_TITLE_INDENT
  }
  return slot + columns + 1
}

function frameExtent(
  plan: Plan,
  direction: FlowDirection,
  group: number,
  ports: readonly number[],
  startOf: (vertex: number) => number,
  through = plan.graph.layers.length,
): Extent {
  const members = membersOf(plan.graph, group, through)
  const extents = members.map((vertex) =>
    vertexExtent(plan, direction, vertex, ports[vertex] ?? 0, startOf(vertex)),
  )
  const inset = FRAME_INSETS[direction]
  const lo = Math.min(...extents.map((extent) => extent.lo)) - inset
  const hi = Math.max(...extents.map((extent) => extent.hi)) + inset
  if (direction === 'LR') return { lo, hi }
  return { lo, hi: Math.max(hi, titleEnd(plan, group, members, ports, lo)) }
}

function spannedRow(
  units: readonly Unit[],
  row: readonly number[],
  layer: number,
  byRank: readonly number[],
): number[] {
  const sequence = row.filter((unit, at) => unit !== row[at - 1])
  const centre = (unit: number) => ((units[unit]?.lo ?? 0) + (units[unit]?.hi ?? 0)) / 2
  for (const frame of byRank) {
    const cluster = units[frame]?.cluster
    if (cluster == null || cluster.first > layer || cluster.last < layer) continue
    if (sequence.includes(frame)) continue
    let low = -1
    let high = sequence.length
    sequence.forEach((unit, at) => {
      const rank = units[unit]?.cluster?.rank
      if (rank === undefined) return
      if (rank < cluster.rank) low = at
      else if (high === sequence.length) high = at
    })
    let at = low + 1
    while (at < high && centre(sequence[at] ?? frame) < centre(frame)) at += 1
    sequence.splice(at, 0, frame)
  }
  return sequence
}

function shiftsApart(
  units: readonly Unit[],
  rows: readonly (readonly number[])[],
  gap: number,
  meter: LayoutMeter,
): number[] {
  const after = units.map(() => [] as { unit: number; need: number }[])
  const waiting = units.map(() => 0)
  for (const row of rows) {
    row.slice(1).forEach((unit, at) => {
      const before = row[at] ?? unit
      const one = units[before]
      const other = units[unit]
      if (one === undefined || other === undefined) return
      const framed = one.cluster !== null || other.cluster !== null
      after[before]?.push({ unit, need: framed ? one.hi + 1 + gap - other.lo : 0 })
      waiting[unit] = (waiting[unit] ?? 0) + 1
    })
  }
  const shifts = units.map(() => 0)
  const ready = units.flatMap((_, unit) => (waiting[unit] === 0 ? [unit] : []))
  for (let at = 0; at < ready.length; at++) {
    const unit = ready[at] ?? 0
    for (const next of after[unit] ?? []) {
      tick(meter)
      shifts[next.unit] = Math.max(shifts[next.unit] ?? 0, (shifts[unit] ?? 0) + next.need)
      waiting[next.unit] = (waiting[next.unit] ?? 0) - 1
      if (waiting[next.unit] === 0) ready.push(next.unit)
    }
  }
  if (ready.length < units.length) throw new DrawingFault(LINES_OVERLAP)
  return shifts
}

function relativeExtent(plan: Plan, direction: FlowDirection, vertex: number): Extent {
  return vertexExtent(plan, direction, vertex, 0, -crossOffset(plan, vertex, direction))
}

function insetOf(graph: Graph, vertex: number, direction: FlowDirection): number {
  return (graph.groupOf[vertex] ?? NO_GROUP) === NO_GROUP ? 0 : FRAME_INSETS[direction]
}

function frameSeparation(
  plan: Plan,
  above: number,
  below: number,
  direction: FlowDirection,
): number {
  const { graph } = plan
  if (graph.groupOf[above] === graph.groupOf[below]) return -Infinity
  const insets = insetOf(graph, above, direction) + insetOf(graph, below, direction)
  const one = relativeExtent(plan, direction, above)
  const other = relativeExtent(plan, direction, below)
  return one.hi + 1 + FRAME_GAPS[direction] + insets - other.lo
}

function raised(placed: readonly number[], floors: readonly number[], gaps: readonly number[]) {
  const ports: number[] = []
  placed.forEach((port, at) => {
    const previous = ports[at - 1]
    const after = previous === undefined ? -Infinity : previous + (gaps[at - 1] ?? 0)
    ports.push(Math.max(port, floors[at] ?? -Infinity, after))
  })
  return ports
}

function packedInFrames(
  plan: Plan,
  direction: FlowDirection,
  old: FramedUnits,
  at: number,
  wanted: readonly number[],
  gaps: readonly number[],
): number[] {
  const { graph } = plan
  const layer = graph.layers[at] ?? []
  const offsets = [0]
  gaps.forEach((gap) => offsets.push((offsets.at(-1) ?? 0) + gap))
  const desired = [...wanted]
  let first = 0
  while (first < layer.length) {
    const group = graph.groupOf[layer[first] ?? 0] ?? NO_GROUP
    let end = first + 1
    while (end < layer.length && graph.groupOf[layer[end] ?? 0] === group) end += 1
    if (group !== NO_GROUP) {
      const block = layer.slice(first, end).map((vertex, index) => ({
        want: (wanted[first + index] ?? 0) - (offsets[first + index] ?? 0),
        own: relativeExtent(plan, direction, vertex),
        offset: offsets[first + index] ?? 0,
      }))
      const unit = old.unitOfCluster.get(group)
      const frame = unit === undefined ? undefined : old.units[unit]
      const centre = mean(block.map((member) => member.want))
      const inset = FRAME_INSETS[direction]
      const low = Math.min(
        ...block.map((m) => (frame?.lo ?? -Infinity) + inset - m.own.hi - m.offset),
      )
      const high = Math.max(
        ...block.map((m) => (frame?.hi ?? Infinity) - inset - m.own.lo - m.offset),
      )
      const start = low > high ? (low + high) / 2 : Math.min(Math.max(centre, low), high)
      const settledStart = direction === 'TD' ? start : Math.floor(start)
      block.forEach((member, index) => (desired[first + index] = settledStart + member.offset))
    }
    first = end
  }
  return desired
}

function floorsOf(plan: Plan, direction: FlowDirection, old: FramedUnits, at: number): number[] {
  const { graph } = plan
  const layer = graph.layers[at] ?? []
  const gap = FRAME_GAPS[direction]
  const clear = (unit: number | undefined) =>
    unit === undefined ? -Infinity : (old.units[unit]?.hi ?? -Infinity) + 1 + gap
  const frameFloor = (group: number) => {
    const unit = old.unitOfCluster.get(group)
    if (unit === undefined) return -Infinity
    return Math.max(
      ...old.rows.map((row) => {
        const index = row.indexOf(unit)
        return index < 1 ? -Infinity : clear(row[index - 1])
      }),
    )
  }
  return layer.map((vertex, index) => {
    tick(plan.meter, old.rows.length + 1)
    const group = graph.groupOf[vertex] ?? NO_GROUP
    const lo = relativeExtent(plan, direction, vertex).lo
    const inset = insetOf(graph, vertex, direction)
    const previous = graph.groupOf[layer[index - 1] ?? vertex] ?? NO_GROUP
    const beside = previous === group ? -Infinity : clear(old.unitOfCluster.get(previous))
    const within = group === NO_GROUP ? -Infinity : frameFloor(group)
    return Math.max(beside, within) + inset - lo
  })
}

type FramedUnits = {
  units: Unit[]
  unitOf: Map<number, number>
  unitOfCluster: Map<number, number>
  rows: number[][]
}

function framedUnits(
  plan: Plan,
  direction: FlowDirection,
  ports: readonly number[],
  through: number,
): FramedUnits {
  const { graph, meter } = plan
  const startOf = (vertex: number) => (ports[vertex] ?? 0) - crossOffset(plan, vertex, direction)
  const unitOfCluster = new Map<number, number>()
  const units: Unit[] = []
  graph.clusters.forEach((cluster, group) => {
    if (cluster.first > through) return
    unitOfCluster.set(group, units.length)
    units.push({ ...frameExtent(plan, direction, group, ports, startOf, through), cluster })
  })
  const unitOf = new Map<number, number>()
  graph.layerOf.forEach((layer, vertex) => {
    if (layer > through) return
    const framed = unitOfCluster.get(graph.groupOf[vertex] ?? NO_GROUP)
    if (framed !== undefined) {
      unitOf.set(vertex, framed)
      return
    }
    const port = ports[vertex] ?? 0
    units.push({ ...vertexExtent(plan, direction, vertex, port, startOf(vertex)), cluster: null })
    unitOf.set(vertex, units.length - 1)
  })
  const byRank = [...unitOfCluster.values()].sort(
    (one, other) => (units[one]?.cluster?.rank ?? 0) - (units[other]?.cluster?.rank ?? 0),
  )
  const rows = graph.layers.slice(0, through + 1).map((layer, at) => {
    tick(meter, layer.length + byRank.length)
    return spannedRow(
      units,
      layer.map((vertex) => unitOf.get(vertex) ?? 0),
      at,
      byRank,
    )
  })
  return { units, unitOf, unitOfCluster, rows }
}

function separateFrames(
  plan: Plan,
  direction: FlowDirection,
  ports: number[],
  through: number,
): void {
  const { units, unitOf, rows } = framedUnits(plan, direction, ports, through)
  const shifts = shiftsApart(units, rows, FRAME_GAPS[direction], plan.meter)
  unitOf.forEach((unit, vertex) => {
    ports[vertex] = (ports[vertex] ?? 0) + (shifts[unit] ?? 0)
  })
}

type Push = { from: number; to: number; need: number }

function compacted(extents: readonly Extent[], pushes: readonly Push[], meter: LayoutMeter) {
  const before = extents.map(() => [] as Push[])
  const after = extents.map(() => [] as Push[])
  const waiting = extents.map(() => 0)
  for (const push of pushes) {
    before[push.to]?.push(push)
    after[push.from]?.push(push)
    waiting[push.to] = (waiting[push.to] ?? 0) + 1
  }
  const order = extents.flatMap((_, item) => (waiting[item] === 0 ? [item] : []))
  for (let at = 0; at < order.length; at++) {
    for (const push of after[order[at] ?? 0] ?? []) {
      tick(meter)
      waiting[push.to] = (waiting[push.to] ?? 0) - 1
      if (waiting[push.to] === 0) order.push(push.to)
    }
  }
  if (order.length < extents.length) throw new DrawingFault(LINES_OVERLAP)
  const loOf = (item: number) => extents[item]?.lo ?? 0
  const hiOf = (item: number) => extents[item]?.hi ?? 0
  const floor = Math.min(...extents.map((extent) => extent.lo))
  const left = extents.map(() => 0)
  for (const item of order) {
    const pushed = (before[item] ?? []).map((push) => (left[push.from] ?? 0) + push.need)
    left[item] = Math.max(floor - loOf(item), ...pushed)
  }
  const ceiling = Math.max(...extents.map((extent, item) => extent.hi + (left[item] ?? 0)))
  const right = extents.map(() => 0)
  for (const item of [...order].reverse()) {
    const pushed = (after[item] ?? []).map((push) => (right[push.to] ?? 0) - push.need)
    right[item] = Math.min(ceiling - hiOf(item), ...pushed)
  }
  const shifts = extents.map(() => 0)
  for (const item of order) {
    const kept = Math.min(Math.max(0, left[item] ?? 0), right[item] ?? 0)
    const pushed = (before[item] ?? []).map((push) => (shifts[push.from] ?? 0) + push.need)
    shifts[item] = Math.max(kept, ...pushed)
  }
  return shifts
}

function portGap(plan: Plan, ports: readonly number[], one: number, other: number): number {
  return (ports[other] ?? 0) - (ports[one] ?? 0)
}

function neededGap(plan: Plan, direction: FlowDirection, above: number, below: number): number {
  return Math.max(
    separation(plan, above, below, direction),
    frameSeparation(plan, above, below, direction),
  )
}

function compactMembers(plan: Plan, direction: FlowDirection, ports: number[], group: number) {
  const { graph } = plan
  const members = membersOf(graph, group, graph.layers.length)
  const itemOf = new Map(members.map((vertex, item) => [vertex, item]))
  const extents = members.map((vertex) => {
    const port = ports[vertex] ?? 0
    return vertexExtent(plan, direction, vertex, port, port - crossOffset(plan, vertex, direction))
  })
  const pushes = graph.layers.flatMap((layer) => {
    const own = layer.filter((vertex) => itemOf.has(vertex))
    return own.slice(1).map((vertex, at) => {
      const above = own[at] ?? vertex
      const need = neededGap(plan, direction, above, vertex) - portGap(plan, ports, above, vertex)
      return { from: itemOf.get(above) ?? 0, to: itemOf.get(vertex) ?? 0, need }
    })
  })
  const shifts = compacted(extents, pushes, plan.meter)
  members.forEach((vertex, item) => {
    ports[vertex] = (ports[vertex] ?? 0) + (shifts[item] ?? 0)
  })
}

function compactFrames(plan: Plan, direction: FlowDirection, ports: number[]): void {
  const { graph } = plan
  graph.clusters.forEach((_, group) => {
    compactMembers(plan, direction, ports, group)
  })
  const { units, unitOf, rows } = framedUnits(plan, direction, ports, graph.layers.length)
  const vertexOf = new Map([...unitOf].map(([vertex, unit]) => [unit, vertex]))
  const gap = FRAME_GAPS[direction]
  const pushes = rows.flatMap((row) =>
    row.slice(1).map((unit, at) => {
      const above = row[at] ?? unit
      const one = units[above]
      const other = units[unit]
      const framed = one?.cluster != null || other?.cluster != null
      const upper = vertexOf.get(above) ?? 0
      const lower = vertexOf.get(unit) ?? 0
      const need = framed
        ? (one?.hi ?? 0) + 1 + gap - (other?.lo ?? 0)
        : neededGap(plan, direction, upper, lower) - portGap(plan, ports, upper, lower)
      return { from: above, to: unit, need }
    }),
  )
  const shifts = compacted(units, pushes, plan.meter)
  unitOf.forEach((unit, vertex) => {
    ports[vertex] = (ports[vertex] ?? 0) + (shifts[unit] ?? 0)
  })
}

type BusItem = {
  source: number
  low: number
  high: number
  port: number
  drops: Map<number, Entry | undefined>
  targets: Set<Entry | undefined>
}

function bandOf(plan: Plan, segments: readonly Segment[], ports: readonly number[]): Band {
  const bySource = new Map<number, Segment[]>()
  for (const segment of segments) {
    const known = bySource.get(segment.from) ?? []
    known.push(segment)
    bySource.set(segment.from, known)
  }
  const items: BusItem[] = []
  for (const [source, outgoing] of bySource) {
    const port = ports[source] ?? 0
    const drops = new Map(
      outgoing.map((segment) => [entryAt(plan, ports, segment), plan.entryOf.get(segment)]),
    )
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
  return tracksOf(items, plan.meter)
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

function drawBox(canvas: Canvas, shape: Shape, row: number, col: number, ink: Ink): void {
  if (shape.shape === 'point') {
    canvas.putLabel(row, col, shape.lines[0] ?? plainLabel(''), 'head')
    return
  }
  const [topLeft, topRight, bottomLeft, bottomRight] =
    shape.shape === 'decision' ? SQUARE_CORNERS : ROUNDED_CORNERS
  const across = BORDER_ACROSS.repeat(shape.width - 2)
  canvas.put(row, col, `${topLeft}${across}${topRight}`, ink)
  shape.lines.forEach((line, at) => {
    const columns = displayWidth(line.text)
    const room = ' '.repeat(shape.width - BOX_PADDING - columns)
    canvas.put(row + 1 + at, col, `${BORDER_DOWN} `, ink)
    canvas.putLabel(row + 1 + at, col + 2, line, ink)
    canvas.put(row + 1 + at, col + 2 + columns, `${room} ${BORDER_DOWN}`, ink)
  })
  canvas.put(row + shape.height - 1, col, `${bottomLeft}${across}${bottomRight}`, ink)
}

function entriesIn(plan: Plan, vertex: number): Entry[] {
  return plan.entries[vertex] ?? []
}

function labelRowsOf(entry: Entry): number {
  return entry.label.length
}

function sourcesOf(graph: Graph, layer: readonly number[]): Segment[] {
  return layer.flatMap((vertex) => graph.outgoing[vertex] ?? [])
}

function placeText(canvas: Canvas, row: number, col: number, lines: readonly Label[]): void {
  let at = row
  while (!lines.every((line, index) => canvas.fits(at + index, col, line.text))) at += 1
  lines.forEach((line, index) => {
    canvas.putLabel(at + index, col, line, 'label')
  })
}

function sortedLoops(loops: readonly Link[], spanOf: (link: Link) => number): Link[] {
  return [...loops].sort((one, other) => spanOf(one) - spanOf(other) || one.order - other.order)
}

function entryColumns(
  plan: Plan,
  ports: readonly number[],
  target: number,
  entry: Entry,
): number[] {
  return entriesIn(plan, target)
    .filter((other) => other !== entry)
    .map((other) => (ports[target] ?? 0) + other.offset)
}

function sideStep(
  plan: Plan,
  direction: FlowDirection,
  placement: Placement,
  target: number,
  column: number,
  taken: ReadonlySet<number>,
  siblings: readonly number[],
): number {
  const start = placement.starts[target] ?? 0
  const size = crossSize(plan, target, direction)
  for (const step of [1, -1]) {
    const moved = column + step
    const inside = moved > start && moved < start + size - 1
    const apart = siblings.every((sibling) => Math.abs(sibling - moved) >= ENTRY_SPACING)
    if (inside && apart && !taken.has(moved)) return step
  }
  return 0
}

function detangle(plan: Plan, direction: FlowDirection, placement: Placement): void {
  const { graph } = plan
  const { ports } = placement
  if (graph.clusters.length === 0) return
  for (const layer of graph.layers) {
    const segments = sourcesOf(graph, layer)
    const taken = new Set(segments.map((segment) => ports[segment.from] ?? 0))
    const owners = new Map<Entry, Segment[]>()
    for (const segment of segments) {
      const entry = plan.entryOf.get(segment)
      if (entry !== undefined) owners.set(entry, [...(owners.get(entry) ?? []), segment])
    }
    owners.forEach((owned, entry) => {
      tick(plan.meter, segments.length)
      const target = owned[0]?.to ?? 0
      if (plan.shapes[target] == null) return
      const column = (ports[target] ?? 0) + entry.offset
      const feeding = new Set(owned.map((segment) => ports[segment.from] ?? 0))
      if (!taken.has(column) || feeding.has(column)) return
      const siblings = entryColumns(plan, ports, target, entry)
      entry.offset += sideStep(plan, direction, placement, target, column, taken, siblings)
    })
  }
}

function opensFrame(graph: Graph, layer: number): boolean {
  return graph.clusters.some((cluster) => cluster.first === layer)
}

function closesFrame(graph: Graph, layer: number): boolean {
  return graph.clusters.some((cluster) => cluster.last === layer)
}

function frameRoom(opens: boolean, room: number): number {
  return opens ? room : 0
}

function freeSlot(canvas: Canvas, frame: Frame, chunk: string): number | null {
  const last = frame.right - 1 - displayWidth(chunk)
  for (let col = frame.left + FRAME_TITLE_INDENT; col <= last; col++) {
    if (canvas.fits(frame.top, col - 1, ` ${chunk} `)) return col
  }
  return null
}

function titleRooms(canvas: Canvas, frame: Frame): number[] {
  const first = frame.left + FRAME_TITLE_INDENT - 1
  const rooms: number[] = []
  let run = 0
  for (let col = frame.right - 1; col >= first; col--) {
    run = canvas.isFree(frame.top, col) ? run + 1 : 0
    rooms[col - first] = run - TITLE_PADDING
  }
  return rooms
}

function placedTitle(canvas: Canvas, frame: Frame): { title: Label; from: number } {
  const least = displayWidth(frame.title.text)
  const rooms = titleRooms(canvas, frame)
  const columns = Math.min(displayWidth(frame.written.text), Math.max(0, ...rooms))
  const at = rooms.findIndex((room) => room >= columns)
  if (columns > least && at >= 0) {
    const from = frame.left + FRAME_TITLE_INDENT + at
    return { title: fittedLabel(frame.written, columns), from }
  }
  const from = freeSlot(canvas, frame, ` ${frame.title.text} `)
  if (from === null) throw new DrawingFault(LINES_OVERLAP)
  return { title: frame.title, from }
}

function drawFrame(canvas: Canvas, frame: Frame): void {
  const { top, left, bottom, right } = frame
  const [topLeft, topRight, bottomLeft, bottomRight] = SQUARE_CORNERS
  const placed = frame.title.text === '' ? null : placedTitle(canvas, frame)
  const title = placed?.title ?? frame.title
  const chunk = placed === null ? '' : ` ${title.text} `
  const from = placed?.from ?? left
  const to = from + displayWidth(chunk)
  if (chunk !== '') {
    canvas.put(top, from, ' ', 'line')
    canvas.putLabel(top, from + 1, title, 'plain')
    canvas.put(top, to - 1, ' ', 'line')
  }
  for (let col = left + 1; col < right; col++) {
    if (col < from || col >= to) canvas.border(top, col, FRAME_ACROSS)
    canvas.border(bottom, col, FRAME_ACROSS)
  }
  for (let row = top + 1; row < bottom; row++) {
    canvas.border(row, left, FRAME_DOWN)
    canvas.border(row, right, FRAME_DOWN)
  }
  canvas.border(top, left, topLeft)
  canvas.border(top, right, topRight)
  canvas.border(bottom, left, bottomLeft)
  canvas.border(bottom, right, bottomRight)
}

function drawDown(plan: Plan): Canvas {
  const { graph, meter } = plan
  const placement = placementOf(plan, 'TD')
  const { ports, starts } = placement
  detangle(plan, 'TD', placement)
  const tops: number[] = []
  const depths: number[] = []
  const bands: Band[] = []
  const labelRows: number[] = []
  const below = (at: number) => frameRoom(closesFrame(graph, at), DOWN_FRAME_ROOM)
  const above = (at: number) => frameRoom(opensFrame(graph, at), DOWN_FRAME_ROOM)
  let top = frameRoom(opensFrame(graph, 0), DOWN_FRAME_TOP_ROWS)
  graph.layers.forEach((layer, at) => {
    tops.push(top)
    const depth = Math.max(1, ...layer.map((vertex) => plan.shapes[vertex]?.height ?? 1))
    const band = bandOf(plan, sourcesOf(graph, layer), ports)
    const next = graph.layers[at + 1] ?? []
    const rows = Math.max(0, ...next.flatMap((vertex) => entriesIn(plan, vertex).map(labelRowsOf)))
    depths.push(depth)
    bands.push(band)
    labelRows.push(rows)
    top += depth + below(at) + band.trackCount + rows + above(at + 1) + 1
  })
  const canvas = new Canvas()
  graph.layers.forEach((layer, at) => {
    for (const vertex of layer) {
      const shape = plan.shapes[vertex]
      if (shape != null) drawBox(canvas, shape, tops[at] ?? 0, starts[vertex] ?? 0, vertex)
    }
  })
  graph.layers.forEach((layer, at) => {
    const layerTop = tops[at] ?? 0
    const band = bands[at] ?? { tracks: new Map<number, number>(), trackCount: 0 }
    const linkTop = layerTop + (depths[at] ?? 1) + below(at)
    const arrowRow = linkTop + band.trackCount + (labelRows[at] ?? 0) + above(at + 1)
    const marked = new Set<number>()
    for (const segment of sourcesOf(graph, layer)) {
      tick(meter)
      const source = segment.from
      const target = segment.to
      const sourceShape = plan.shapes[source]
      const targetShape = plan.shapes[target]
      const from = ports[source] ?? 0
      const to = entryAt(plan, ports, segment)
      const startRow = sourceShape == null ? layerTop : layerTop + sourceShape.height
      if (sourceShape != null && sourceShape.shape !== 'point' && !marked.has(source)) {
        canvas.mark(startRow - 1, from, PORT_BELOW)
        marked.add(source)
      }
      const arrowed = targetShape != null && segment.link.arrow
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
      if (endRow >= startRow) canvas.path(points, segment.link, segment.link.stroke, UP, DOWN)
    }
    for (const target of graph.layers[at + 1] ?? []) {
      for (const entry of entriesIn(plan, target)) {
        const to = (ports[target] ?? 0) + entry.offset
        if (plan.shapes[target] != null) {
          if (entry.arrow) canvas.put(arrowRow, to, ARROW_DOWN, 'head')
          else if (plan.shapes[target].shape !== 'point') canvas.mark(arrowRow + 1, to, PORT_ABOVE)
        }
        entry.label.forEach((line, index) => {
          canvas.putLabel(linkTop + band.trackCount + index, to + LABEL_INDENT, line, 'label')
        })
      }
    }
  })
  graph.clusters.forEach((cluster, group) => {
    const { lo, hi } = frameExtent(plan, 'TD', group, ports, (vertex) => starts[vertex] ?? 0)
    drawFrame(canvas, {
      top: (tops[cluster.first] ?? 0) - DOWN_FRAME_TOP_ROWS,
      left: lo,
      bottom: (tops[cluster.last] ?? 0) + (depths[cluster.last] ?? 1),
      right: hi,
      title: plan.titles[group] ?? plainLabel(''),
      written: plan.writtenTitles[group] ?? plainLabel(''),
    })
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
    canvas.path(points, link, link.stroke, LEFT, LEFT)
    if (link.arrow && !arrowed.has(link.to)) {
      canvas.put(targetRow, entry, ARROW_LEFT, 'head')
      arrowed.add(link.to)
    }
  })
  for (const link of loops) {
    const label = edgeLabel(link.label, plan)
    if (label.length > 0) placeText(canvas, rowOf(link.from, true), outermost + LABEL_INDENT, label)
  }
}

type AcrossBand = Band & { width: number; labelStarts: Map<Entry, number> }

function labelStartOf(
  plan: Plan,
  band: Band,
  segments: readonly Segment[],
  entry: Entry,
  ports: readonly number[],
): number {
  const owned = segments.filter((segment) => plan.entryOf.get(segment) === entry)
  const port = owned[0] === undefined ? 0 : entryAt(plan, ports, owned[0])
  const low = port - entry.label.length
  const high = port - 1
  const columns = widestLabel(entry.label)
  const busColumn = (source: number) => STUB_COLUMNS + BUS_SPACING * (band.tracks.get(source) ?? 0)
  const runStarts = owned.map((segment) =>
    (ports[segment.from] ?? 0) === port ? 0 : busColumn(segment.from),
  )
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
        .map((segment) => entryAt(plan, ports, segment))
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
  const band = bandOf(plan, segments, ports)
  const base =
    band.trackCount === 0
      ? STRAIGHT_LINK_COLUMNS
      : STUB_COLUMNS + BUS_SPACING * (band.trackCount - 1) + STRAIGHT_LINK_COLUMNS + 1
  const labelStarts = new Map<Entry, number>()
  let width = base
  for (const entry of next.flatMap((target) => entriesIn(plan, target))) {
    if (entry.label.length === 0) continue
    const start = labelStartOf(plan, band, segments, entry, ports)
    labelStarts.set(entry, start)
    width = Math.max(width, start + widestLabel(entry.label) + 1)
  }
  return { ...band, width, labelStarts }
}

function drawAcross(plan: Plan): Canvas {
  const { graph, meter } = plan
  const placement = placementOf(plan, 'LR')
  const { ports, starts } = placement
  detangle(plan, 'LR', placement)
  const lefts: number[] = []
  const widths: number[] = []
  const bands: AcrossBand[] = []
  const after = (at: number) => frameRoom(closesFrame(graph, at), ACROSS_FRAME_ROOM)
  const before = (at: number) => frameRoom(opensFrame(graph, at), ACROSS_FRAME_ROOM)
  const titled = (at: number) =>
    graph.clusters.flatMap((cluster, group) =>
      cluster.first === at ? [titleColumns(plan.titles[group] ?? plainLabel(''))] : [],
    )
  let left = before(0)
  graph.layers.forEach((layer, at) => {
    lefts.push(left)
    const boxes = layer.map((vertex) => plan.shapes[vertex]?.width ?? 1)
    const width = Math.max(1, ...boxes, ...titled(at))
    widths.push(width)
    const band = acrossBandOf(plan, layer, graph.layers[at + 1] ?? [], ports)
    bands.push(band)
    left += width + after(at) + band.width + before(at + 1)
  })
  const canvas = new Canvas()
  graph.layers.forEach((layer, at) => {
    for (const vertex of layer) {
      const shape = plan.shapes[vertex]
      if (shape != null) drawBox(canvas, shape, starts[vertex] ?? 0, lefts[at] ?? 0, vertex)
    }
  })
  graph.layers.forEach((layer, at) => {
    const band = bands[at]
    if (band === undefined || at === graph.layers.length - 1) return
    const layerLeft = lefts[at] ?? 0
    const linkLeft = layerLeft + (widths[at] ?? 1) + after(at)
    const arrowCol = linkLeft + band.width + before(at + 1) - 1
    for (const segment of sourcesOf(graph, layer)) {
      tick(meter)
      const sourceShape = plan.shapes[segment.from]
      const from = ports[segment.from] ?? 0
      const to = entryAt(plan, ports, segment)
      const startCol = sourceShape == null ? layerLeft : layerLeft + sourceShape.width
      const arrowed = plan.shapes[segment.to] != null && segment.link.arrow
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
      canvas.path(points, segment.link, segment.link.stroke, LEFT, RIGHT)
    }
    for (const target of graph.layers[at + 1] ?? []) {
      for (const entry of entriesIn(plan, target)) {
        const to = (ports[target] ?? 0) + entry.offset
        if (plan.shapes[target] != null && entry.arrow) {
          canvas.put(to, arrowCol, ARROW_RIGHT, 'head')
        }
        const start = band.labelStarts.get(entry) ?? 0
        entry.label.forEach((line, index) => {
          canvas.putLabel(to - entry.label.length + index, linkLeft + start, line, 'label')
        })
      }
    }
  })
  graph.clusters.forEach((cluster, group) => {
    const { lo, hi } = frameExtent(plan, 'LR', group, ports, (vertex) => starts[vertex] ?? 0)
    drawFrame(canvas, {
      top: lo,
      left: (lefts[cluster.first] ?? 0) - ACROSS_FRAME_ROOM,
      bottom: hi,
      right: (lefts[cluster.last] ?? 0) + (widths[cluster.last] ?? 1) + ACROSS_FRAME_ROOM - 1,
      title: plan.titles[group] ?? plainLabel(''),
      written: plan.writtenTitles[group] ?? plainLabel(''),
    })
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
    if (!exits.has(link.from) && plan.shapes[link.from]?.shape !== 'point') {
      canvas.mark(bottomOf(link.from) - 1, exit, PORT_BELOW)
      exits.add(link.from)
    }
    const points = [
      { row: bottomOf(link.from), col: exit },
      { row: channel, col: exit },
      { row: channel, col: entry },
      { row: link.arrow ? below + 1 : below, col: entry },
    ]
    canvas.path(points, link, link.stroke, UP, UP)
    if (link.arrow && !arrowed.has(link.to)) {
      canvas.put(below, entry, ARROW_UP, 'head')
      arrowed.add(link.to)
    }
  })
  for (const link of loops) {
    const label = edgeLabel(link.label, plan)
    if (label.length > 0) placeText(canvas, outermost + 1, columnOf(link.from, true), label)
  }
}

export type LevelRows = 'kept' | 'wrapped'

function attemptsOf(
  direction: FlowDirection,
  framed: boolean,
  widest: number,
  levelRows: LevelRows,
  longest: number,
): Attempt[] {
  type Labelled = Pick<Attempt, 'direction'> & LabelRule
  const plain: Labelled[] =
    direction === 'LR'
      ? [
          { direction: 'LR', ...PLAIN_LABELS },
          { direction: 'TD', ...PLAIN_LABELS },
        ]
      : [{ direction: 'TD', ...PLAIN_LABELS }]
  const down = (rules: readonly LabelRule[]): Labelled[] =>
    rules.map((labels) => ({ direction: 'TD', ...labels }))
  const packings = framed ? [true, false] : [false]
  const packed = (labelled: readonly Labelled[], perRow: number): Attempt[] =>
    labelled.flatMap((attempt) => packings.map((compact) => ({ ...attempt, compact, perRow })))
  const caps = rowCapsOf(widest)
  const everyRow = (labelled: readonly Labelled[]): Attempt[] => [
    ...packed(labelled, Infinity),
    ...caps.flatMap((perRow) => packed(labelled, perRow)),
  ]
  if (levelRows === 'kept') {
    return packed(
      [...plain, ...down(FITTED_LABELS), ...down(brokenLabels(FITTED_LABELS, longest))],
      Infinity,
    )
  }
  const whole = [...FITTED_LABELS, WRAPPED_EDGE_LABELS]
  return [
    ...packed(plain, Infinity),
    ...caps.flatMap((perRow) => packed(down([PLAIN_LABELS]), perRow)),
    ...everyRow(down(whole)),
    ...everyRow(down(brokenLabels(whole, longest))),
  ]
}

function rowCapsOf(widest: number): number[] {
  const caps: number[] = []
  for (let rows = 2; rows <= widest; rows++) {
    const perRow = Math.ceil(widest / rows)
    if (caps.at(-1) !== perRow) caps.push(perRow)
  }
  return caps
}

function fitsScreen(canvas: Canvas, width: number): boolean {
  return canvas.width <= width && canvas.height <= MOST_ROWS
}

function drawAttempt(
  graph: Graph,
  attempt: Attempt,
  width: number,
  meter: LayoutMeter,
  cache: ShapeCache,
): Canvas {
  let split = new Set<number>()
  for (;;) {
    const plan = planOf(graph, attempt, split, meter, cache, width)
    const canvas = attempt.direction === 'TD' ? drawDown(plan) : drawAcross(plan)
    if (!fitsScreen(canvas, width)) return canvas
    const wrong = canvas.falseLinks(graph.real, meter)
    if (wrong.length === 0) return canvas
    const next = new Set([...split, ...wrong.map((link) => link.to)])
    if (next.size === split.size) throw new DrawingFault(LINES_OVERLAP)
    split = next
  }
}

export function drawFlowchart(
  chart: Flowchart,
  width: number,
  meter: LayoutMeter = { steps: 0 },
  levelRows: LevelRows = 'kept',
): FlowDrawing | Refusal {
  let graph: Graph
  try {
    graph = graphOf(chart, meter)
  } catch (error) {
    if (error instanceof DrawingFault) return refusal(error.reason)
    throw error
  }
  const graphs = new Map<number, Graph>([[Infinity, graph]])
  const shapes: ShapeCache = new Map()
  const graphWith = (perRow: number): Graph => {
    const known = graphs.get(perRow)
    if (known !== undefined) return known
    const made = graphOf(chart, meter, perRow)
    graphs.set(perRow, made)
    return made
  }
  const widest = widestLayer(graph.layerOf.slice(0, chart.nodes.length))
  let narrowest = Infinity
  let shortest = Infinity
  let fault: string | null = null
  for (const attempt of attemptsOf(
    chart.direction,
    graph.clusters.length > 0,
    widest,
    levelRows,
    longestWord(chart.nodes),
  )) {
    let canvas: Canvas
    try {
      canvas = drawAttempt(graphWith(attempt.perRow), attempt, width, meter, shapes)
    } catch (error) {
      if (!(error instanceof DrawingFault)) throw error
      fault ??= error.reason
      continue
    }
    const fitsWidth = canvas.width <= width
    if (fitsScreen(canvas, width)) return drawingOf(canvas.inkedLines())
    narrowest = Math.min(narrowest, canvas.width)
    if (fitsWidth) shortest = Math.min(shortest, canvas.height)
  }
  if (Number.isFinite(shortest)) {
    return refusal(`${String(shortest)} rows, at most ${String(MOST_ROWS)} draw`)
  }
  if (Number.isFinite(narrowest)) {
    return tooWide(narrowest, width)
  }
  return refusal(fault ?? LINES_OVERLAP)
}
