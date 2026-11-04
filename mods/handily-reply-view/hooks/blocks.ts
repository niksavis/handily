import { lineSegmentsOf, markedLine, PLAIN_MARK, type Run } from './markdown'
import { displayWidth, graphemesOf } from './width'

export type HeadingStyle = 'banner' | 'bold' | 'underline' | 'uppercase'

export const HEADING_STYLES: readonly HeadingStyle[] = ['banner', 'bold', 'underline', 'uppercase']

export const DEFAULT_HEADING_STYLE: HeadingStyle = 'banner'

export function isHeadingStyle(value: unknown): value is HeadingStyle {
  return HEADING_STYLES.some((style) => style === value)
}

export type Heading = { level: number; text: string }

const ATX_OPENING = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/
const CLOSING_SEQUENCE = /(?:^|[ \t]+)#+$/
const EDGE_SPACES = /^[ \t]+|[ \t]+$/g

export function withoutEdgeSpaces(text: string): string {
  return text.replace(EDGE_SPACES, '')
}

export function headingOf(line: string): Heading | null {
  const found = ATX_OPENING.exec(line)
  const marks = found?.[1]
  if (marks === undefined) return null
  const content = (found?.[2] ?? '').replace(EDGE_SPACES, '')
  return {
    level: marks.length,
    text: content.replace(CLOSING_SEQUENCE, '').replace(EDGE_SPACES, ''),
  }
}

export type ListMark = 'none' | 'bullet' | 'number' | 'open' | 'done'

export type ListLine = { indent: number; marker: string; mark: ListMark; text: string }

export type ListEntry =
  { kind: 'line'; line: ListLine } | { kind: 'tally'; done: number; total: number }

type OpenItem = { content: number; indent: number; text: number; kind: string; hasText: boolean }

const LIST_ITEM_PARTS = /^( *)([-*+]|(\d{1,9})[.)])(?:( +)(.*))?$/
const TASK = /^\[([ xX])\][ \t]+(.*)$/
const BLOCK_START =
  /^(?:#{1,6}(?:[ \t]|$)|[>|<]|`{3}|~{3}|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|[-=*_ \t|:]+$)/
const BULLETS = ['•', '◦', '▪'] as const
const OPEN_MARK = '[ ]'
const DEEPEST_INDENTED_LEVEL = 4
const CODE_INDENT = 4
const FIRST_NUMBER = 1
const TALLIED_FROM_TASKS = 3

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function bulletOf(level: number): string {
  return BULLETS[Math.min(level, BULLETS.length) - 1] ?? BULLETS[0]
}

function markOf(number: string | undefined, task: RegExpExecArray | null): ListMark {
  if (task !== null) return task[1] === ' ' ? 'open' : 'done'
  return number === undefined ? 'bullet' : 'number'
}

function shownMarker(mark: ListMark, level: number, written: string, doneGlyph: string): string {
  switch (mark) {
    case 'bullet':
      return bulletOf(level)
    case 'done':
      return `[${doneGlyph}]`
    case 'open':
      return OPEN_MARK
    case 'number':
    case 'none':
      return written
  }
}

function startsBlock(text: string): boolean {
  return text !== '' && BLOCK_START.test(text)
}

function interrupts(number: string | undefined, content: string): boolean {
  return (
    withoutEdgeSpaces(content) !== '' && (number === undefined || Number(number) === FIRST_NUMBER)
  )
}

function kindOf(marker: string, number: string | undefined): string {
  return number === undefined ? marker : marker.slice(-1)
}

export type TopList = { lines: string[]; blanksBefore: number }

export function topListsOf(lines: readonly string[]): TopList[] {
  const lists: TopList[] = []
  let content = -1
  let kind: string | undefined
  for (const line of lines) {
    const item = LIST_ITEM_PARTS.exec(line)
    const indent = (item?.[1] ?? '').length
    const isTop = item !== null && (content < 0 || indent < content)
    const itemKind = item === null ? undefined : kindOf(item[2] ?? '', item[3])
    const last = lists.at(-1)
    if (last === undefined || (isTop && itemKind !== kind)) {
      const hasBlank = last !== undefined && last.lines.at(-1) === ''
      if (hasBlank) last.lines.pop()
      lists.push({ lines: [], blanksBefore: hasBlank ? 1 : 0 })
    }
    if (isTop) {
      kind = itemKind
      content = indent + (item[2] ?? '').length + Math.max((item[4] ?? '').length, 1)
    }
    lists.at(-1)?.lines.push(line)
  }
  return lists
}

export function interruptsText(line: string): boolean {
  const item = LIST_ITEM_PARTS.exec(line)
  return item !== null && interrupts(item[3], item[5] ?? '')
}

export function listOf(lines: readonly string[], doneGlyph: string): ListEntry[] | null {
  const open: OpenItem[] = []
  const entries: ListEntry[] = []
  let afterText = false
  let tasks = 0
  let done = 0
  const endList = () => {
    if (tasks >= TALLIED_FROM_TASKS) entries.push({ kind: 'tally', done, total: tasks })
    tasks = 0
    done = 0
  }
  for (const line of lines) {
    if (isBlank(line)) {
      afterText = false
      continue
    }
    const item = LIST_ITEM_PARTS.exec(line)
    if (item === null) {
      const owner = open.at(-1)
      const text = withoutEdgeSpaces(line)
      if (owner?.hasText !== true || startsBlock(text)) return null
      entries.push({ kind: 'line', line: { indent: owner.text, marker: '', mark: 'none', text } })
      afterText = true
      continue
    }
    const indent = (item[1] ?? '').length
    const marker = item[2] ?? ''
    const number = item[3]
    const spaces = (item[4] ?? '').length
    const content = item[5] ?? ''
    let sibling: OpenItem | undefined
    while (open.length > 0 && indent < (open.at(-1)?.content ?? 0)) sibling = open.pop()
    const parent = open.at(-1)
    if (indent >= (parent?.content ?? 0) + CODE_INDENT || spaces > CODE_INDENT) return null
    const kind = kindOf(marker, number)
    const startsList = sibling?.kind !== kind
    const isEmpty = withoutEdgeSpaces(content) === ''
    if (startsList && afterText && !interrupts(number, content)) return null
    const level = open.length + 1
    if (level === 1 && startsList) endList()
    const deepest = open[DEEPEST_INDENTED_LEVEL - 1]
    const shownIndent =
      level > DEEPEST_INDENTED_LEVEL ? (deepest?.indent ?? 0) : (parent?.text ?? 0)
    const task = TASK.exec(content)
    if (task !== null && number !== undefined) return null
    const mark = markOf(number, task)
    const shown = shownMarker(mark, level, marker, doneGlyph)
    const text = withoutEdgeSpaces(task === null ? content : (task[2] ?? ''))
    if (startsBlock(text)) return null
    entries.push({ kind: 'line', line: { indent: shownIndent, marker: shown, mark, text } })
    open.push({
      content: indent + marker.length + Math.max(spaces, 1),
      indent: shownIndent,
      text: shownIndent + displayWidth(shown) + 1,
      kind,
      hasText: !isEmpty,
    })
    if (task !== null) tasks += 1
    if (mark === 'done') done += 1
    afterText = !isEmpty
  }
  endList()
  return entries
}

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export const ALERT_WORDS: Readonly<Record<AlertKind, string>> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

const ALERT_KINDS = Object.keys(ALERT_WORDS) as readonly AlertKind[]

export type QuoteRow = { depth: number; text: string }

export type QuoteModel =
  { kind: 'quote'; rows: QuoteRow[] } | { kind: 'alert'; alert: AlertKind; rows: string[] }

const QUOTE_MARK = /^ {0,3}> ?/
const CODE_START = /^(?: {4}|\t)/
const ALERT_MARKER = /^\[!([A-Za-z]+)\][ \t]*$/

function quoteRowOf(line: string): QuoteRow {
  let depth = 0
  let rest = line
  for (let found = QUOTE_MARK.exec(rest); found !== null; found = QUOTE_MARK.exec(rest)) {
    rest = rest.slice(found[0].length)
    depth += 1
  }
  return { depth, text: rest }
}

function withoutEdgeBlanks(rows: readonly QuoteRow[]): QuoteRow[] {
  const first = rows.findIndex((row) => row.text !== '')
  const last = rows.findLastIndex((row) => row.text !== '')
  return first === -1 ? [] : rows.slice(first, last + 1)
}

function alertOf(row: QuoteRow | undefined): AlertKind | undefined {
  const word = row?.depth === 1 ? ALERT_MARKER.exec(row.text)?.[1]?.toLowerCase() : undefined
  return ALERT_KINDS.find((kind) => kind === word)
}

export function quoteOf(lines: readonly string[]): QuoteModel | null {
  const rows: QuoteRow[] = []
  for (const line of lines) {
    const row = quoteRowOf(line)
    const last = rows.at(-1)
    if (row.depth === 0 || CODE_START.test(row.text)) return null
    const text = withoutEdgeSpaces(row.text)
    if (startsBlock(text)) return null
    if (last !== undefined && row.depth < last.depth && last.text !== '') return null
    rows.push({ depth: row.depth, text })
  }
  const [first, ...body] = rows
  const alert = alertOf(first)
  if (alert === undefined) return { kind: 'quote', rows: withoutEdgeBlanks(rows) }
  if (body.some((row) => row.depth !== 1)) return null
  return { kind: 'alert', alert, rows: withoutEdgeBlanks(body).map((row) => row.text) }
}

const LINK_SCHEMES: ReadonlySet<string> = new Set(['https:', 'http:', 'mailto:'])
const MAIL_SCHEME = 'mailto:'

function linkTargetOf(address: string): URL | null {
  if (!URL.canParse(address)) return null
  const url = new URL(address)
  return LINK_SCHEMES.has(url.protocol) ? url : null
}

function hostOf(url: URL): string {
  return url.protocol === MAIL_SCHEME ? url.pathname : url.host
}

function linkRuns(text: string, address: string): Run[] {
  const runs = markedLine(text)
  const url = linkTargetOf(address)
  const shownAddress = url === null ? address : hostOf(url)
  const after: Run[] =
    text === address ? [] : [{ text: ` (${shownAddress})`, mark: PLAIN_MARK, isDim: true }]
  if (url === null) return [...runs, ...after]
  return [
    ...runs.map((run) => ({ ...run, mark: { ...run.mark, isLink: true }, href: address })),
    ...after,
  ]
}

export function proseRunsOf(line: string): Run[] {
  return lineSegmentsOf(line).flatMap((segment) =>
    segment.address === null ? markedLine(segment.text) : linkRuns(segment.text, segment.address),
  )
}

type Cell = { grapheme: string; run: Run; columns: number }

type Stretch = { isSpace: boolean; cells: Cell[] }

function isBreakable(grapheme: string, run: Run): boolean {
  return grapheme === ' ' && !run.mark.isCode
}

function stretchesOf(runs: readonly Run[]): Stretch[] {
  const stretches: Stretch[] = []
  for (const run of runs) {
    for (const grapheme of graphemesOf(run.text)) {
      const cell = { grapheme, run, columns: displayWidth(grapheme) }
      const isSpace = isBreakable(grapheme, run)
      const last = stretches.at(-1)
      if (last?.isSpace === isSpace) last.cells.push(cell)
      else stretches.push({ isSpace, cells: [cell] })
    }
  }
  return stretches
}

function runsOfCells(cells: readonly Cell[]): Run[] {
  const runs: Run[] = []
  let source: Run | undefined
  for (const cell of cells) {
    const last = runs.at(-1)
    if (last !== undefined && source === cell.run) last.text += cell.grapheme
    else runs.push({ ...cell.run, text: cell.grapheme })
    source = cell.run
  }
  return runs
}

function withoutTrailingSpaces(cells: readonly Cell[]): Cell[] {
  const end = cells.findLastIndex((cell) => !isBreakable(cell.grapheme, cell.run))
  return cells.slice(0, end + 1)
}

export function wrappedRuns(runs: readonly Run[], width: number): Run[][] {
  const room = Math.max(width, 1)
  const lines: Cell[][] = []
  let line: Cell[] = []
  let used = 0
  const breakLine = () => {
    lines.push(withoutTrailingSpaces(line))
    line = []
    used = 0
  }
  for (const stretch of stretchesOf(runs)) {
    const columns = stretch.cells.reduce((total, cell) => total + cell.columns, 0)
    if (stretch.isSpace) {
      if (line.length > 0) {
        line.push(...stretch.cells)
        used += columns
      }
      continue
    }
    if (used + columns > room && line.length > 0) breakLine()
    for (const cell of stretch.cells) {
      if (used + cell.columns > room && line.length > 0) breakLine()
      line.push(cell)
      used += cell.columns
    }
  }
  breakLine()
  return lines.map(runsOfCells)
}

export function runsWidth(runs: readonly Run[]): number {
  return runs.reduce((total, run) => total + displayWidth(run.text), 0)
}
