import { barColumns, ChartGrid, cutLabel, fits, leastLabel, putHead, shareBar } from './charts'
import { MOST_ROWS, shown, widest } from './flowchart'
import { PLAIN_LOOKS, type Ink, type InkedDrawing, type Looks } from './ink'
import { doesNotParse, lineFault, type Refusal, type Statement } from './mermaid'
import { displayWidth } from './width'

export type TreemapNode = { name: string; value: number; children: TreemapNode[] | null }

export type Treemap = { kind: 'treemap'; title: string | null; nodes: TreemapNode[] }

const HEADER = /^treemap/
const DRAWN_HEADER = /^treemap(?:-beta)?$/
const TITLE = /^title(?:[\t ](.*?))?(?:%%.*)?$/
const ACCESSIBILITY = /^acc(?:Title[\t ]*:|Descr[\t ]*:)/
const DESCRIPTION_BLOCK = /^accDescr\s*\{/
const DESCRIPTION_END = '}'
const CLASS_DEF = /^classDef\s+[a-zA-Z_][a-zA-Z0-9_]+(?:\s|;|$)/
const ITEM =
  /^(?:"([^"]*)"|'([^']*)')(?:[\t ]*[:,][\t ]*([0-9_.,]+))?(?::::[a-zA-Z_][a-zA-Z0-9_]*)?(?:[\t ]*%%.*)?$/
const THOUSANDS = /,/g
const NUMBER = /^(?:\d+\.?\d*|\.\d+)$/
const SPACES = /[\t ]{2,}/g
const GROUPS = /\B(?=(\d{3})+(?!\d))/g
const DIGITS = /^\d+$/
const SIGNIFICANT_DIGITS = 12
const BRANCH = '├─ '
const LAST_BRANCH = '└─ '
const THROUGH = '│  '
const PAST = '   '
const LABEL_GAP = 1
const ROOT_INK: Ink = 0
const LINE_INK: Ink = 'line'
const VALUE_INK: Ink = 1
const BOLD: Looks = { ...PLAIN_LOOKS, isBold: true }

type Open = { node: TreemapNode; level: number }

export class TreemapBuilder {
  private title: string | null = null
  private readonly nodes: TreemapNode[] = []
  private readonly open: Open[] = []
  private isInDescription = false

  add({ line, text, indent }: Statement): void {
    if (this.isInDescription) {
      this.isInDescription = !text.includes(DESCRIPTION_END)
      return
    }
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = (title[1] ?? '').trim().replace(SPACES, ' ') || null
      return
    }
    if (ACCESSIBILITY.test(text) || CLASS_DEF.test(text)) return
    if (DESCRIPTION_BLOCK.test(text)) {
      this.isInDescription = !text.includes(DESCRIPTION_END)
      return
    }
    const item = ITEM.exec(text)
    if (item === null) throw doesNotParse(line)
    const name = item[1] ?? item[2] ?? ''
    const written = item[3]
    const node: TreemapNode =
      written === undefined
        ? { name, value: 0, children: [] }
        : { name, value: valueOf(line, written), children: null }
    while ((this.open.at(-1)?.level ?? -1) >= indent) this.open.pop()
    const parent = this.open.at(-1)
    if (parent === undefined) this.nodes.push(node)
    else parent.node.children?.push(node)
    if (node.children !== null) this.open.push({ node, level: indent })
  }

  build(): Treemap | Refusal {
    if (this.nodes.length === 0) return treemapRefusal('the treemap has no items')
    const nodes = this.nodes.map(totalled)
    if (totalOf(nodes) === 0) return treemapRefusal('the treemap values add up to 0')
    return { kind: 'treemap', title: this.title, nodes }
  }
}

function valueOf(line: number, written: string): number {
  const number = written.replace(THOUSANDS, '')
  if (!NUMBER.test(number)) {
    throw lineFault(line, `line ${String(line)}: ${JSON.stringify(written)} is not a number`)
  }
  return Number(number)
}

function totalOf(nodes: readonly TreemapNode[]): number {
  return nodes.reduce((sum, node) => sum + node.value, 0)
}

function totalled(node: TreemapNode): TreemapNode {
  if (node.children === null) return node
  const children = node.children.map(totalled)
  return { ...node, value: totalOf(children), children }
}

function treemapRefusal(reason: string): Refusal {
  return { kind: 'refused', reason, line: null, limit: null }
}

export function treemapBuilder(header: Statement): TreemapBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (!DRAWN_HEADER.test(header.text)) throw doesNotParse(header.line)
  return new TreemapBuilder()
}

type Row = { prefix: string; label: string; value: number; isSection: boolean; ink: Ink }

function valueText(value: number): string {
  const [whole = '', fraction] = String(Number(value.toPrecision(SIGNIFICANT_DIGITS))).split('.')
  const grouped = DIGITS.test(whole) ? whole.replace(GROUPS, ',') : whole
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

function sorted(nodes: readonly TreemapNode[]): TreemapNode[] {
  return [...nodes].sort((one, other) => other.value - one.value)
}

function sectionInks(nodes: readonly TreemapNode[]): Map<TreemapNode, Ink> {
  const inks = new Map<TreemapNode, Ink>()
  let level = sorted(nodes)
  while (level.length > 0) {
    for (const node of level) if (node.children !== null) inks.set(node, inks.size + 1)
    level = level.flatMap((node) => sorted(node.children ?? []))
  }
  return inks
}

function rowsOf(nodes: readonly TreemapNode[]): Row[] {
  const inks = sectionInks(nodes)
  const rows: Row[] = []
  const visit = (node: TreemapNode, lead: string, mark: string, parent: Ink) => {
    const ink = inks.get(node) ?? parent
    rows.push({
      prefix: lead + mark,
      label: shown(node.name),
      value: node.value,
      isSection: node.children !== null,
      ink,
    })
    const children = sorted(node.children ?? [])
    const inner = mark === '' ? '' : lead + (mark === LAST_BRANCH ? PAST : THROUGH)
    children.forEach((child, at) => {
      visit(child, inner, at === children.length - 1 ? LAST_BRANCH : BRANCH, ink)
    })
  }
  for (const node of sorted(nodes)) visit(node, '', '', ROOT_INK)
  return rows
}

export function drawTreemap(treemap: Treemap, width: number): InkedDrawing | Refusal {
  const rows = rowsOf(treemap.nodes)
  const texts = rows.map((row) => valueText(row.value))
  const valueWidth = widest(texts)
  const wanted = Math.max(...rows.map((row) => displayWidth(row.prefix + row.label)))
  const least = Math.max(
    ...rows.map((row) => displayWidth(row.prefix) + leastLabel(displayWidth(row.label))),
  )
  const columns = barColumns([{ wanted, least }], LABEL_GAP * 2 + valueWidth, width)
  if (columns.kind === 'refused') return columns
  const labelWidth = columns.widths[0] ?? 0
  const left = labelWidth + LABEL_GAP
  const total = totalOf(treemap.nodes)
  const sheet = new ChartGrid()
  let line = putHead(sheet, treemap.title, [], width)
  rows.forEach((row, at) => {
    const prefixWidth = displayWidth(row.prefix)
    sheet.put(line, 0, row.prefix, LINE_INK)
    const label = cutLabel(row.label, labelWidth - prefixWidth)
    sheet.put(
      line,
      prefixWidth,
      label,
      row.isSection ? row.ink : 'plain',
      row.isSection ? BOLD : PLAIN_LOOKS,
    )
    sheet.put(line, left, shareBar(row.value / total, columns.bar), row.ink)
    const text = texts[at] ?? ''
    sheet.put(line, width - displayWidth(text), text, VALUE_INK)
    line += 1
  })
  if (line > MOST_ROWS) {
    return treemapRefusal(`${String(line)} rows, at most ${String(MOST_ROWS)} draw`)
  }
  return fits(sheet.drawing(width), width)
}
