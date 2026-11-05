import { ChartGrid } from './charts'
import { DOWN, LEFT, MOST_ROWS, RIGHT, shown, SOLID_GLYPHS, tooWide, UP } from './flowchart'
import { PLAIN_LOOKS, plainLabel, type Ink, type InkedDrawing, type InkRun } from './ink'
import { doesNotParse, lineFault, type Refusal, type Statement } from './mermaid'
import {
  drawnOutline,
  inkedLine,
  part,
  titleLines,
  withLooks,
  wrappedLabel,
  type Part as Piece,
} from './outline'
import { displayWidth } from './width'

export type PacketField = { label: string; start: number; end: number }

export type Packet = { kind: 'packet'; title: string | null; fields: PacketField[] }

const HEADER = /^packet/
const DRAWN_HEADER = /^packet(?:-beta)?$/
const TITLE = /^title(?:[\t ](.*))?$/
const ACCESSIBILITY = /^acc(?:Title\s*:|Descr\s*(?::|\{[^}]*\}$))/
const INTEGER = '(0|[1-9]\\d*)'
const FIELD = new RegExp(
  `^(?:${INTEGER}(?:\\s*-\\s*${INTEGER})?|\\+\\s*${INTEGER})\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')(?:\\s*%%.*)?$`,
)
const ESCAPE = /\\(.)/g

function unquoted(text: string): string {
  return text.slice(1, -1).replace(ESCAPE, '$1')
}

export class PacketBuilder {
  private title: string | null = null
  private readonly fields: PacketField[] = []

  add({ line, text }: Statement): void {
    if (ACCESSIBILITY.test(text)) return
    const title = TITLE.exec(text)
    if (title !== null) {
      this.title = shown(title[1] ?? '').trim() || null
      return
    }
    const found = FIELD.exec(text)
    if (found === null) throw doesNotParse(line)
    const next = (this.fields.at(-1)?.end ?? -1) + 1
    const bits = found[3] === undefined ? null : Number(found[3])
    const start = found[1] === undefined ? next : Number(found[1])
    const end = bits === null ? Number(found[2] ?? found[1]) : start + bits - 1
    const at = `line ${String(line)}:`
    if (bits === 0) throw lineFault(line, `${at} a field has at least 1 bit`)
    if (end < start) {
      throw lineFault(line, `${at} the field ends at bit ${String(end)}, before its start`)
    }
    if (start !== next) {
      throw lineFault(
        line,
        `${at} the field starts at bit ${String(start)}, not at bit ${String(next)}`,
      )
    }
    this.fields.push({ label: shown(unquoted(found[4] ?? '""')), start, end })
  }

  build(): Packet | Refusal {
    if (this.fields.length === 0) {
      return { kind: 'refused', reason: 'the packet has no fields', line: null, limit: null }
    }
    return { kind: 'packet', title: this.title, fields: this.fields }
  }
}

export function packetBuilder(header: Statement): PacketBuilder | null {
  if (!HEADER.test(header.text)) return null
  if (!DRAWN_HEADER.test(header.text)) throw doesNotParse(header.line)
  return new PacketBuilder()
}

const WORD_BITS = 32
const ROW_BITS = [WORD_BITS, 16, 8]
const BIT_COLUMNS = 2
const KEYS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const ACROSS = LEFT | RIGHT
const SIDE = '│'
const RANGE_GAP = '  '
const LINE_INK: Ink = 'line'
const BOLD = { ...PLAIN_LOOKS, isBold: true }

type Part = { field: number; start: number; end: number }

type Layout = { bits: number; words: Part[][]; fields: PacketField[]; keyed: number[] }

function rowWidth(bits: number): number {
  return bits * BIT_COLUMNS + 1
}

function wordsOf(packet: Packet, bits: number): Part[][] {
  const words: Part[][] = []
  packet.fields.forEach((field, index) => {
    for (let start = field.start; start <= field.end;) {
      const word = Math.floor(start / bits)
      const end = Math.min(field.end, (word + 1) * bits - 1)
      const parts = words[word] ?? []
      parts.push({ field: index, start, end })
      words[word] = parts
      start = end + 1
    }
  })
  return words
}

function leftOf(bits: number, part: Part): number {
  return (part.start % bits) * BIT_COLUMNS
}

function roomOf(part: Part): number {
  return (part.end - part.start + 1) * BIT_COLUMNS - 1
}

function edgesOf(bits: number, word: readonly Part[] | undefined): Set<number> {
  const edges = new Set<number>()
  for (const part of word ?? []) {
    edges.add(leftOf(bits, part))
    edges.add(leftOf(bits, part) + roomOf(part) + 1)
  }
  return edges
}

function extentOf(bits: number, word: readonly Part[] | undefined): number {
  const last = word?.at(-1)
  return last === undefined ? 0 : leftOf(bits, last) + roomOf(last) + 1
}

function putRule(sheet: ChartGrid, row: number, layout: Layout, below: number): Set<number> {
  const { bits, words } = layout
  const above = edgesOf(bits, words[below - 1])
  const under = edgesOf(bits, words[below])
  const extent = Math.max(extentOf(bits, words[below - 1]), extentOf(bits, words[below]))
  const plain = new Set<number>()
  for (let col = 0; col <= extent; col++) {
    const mask =
      (col > 0 ? LEFT : 0) |
      (col < extent ? RIGHT : 0) |
      (above.has(col) ? UP : 0) |
      (under.has(col) ? DOWN : 0)
    if (mask === ACROSS) plain.add(col)
    sheet.put(row, col, SOLID_GLYPHS[mask] ?? ' ', LINE_INK)
  }
  return plain
}

function isPlain(plain: ReadonlySet<number>, from: number, columns: number): boolean {
  for (let col = from; col < from + columns; col++) if (!plain.has(col)) return false
  return true
}

function bitNumbers(part: Part): { text: string; at: number }[] {
  const first = String(part.start)
  if (part.start === part.end) return [{ text: first, at: 1 }]
  const last = String(part.end)
  return [
    { text: first, at: 1 },
    { text: last, at: roomOf(part) + 1 - last.length },
  ]
}

function putNumbers(
  sheet: ChartGrid,
  row: number,
  layout: Layout,
  word: number,
  plain: Set<number>,
) {
  for (const part of layout.words[word] ?? []) {
    for (const { text, at } of bitNumbers(part)) {
      const col = leftOf(layout.bits, part) + at
      if (!isPlain(plain, col, text.length)) continue
      sheet.put(row, col, text, 'plain')
      for (let taken = col - 1; taken <= col + text.length; taken++) plain.delete(taken)
    }
  }
}

function partText(layout: Layout, part: Part): string {
  const label = layout.fields[part.field]?.label ?? ''
  if (displayWidth(label) <= roomOf(part)) return label
  return KEYS[layout.keyed.indexOf(part.field)] ?? ''
}

function putLabels(sheet: ChartGrid, row: number, layout: Layout, word: number) {
  const parts = layout.words[word] ?? []
  for (const part of parts) {
    const left = leftOf(layout.bits, part)
    const text = partText(layout, part)
    const isKey = text !== (layout.fields[part.field]?.label ?? '')
    sheet.put(row, left, SIDE, LINE_INK)
    const at = left + 1 + Math.floor((roomOf(part) - displayWidth(text)) / 2)
    sheet.put(row, at, text, part.field, isKey ? BOLD : PLAIN_LOOKS)
  }
  sheet.put(row, extentOf(layout.bits, parts), SIDE, LINE_INK)
}

function keyedOf(fields: readonly PacketField[], words: readonly Part[][]): number[] {
  const keyed = new Set<number>()
  for (const part of words.flat()) {
    if (displayWidth(fields[part.field]?.label ?? '') > roomOf(part)) keyed.add(part.field)
  }
  return [...keyed].sort((one, other) => one - other)
}

function rangeText(field: PacketField): string {
  if (field.start === field.end) return `bit ${String(field.start)}`
  return `bits ${String(field.start)}-${String(field.end)}`
}

function keyLines(layout: Layout, width: number): InkRun[][] {
  return layout.keyed.flatMap((index, at) => {
    const field = layout.fields[index]
    if (field === undefined) return []
    const lead = `${KEYS[at] ?? ''} `
    const range = rangeText(field)
    const names = wrappedLabel(plainLabel(field.label), width - lead.length)
    const last = names.at(-1)?.text ?? ''
    const together = displayWidth(last) + RANGE_GAP.length + range.length <= width - lead.length
    const rows: Piece[][] = names.map((name, line) => [
      line === 0
        ? { label: withLooks(plainLabel(lead), BOLD), ink: index }
        : part(' '.repeat(lead.length), 'plain'),
      { label: name, ink: 'plain' },
    ])
    if (together) rows.at(-1)?.push(part(`${RANGE_GAP}${range}`, LINE_INK))
    else rows.push([part(' '.repeat(lead.length), 'plain'), part(range, LINE_INK)])
    return rows.map((row) => inkedLine(row))
  })
}

function noteLines(bits: number, width: number): InkRun[][] {
  if (bits === WORD_BITS) return []
  const note = `${String(bits)} bits a row: ${String(WORD_BITS)} bits take ${String(rowWidth(WORD_BITS))} columns, the screen has ${String(width)}.`
  return wrappedLabel(plainLabel(note), width).map((line) =>
    inkedLine([{ label: line, ink: LINE_INK }]),
  )
}

function tooManyRows(rows: number): Refusal {
  return {
    kind: 'refused',
    reason: `${String(rows)} rows, at most ${String(MOST_ROWS)} draw`,
    line: null,
    limit: null,
  }
}

export function drawPacket(packet: Packet, width: number): InkedDrawing | Refusal {
  const bits = ROW_BITS.find((candidate) => rowWidth(candidate) <= width)
  if (bits === undefined) return tooWide(rowWidth(ROW_BITS.at(-1) ?? 1), width)
  const total = (packet.fields.at(-1)?.end ?? 0) + 1
  const frameRows = 2 * Math.ceil(total / bits) + 1
  if (frameRows > MOST_ROWS) return tooManyRows(frameRows)
  const words = wordsOf(packet, bits)
  const keyed = keyedOf(packet.fields, words)
  if (keyed.length > KEYS.length) {
    return {
      kind: 'refused',
      reason: `${String(keyed.length)} fields need a key, at most ${String(KEYS.length)} draw`,
      line: null,
      limit: null,
    }
  }
  const layout: Layout = { bits, words, fields: packet.fields, keyed }
  const sheet = new ChartGrid()
  words.forEach((_, word) => {
    const plain = putRule(sheet, 2 * word, layout, word)
    putNumbers(sheet, 2 * word, layout, word, plain)
    putLabels(sheet, 2 * word + 1, layout, word)
  })
  putRule(sheet, 2 * words.length, layout, words.length)
  return drawnOutline([
    ...titleLines(packet.title, width),
    ...sheet.drawing(width).inked,
    ...noteLines(bits, width),
    ...keyLines(layout, width),
  ])
}
