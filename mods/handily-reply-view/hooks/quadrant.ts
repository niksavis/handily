import { ChartGrid } from './charts'
import { shown, shownLabel, tooWide } from './flowchart'
import {
  fittedLabel,
  PLAIN_LOOKS,
  plainLabel,
  type Ink,
  type InkedDrawing,
  type Label,
} from './ink'
import {
  DiagramFault,
  doesNotParse,
  lineFault,
  notDrawnYet,
  type Refusal,
  type Statement,
} from './mermaid'
import { withLooks, wrappedLabel } from './outline'
import { displayWidth } from './width'

export type QuadrantAxis = { low: string; high: string; isOpen: boolean }

export type QuadrantPoint = { label: string; x: number; y: number }

export type QuadrantChart = {
  kind: 'quadrant'
  title: string | null
  quadrants: [string, string, string, string]
  xAxis: QuadrantAxis | null
  yAxis: QuadrantAxis | null
  points: QuadrantPoint[]
}

const HEADER = /^quadrantChart/
const DRAWN_HEADER = 'quadrantChart'
const TITLE = /^title(?:\s+(.*))?$/i
const ACCESSIBILITY = /^acc(?:Title|Descr)\s*:/i
const ACCESSIBILITY_BLOCK = /^accDescr\s*\{[^}]*\}$/i
const CLASS_DEFINITION = /^classDef\s/i
const AXIS = /^([xy])-axis\s+(.+)$/i
const AXIS_DELIMITER = /\s*--+>\s*/
const QUADRANT = /^quadrant-([1-4])\s+(.+)$/i
const POINT = /^(.+?)(?::::\w+)?\s*:\s*\[\s*([^\s,\]]*)\s*,\s*([^\s,\]]*)\s*\]\s*(.*)$/
const COORDINATE = /^(?:1|0(?:\.\d+)?)$/
const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/
const STYLE = /^(radius|color|stroke-color|stroke-width)\s*:\s*([\w#]+)$/
const STYLE_SPLIT = /\s*,\s*/
const QUOTED_HEAD = /^"([^"]*)"(.*)$/
const MARKDOWN_HEAD = /^"`/
const TEXT_TAIL = /^(?:[A-Za-z0-9 \t!#$%&'*+,\-./?\\_`=]|[^\p{ASCII}])*$/u
const TEXT_START = /^[^\s-]/
const MOST_POINTS = 35

function textOf(line: number, raw: string): string {
  const text = raw.trim()
  if (MARKDOWN_HEAD.test(text)) throw notDrawnYet(line, 'markdown strings')
  const quoted = QUOTED_HEAD.exec(text)
  const tail = quoted === null ? text : (quoted[2] ?? '')
  if ((quoted === null && !TEXT_START.test(text)) || !TEXT_TAIL.test(tail)) {
    throw doesNotParse(line)
  }
  return shown(quoted === null ? text : `${quoted[1] ?? ''}${tail}`).trim()
}

function coordinateOf(line: number, written: string): number {
  if (COORDINATE.test(written)) return Number(written)
  const value = Number(written)
  if (!NUMBER.test(written) || (value >= 0 && value <= 1)) throw doesNotParse(line)
  throw lineFault(line, `line ${String(line)}: ${written} is not from 0 to 1`)
}

function refuseStyles(line: number, styles: string): void {
  if (styles === '') return
  for (const style of styles.split(STYLE_SPLIT)) {
    if (!STYLE.test(style)) throw doesNotParse(line)
  }
}

export class QuadrantBuilder {
  private title: string | null = null
  private readonly quadrants: [string, string, string, string] = ['', '', '', '']
  private xAxis: QuadrantAxis | null = null
  private yAxis: QuadrantAxis | null = null
  private readonly points: QuadrantPoint[] = []

  add({ line, text }: Statement): void {
    if (ACCESSIBILITY.test(text) || ACCESSIBILITY_BLOCK.test(text)) return
    if (CLASS_DEFINITION.test(text)) return
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = shown(title[1] ?? '').trim() || null
      return
    }
    const axis = AXIS.exec(text)
    if (axis !== null) {
      const parsed = this.axis(line, axis[2] ?? '')
      if ((axis[1] ?? '').toLowerCase() === 'x') this.xAxis = parsed
      else this.yAxis = parsed
      return
    }
    const quadrant = QUADRANT.exec(text)
    if (quadrant !== null) {
      this.quadrants[Number(quadrant[1]) - 1] = textOf(line, quadrant[2] ?? '')
      return
    }
    this.point(line, text)
  }

  build(): QuadrantChart {
    if (this.points.length > MOST_POINTS) {
      throw new DiagramFault({
        kind: 'refused',
        reason: `${String(this.points.length)} points, at most ${String(MOST_POINTS)} draw`,
        line: null,
        limit: null,
      })
    }
    return {
      kind: 'quadrant',
      title: this.title,
      quadrants: this.quadrants,
      xAxis: this.xAxis,
      yAxis: this.yAxis,
      points: this.points,
    }
  }

  private axis(line: number, rest: string): QuadrantAxis {
    const parts = rest.split(AXIS_DELIMITER)
    if (parts.length > 2) throw doesNotParse(line)
    const [low = '', high] = parts
    return {
      low: textOf(line, low),
      high: high === undefined || high.trim() === '' ? '' : textOf(line, high),
      isOpen: high !== undefined && high.trim() === '',
    }
  }

  private point(line: number, text: string): void {
    const found = POINT.exec(text)
    if (found === null) throw doesNotParse(line)
    refuseStyles(line, (found[4] ?? '').trim())
    this.points.push({
      label: textOf(line, found[1] ?? ''),
      x: coordinateOf(line, found[2] ?? ''),
      y: coordinateOf(line, found[3] ?? ''),
    })
  }
}

export function quadrantBuilder(header: Statement): QuadrantBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (header.text !== DRAWN_HEADER) throw doesNotParse(header.line)
  return new QuadrantBuilder()
}

const QUADRANT_ROWS = 6
const LEAST_QUADRANT_COLUMNS = 8
const NAME_INSET = 1
const MARKER = '●'
const KEYS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LABEL_GAP = 1
const MARK_GAP = 2
const MARK_COLUMNS = 2
const LIST_GAP = ', '
const UP_MARK = '▲ '
const DOWN_MARK = '▼ '
const LEFT_MARK = '◀ '
const RIGHT_MARK = ' ▶'
const OPEN_MARK = ' →'
const AXIS_GAP = 2
const ACROSS = '─'
const DOWN = '│'
const LINE_INK: Ink = 'line'
const BOLD = { ...PLAIN_LOOKS, isBold: true }
const QUADRANT_INKS: readonly Ink[] = [1, 0, 2, 3]
const EDGES = {
  top: ['┌', '┬', '┐'],
  middle: ['├', '┼', '┤'],
  bottom: ['└', '┴', '┘'],
} as const

type Plot = { top: number; quadrant: number; width: number }

type Spot = { row: number; col: number; first: number; points: QuadrantPoint[] }

type Span = { row: number; from: number; to: number }

function rowOf(plot: Plot, y: number): number {
  const rows = 2 * QUADRANT_ROWS
  const step = rows - 1 - Math.min(Math.floor(y * rows), rows - 1)
  return plot.top + 1 + step + (step < QUADRANT_ROWS ? 0 : 1)
}

function colOf(plot: Plot, x: number): number {
  const cols = 2 * plot.quadrant
  const step = Math.min(Math.floor(x * cols), cols - 1)
  return 1 + step + (step < plot.quadrant ? 0 : 1)
}

function isLeft(plot: Plot, col: number): boolean {
  return col <= plot.quadrant
}

function isTop(plot: Plot, row: number): boolean {
  return row <= plot.top + QUADRANT_ROWS
}

function quadrantAt(plot: Plot, row: number, col: number): number {
  if (isTop(plot, row)) return isLeft(plot, col) ? 1 : 0
  return isLeft(plot, col) ? 2 : 3
}

function interiorOf(plot: Plot, col: number): { from: number; to: number } {
  return isLeft(plot, col)
    ? { from: 1, to: plot.quadrant }
    : { from: plot.quadrant + 2, to: 2 * plot.quadrant + 1 }
}

function cellsOf(chart: QuadrantChart, plot: Plot): Spot[] {
  const cells = new Map<string, Spot>()
  chart.points.forEach((point, index) => {
    const row = rowOf(plot, point.y)
    const col = colOf(plot, point.x)
    const key = `${String(row)}:${String(col)}`
    const cell = cells.get(key) ?? { row, col, first: index, points: [] }
    cell.points.push(point)
    cells.set(key, cell)
  })
  return [...cells.values()]
}

function spotsOf(chart: QuadrantChart, plot: Plot): Spot[] {
  const cells = cellsOf(chart, plot).sort(
    (one, other) => one.row - other.row || one.col - other.col,
  )
  const spots: Spot[] = []
  for (const cell of cells) {
    const last = spots.at(-1)
    const isNear =
      last !== undefined &&
      last.row === cell.row &&
      isLeft(plot, last.col) === isLeft(plot, cell.col) &&
      cell.col - last.col < MARK_COLUMNS + MARK_GAP
    if (last === undefined || !isNear) spots.push({ ...cell, points: [...cell.points] })
    else {
      last.points.push(...cell.points)
      last.first = Math.min(last.first, cell.first)
    }
  }
  return spots.sort((one, other) => one.first - other.first)
}

function spotLabel(spot: Spot): string {
  return spot.points.map((point) => point.label).join(LIST_GAP)
}

function markOf(plot: Plot, spot: Spot): Span {
  const fitsRight = spot.col + 1 <= interiorOf(plot, spot.col).to
  const from = fitsRight ? spot.col : spot.col - 1
  return { row: spot.row, from, to: from + MARK_COLUMNS - 1 }
}

function keyColumn(plot: Plot, spot: Spot): number {
  const mark = markOf(plot, spot)
  return mark.from === spot.col ? mark.to : mark.from
}

class Occupancy {
  private readonly labels = new Set<string>()
  private readonly marks = new Map<string, Spot>()

  takeLabel(span: Span): void {
    for (let col = span.from; col <= span.to; col++) this.labels.add(cellKey(span.row, col))
  }

  takeMark(span: Span, spot: Spot): void {
    for (let col = span.from; col <= span.to; col++) this.marks.set(cellKey(span.row, col), spot)
  }

  isFree(span: Span, own: Spot): boolean {
    for (let col = span.from - MARK_GAP; col <= span.to + MARK_GAP; col++) {
      const mark = this.marks.get(cellKey(span.row, col))
      if (mark !== undefined && mark !== own) return false
      const isNear = col >= span.from - LABEL_GAP && col <= span.to + LABEL_GAP
      if (isNear && this.labels.has(cellKey(span.row, col))) return false
    }
    return true
  }
}

function cellKey(row: number, col: number): string {
  return `${String(row)}:${String(col)}`
}

function labelSpan(plot: Plot, taken: Occupancy, spot: Spot, columns: number): Span | null {
  const { from, to } = interiorOf(plot, spot.col)
  const mark = markOf(plot, spot)
  const right = {
    row: spot.row,
    from: spot.col + 1 + LABEL_GAP,
    to: spot.col + LABEL_GAP + columns,
  }
  const left = {
    row: spot.row,
    from: mark.from - LABEL_GAP - columns,
    to: mark.from - 1 - LABEL_GAP,
  }
  for (const span of [right, left]) {
    if (span.from <= from || span.to >= to) continue
    if (taken.isFree(span, spot)) return span
  }
  return null
}

function putEdge(sheet: ChartGrid, row: number, plot: Plot, glyphs: readonly string[]): void {
  const [left = '', middle = '', right = ''] = glyphs
  const across = ACROSS.repeat(plot.quadrant)
  sheet.put(row, 0, `${left}${across}${middle}${across}${right}`, LINE_INK)
}

type Place = { quadrant: number; isTop: boolean; isLeft: boolean }

const PLACES: readonly Place[] = [
  { quadrant: 1, isTop: true, isLeft: true },
  { quadrant: 0, isTop: true, isLeft: false },
  { quadrant: 2, isTop: false, isLeft: true },
  { quadrant: 3, isTop: false, isLeft: false },
]

function nameOf(chart: QuadrantChart, place: Place): Label | null {
  const name = chart.quadrants[place.quadrant] ?? ''
  return name === '' ? null : withLooks(shownLabel(name), BOLD)
}

function leftOf(plot: Plot, place: Place): number {
  return place.isLeft ? 1 : plot.quadrant + 2
}

function putEdgeName(sheet: ChartGrid, plot: Plot, place: Place, name: Label): void {
  const row = place.isTop ? plot.top : plot.top + QUADRANT_ROWS + 1
  const label = fittedLabel(name, Math.max(plot.quadrant - 2 * NAME_INSET, 1))
  const columns = displayWidth(label.text) + 2
  const at = leftOf(plot, place) + Math.max(Math.floor((plot.quadrant - columns) / 2), 0)
  sheet.put(row, at, ` ${' '.repeat(displayWidth(label.text))} `, LINE_INK)
  sheet.grid.putLabel(row, at + 1, label, QUADRANT_INKS[place.quadrant] ?? 0)
}

function putInsideName(sheet: ChartGrid, plot: Plot, place: Place, name: Label): void {
  const room = Math.max(plot.quadrant - 2, 1)
  const wrapped = wrappedLabel(name, room)
  const lines = wrapped.length > QUADRANT_ROWS ? wrapped.slice(0, QUADRANT_ROWS) : wrapped
  if (wrapped.length > QUADRANT_ROWS) {
    const last = lines[QUADRANT_ROWS - 1] ?? name
    lines[QUADRANT_ROWS - 1] = fittedLabel(
      { text: `${last.text} …`, runs: [...last.runs, { text: ' …', looks: BOLD }] },
      room,
    )
  }
  const first =
    (place.isTop ? plot.top + 1 : plot.top + QUADRANT_ROWS + 2) +
    Math.floor((QUADRANT_ROWS - lines.length) / 2)
  lines.forEach((line, index) => {
    const at = leftOf(plot, place) + Math.floor((plot.quadrant - displayWidth(line.text)) / 2)
    sheet.grid.putLabel(first + index, at, line, QUADRANT_INKS[place.quadrant] ?? 0)
  })
}

function putFrame(sheet: ChartGrid, chart: QuadrantChart, plot: Plot): void {
  const middle = plot.top + QUADRANT_ROWS + 1
  const bottom = middle + QUADRANT_ROWS + 1
  putEdge(sheet, plot.top, plot, EDGES.top)
  putEdge(sheet, middle, plot, EDGES.middle)
  putEdge(sheet, bottom, plot, EDGES.bottom)
  for (let row = plot.top + 1; row < bottom; row++) {
    if (row === middle) continue
    for (const col of [0, plot.quadrant + 1, 2 * plot.quadrant + 2]) {
      sheet.put(row, col, DOWN, LINE_INK)
    }
  }
  for (const place of PLACES) {
    const name = nameOf(chart, place)
    if (name === null) continue
    if (chart.points.length === 0) putInsideName(sheet, plot, place, name)
    else putEdgeName(sheet, plot, place, name)
  }
}

function putPoints(sheet: ChartGrid, chart: QuadrantChart, plot: Plot): Spot[] {
  const spots = spotsOf(chart, plot)
  const taken = new Occupancy()
  for (const spot of spots) taken.takeMark(markOf(plot, spot), spot)
  const keyed: Spot[] = []
  for (const spot of spots) {
    const ink = QUADRANT_INKS[quadrantAt(plot, spot.row, spot.col)] ?? 0
    const label = shownLabel(spotLabel(spot))
    const span = labelSpan(plot, taken, spot, displayWidth(label.text))
    sheet.put(spot.row, spot.col, MARKER, ink)
    if (span === null) {
      sheet.put(spot.row, keyColumn(plot, spot), KEYS[keyed.length] ?? MARKER, ink, BOLD)
      keyed.push(spot)
      continue
    }
    taken.takeLabel(span)
    sheet.grid.putLabel(span.row, span.from, label, 'plain')
  }
  return keyed
}

function putWrapped(sheet: ChartGrid, row: number, lead: string, text: string, width: number) {
  const lines = wrappedLabel(plainLabel(text), width - displayWidth(lead))
  lines.forEach((line, index) => {
    sheet.put(row + index, 0, index === 0 ? lead : ' '.repeat(displayWidth(lead)), LINE_INK)
    sheet.put(row + index, displayWidth(lead), line.text, LINE_INK)
  })
  return row + lines.length
}

function upperText(axis: QuadrantAxis | null): string {
  if (axis === null) return ''
  return axis.isOpen ? axis.low : axis.high
}

function lowerText(axis: QuadrantAxis | null): string {
  return axis === null || axis.isOpen ? '' : axis.low
}

function putXAxis(sheet: ChartGrid, row: number, axis: QuadrantAxis, width: number): number {
  const lead = axis.isOpen ? '' : LEFT_MARK
  const text = axis.isOpen ? `${axis.low}${OPEN_MARK}` : axis.low
  const low = `${lead}${text}`
  const high = axis.high === '' ? '' : `${axis.high}${RIGHT_MARK}`
  const together = displayWidth(low) + AXIS_GAP + displayWidth(high) <= width
  if (high === '' && displayWidth(low) <= width) {
    sheet.put(row, 0, low, LINE_INK)
    return row + 1
  }
  if (high !== '' && together) {
    sheet.put(row, 0, low, LINE_INK)
    sheet.put(row, width - displayWidth(high), high, LINE_INK)
    return row + 1
  }
  const next = putWrapped(sheet, row, lead, text, width)
  if (high === '') return next
  if (displayWidth(high) <= width) {
    sheet.put(next, width - displayWidth(high), high, LINE_INK)
    return next + 1
  }
  return putWrapped(sheet, next, '', high, width)
}

function putHead(sheet: ChartGrid, chart: QuadrantChart, width: number): number {
  let row = 0
  const title =
    chart.title === null ? [] : wrappedLabel(withLooks(plainLabel(chart.title), BOLD), width)
  for (const line of title) {
    sheet.grid.putLabel(row, 0, line, 'plain')
    row += 1
  }
  const upper = upperText(chart.yAxis)
  return upper === '' ? row : putWrapped(sheet, row, UP_MARK, upper, width)
}

function putKeys(sheet: ChartGrid, row: number, plot: Plot, keyed: readonly Spot[], width: number) {
  let at = row
  keyed.forEach((spot, index) => {
    const key = KEYS[index] ?? MARKER
    const ink = QUADRANT_INKS[quadrantAt(plot, spot.row, spot.col)] ?? 0
    const lead = `${key} `
    const lines = wrappedLabel(shownLabel(spotLabel(spot)), width - displayWidth(lead))
    sheet.put(at, 0, key, ink, BOLD)
    lines.forEach((line, offset) => {
      sheet.grid.putLabel(at + offset, displayWidth(lead), line, 'plain')
    })
    at += lines.length
  })
}

export function drawQuadrant(chart: QuadrantChart, width: number): InkedDrawing | Refusal {
  const quadrant = Math.floor((width - 3) / 2)
  if (quadrant < LEAST_QUADRANT_COLUMNS) return tooWide(2 * LEAST_QUADRANT_COLUMNS + 3, width)
  const sheet = new ChartGrid()
  const top = putHead(sheet, chart, width)
  const plot: Plot = { top, quadrant, width: 2 * quadrant + 3 }
  putFrame(sheet, chart, plot)
  const keyed = putPoints(sheet, chart, plot)
  let row = top + 2 * QUADRANT_ROWS + 3
  const lower = lowerText(chart.yAxis)
  if (lower !== '') row = putWrapped(sheet, row, DOWN_MARK, lower, plot.width)
  if (chart.xAxis !== null) row = putXAxis(sheet, row, chart.xAxis, plot.width)
  putKeys(sheet, row, plot, keyed, width)
  return sheet.drawing(width)
}
