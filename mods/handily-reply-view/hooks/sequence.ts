import { MOST_ROWS, shown, tick, widest, type LayoutMeter } from './flowchart'
import type {
  Message,
  MessageHead,
  Note,
  NotePlacement,
  Refusal,
  SequenceBlock,
  SequenceDiagram,
  SequenceEvent,
  Stroke,
} from './mermaid'
import { wrapCell } from './table'
import { displayWidth, fitted, graphemesOf, padToWidth } from './width'

export type SequenceDrawing = { kind: 'drawing'; lines: string[] }

const BOX_GAP = 8
const BOX_PADDING = 4
const LABEL_ROOM = 5
const CLEARANCE = 2
const SPAN_NOTE_MARGIN = 2
const SIDE_NOTE_GAP = 2
const LOOP_COLUMNS = 3
const LOOP_LABEL_OFFSET = 5
const LOOP_ROWS = 2
const MOST_LABEL_LINES = 3
const DEPTH_INDENT = 2
const ROW_HEAD = '┄┄ '
const ROW_FILL = '┄'
const ROW_CROSSING = '┼'
const ROW_TAIL_AT_LEAST = 2
const END_WORD = 'end'
const LIFELINE = '│'
const PORT_ABOVE = '┴'
const PORT_BELOW = '┬'
const NOTE_DOWN = '│'
const NOTE_ACROSS = '─'
const LOOP_TOP = '┐'
const LOOP_BOTTOM = '┘'

const STROKES: Readonly<Record<Stroke, { across: string; down: string }>> = {
  solid: { across: '─', down: '│' },
  dashed: { across: '╌', down: '╎' },
}

const HEADS: Readonly<Record<Exclude<MessageHead, 'none'>, { right: string; left: string }>> = {
  arrow: { right: '▶', left: '◀' },
  cross: { right: '×', left: '×' },
  open: { right: '▷', left: '◁' },
}

type Box = { lines: string[]; width: number; height: number }

type Step =
  { kind: 'event'; at: number; event: SequenceEvent } | { kind: 'row'; depth: number; text: string }

type Reach = { low: number; high: number; left: number; right: number }

type Layout = {
  lifelines: number[]
  left: number
  right: number
  height: number
  labels: string[][]
}

type Parts = {
  diagram: SequenceDiagram
  places: number[][]
  boxes: Box[]
  labels: Labels
  steps: Step[]
  meter: LayoutMeter
}

class DrawingFault extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

function refusal(reason: string): Refusal {
  return { kind: 'refused', reason, line: null, limit: null }
}

class Grid {
  private readonly rows = new Map<number, Map<number, string>>()

  put(row: number, col: number, text: string): void {
    const cells = this.cellsOf(row)
    let at = col
    let pending = ''
    for (const grapheme of graphemesOf(text)) {
      const columns = displayWidth(grapheme)
      if (columns === 0) {
        if (at === col) pending += grapheme
        else cells.set(at - 1, `${cells.get(at - 1) ?? ''}${grapheme}`)
        continue
      }
      cells.set(at, pending + grapheme)
      pending = ''
      if (columns > 1) cells.set(at + 1, '')
      at += columns
    }
  }

  line(row: number, left: number, right: number): string {
    const cells = this.rows.get(row)
    let line = ''
    for (let col = left; col <= right; col++) line += cells?.get(col) ?? ' '
    return line.trimEnd()
  }

  private cellsOf(row: number): Map<number, string> {
    const known = this.rows.get(row)
    if (known !== undefined) return known
    const cells = new Map<number, string>()
    this.rows.set(row, cells)
    return cells
  }
}

function boxOf(label: readonly string[]): Box {
  const lines = label.length === 0 ? [''] : label.map(shown)
  return { lines, width: widest(lines) + BOX_PADDING, height: lines.length + 2 }
}

function textOf(event: SequenceEvent): string[] {
  const lines = event.text.map(shown).filter((line) => line.trim() !== '')
  if (event.kind === 'note' || event.number === null) return lines
  const number = `${String(event.number)}.`
  const [first, ...rest] = lines
  return [first === undefined ? number : `${number} ${first}`, ...rest]
}

class Labels {
  private readonly wraps: Map<number, string[]>[]
  private readonly least: (number | undefined)[]
  readonly widest: number

  constructor(
    private readonly texts: readonly string[][],
    private readonly meter: LayoutMeter,
  ) {
    this.wraps = texts.map(() => new Map<number, string[]>())
    this.least = texts.map(() => undefined)
    this.widest = Math.max(1, ...texts.map(widest))
  }

  at(index: number, wrap: number | null): string[] {
    const text = this.texts[index] ?? []
    if (wrap === null || wrap >= widest(text)) return text
    const lines = this.wrapped(index, wrap)
    if (lines.length <= Math.max(MOST_LABEL_LINES, text.length)) return lines
    return this.wrapped(index, this.leastOf(index))
  }

  private leastOf(index: number): number {
    const known = this.least[index]
    if (known !== undefined) return known
    const text = this.texts[index] ?? []
    const most = Math.max(MOST_LABEL_LINES, text.length)
    let low = 1
    let high = Math.max(widest(text), 1)
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (this.wrapped(index, middle).length <= most) high = middle
      else low = middle + 1
    }
    this.least[index] = low
    return low
  }

  private wrapped(index: number, width: number): string[] {
    const wraps = this.wraps[index]
    const known = wraps?.get(width)
    if (known !== undefined) return known
    tick(this.meter)
    const lines = (this.texts[index] ?? []).flatMap((line) => wrapCell(line, width))
    wraps?.set(width, lines)
    return lines
  }
}

function sectionWord(block: SequenceBlock): string {
  return block.kind === 'par' ? 'and' : 'else'
}

function rowText(word: string, label: readonly string[], depth: number, width: number): string {
  const text = label.map(shown).join(' ').trim()
  if (text === '') return word
  const ends = displayWidth(ROW_HEAD) + 1 + ROW_TAIL_AT_LEAST + 2 * DEPTH_INDENT * depth
  const room = width - ends - displayWidth(`${word}: `)
  return `${word}: ${fitted(text, Math.max(room, 1))}`
}

function blockEnd(block: SequenceBlock): number {
  return block.sections.at(-1)?.to ?? 0
}

function blockStart(block: SequenceBlock): number {
  return block.sections[0]?.from ?? 0
}

function stepsOf(diagram: SequenceDiagram, width: number, meter: LayoutMeter): Step[] {
  const top: SequenceBlock[] = []
  const inner = new Map<SequenceBlock, SequenceBlock[][]>()
  const open: SequenceBlock[] = []
  for (const block of diagram.blocks) {
    tick(meter)
    while ((open.at(-1)?.depth ?? -1) >= block.depth) open.pop()
    const parent = open.at(-1)
    const start = blockStart(block)
    const section =
      parent === undefined
        ? top
        : inner.get(parent)?.[parent.sections.findLastIndex((part) => part.from <= start)]
    section?.push(block)
    inner.set(
      block,
      block.sections.map(() => []),
    )
    open.push(block)
  }
  const steps: Step[] = []
  const eventStep = (at: number) => {
    const event = diagram.events[at]
    if (event !== undefined) steps.push({ kind: 'event', at, event })
  }
  const events = (from: number, to: number, blocks: readonly SequenceBlock[]) => {
    let at = from
    for (const block of blocks) {
      for (; at < blockStart(block); at++) eventStep(at)
      blockSteps(block)
      at = Math.max(at, blockEnd(block))
    }
    for (; at < to; at++) eventStep(at)
  }
  const row = (word: string, label: readonly string[], depth: number) => {
    tick(meter)
    steps.push({ kind: 'row', depth, text: rowText(word, label, depth, width) })
  }
  const blockSteps = (block: SequenceBlock) => {
    block.sections.forEach((section, index) => {
      row(index === 0 ? block.kind : sectionWord(block), section.label, block.depth)
      events(section.from, section.to, inner.get(block)?.[index] ?? [])
    })
    row(END_WORD, [], block.depth)
  }
  events(0, diagram.events.length, top)
  return steps
}

function placesOf(diagram: SequenceDiagram): number[][] {
  const index = new Map(diagram.participants.map((participant, at) => [participant.id, at]))
  const placeOf = (id: string) => {
    const place = index.get(id)
    if (place === undefined) throw new DrawingFault('a message names no participant')
    return place
  }
  return diagram.events.map((event) =>
    event.kind === 'message'
      ? [placeOf(event.from), placeOf(event.to)]
      : event.participants.map(placeOf),
  )
}

function noteReach(placement: NotePlacement, low: number, high: number, width: number): Reach {
  if (low !== high) return { low, high, left: SPAN_NOTE_MARGIN, right: SPAN_NOTE_MARGIN }
  switch (placement) {
    case 'left of':
      return { low, high, left: width + SIDE_NOTE_GAP - 1, right: -SIDE_NOTE_GAP }
    case 'right of':
      return { low, high, left: -SIDE_NOTE_GAP, right: width + SIDE_NOTE_GAP - 1 }
    case 'over':
      return { low, high, left: Math.floor(width / 2), right: Math.ceil(width / 2) - 1 }
  }
}

function noteReachOf(note: Note, places: readonly number[], label: string[]): Reach {
  return noteReach(note.placement, Math.min(...places), Math.max(...places), boxOf(label).width)
}

function loopReach(place: number, label: string[]): Reach {
  const width = widest(label)
  const right = width === 0 ? LOOP_COLUMNS : LOOP_LABEL_OFFSET - 1 + width
  return { low: place, high: place, left: -1, right }
}

function isLoop(places: readonly number[]): boolean {
  return places[0] === places[1]
}

function reachOf(event: SequenceEvent, places: readonly number[], label: string[]): Reach | null {
  if (event.kind === 'note') return noteReachOf(event, places, label)
  return isLoop(places) ? loopReach(places[0] ?? 0, label) : null
}

function stepHeight(step: Step, label: string[], places: number[]): number {
  if (step.kind === 'row') return 1
  if (step.event.kind === 'note') return Math.max(label.length, 1) + 2
  if (isLoop(places)) return Math.max(label.length, LOOP_ROWS)
  return label.length + 1
}

function layoutOf(parts: Parts, wrap: number | null): Layout {
  const { diagram, places, boxes, steps, meter } = parts
  const labels = diagram.events.map((_, at) => parts.labels.at(at, wrap))
  const need = boxes
    .slice(1)
    .map((box, at) => BOX_GAP + Math.ceil((boxes[at]?.width ?? 0) / 2) + Math.floor(box.width / 2))
  const atLeast = (gap: number, columns: number) => {
    if (gap >= 0 && gap < need.length) need[gap] = Math.max(need[gap] ?? 0, columns)
  }
  const reaches: Reach[] = []
  diagram.events.forEach((event, at) => {
    tick(meter)
    const label = labels[at] ?? []
    const place = places[at] ?? []
    const reach = reachOf(event, place, label)
    if (reach === null) {
      atLeast(Math.min(...place), widest(label) + LABEL_ROOM)
      return
    }
    reaches.push(reach)
    atLeast(reach.low - 1, reach.left + CLEARANCE)
    atLeast(reach.high, reach.right + CLEARANCE)
    if (reach.high > reach.low) {
      atLeast(reach.low, boxOf(label).width - 2 * SPAN_NOTE_MARGIN - 1)
    }
  })
  const lifelines = [Math.floor((boxes[0]?.width ?? 0) / 2)]
  for (const gap of need) lifelines.push((lifelines.at(-1) ?? 0) + gap)
  let left = 0
  let right = 0
  boxes.forEach((box, at) => {
    right = Math.max(right, (lifelines[at] ?? 0) + Math.ceil(box.width / 2) - 1)
  })
  for (const reach of reaches) {
    left = Math.min(left, (lifelines[reach.low] ?? 0) - reach.left)
    right = Math.max(right, (lifelines[reach.high] ?? 0) + reach.right)
  }
  let height = Math.max(...boxes.map((box) => box.height))
  for (const step of steps) {
    tick(meter)
    if (step.kind === 'row') {
      const least = displayWidth(ROW_HEAD) + displayWidth(step.text) + 1 + ROW_TAIL_AT_LEAST
      right = Math.max(right, left + 2 * DEPTH_INDENT * step.depth + least - 1)
    }
    const at = step.kind === 'event' ? step.at : -1
    height += stepHeight(step, labels[at] ?? [], places[at] ?? [])
  }
  return { lifelines, left, right, height, labels }
}

function drawBox(grid: Grid, box: Box, top: number, left: number, port: number): void {
  const across = NOTE_ACROSS.repeat(box.width - 2)
  grid.put(top, left, `┌${across}┐`)
  box.lines.forEach((line, index) => {
    grid.put(top + 1 + index, left, `${NOTE_DOWN} ${padToWidth(line, box.width - 4)} ${NOTE_DOWN}`)
  })
  grid.put(top + box.height - 1, left, `└${across}┘`)
  grid.put(top + box.height - 1, port, PORT_BELOW)
}

function drawNote(grid: Grid, layout: Layout, top: number, reach: Reach, label: string[]): void {
  const left = (layout.lifelines[reach.low] ?? 0) - reach.left
  const right = (layout.lifelines[reach.high] ?? 0) + reach.right
  const lines = label.length === 0 ? [''] : label
  const inner = right - left - 1
  const indent = Math.floor((inner - 2 - widest(lines)) / 2)
  const bottom = top + lines.length + 1
  grid.put(top, left, `┌${NOTE_ACROSS.repeat(inner)}┐`)
  grid.put(bottom, left, `└${NOTE_ACROSS.repeat(inner)}┘`)
  lines.forEach((line, index) => {
    const text = padToWidth(' '.repeat(indent) + line, inner - 2)
    grid.put(top + 1 + index, left, `${NOTE_DOWN} ${text} ${NOTE_DOWN}`)
  })
  for (const lifeline of layout.lifelines) {
    if (lifeline <= left || lifeline >= right) continue
    grid.put(top, lifeline, PORT_ABOVE)
    grid.put(bottom, lifeline, PORT_BELOW)
  }
}

function headOf(head: MessageHead, side: 'right' | 'left', stroke: Stroke): string {
  return head === 'none' ? STROKES[stroke].across : HEADS[head][side]
}

function drawLoop(grid: Grid, top: number, lifeline: number, event: Message, label: string[]) {
  const { across, down } = STROKES[event.stroke]
  const rows = Math.max(label.length, LOOP_ROWS)
  grid.put(top, lifeline + 1, `${across}${across}${LOOP_TOP}`)
  for (let row = 1; row < rows - 1; row++) grid.put(top + row, lifeline + LOOP_COLUMNS, down)
  const head = headOf(event.head, 'left', event.stroke)
  grid.put(top + rows - 1, lifeline + 1, `${head}${across}${LOOP_BOTTOM}`)
  label.forEach((line, index) => {
    grid.put(top + index, lifeline + LOOP_LABEL_OFFSET, line)
  })
}

function drawMessage(
  grid: Grid,
  layout: Layout,
  top: number,
  event: Message,
  places: number[],
  label: string[],
): void {
  const [from = 0, to = 0] = places
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  const start = layout.lifelines[low] ?? 0
  const end = layout.lifelines[high] ?? 0
  const column = Math.floor((start + (layout.lifelines[low + 1] ?? end) - widest(label)) / 2)
  label.forEach((line, index) => {
    grid.put(top + index, column, line)
  })
  const row = top + label.length
  const crossed = new Set(layout.lifelines.slice(low + 1, high))
  const { across } = STROKES[event.stroke]
  for (let col = start + 1; col < end; col++) if (!crossed.has(col)) grid.put(row, col, across)
  if (to > from) grid.put(row, end - 1, headOf(event.head, 'right', event.stroke))
  else grid.put(row, start + 1, headOf(event.head, 'left', event.stroke))
}

function drawRow(grid: Grid, layout: Layout, row: number, step: Step & { kind: 'row' }): void {
  const left = layout.left + DEPTH_INDENT * step.depth
  const right = layout.right - DEPTH_INDENT * step.depth
  const head = `${ROW_HEAD}${step.text} `
  grid.put(row, left, head)
  const lifelines = new Set(layout.lifelines)
  for (let col = left + displayWidth(head); col <= right; col++) {
    grid.put(row, col, lifelines.has(col) ? ROW_CROSSING : ROW_FILL)
  }
}

function drawingOf(parts: Parts, layout: Layout): string[] {
  const { places, boxes, steps } = parts
  const grid = new Grid()
  boxes.forEach((box, at) => {
    const lifeline = layout.lifelines[at] ?? 0
    for (let row = box.height; row < layout.height; row++) grid.put(row, lifeline, LIFELINE)
    drawBox(grid, box, 0, lifeline - Math.floor(box.width / 2), lifeline)
  })
  let row = Math.max(...boxes.map((box) => box.height))
  for (const step of steps) {
    if (step.kind === 'row') {
      drawRow(grid, layout, row, step)
      row += 1
      continue
    }
    const { event } = step
    const label = layout.labels[step.at] ?? []
    const place = places[step.at] ?? []
    if (event.kind === 'note') drawNote(grid, layout, row, noteReachOf(event, place, label), label)
    else if (isLoop(place)) drawLoop(grid, row, layout.lifelines[place[0] ?? 0] ?? 0, event, label)
    else drawMessage(grid, layout, row, event, place, label)
    row += stepHeight(step, label, place)
  }
  return Array.from({ length: layout.height }, (_, at) => grid.line(at, layout.left, layout.right))
}

function columnsOf(layout: Layout): number {
  return layout.right - layout.left + 1
}

function partsOf(diagram: SequenceDiagram, width: number, meter: LayoutMeter): Parts {
  if (diagram.participants.length === 0) {
    throw new DrawingFault('the sequence diagram has no participants')
  }
  return {
    diagram,
    places: placesOf(diagram),
    boxes: diagram.participants.map((participant) => boxOf(participant.label)),
    labels: new Labels(diagram.events.map(textOf), meter),
    steps: stepsOf(diagram, width, meter),
    meter,
  }
}

function fittedLayout(parts: Parts, width: number): Layout | number {
  const plain = layoutOf(parts, null)
  if (columnsOf(plain) <= width) return plain
  let fitting: Layout | null = null
  let fits = 0
  let wide = parts.labels.widest + 1
  let narrowest = columnsOf(plain)
  while (wide - fits > 1) {
    const middle = Math.floor((fits + wide) / 2)
    const layout = layoutOf(parts, middle)
    narrowest = Math.min(narrowest, columnsOf(layout))
    if (columnsOf(layout) <= width) {
      fitting = layout
      fits = middle
    } else wide = middle
  }
  return fitting ?? narrowest
}

export function drawSequence(
  diagram: SequenceDiagram,
  width: number,
  meter: LayoutMeter = { steps: 0 },
): SequenceDrawing | Refusal {
  let parts: Parts
  try {
    parts = partsOf(diagram, width, meter)
  } catch (error) {
    if (error instanceof DrawingFault) return refusal(error.reason)
    throw error
  }
  const layout = fittedLayout(parts, width)
  if (typeof layout === 'number') {
    return refusal(`it takes ${String(layout)} columns, the screen has ${String(width)}`)
  }
  if (layout.height > MOST_ROWS) {
    return refusal(`${String(layout.height)} rows, at most ${String(MOST_ROWS)} draw`)
  }
  return { kind: 'drawing', lines: drawingOf(parts, layout) }
}
