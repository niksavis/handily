import {
  copiedCell,
  markedCell,
  PLAIN_MARK,
  sameMark,
  shownText,
  textOfRuns,
  type Alignment,
  type Mark,
  type Run,
  type Table,
} from './markdown'
import { cutToWidth, displayWidth, graphemesOf, padToWidth } from './width'

const COLUMN_RULE = '│'
const COLUMN_GAP = displayWidth(` ${COLUMN_RULE} `)
const SIDE_COLUMNS = displayWidth(`${COLUMN_RULE} `)
const LONG_COLUMN_CELLS_AT_LEAST = 12
const COLUMN_CELLS_AT_LEAST = 6
const NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/

export const TABLE_STYLES = ['rules', 'box'] as const

export type TableStyle = (typeof TABLE_STYLES)[number]

export const DEFAULT_TABLE_STYLE: TableStyle = 'rules'

export function isTableStyle(value: unknown): value is TableStyle {
  return TABLE_STYLES.some((style) => style === value)
}

export type RuleEdge = { left: string; fill: string; cross: string; right: string }

export type TableFrame = {
  top: RuleEdge | null
  header: RuleEdge
  row: RuleEdge
  bottom: RuleEdge | null
  hasSides: boolean
  rulesEveryRow: boolean
}

export const TABLE_FRAMES: Readonly<Record<TableStyle, TableFrame>> = {
  rules: {
    top: null,
    header: { left: '', fill: '═', cross: '╪', right: '' },
    row: { left: '', fill: '┄', cross: '┼', right: '' },
    bottom: null,
    hasSides: false,
    rulesEveryRow: false,
  },
  box: {
    top: { left: '┌', fill: '─', cross: '┬', right: '┐' },
    header: { left: '╞', fill: '═', cross: '╪', right: '╡' },
    row: { left: '├', fill: '─', cross: '┼', right: '┤' },
    bottom: { left: '└', fill: '─', cross: '┴', right: '┘' },
    hasSides: true,
    rulesEveryRow: true,
  },
}

export type Cell = { text: string; runs: Run[]; isNumber: boolean }

export type CellMark = Mark & { isNumber: boolean }

export type TableLook = {
  header: Cell[]
  rows: Cell[][]
  alignments: Alignment[]
  widths: number[]
  words: number[]
}

const EMPTY_CELL: Cell = { text: '', runs: [], isNumber: false }

type CellText = (cell: string) => string

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, value) => total + value, 0)
}

function plainCellOf(text: string): Cell {
  return { text, runs: [{ text, mark: PLAIN_MARK }], isNumber: false }
}

function cellOf(source: string): Cell {
  const runs = markedCell(source)
    .map((run) => ({ text: shownText(run.text), mark: run.mark }))
    .filter((run) => run.text !== '')
  const text = textOfRuns(runs)
  return { text, runs, isNumber: NUMBER.test(text) }
}

function headerOf(table: Table, text: CellText): string[] {
  return table.header.map((cell, index) => text(cell) || `Column ${String(index + 1)}`)
}

function rowsOf(table: Table, text: CellText): string[][] {
  return table.rows.map((row) => row.map(text))
}

function headerCells(table: Table): Cell[] {
  return table.header.map((source, index) => {
    const cell = cellOf(source)
    return cell.text === '' ? plainCellOf(`Column ${String(index + 1)}`) : cell
  })
}

function longestWord(cell: string): number {
  return Math.max(0, ...cell.split(' ').map(displayWidth))
}

export function tableLook(table: Table): TableLook {
  const header = headerCells(table)
  const rows = table.rows.map((row) => row.map(cellOf))
  const widestBy = (measure: (text: string) => number) =>
    header.map((cell, index) =>
      Math.max(measure(cell.text), ...rows.map((row) => measure(row[index]?.text ?? ''))),
    )
  return {
    header,
    rows,
    alignments: table.alignments,
    widths: widestBy(displayWidth),
    words: widestBy(longestWord),
  }
}

function gapsOf(columns: number): number {
  return COLUMN_GAP * Math.max(columns - 1, 0)
}

export function tableWidth(widths: readonly number[]): number {
  return sum(widths) + gapsOf(widths.length)
}

function sidesOf(frame: TableFrame): number {
  return frame.hasSides ? 2 * SIDE_COLUMNS : 0
}

export function framedWidth(widths: readonly number[], frame: TableFrame): number {
  return tableWidth(widths) + sidesOf(frame)
}

export function roomInside(room: number, frame: TableFrame): number {
  return room - sidesOf(frame)
}

function longColumns(naturals: readonly number[], free: number) {
  let long = naturals.map((_, index) => index)
  let left = free
  for (;;) {
    const share = left / long.length
    const short = long.filter((index) => {
      const natural = naturals[index] ?? 0
      return natural <= share && natural <= LONG_COLUMN_CELLS_AT_LEAST
    })
    if (short.length === 0 || short.length === long.length) return { long, left }
    left -= sum(short.map((index) => naturals[index] ?? 0))
    long = long.filter((index) => !short.includes(index))
  }
}

function sharedWidths(
  naturals: readonly number[],
  long: readonly number[],
  room: number,
  leastOf: (index: number) => number,
): Map<number, number> {
  const widths = new Map<number, number>()
  const natural = (index: number) => naturals[index] ?? 0
  let open = [...long]
  let left = room
  for (;;) {
    const weight = sum(open.map(natural))
    const under = open.filter((index) => (left * natural(index)) / weight < leastOf(index))
    if (under.length === 0 || under.length === open.length) break
    for (const index of under) widths.set(index, leastOf(index))
    left -= sum(under.map(leastOf))
    open = open.filter((index) => !under.includes(index))
  }
  const weight = sum(open.map(natural))
  const exact = open.map((index) => ({ index, share: (left * natural(index)) / weight }))
  let spare = left - sum(exact.map(({ share }) => Math.floor(share)))
  const byFraction = exact.sort((a, b) => (b.share % 1) - (a.share % 1) || a.index - b.index)
  for (const { index, share } of byFraction) {
    widths.set(index, Math.floor(share) + (spare > 0 ? 1 : 0))
    spare -= 1
  }
  return widths
}

function wholeWordsOrLeast(
  words: readonly number[],
  long: readonly number[],
  left: number,
  least: number,
): (index: number) => number {
  const wholeWordAtLeast = (floor: number) => (index: number) => Math.max(floor, words[index] ?? 0)
  const fitting = [least, COLUMN_CELLS_AT_LEAST]
    .map(wholeWordAtLeast)
    .find((leastOf) => sum(long.map(leastOf)) <= left)
  return fitting ?? (() => least)
}

export function columnWidths(look: TableLook, room: number): number[] | null {
  const naturals = look.widths
  const free = room - gapsOf(naturals.length)
  if (sum(naturals) <= free) return [...naturals]
  const { long, left } = longColumns(naturals, free)
  const least = Math.min(LONG_COLUMN_CELLS_AT_LEAST, Math.floor(left / long.length))
  if (least < COLUMN_CELLS_AT_LEAST) return null
  const shared = sharedWidths(
    naturals,
    long,
    left,
    wholeWordsOrLeast(look.words, long, left, least),
  )
  return naturals.map((natural, index) => shared.get(index) ?? natural)
}

function piecesOf(word: string, width: number): string[] {
  const pieces: string[] = []
  let rest = word
  while (displayWidth(rest) > width) {
    const piece = cutToWidth(rest, width) || (graphemesOf(rest)[0] ?? rest)
    pieces.push(piece)
    rest = rest.slice(piece.length)
  }
  return [...pieces, rest]
}

export function wrapCell(text: string, width: number): string[] {
  if (displayWidth(text) <= width) return [text]
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ').filter((part) => part !== '')) {
    for (const piece of piecesOf(word, width)) {
      const joined = line === '' ? piece : `${line} ${piece}`
      if (line === '' || displayWidth(joined) <= width) {
        line = joined
        continue
      }
      lines.push(line)
      line = piece
    }
  }
  return [...lines, line]
}

function aligned(text: string, width: number, alignment: Alignment): string {
  const room = Math.max(width - displayWidth(text), 0)
  if (alignment === 'right') return ' '.repeat(room) + text
  if (alignment === 'center') return padToWidth(' '.repeat(Math.floor(room / 2)) + text, width)
  return padToWidth(text, width)
}

function marksOf(cell: Cell): Mark[] {
  return cell.runs.flatMap((run) => Array.from({ length: run.text.length }, () => run.mark))
}

function addRun(runs: Run[], text: string, mark: Mark): void {
  const last = runs.at(-1)
  if (last !== undefined && sameMark(last.mark, mark)) last.text += text
  else runs.push({ text, mark })
}

function runsOfLines(cell: Cell, lines: readonly string[]): Run[][] {
  const marks = marksOf(cell)
  let at = 0
  return lines.map((line) => {
    const runs: Run[] = []
    for (const character of line) {
      if (character === ' ' && cell.text[at] !== ' ') {
        addRun(runs, character, PLAIN_MARK)
        continue
      }
      if (character !== ' ') while (cell.text[at] === ' ') at += 1
      const isFound = cell.text.startsWith(character, at)
      addRun(runs, character, isFound ? (marks[at] ?? PLAIN_MARK) : PLAIN_MARK)
      if (isFound) at += character.length
    }
    return runs
  })
}

type CellLine = { text: string; runs: Run[]; isNumber: boolean }

function alignedLines(
  look: TableLook,
  widths: readonly number[],
  cells: readonly Cell[],
): CellLine[][] {
  const wrapped = widths.map((width, index) => {
    const cell = cells[index] ?? EMPTY_CELL
    return { cell, lines: runsOfLines(cell, wrapCell(cell.text, width)) }
  })
  const height = Math.max(1, ...wrapped.map(({ lines }) => lines.length))
  return Array.from({ length: height }, (_, line) =>
    wrapped.map(({ cell, lines }, index) => {
      const runs = lines[line] ?? []
      return {
        text: aligned(textOfRuns(runs), widths[index] ?? 0, look.alignments[index] ?? 'left'),
        runs,
        isNumber: cell.isNumber,
      }
    }),
  )
}

export type Span =
  | { text: string; kind: 'cell'; mark: CellMark }
  | { text: string; kind: 'space' }
  | { text: string; kind: 'rule' }

function trimmedRuns(runs: readonly Run[]): Run[] {
  const text = textOfRuns(runs)
  const start = text.length - text.trimStart().length
  const end = text.trimEnd().length
  const kept: Run[] = []
  let at = 0
  for (const run of runs) {
    const from = Math.max(start - at, 0)
    const to = Math.min(end - at, run.text.length)
    if (to > from) kept.push({ text: run.text.slice(from, to), mark: run.mark })
    at += run.text.length
  }
  return kept
}

function spansOf(line: readonly CellLine[], frame: TableFrame): Span[] {
  const spans: Span[] = []
  const addSpace = (text: string) => {
    const last = spans.at(-1)
    if (text === '') return
    if (last?.kind === 'space') last.text += text
    else spans.push({ text, kind: 'space' })
  }
  const addRule = () => {
    spans.push({ text: COLUMN_RULE, kind: 'rule' })
  }
  if (frame.hasSides) {
    addRule()
    addSpace(' ')
  }
  for (const [index, cell] of line.entries()) {
    if (index > 0) {
      addSpace(' ')
      addRule()
      addSpace(' ')
    }
    const lead = cell.text.length - cell.text.trimStart().length
    const text = cell.text.trim()
    addSpace(cell.text.slice(0, lead))
    for (const run of trimmedRuns(cell.runs)) {
      spans.push({ text: run.text, kind: 'cell', mark: { ...run.mark, isNumber: cell.isNumber } })
    }
    addSpace(cell.text.slice(lead + text.length))
  }
  if (frame.hasSides) {
    addSpace(' ')
    addRule()
  }
  if (spans.at(-1)?.kind === 'space') spans.pop()
  return spans
}

export function spanLines(
  look: TableLook,
  widths: readonly number[],
  cells: readonly Cell[],
  frame: TableFrame,
): Span[][] {
  return alignedLines(look, widths, cells).map((line) => spansOf(line, frame))
}

export function textOfSpans(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join('')
}

export function ruleLine(widths: readonly number[], edge: RuleEdge): string {
  const inner = widths
    .map((width) => edge.fill.repeat(width))
    .join(`${edge.fill}${edge.cross}${edge.fill}`)
  return edge.left === '' ? inner : `${edge.left}${edge.fill}${inner}${edge.fill}${edge.right}`
}

export function rowTitle(row: readonly Cell[], index: number): Cell {
  const first = row[0] ?? EMPTY_CELL
  return first.text === '' ? plainCellOf(`Row ${String(index + 1)}`) : first
}

export type Field = { label: Cell; value: Cell }

export function fieldsOf(look: TableLook, row: readonly Cell[]): Field[] {
  return look.header
    .slice(1)
    .map((label, index) => ({ label, value: row[index + 1] ?? EMPTY_CELL }))
    .filter((field) => field.value.text !== '')
}

export function labelOf(cell: Cell): Cell {
  const runs = cell.runs.map((run) => ({ ...run }))
  addRun(runs, ':', PLAIN_MARK)
  return { text: `${cell.text}:`, runs, isNumber: cell.isNumber }
}

export function labelWidth(look: TableLook): number {
  return Math.max(0, ...look.header.slice(1).map((cell) => displayWidth(cell.text))) + 1
}

export function textCopy(table: Table): string {
  const header = headerOf(table, copiedCell)
  return rowsOf(table, copiedCell)
    .map((row) =>
      header
        .map((label, index) => ({ label, value: row[index] ?? '' }))
        .filter((field) => field.value !== '')
        .map((field) => `${field.label}: ${field.value}`)
        .join('\n'),
    )
    .join('\n\n')
}
