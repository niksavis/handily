import { barColumns, ChartGrid, cutLabel, fits, leastLabel, shareBar } from './charts'
import { MOST_ROWS, shown, widest } from './flowchart'
import { PLAIN_LOOKS, type Ink, type InkedDrawing, type Looks } from './ink'
import { doesNotParse, lineFault, type Refusal, type Statement } from './mermaid'
import { displayWidth } from './width'

export type SankeyLink = { source: number; target: number; value: number }

export type Sankey = { kind: 'sankey'; nodes: string[]; links: SankeyLink[] }

const HEADER = /^sankey/
const DRAWN_HEADER = /^sankey(?:-beta)?$/
const PRINTABLE = /^[ -~]*$/
const FIELD = /(?:"((?:[^"]|"")*)"|([^",]*))(,|$)/y
const ESCAPED_QUOTE = /""/g
const QUOTE = '"'
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const FIELDS = 3
const LABEL_GAP = 1
const BRANCH = '├─ '
const LAST_BRANCH = '└─ '
const LINE_INK: Ink = 'line'
const VALUE_INK: Ink = 1
const BOLD: Looks = { ...PLAIN_LOOKS, isBold: true }

function fieldsOf({ line, text, indent }: Statement): string[] {
  if (!PRINTABLE.test(text) || (indent > 0 && text.startsWith(QUOTE))) throw doesNotParse(line)
  const fields: string[] = []
  FIELD.lastIndex = 0
  for (;;) {
    const found = FIELD.exec(text)
    if (found === null) throw doesNotParse(line)
    const quoted = found[1]
    fields.push(
      (quoted === undefined ? (found[2] ?? '') : quoted.replace(ESCAPED_QUOTE, QUOTE)).trim(),
    )
    if (found[3] !== ',') return fields
  }
}

export class SankeyBuilder {
  private readonly nodes = new Map<string, number>()
  private readonly links: SankeyLink[] = []
  private readonly targets: number[][] = []

  add(statement: Statement): void {
    const { line } = statement
    const fields = fieldsOf(statement)
    const [source = '', target = '', written = ''] = fields
    if (fields.length !== FIELDS || source === '' || target === '') throw doesNotParse(line)
    if (!NUMBER.test(written)) {
      throw lineFault(line, `line ${String(line)}: ${JSON.stringify(written)} is not a number`)
    }
    const value = Number(written)
    if (value < 0) {
      throw lineFault(
        line,
        `line ${String(line)}: the link from ${JSON.stringify(source)} to ${JSON.stringify(target)} is below 0`,
      )
    }
    const from = this.node(source)
    const to = this.node(target)
    if (this.reaches(to, from)) throw lineFault(line, `line ${String(line)} closes a cycle`)
    this.targets[from]?.push(to)
    this.links.push({ source: from, target: to, value })
  }

  build(): Sankey | Refusal {
    if (this.links.length === 0) {
      return { kind: 'refused', reason: 'the sankey diagram has no links', line: null, limit: null }
    }
    return { kind: 'sankey', nodes: [...this.nodes.keys()], links: this.links }
  }

  private node(name: string): number {
    const known = this.nodes.get(name)
    if (known !== undefined) return known
    const index = this.nodes.size
    this.nodes.set(name, index)
    this.targets.push([])
    return index
  }

  private reaches(from: number, to: number): boolean {
    const seen = new Set<number>()
    const open = [from]
    for (let node = open.pop(); node !== undefined; node = open.pop()) {
      if (node === to) return true
      if (seen.has(node)) continue
      seen.add(node)
      open.push(...(this.targets[node] ?? []))
    }
    return false
  }
}

export function sankeyBuilder(header: Statement): SankeyBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (!DRAWN_HEADER.test(header.text)) throw doesNotParse(header.line)
  return new SankeyBuilder()
}

type Flow = { into: number; out: number; depth: number; links: SankeyLink[] }

function valueText(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function flowsOf(sankey: Sankey): Flow[] {
  const flows: Flow[] = sankey.nodes.map(() => ({ into: 0, out: 0, depth: 0, links: [] }))
  for (const link of sankey.links) {
    const source = flows[link.source]
    const target = flows[link.target]
    if (source === undefined || target === undefined) continue
    source.out += link.value
    source.links.push(link)
    target.into += link.value
  }
  for (let changed = true; changed;) {
    changed = false
    for (const link of sankey.links) {
      const source = flows[link.source]
      const target = flows[link.target]
      if (source === undefined || target === undefined || target.depth > source.depth) continue
      target.depth = source.depth + 1
      changed = true
    }
  }
  const last = Math.max(...flows.map((flow) => flow.depth))
  for (const flow of flows) if (flow.links.length === 0) flow.depth = last
  return flows
}

export function drawSankey(sankey: Sankey, width: number): InkedDrawing | Refusal {
  const flows = flowsOf(sankey)
  const order = sankey.nodes
    .map((_, index) => index)
    .sort((one, other) => (flows[one]?.depth ?? 0) - (flows[other]?.depth ?? 0) || one - other)
  const inks = new Map(order.map((node, at) => [node, at]))
  const names = sankey.nodes.map(shown)
  const rows = sankey.nodes.length + sankey.links.length
  if (rows > MOST_ROWS) {
    return {
      kind: 'refused',
      reason: `${String(rows)} rows, at most ${String(MOST_ROWS)} draw`,
      line: null,
      limit: null,
    }
  }
  const valueWidth = widest(sankey.links.map((link) => valueText(link.value)))
  const targetWidth = widest(sankey.links.map((link) => names[link.target] ?? ''))
  const fixed = displayWidth(BRANCH) + 2 * LABEL_GAP + valueWidth
  const columns = barColumns(
    [{ wanted: targetWidth, least: leastLabel(targetWidth) }],
    fixed,
    width,
  )
  if (columns.kind === 'refused') return columns
  const labelWidth = columns.widths[0] ?? 0
  const high = Math.max(...sankey.links.map((link) => link.value))
  const left = displayWidth(BRANCH) + labelWidth + LABEL_GAP
  const totals = flows.map((flow) => valueText(Math.max(flow.into, flow.out)))
  const nameWidth = width - widest(totals) - LABEL_GAP
  const sheet = new ChartGrid()
  let row = 0
  for (const node of order) {
    const flow = flows[node]
    if (flow === undefined) continue
    const total = totals[node] ?? ''
    const ink = inks.get(node) ?? 0
    sheet.put(row, 0, cutLabel(names[node] ?? '', nameWidth), ink, BOLD)
    sheet.put(row, width - displayWidth(total), total, VALUE_INK)
    row += 1
    flow.links.forEach((link, at) => {
      const target = inks.get(link.target) ?? 0
      const text = valueText(link.value)
      sheet.put(row, 0, at === flow.links.length - 1 ? LAST_BRANCH : BRANCH, LINE_INK)
      sheet.put(row, displayWidth(BRANCH), cutLabel(names[link.target] ?? '', labelWidth), target)
      const share = high > 0 ? link.value / high : 0
      sheet.put(row, left, shareBar(share, columns.bar), target)
      sheet.put(row, width - displayWidth(text), text, VALUE_INK)
      row += 1
    })
  }
  return fits(sheet.drawing(width), width)
}
