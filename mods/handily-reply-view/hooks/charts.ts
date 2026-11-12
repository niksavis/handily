import { shown, tooWide } from './flowchart'
import { drawingOf, PLAIN_LOOKS, type Ink, type InkedDrawing, type Looks } from './ink'
import {
  DiagramFault,
  doesNotParse,
  lineFault,
  notDrawnYet,
  type Refusal,
  type Statement,
} from './mermaid'
import { Grid } from './sequence'
import { cutToWidth, displayWidth, fitted } from './width'

export type ChartPlot = 'bar' | 'line'

export type Series = { name: string | null; values: number[] }

export type ValueRange = { low: number; high: number }

export type XyChart = {
  kind: 'chart'
  plot: ChartPlot
  title: string | null
  isHorizontal: boolean
  categories: string[]
  axisTitles: string[]
  range: ValueRange | null
  series: Series[]
}

export type Slice = { label: string; value: number }

export type PieChart = { kind: 'chart'; plot: 'pie'; title: string | null; slices: Slice[] }

export type Chart = XyChart | PieChart

export type LegendItem = { glyph: string; ink: Ink; name: string; looks: Looks }

export type ChartShape = 'pie' | 'upright' | 'across'

export type ShapedChart = InkedDrawing & { shape: ChartShape }

type Shaped = { shape: ChartShape; drawn: InkedDrawing | Refusal }

type Scale = { low: number; high: number; step: number }

type Row = { label: string; value: number; text: string; series: number }

type Area = { labelWidth: number; textWidth: number; barWidth: number }

const MOST_BARS = 40
const MOST_SERIES = 2
const VERTICAL_BARS_AT_MOST = 12
const LABEL_UNDER_BAR_AT_MOST = 8
const LINE_BARS_AT_MOST = 40
const PLOT_ROWS = 10
const TICK_ROWS = 2
const TICKS = PLOT_ROWS / TICK_ROWS
const SLOT_GAP = 2
const MIN_BAR = 6
const MIN_LABEL = 3
const LEAST_DECIMALS = 2
const MOST_DECIMALS = 100
const SIGNIFICANT_DIGITS = 2
const LEGEND_GAP = '   '
const XY_HEADER = /^xychart(?:-beta)?(?:\s+(vertical|horizontal))?$/i
const XY_KIND = /^xychart(?:-beta)?$/i
const PIE_HEADER = /^pie(?:\s+showData)?(?:\s+title(?:\s+(.*))?)?$/
const PIE_KIND = 'pie'
const FIRST_WORD = /^\S+/
const COMMENT_LINE = /^%%/
const TRAILING_COMMENT = /\s+%%.*$/
const IGNORED_STATEMENT = /^acc(?:Title|Descr)\s*:/i
const TITLE = /^title(?:\s+(.*))?$/i
const PIE_TITLE = /^title(?:\s+(.*))?$/
const AXIS = /^([xy])-axis(?:\s+(.*))?$/i
const PLOT = /^(bar|line)(?:\s+(.*))?$/i
const NAMED_LIST = /^(?:("[^"]*")|([^\s"[\]]+))?\s*\[(.*)\]$/
const NUMBER_TEXT = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`
const NUMBER = new RegExp(`^${NUMBER_TEXT}$`)
const LABELLED_POINT = new RegExp(`^${NUMBER_TEXT}\\s+"[^"]*"$`)
const AXIS_RANGE = new RegExp(
  `^(?:("[^"]*")\\s*|(?!${NUMBER_TEXT}\\s)([^\\s"[\\]]+)\\s+)?(${NUMBER_TEXT})\\s*-->\\s*(${NUMBER_TEXT})$`,
)
const SLICE = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:\s*(\S+)$/
const PIE_NUMBER = /^-?(?:\d+\.\d+|\d+)$/
const QUOTED = /^"([^"]*)"$/
const MARKDOWN_TEXT = /^`[\s\S]*`$/
const NICE_TOPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
const NICE_STEPS = [1, 2, 2.5, 5, 10]
const FULL = '█'
const UP_EIGHTHS = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇']
const RIGHT_EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const SHADE = '▒'
const LEFT_HALF = '▐'
const ZERO_LINE = '┃'
const POINT_GLYPHS = ['●', '◇']
const BAR_GLYPHS = [FULL, SHADE]
const AXIS_TICK = '┤'
const AXIS_DOWN = '│'
const AXIS_CORNER = '└'
const AXIS_ACROSS = '─'
const STEP_UP = '╯'
const STEP_DOWN = '╮'
const SHARE_GAP = ' · '
const VALUE_INK: Ink = 1
const AXIS_INK: Ink = 'line'
const TALLEST_INK: Ink = 'head'
const BOLD: Looks = { ...PLAIN_LOOKS, isBold: true }
const UNIT_SCALE: Scale = { low: 0, high: 1, step: 0 }

export class ChartGrid {
  readonly grid = new Grid()
  rows = 0

  put(row: number, col: number, text: string, ink: Ink, looks: Looks = PLAIN_LOOKS): void {
    this.grid.put(row, col, text, ink, looks)
    this.rows = Math.max(this.rows, row + 1)
  }

  drawing(width: number): InkedDrawing {
    return drawingOf(
      Array.from({ length: this.rows }, (_, row) => this.grid.line(row, 0, width - 1)),
    )
  }
}

function chartFault(reason: string): DiagramFault {
  return new DiagramFault({ kind: 'refused', reason, line: null, limit: null })
}

function textOf(raw: string, line: number): string {
  const quoted = QUOTED.exec(raw.trim())
  const text = quoted === null ? raw.trim() : (quoted[1] ?? '')
  if (MARKDOWN_TEXT.test(text)) throw notDrawnYet(line, 'markdown strings')
  return shown(text)
}

function itemsOf(list: string): string[] {
  const items: string[] = []
  let item = ''
  let isQuoted = false
  for (const character of list) {
    if (character === '"') isQuoted = !isQuoted
    if (character === ',' && !isQuoted) {
      items.push(item.trim())
      item = ''
    } else item += character
  }
  items.push(item.trim())
  return items.length === 1 && items[0] === '' ? [] : items
}

export function cutLabel(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  return `${cutToWidth(text, Math.max(width - 1, 0)).trimEnd()}…`
}

function decimalsFor(magnitude: number): number {
  const size = Math.abs(magnitude)
  if (size === 0 || !Number.isFinite(size)) return LEAST_DECIMALS
  return Math.min(
    Math.max(LEAST_DECIMALS, SIGNIFICANT_DIGITS - 1 - Math.floor(Math.log10(size))),
    MOST_DECIMALS,
  )
}

function roundedText(value: number, magnitude: number): string {
  const rounded = Number(value.toFixed(decimalsFor(magnitude)))
  return String(rounded === 0 ? 0 : rounded)
}

function numberText(value: number): string {
  return roundedText(value, value)
}

function signedText(value: number): string {
  return value > 0 ? `+${numberText(value)}` : numberText(value)
}

function cleanNumber(value: number): number {
  return Number(value.toPrecision(12))
}

function niceTop(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const nice = NICE_TOPS.find((factor) => cleanNumber(factor * power) >= value) ?? 10
  return cleanNumber(nice * power)
}

function niceStep(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const nice = NICE_STEPS.find((factor) => cleanNumber(factor * power) >= value) ?? 10
  return cleanNumber(nice * power)
}

function wrappedWords(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    const joined = line === '' ? word : `${line} ${word}`
    if (displayWidth(joined) <= width) line = joined
    else {
      if (line !== '') lines.push(line)
      line = fitted(word, width)
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

function legendWidth(items: readonly LegendItem[]): number {
  return displayWidth(items.map((item) => `${item.glyph} ${item.name}`).join(LEGEND_GAP))
}

function putLegend(sheet: ChartGrid, row: number, col: number, items: readonly LegendItem[]) {
  let at = col
  for (const item of items) {
    sheet.put(row, at, item.glyph, item.ink)
    sheet.put(row, at + displayWidth(item.glyph) + 1, item.name, item.ink, item.looks)
    at += displayWidth(`${item.glyph} ${item.name}`) + LEGEND_GAP.length
  }
}

export function putLegendRows(
  sheet: ChartGrid,
  row: number,
  items: readonly LegendItem[],
  width: number,
): number {
  let at = row
  let line: LegendItem[] = []
  for (const item of items) {
    const fittedItem = { ...item, name: fitted(item.name, Math.max(width - 2, 1)) }
    if (line.length > 0 && legendWidth([...line, fittedItem]) > width) {
      putLegend(sheet, at, 0, line)
      at += 1
      line = []
    }
    line.push(fittedItem)
  }
  if (line.length > 0) {
    putLegend(sheet, at, 0, line)
    at += 1
  }
  return at
}

export function putHead(
  sheet: ChartGrid,
  title: string | null,
  legend: readonly LegendItem[],
  width: number,
): number {
  const lines = title === null ? [] : wrappedWords(title, width)
  lines.forEach((line, row) => {
    sheet.put(row, 0, line, 'plain', BOLD)
  })
  if (legend.length === 0) return lines.length
  const last = lines.at(-1)
  const room = width - (last === undefined ? 0 : displayWidth(last) + LEGEND_GAP.length)
  if (last !== undefined && legendWidth(legend) <= room) {
    putLegend(sheet, lines.length - 1, width - legendWidth(legend), legend)
    return lines.length
  }
  return putLegendRows(sheet, lines.length, legend, width)
}

function putWrapped(sheet: ChartGrid, row: number, text: string, width: number): number {
  const lines = wrappedWords(text, width)
  lines.forEach((line, at) => {
    sheet.put(row + at, 0, line, AXIS_INK)
  })
  return row + lines.length
}

class XyBuilder {
  private title: string | null = null
  private categories: string[] | null = null
  private readonly axisTitles = { x: '', y: '' }
  private range: ValueRange | null = null
  private readonly series: (Series & { plot: ChartPlot })[] = []

  constructor(private readonly isHorizontal: boolean) {}

  add(statement: Statement): void {
    const line = statement.line
    const text = statement.text.replace(TRAILING_COMMENT, '')
    if (IGNORED_STATEMENT.test(text)) return
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = textOf(title[1] ?? '', line) || null
      return
    }
    const axis = AXIS.exec(text)
    if (axis !== null) {
      this.axis((axis[1] ?? '').toLowerCase(), (axis[2] ?? '').trim(), line)
      return
    }
    const plot = PLOT.exec(text)
    if (plot === null) throw doesNotParse(line)
    const named = NAMED_LIST.exec((plot[2] ?? '').trim())
    if (named === null) throw doesNotParse(line)
    const name = named[1] ?? named[2]
    this.series.push({
      plot: (plot[1] ?? '').toLowerCase() === 'bar' ? 'bar' : 'line',
      name: name === undefined ? null : textOf(name, line),
      values: itemsOf(named[3] ?? '').map((item) => this.value(item, line)),
    })
  }

  build(): XyChart {
    const [first, second, ...rest] = this.series
    const count = first?.values.length ?? 0
    if (first === undefined || this.series.every((series) => series.values.length === 0)) {
      throw chartFault('the chart has no values')
    }
    if (rest.length > 0) {
      throw chartFault(`${String(this.series.length)} series, at most ${String(MOST_SERIES)} draw`)
    }
    if (second !== undefined && second.plot !== first.plot) {
      throw chartFault('a chart with bar and line series does not draw yet')
    }
    if (second !== undefined && second.values.length !== count) {
      throw chartFault(
        `the first series has ${String(count)} values and the second has ${String(second.values.length)}`,
      )
    }
    const categories = this.categories ?? Array.from({ length: count }, (_, at) => String(at + 1))
    if (categories.length !== count) {
      throw chartFault(
        `the x-axis has ${String(categories.length)} labels for ${String(count)} values`,
      )
    }
    const drawn = first.plot === 'bar' ? count * this.series.length : count
    if (drawn > MOST_BARS) {
      const noun = first.plot === 'bar' ? 'bars' : 'points'
      throw chartFault(`${String(drawn)} ${noun}, at most ${String(MOST_BARS)} draw`)
    }
    return {
      kind: 'chart',
      plot: first.plot,
      title: this.title,
      isHorizontal: this.isHorizontal,
      categories,
      axisTitles: [this.axisTitles.x, this.axisTitles.y],
      range: this.range,
      series: this.series.map(({ name, values }) => ({ name, values })),
    }
  }

  private value(item: string, line: number): number {
    if (NUMBER.test(item)) return Number(item)
    if (LABELLED_POINT.test(item)) throw notDrawnYet(line, 'a point label')
    throw lineFault(line, `line ${String(line)}: ${JSON.stringify(item)} is not a number`)
  }

  private axis(name: string, rest: string, line: number): void {
    const range = AXIS_RANGE.exec(rest)
    if (range !== null) {
      if (name === 'x') throw notDrawnYet(line, 'a numeric x-axis')
      const low = Number(range[3])
      const high = Number(range[4])
      if (!(high > low)) throw doesNotParse(line)
      this.range = { low, high }
      this.axisTitles.y = textOf(range[1] ?? range[2] ?? '', line)
      return
    }
    const band = name === 'x' ? NAMED_LIST.exec(rest) : null
    if (band !== null) {
      this.categories = itemsOf(band[3] ?? '').map((item) => {
        if (item === '') throw doesNotParse(line)
        return textOf(item, line)
      })
      this.axisTitles.x = textOf(band[1] ?? band[2] ?? '', line)
      return
    }
    if (rest.includes('[') || rest.includes('-->')) throw doesNotParse(line)
    if (name === 'x') this.axisTitles.x = textOf(rest, line)
    else this.axisTitles.y = textOf(rest, line)
  }
}

class PieBuilder {
  private title: string | null
  private readonly slices: Slice[] = []

  constructor(title: string | undefined) {
    this.title = title === undefined ? null : shown(title.trim()) || null
  }

  add(statement: Statement): void {
    const { line, text } = statement
    if (IGNORED_STATEMENT.test(text)) return
    const title = PIE_TITLE.exec(text)
    if (title !== null) {
      this.title = shown((title[1] ?? '').trim()) || null
      return
    }
    const slice = SLICE.exec(text)
    if (slice === null) throw doesNotParse(line)
    const label = shown((slice[1] ?? '').slice(1, -1))
    const written = slice[2] ?? ''
    if (!PIE_NUMBER.test(written)) {
      throw lineFault(line, `line ${String(line)}: ${JSON.stringify(written)} is not a number`)
    }
    const value = Number(written)
    if (value < 0) {
      throw lineFault(
        line,
        `line ${String(line)}: the pie slice ${JSON.stringify(label)} is below 0`,
      )
    }
    this.slices.push({ label, value })
  }

  build(): PieChart {
    if (this.slices.length === 0) throw chartFault('the chart has no values')
    if (this.slices.length > MOST_BARS) {
      throw chartFault(`${String(this.slices.length)} slices, at most ${String(MOST_BARS)} draw`)
    }
    if (this.slices.every((slice) => slice.value === 0)) {
      throw chartFault('the pie slices add up to 0')
    }
    return { kind: 'chart', plot: 'pie', title: this.title, slices: this.slices }
  }
}

export type ChartBuilder = XyBuilder | PieBuilder

export function chartBuilderOf(header: string): ChartBuilder | null {
  const xy = XY_HEADER.exec(header)
  if (xy !== null) return new XyBuilder(xy[1]?.toLowerCase() === 'horizontal')
  const pie = PIE_HEADER.exec(header)
  return pie === null ? null : new PieBuilder(pie[1])
}

export function isChartKind(kind: string): boolean {
  return kind === PIE_KIND || XY_KIND.test(kind)
}

export function isChartSource(source: string): boolean {
  const header = source
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .find((line) => line !== '' && !COMMENT_LINE.test(line))
  const kind = header === undefined ? undefined : FIRST_WORD.exec(header)?.[0]
  return kind !== undefined && isChartKind(kind)
}

export function chartName(chart: Chart): string {
  return `${chart.plot} chart`
}

function widestOf(texts: readonly string[]): number {
  return Math.max(0, ...texts.map(displayWidth))
}

function allValues(chart: XyChart): number[] {
  return chart.series.flatMap((series) => series.values)
}

function verticalScale(chart: XyChart): Scale {
  const values = allValues(chart)
  const least = Math.min(...values)
  const most = Math.max(...values)
  const range = chart.range
  if (range !== null && range.low <= least && range.high >= most) {
    return { low: range.low, high: range.high, step: (range.high - range.low) / TICKS }
  }
  const low = range !== null && range.low <= least ? range.low : least < 0 ? -niceTop(-least) : 0
  const step = niceStep((most - low) / TICKS)
  return { low, high: cleanNumber(low + step * TICKS), step }
}

function tickTexts(scale: Scale): string[] {
  return Array.from({ length: TICKS + 1 }, (_, at) =>
    roundedText(cleanNumber(scale.low + scale.step * at), scale.step),
  )
}

function legendOf(chart: XyChart, glyphs: readonly string[]): LegendItem[] {
  const isShown = chart.series.length > 1 || chart.series.some((series) => series.name !== null)
  if (!isShown) return []
  return chart.series.map((series, at) => ({
    glyph: glyphs[at] ?? FULL,
    ink: at,
    name: series.name ?? `series ${String(at + 1)}`,
    looks: PLAIN_LOOKS,
  }))
}

function axisTitleText(chart: XyChart): string {
  const [x = '', y = ''] = chart.axisTitles
  return [x === '' ? '' : `x-axis ${x}`, y === '' ? '' : `y-axis ${y}`]
    .filter((part) => part !== '')
    .join(SHARE_GAP)
}

function putFoot(
  sheet: ChartGrid,
  row: number,
  chart: XyChart,
  notes: readonly string[],
  width: number,
) {
  let at = row
  const axes = axisTitleText(chart)
  if (axes !== '') at = putWrapped(sheet, at, axes, width)
  for (const note of notes) at = putWrapped(sheet, at, note, width)
}

function tallestInk(chart: XyChart, value: number, series: number): Ink {
  const isSingle = chart.series.length === 1 && chart.categories.length > 1
  return isSingle && value === Math.max(...allValues(chart)) && value > 0 ? TALLEST_INK : series
}

function centered(text: string, left: number, room: number): number {
  return left + Math.max(Math.floor((room - displayWidth(text)) / 2), 0)
}

type Columns = { axis: number; plotLeft: number; slot: number; total: number }

function columnsOf(chart: XyChart, ticks: readonly string[], inner: number): Columns {
  const labels = widestOf(chart.categories)
  const slot = Math.max(inner, labels) + SLOT_GAP
  const axis = widestOf(ticks) + 1
  const plotLeft = axis + SLOT_GAP
  return { axis, plotLeft, slot, total: plotLeft + chart.categories.length * slot - SLOT_GAP }
}

function putAxis(
  sheet: ChartGrid,
  top: number,
  plotRows: number,
  ticks: readonly string[],
  columns: Columns,
  tickAt: (row: number) => number | null,
) {
  for (let row = 0; row < plotRows; row++) {
    const tick = tickAt(row)
    const text = tick === null ? undefined : ticks[tick]
    if (text !== undefined) {
      sheet.put(top + row, columns.axis - 1 - displayWidth(text), text, VALUE_INK)
    }
    sheet.put(top + row, columns.axis, text === undefined ? AXIS_DOWN : AXIS_TICK, AXIS_INK)
  }
}

function putBase(sheet: ChartGrid, row: number, low: string | undefined, columns: Columns) {
  if (low !== undefined) sheet.put(row, columns.axis - 1 - displayWidth(low), low, VALUE_INK)
  sheet.put(row, columns.axis, AXIS_CORNER, AXIS_INK)
  sheet.put(row, columns.axis + 1, AXIS_ACROSS.repeat(columns.total - columns.axis - 1), AXIS_INK)
}

function putCategories(sheet: ChartGrid, row: number, chart: XyChart, columns: Columns) {
  chart.categories.forEach((label, at) => {
    const left = columns.plotLeft + at * columns.slot
    sheet.put(row, centered(label, left, columns.slot - SLOT_GAP), label, 'plain')
  })
}

function eighthsOf(value: number, scale: Scale, cells: number): number {
  const share = (value - scale.low) / (scale.high - scale.low)
  const eighths = Math.round(Math.min(Math.max(share, 0), 1) * cells * 8)
  return value > scale.low && eighths === 0 ? 1 : eighths
}

function wholeOf(value: number, scale: Scale, cells: number): number {
  const share = (value - scale.low) / (scale.high - scale.low)
  const whole = Math.round(Math.min(Math.max(share, 0), 1) * cells)
  return value > scale.low && whole === 0 ? 1 : whole
}

function verticalBars(chart: XyChart, width: number): InkedDrawing | null {
  const scale = verticalScale(chart)
  const ticks = tickTexts(scale)
  const texts = chart.series.map((series) => series.values.map(numberText))
  const valueWidth = widestOf(texts.flat())
  const count = chart.series.length
  const labelWidth = widestOf(chart.categories)
  const barWidth = Math.max(valueWidth, count === 1 ? labelWidth : 2, 2)
  const columns = columnsOf(chart, ticks, count * barWidth + count - 1)
  if (columns.total > width) return null
  const sheet = new ChartGrid()
  const head = putHead(sheet, chart.title, legendOf(chart, BAR_GLYPHS), width)
  const filled = chart.series.map((series, at) =>
    series.values.map((value) =>
      at === 0 ? eighthsOf(value, scale, PLOT_ROWS) : wholeOf(value, scale, PLOT_ROWS) * 8,
    ),
  )
  const headroom = filled.flat().some((eighths) => Math.ceil(eighths / 8) >= PLOT_ROWS) ? 1 : 0
  const top = head + (head > 0 ? 1 : 0) + headroom
  putAxis(sheet, top, PLOT_ROWS, ticks, columns, (row) =>
    (PLOT_ROWS - row) % TICK_ROWS === 0 ? (PLOT_ROWS - row) / TICK_ROWS : null,
  )
  chart.series.forEach((series, at) => {
    series.values.forEach((value, category) => {
      const left = columns.plotLeft + category * columns.slot + at * (barWidth + 1)
      const eighths = filled[at]?.[category] ?? 0
      const ink = tallestInk(chart, value, at)
      const full = Math.floor(eighths / 8)
      for (let row = 0; row < full; row++) {
        sheet.put(top + PLOT_ROWS - 1 - row, left, (BAR_GLYPHS[at] ?? FULL).repeat(barWidth), ink)
      }
      const part = UP_EIGHTHS[eighths % 8] ?? ''
      if (part !== '') sheet.put(top + PLOT_ROWS - 1 - full, left, part.repeat(barWidth), ink)
      const text = texts[at]?.[category] ?? ''
      const above = top + PLOT_ROWS - 1 - Math.ceil(eighths / 8)
      sheet.put(above, centered(text, left, barWidth), text, VALUE_INK)
    })
  })
  putBase(sheet, top + PLOT_ROWS, ticks[0], columns)
  putCategories(sheet, top + PLOT_ROWS + 1, chart, columns)
  putFoot(sheet, top + PLOT_ROWS + 2, chart, [], width)
  return sheet.drawing(width)
}

function pointRow(value: number, scale: Scale): number {
  const share = (value - scale.low) / (scale.high - scale.low)
  return PLOT_ROWS - Math.round(Math.min(Math.max(share, 0), 1) * PLOT_ROWS)
}

function putStep(sheet: ChartGrid, from: [number, number], to: [number, number], ink: Ink) {
  const [fromCol, fromRow] = from
  const [toCol, toRow] = to
  if (toCol - fromCol > 1)
    sheet.put(fromRow, fromCol + 1, AXIS_ACROSS.repeat(toCol - fromCol - 1), ink)
  if (toRow === fromRow) return
  sheet.put(fromRow, toCol, toRow < fromRow ? STEP_UP : STEP_DOWN, ink)
  for (let row = Math.min(fromRow, toRow) + 1; row < Math.max(fromRow, toRow); row++) {
    sheet.put(row, toCol, AXIS_DOWN, ink)
  }
}

function verticalLines(chart: XyChart, width: number): InkedDrawing | number {
  const scale = verticalScale(chart)
  const ticks = tickTexts(scale)
  const texts = chart.series.map((series) => series.values.map(numberText))
  const columns = columnsOf(chart, ticks, Math.max(widestOf(texts.flat()), 3))
  if (columns.total > width) return columns.total
  const sheet = new ChartGrid()
  const head = putHead(sheet, chart.title, legendOf(chart, POINT_GLYPHS), width)
  const top = head + (head > 0 ? 1 : 0)
  putAxis(sheet, top, PLOT_ROWS + 1, ticks, columns, (row) =>
    (PLOT_ROWS - row) % TICK_ROWS === 0 ? (PLOT_ROWS - row) / TICK_ROWS : null,
  )
  const centerOf = (category: number) =>
    columns.plotLeft + category * columns.slot + Math.floor((columns.slot - SLOT_GAP) / 2)
  const pointsOf = (series: Series) =>
    series.values.map((value, at): [number, number] => [centerOf(at), top + pointRow(value, scale)])
  const drawOrder = chart.series.map((series, at) => ({ series, at })).reverse()
  for (const { series, at } of drawOrder) {
    const points = pointsOf(series)
    points.slice(1).forEach((point, index) => {
      putStep(sheet, points[index] ?? point, point, at)
    })
  }
  for (const { series, at } of drawOrder) {
    for (const [col, row] of pointsOf(series)) sheet.put(row, col, POINT_GLYPHS[at] ?? '●', at)
  }
  const base = top + PLOT_ROWS + 1
  putBase(sheet, base, undefined, columns)
  putCategories(sheet, base + 1, chart, columns)
  texts.forEach((row, at) => {
    const glyph = POINT_GLYPHS[at] ?? '●'
    sheet.put(base + 2 + at, columns.axis, glyph, at)
    row.forEach((text, category) => {
      const left = centerOf(category) - Math.floor((displayWidth(text) - 1) / 2)
      sheet.put(base + 2 + at, left, text, VALUE_INK)
    })
  })
  putFoot(sheet, base + 2 + texts.length, chart, [], width)
  return sheet.drawing(width)
}

function areaOf(
  labels: readonly string[],
  textWidth: number,
  width: number,
  mayCut = true,
): Area | null {
  const labelWidth = Math.min(widestOf(labels), Math.max(MIN_LABEL + 1, Math.floor(width / 3)))
  const barWidth = width - labelWidth - textWidth - 2
  if (barWidth >= MIN_BAR) return { labelWidth, textWidth, barWidth }
  if (!mayCut) return null
  const cut = width - textWidth - 2 - MIN_BAR
  if (cut < MIN_LABEL || labelWidth === 0) return null
  return { labelWidth: cut, textWidth, barWidth: MIN_BAR }
}

export function rightBar(eighths: number, glyph: string): string {
  if (glyph !== FULL) return glyph.repeat(Math.round(eighths / 8))
  return FULL.repeat(Math.floor(eighths / 8)) + (RIGHT_EIGHTHS[eighths % 8] ?? '')
}

export function shareBar(share: number, cells: number): string {
  return rightBar(eighthsOf(share, UNIT_SCALE, cells), FULL)
}

export type BarColumn = { wanted: number; least: number }

export type BarColumns = { kind: 'columns'; widths: number[]; bar: number }

export function barColumns(
  columns: readonly BarColumn[],
  fixed: number,
  width: number,
): BarColumns | Refusal {
  const cap = Math.floor(width / (columns.length + 1))
  const widths = columns.map(({ wanted, least }) => Math.min(wanted, Math.max(cap, least)))
  let bar = width - fixed - widths.reduce((sum, column) => sum + column, 0)
  while (bar < MIN_BAR) {
    const spare = widths.map((column, at) => column - (columns[at]?.least ?? column))
    const most = Math.max(0, ...spare)
    if (most === 0) {
      const least = columns.reduce((sum, column) => sum + column.least, 0)
      return tooWide(fixed + least + MIN_BAR, width)
    }
    const at = spare.indexOf(most)
    widths[at] = (widths[at] ?? most) - 1
    bar += 1
  }
  return { kind: 'columns', widths, bar }
}

export function leastLabel(wanted: number): number {
  return Math.min(wanted, MIN_LABEL)
}

function rowsOf(chart: XyChart, texts: (value: number) => string): Row[] {
  return chart.categories.flatMap((label, category) =>
    chart.series.map((series, at) => {
      const value = series.values[category] ?? 0
      return { label: at === 0 ? label : '', value, text: texts(value), series: at }
    }),
  )
}

function putLabelAndText(sheet: ChartGrid, row: number, entry: Row, area: Area, width: number) {
  if (entry.label !== '') sheet.put(row, 0, cutLabel(entry.label, area.labelWidth), 'plain')
  sheet.put(row, width - displayWidth(entry.text), entry.text, VALUE_INK)
}

function horizontalBars(
  chart: XyChart,
  width: number,
  notes: readonly string[],
): InkedDrawing | Refusal {
  const values = allValues(chart)
  if (values.some((value) => value < 0)) return signedBars(chart, width, notes)
  const scale: Scale =
    chart.range !== null &&
    chart.range.high >= Math.max(...values) &&
    chart.range.low <= Math.min(...values)
      ? { ...chart.range, step: 0 }
      : { low: 0, high: niceTop(Math.max(...values)), step: 0 }
  const rows = rowsOf(chart, numberText)
  const area = areaOf(chart.categories, widestOf(rows.map((entry) => entry.text)), width)
  if (area === null)
    return tooWide(MIN_LABEL + MIN_BAR + 2 + widestOf(rows.map((entry) => entry.text)), width)
  const sheet = new ChartGrid()
  let row = putHead(sheet, chart.title, legendOf(chart, BAR_GLYPHS), width)
  const left = area.labelWidth + 1
  for (const entry of rows) {
    putLabelAndText(sheet, row, entry, area, width)
    const glyph = BAR_GLYPHS[entry.series] ?? FULL
    const bar = rightBar(eighthsOf(entry.value, scale, area.barWidth), glyph)
    sheet.put(row, left, bar, tallestInk(chart, entry.value, entry.series))
    row += 1
  }
  const lowText = numberText(scale.low)
  const highText = numberText(scale.high)
  if (displayWidth(lowText) + displayWidth(highText) + 1 <= area.barWidth) {
    sheet.put(row, left, lowText, VALUE_INK)
    sheet.put(row, left + area.barWidth - displayWidth(highText), highText, VALUE_INK)
    row += 1
  }
  putFoot(sheet, row, chart, notes, width)
  return sheet.drawing(width)
}

function signedBars(
  chart: XyChart,
  width: number,
  notes: readonly string[],
): InkedDrawing | Refusal {
  const most = niceTop(Math.max(...allValues(chart).map(Math.abs)))
  const rows = rowsOf(chart, signedText)
  const textWidth = widestOf(rows.map((entry) => entry.text))
  const area = areaOf(chart.categories, textWidth, width)
  if (area === null) return tooWide(MIN_LABEL + MIN_BAR + 2 + textWidth, width)
  const half = Math.floor((area.barWidth - 1) / 2)
  const left = area.labelWidth + 1
  const zero = left + half
  const sheet = new ChartGrid()
  let row = putHead(sheet, chart.title, legendOf(chart, BAR_GLYPHS), width)
  for (const entry of rows) {
    putLabelAndText(sheet, row, entry, area, width)
    sheet.put(row, zero, ZERO_LINE, AXIS_INK)
    const glyph = BAR_GLYPHS[entry.series] ?? FULL
    const ink = entry.series
    const scale: Scale = { low: 0, high: most, step: 0 }
    if (entry.value > 0) {
      sheet.put(row, zero + 1, rightBar(eighthsOf(entry.value, scale, half), glyph), ink)
    } else if (entry.value < 0) {
      const halves = Math.max(Math.round((-entry.value / most) * half * 2), 1)
      const whole = glyph === FULL ? Math.floor(halves / 2) : Math.round(halves / 2)
      const part = glyph === FULL && halves % 2 === 1 ? LEFT_HALF : ''
      const bar = part + glyph.repeat(Math.max(whole, part === '' ? 1 : 0))
      sheet.put(row, zero - displayWidth(bar), bar, ink)
    }
    row += 1
  }
  const lowText = signedText(-most)
  const highText = signedText(most)
  if (displayWidth(lowText) + 1 < half && displayWidth(highText) + 1 < half) {
    sheet.put(row, left, lowText, VALUE_INK)
    sheet.put(row, zero, '0', VALUE_INK)
    sheet.put(row, zero + half + 1 - displayWidth(highText), highText, VALUE_INK)
    row += 1
  }
  putFoot(sheet, row, chart, notes, width)
  return sheet.drawing(width)
}

function across(drawn: InkedDrawing | Refusal): Shaped {
  return { shape: 'across', drawn }
}

function upright(drawn: InkedDrawing): Shaped {
  return { shape: 'upright', drawn }
}

function lineAsBars(chart: XyChart, width: number): Shaped {
  if (chart.isHorizontal) {
    return across(
      horizontalBars(chart, width, [
        'line chart drawn as bars: a horizontal line chart draws as bars.',
      ]),
    )
  }
  if (width <= LINE_BARS_AT_MOST) {
    return across(
      horizontalBars(chart, width, [
        `line chart drawn as bars: the screen has ${String(width)} columns.`,
      ]),
    )
  }
  const drawn = verticalLines(chart, width)
  if (typeof drawn !== 'number') return upright(drawn)
  return across(
    horizontalBars(chart, width, [
      `line chart drawn as bars: it takes ${String(drawn)} columns, the screen has ${String(width)}.`,
    ]),
  )
}

function drawsUpright(chart: XyChart): boolean {
  return (
    !chart.isHorizontal &&
    chart.categories.length <= VERTICAL_BARS_AT_MOST &&
    widestOf(chart.categories) <= LABEL_UNDER_BAR_AT_MOST &&
    allValues(chart).every((value) => value >= 0)
  )
}

function drawXy(chart: XyChart, width: number): Shaped {
  if (chart.plot === 'line') return lineAsBars(chart, width)
  const bars = drawsUpright(chart) ? verticalBars(chart, width) : null
  return bars === null ? across(horizontalBars(chart, width, [])) : upright(bars)
}

function shareText(value: number, total: number): string {
  const share = (value / total) * 100
  return share > 0 && share < 0.5 ? '<1%' : `${String(Math.round(share))}%`
}

function drawPie(chart: PieChart, width: number): InkedDrawing | Refusal {
  const total = chart.slices.reduce((sum, slice) => sum + slice.value, 0)
  const slices = chart.slices
    .map((slice, at) => ({ ...slice, at }))
    .sort((one, other) => other.value - one.value || one.at - other.at)
  const shares = slices.map((slice) => shareText(slice.value, total))
  const values = slices.map((slice) => numberText(slice.value))
  const shareWidth = widestOf(shares)
  const valueWidth = widestOf(values)
  const labels = slices.map((slice) => slice.label)
  const fullWidth = shareWidth + SHARE_GAP.length + valueWidth
  const full = areaOf(labels, fullWidth, width, false)
  const area = full ?? areaOf(labels, shareWidth, width, false) ?? areaOf(labels, shareWidth, width)
  if (area === null) return tooWide(MIN_LABEL + MIN_BAR + 2 + shareWidth, width)
  const sheet = new ChartGrid()
  let row = putHead(sheet, chart.title, [], width)
  slices.forEach((slice, at) => {
    sheet.put(row, 0, cutLabel(slice.label, area.labelWidth), 'plain')
    sheet.put(row, area.labelWidth + 1, shareBar(slice.value / total, area.barWidth), at)
    const share = (shares[at] ?? '').padStart(shareWidth)
    const text =
      full === null ? share : `${share}${SHARE_GAP}${(values[at] ?? '').padStart(valueWidth)}`
    sheet.put(row, width - displayWidth(text), text, VALUE_INK)
    row += 1
  })
  return sheet.drawing(width)
}

export function fits(drawing: InkedDrawing, width: number): InkedDrawing | Refusal {
  const widest = widestOf(drawing.lines)
  return widest > width ? tooWide(widest, width) : drawing
}

function shapedOf(chart: Chart, width: number): Shaped {
  return chart.plot === 'pie'
    ? { shape: 'pie', drawn: drawPie(chart, width) }
    : drawXy(chart, width)
}

export function drawChart(chart: Chart, width: number): ShapedChart | Refusal {
  const { shape, drawn } = shapedOf(chart, width)
  const shown = drawn.kind === 'drawing' ? fits(drawn, width) : drawn
  return shown.kind === 'drawing' ? { ...shown, shape } : shown
}
