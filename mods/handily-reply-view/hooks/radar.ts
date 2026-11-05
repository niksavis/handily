import {
  barColumns,
  ChartGrid,
  cutLabel,
  fits,
  leastLabel,
  putHead,
  shareBar,
  type BarColumn,
  type LegendItem,
} from './charts'
import { MOST_ROWS, shown, widest } from './flowchart'
import { PLAIN_LOOKS, type Ink, type InkedDrawing, type Looks } from './ink'
import { doesNotParse, lineFault, type Refusal, type Statement } from './mermaid'
import { displayWidth } from './width'

export type RadarAxis = { name: string; label: string }

export type RadarCurve = { label: string; values: number[] }

export type Radar = {
  kind: 'radar'
  title: string | null
  axes: RadarAxis[]
  curves: RadarCurve[]
  low: number
  high: number
  hasLegend: boolean
}

type Token = { kind: 'string' | 'number' | 'word' | 'mark'; text: string }

type Entry = { axis: string | null; value: number }

type WrittenCurve = { name: string; label: string; entries: Entry[]; line: number }

type OptionName = 'showLegend' | 'ticks' | 'max' | 'min' | 'graticule'

const HEADER = /^radar-beta/
const DRAWN_HEADER = /^radar-beta(?:\s*:)?$/
const TITLE = /^title(?:[\t ](.*?))?(?:%%.*)?$/
const ACCESSIBILITY = /^acc(?:Title[\t ]*:|Descr[\t ]*:)/
const DESCRIPTION_BLOCK = /^accDescr\s*\{/
const DESCRIPTION_END = '}'
const CURVE = /^curve(?![-\w])/
const SPACES = /[\t ]{2,}/g
const TOKEN =
  /\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\d+\.\d+(?!\.)|0|[1-9]\d*(?!\.))|(\w(?:[-\w]*\w)?)|([[\]{},:]))/y
const COMMENT = /\s*%%/y
const ESCAPE = /\\(.)/gs
const CONTROL_ESCAPES: ReadonlySet<string> = new Set(['b', 'f', 'n', 'r', 't', 'v', '0'])
const OPTIONS: ReadonlySet<string> = new Set(['showLegend', 'ticks', 'max', 'min', 'graticule'])
const RESERVED: ReadonlySet<string> = new Set([
  ...OPTIONS,
  'axis',
  'curve',
  'true',
  'false',
  'circle',
  'polygon',
  'title',
  'accTitle',
  'accDescr',
])
const BOOLEANS: ReadonlySet<string> = new Set(['true', 'false'])
const GRATICULES: ReadonlySet<string> = new Set(['circle', 'polygon'])
const OPENING = '{'
const CLOSING = '}'
const LEGEND_GLYPH = '█'
const LABEL_GAP = 1
const STACK_INDENT = 2
const COLUMN_GAP = 2
const VALUE_INK: Ink = 1
const BOLD: Looks = { ...PLAIN_LOOKS, isBold: true }

function tokensOf(line: number, text: string): Token[] {
  const tokens: Token[] = []
  let at = 0
  while (at < text.length) {
    COMMENT.lastIndex = at
    if (COMMENT.test(text)) break
    TOKEN.lastIndex = at
    const found = TOKEN.exec(text)
    if (found === null) {
      if (text.slice(at).trim() === '') break
      throw doesNotParse(line)
    }
    at = TOKEN.lastIndex
    const [, string, number, word, mark] = found
    if (string !== undefined) tokens.push({ kind: 'string', text: string })
    else if (number !== undefined) tokens.push({ kind: 'number', text: number })
    else if (word !== undefined) tokens.push({ kind: 'word', text: word })
    else tokens.push({ kind: 'mark', text: mark ?? '' })
  }
  return tokens
}

function stringValue(written: string): string {
  return written
    .slice(1, -1)
    .replace(ESCAPE, (_, character: string) => (CONTROL_ESCAPES.has(character) ? ' ' : character))
}

class Tokens {
  private at = 0

  constructor(
    private readonly tokens: readonly Token[],
    readonly line: number,
  ) {}

  get done(): boolean {
    return this.at >= this.tokens.length
  }

  get isOpen(): boolean {
    const marks = this.tokens.filter((token) => token.kind === 'mark')
    const opened = marks.filter((token) => token.text === OPENING).length
    return opened > marks.filter((token) => token.text === CLOSING).length
  }

  with(more: readonly Token[]): Tokens {
    return new Tokens([...this.tokens, ...more], this.line)
  }

  peek(): Token | undefined {
    return this.tokens[this.at]
  }

  skip(mark: string): boolean {
    const next = this.peek()
    if (next?.kind !== 'mark' || next.text !== mark) return false
    this.at += 1
    return true
  }

  expect(mark: string): void {
    if (!this.skip(mark)) throw doesNotParse(this.line)
  }

  take(kind: Token['kind']): string {
    const next = this.peek()
    if (next?.kind !== kind) throw doesNotParse(this.line)
    this.at += 1
    return next.text
  }

  name(): string {
    const name = this.take('word')
    if (RESERVED.has(name)) throw doesNotParse(this.line)
    return name
  }

  label(name: string): string {
    if (!this.skip('[')) return name
    const label = stringValue(this.take('string'))
    this.expect(']')
    return label
  }
}

export class RadarBuilder {
  private title: string | null = null
  private readonly axes: RadarAxis[] = []
  private readonly curves: WrittenCurve[] = []
  private readonly options = new Map<OptionName, string>()
  private pending: Tokens | null = null
  private isInDescription = false

  add(statement: Statement): void {
    if (this.isInDescription) {
      this.isInDescription = !statement.text.includes(DESCRIPTION_END)
      return
    }
    const pending = this.pending
    if (pending === null && !CURVE.test(statement.text)) {
      this.statement(statement)
      return
    }
    const tokens = (pending ?? new Tokens([], statement.line)).with(
      tokensOf(statement.line, statement.text),
    )
    if (tokens.isOpen) {
      this.pending = tokens
      return
    }
    this.pending = null
    this.read(tokens)
  }

  build(): Radar | Refusal {
    if (this.pending !== null) throw doesNotParse(this.pending.line)
    if (this.axes.length === 0) return radarRefusal('the radar diagram has no axes')
    if (this.curves.length === 0) return radarRefusal('the radar diagram has no curves')
    const curves = this.curves.map((curve) => ({
      label: curve.label,
      values: this.valuesOf(curve),
    }))
    const low = Number(this.options.get('min') ?? 0)
    const most = Math.max(...curves.flatMap((curve) => curve.values))
    const high = Number(this.options.get('max') ?? most)
    if (!(high > low)) {
      return radarRefusal(`the max ${String(high)} is not above the min ${String(low)}`)
    }
    return {
      kind: 'radar',
      title: this.title,
      axes: this.axes,
      curves,
      low,
      high,
      hasLegend: this.options.get('showLegend') !== 'false',
    }
  }

  private statement({ line, text }: Statement): void {
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = (title[1] ?? '').trim().replace(SPACES, ' ') || null
      return
    }
    if (ACCESSIBILITY.test(text)) return
    if (DESCRIPTION_BLOCK.test(text)) {
      this.isInDescription = !text.includes(DESCRIPTION_END)
      return
    }
    this.read(new Tokens(tokensOf(line, text), line))
  }

  private read(tokens: Tokens): void {
    const item = this.readerOf(tokens)
    item()
    while (tokens.skip(',')) item()
    if (!tokens.done) throw doesNotParse(tokens.line)
  }

  private readerOf(tokens: Tokens): () => void {
    const keyword = tokens.peek()
    if (keyword?.kind !== 'word') throw doesNotParse(tokens.line)
    if (OPTIONS.has(keyword.text)) {
      return () => {
        this.option(tokens)
      }
    }
    tokens.take('word')
    if (keyword.text === 'axis') {
      return () => {
        this.axis(tokens)
      }
    }
    if (keyword.text === 'curve') {
      return () => {
        this.curve(tokens)
      }
    }
    throw doesNotParse(tokens.line)
  }

  private axis(tokens: Tokens): void {
    const name = tokens.name()
    this.axes.push({ name, label: tokens.label(name) })
  }

  private curve(tokens: Tokens): void {
    const name = tokens.name()
    const label = tokens.label(name)
    tokens.expect(OPENING)
    const isDetailed = tokens.peek()?.kind === 'word'
    const entries = [this.entry(tokens, isDetailed)]
    while (tokens.skip(',')) entries.push(this.entry(tokens, isDetailed))
    tokens.expect(CLOSING)
    this.curves.push({ name, label, entries, line: tokens.line })
  }

  private entry(tokens: Tokens, isDetailed: boolean): Entry {
    if (!isDetailed) return { axis: null, value: Number(tokens.take('number')) }
    const axis = tokens.take('word')
    tokens.skip(':')
    return { axis, value: Number(tokens.take('number')) }
  }

  private option(tokens: Tokens): void {
    const name = tokens.take('word')
    if (!isOptionName(name)) throw doesNotParse(tokens.line)
    const next = tokens.peek()
    const value = next?.text ?? ''
    const isValid =
      name === 'showLegend'
        ? next?.kind === 'word' && BOOLEANS.has(value)
        : name === 'graticule'
          ? next?.kind === 'word' && GRATICULES.has(value)
          : next?.kind === 'number'
    if (!isValid || next === undefined) throw doesNotParse(tokens.line)
    tokens.take(next.kind)
    this.options.set(name, value)
  }

  private valuesOf(curve: WrittenCurve): number[] {
    if (curve.entries[0]?.axis === null) {
      if (curve.entries.length !== this.axes.length) {
        throw lineFault(
          curve.line,
          `the curve ${curve.label} has ${valueCount(curve.entries.length)} for ${axisCount(this.axes.length)}`,
        )
      }
      return curve.entries.map((entry) => entry.value)
    }
    return this.axes.map((axis) => {
      const entry = curve.entries.find((found) => found.axis === axis.name)
      if (entry === undefined) {
        throw lineFault(
          curve.line,
          `the curve ${curve.label} has no value for the axis ${axis.label}`,
        )
      }
      return entry.value
    })
  }
}

function isOptionName(name: string): name is OptionName {
  return OPTIONS.has(name)
}

function valueCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'value' : 'values'}`
}

function axisCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'axis' : 'axes'}`
}

function radarRefusal(reason: string): Refusal {
  return { kind: 'refused', reason, line: null, limit: null }
}

export function radarBuilder(header: Statement): RadarBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (!DRAWN_HEADER.test(header.text)) throw doesNotParse(header.line)
  return new RadarBuilder()
}

function valueText(value: number): string {
  return String(value)
}

type Layout = {
  kind: 'layout'
  isStacked: boolean
  axisWidth: number
  curveLeft: number
  curveWidth: number
  left: number
  bar: number
}

function column(wanted: number): BarColumn {
  return { wanted, least: leastLabel(wanted) }
}

function layoutOf(
  axisLabels: readonly string[],
  curveLabels: readonly string[],
  valueWidth: number,
  width: number,
): Layout | Refusal {
  const fixed = LABEL_GAP + valueWidth
  const axisWanted = widest(axisLabels)
  if (curveLabels.length === 1) {
    const single = barColumns([column(axisWanted)], fixed + LABEL_GAP, width)
    if (single.kind === 'refused') return single
    const axisWidth = single.widths[0] ?? 0
    const left = axisWidth + LABEL_GAP
    return {
      kind: 'layout',
      isStacked: false,
      axisWidth,
      curveLeft: left,
      curveWidth: 0,
      left,
      bar: single.bar,
    }
  }
  const curveWanted = widest(curveLabels)
  const wanted = [axisWanted, curveWanted]
  const side = barColumns(wanted.map(column), fixed + COLUMN_GAP + LABEL_GAP, width)
  if (side.kind === 'columns' && side.widths.every((used, at) => used === wanted[at])) {
    const curveLeft = axisWanted + COLUMN_GAP
    const left = curveLeft + curveWanted + LABEL_GAP
    return {
      kind: 'layout',
      isStacked: false,
      axisWidth: axisWanted,
      curveLeft,
      curveWidth: curveWanted,
      left,
      bar: side.bar,
    }
  }
  const stacked = barColumns([column(curveWanted)], fixed + STACK_INDENT + LABEL_GAP, width)
  if (stacked.kind === 'refused') return stacked
  const curveWidth = stacked.widths[0] ?? 0
  const left = STACK_INDENT + curveWidth + LABEL_GAP
  return {
    kind: 'layout',
    isStacked: true,
    axisWidth: width,
    curveLeft: STACK_INDENT,
    curveWidth,
    left,
    bar: stacked.bar,
  }
}

export function drawRadar(radar: Radar, width: number): InkedDrawing | Refusal {
  const axisLabels = radar.axes.map((axis) => shown(axis.label))
  const curveLabels = radar.curves.map((curve) => shown(curve.label))
  const texts = radar.curves.map((curve) => curve.values.map(valueText))
  const layout = layoutOf(axisLabels, curveLabels, widest(texts.flat()), width)
  if (layout.kind === 'refused') return layout
  const hasCurveColumn = curveLabels.length > 1
  const legend: LegendItem[] =
    radar.hasLegend && !hasCurveColumn
      ? curveLabels.map((name, at) => ({ glyph: LEGEND_GLYPH, ink: at, name, looks: PLAIN_LOOKS }))
      : []
  const sheet = new ChartGrid()
  let row = putHead(sheet, radar.title, legend, width)
  const span = radar.high - radar.low
  axisLabels.forEach((label, axis) => {
    sheet.put(row, 0, cutLabel(label, layout.axisWidth), 'plain', BOLD)
    if (layout.isStacked) row += 1
    radar.curves.forEach((curve, at) => {
      const value = curve.values[axis] ?? radar.low
      const share = (Math.min(Math.max(value, radar.low), radar.high) - radar.low) / span
      if (hasCurveColumn) {
        sheet.put(row, layout.curveLeft, cutLabel(curveLabels[at] ?? '', layout.curveWidth), at)
      }
      sheet.put(row, layout.left, shareBar(share, layout.bar), at)
      const text = texts[at]?.[axis] ?? ''
      sheet.put(row, width - displayWidth(text), text, VALUE_INK)
      row += 1
    })
  })
  const lowText = valueText(radar.low)
  const highText = valueText(radar.high)
  if (displayWidth(lowText) + displayWidth(highText) + 1 <= layout.bar) {
    sheet.put(row, layout.left, lowText, VALUE_INK)
    sheet.put(row, layout.left + layout.bar - displayWidth(highText), highText, VALUE_INK)
    row += 1
  }
  if (row > MOST_ROWS) {
    return radarRefusal(`${String(row)} rows, at most ${String(MOST_ROWS)} draw`)
  }
  return fits(sheet.drawing(width), width)
}
