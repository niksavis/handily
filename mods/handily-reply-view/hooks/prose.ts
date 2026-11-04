import {
  headingOf,
  interruptsText,
  listOf,
  proseRunsOf,
  quoteOf,
  type AlertKind,
  type ListLine,
  type ListMark,
} from './blocks'
import { isSimpleLine, shownText, type Run } from './markdown'

export type DrawnLine = { indent: number; marker: string; mark: ListMark; runs: Run[] }

export type QuoteLine = { depth: number; runs: Run[] }

export type ProsePart =
  | { kind: 'drawn'; line: DrawnLine }
  | { kind: 'engine'; text: string }
  | { kind: 'blank' }
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'quote'; lines: QuoteLine[] }
  | { kind: 'alert'; alert: AlertKind; lines: Run[][] }
  | { kind: 'tally'; done: number; total: number }

type UnitKind = 'paragraph' | 'list' | 'heading' | 'quote' | 'engine'

type Unit = { kind: UnitKind; lines: string[]; blanksBefore: number }

const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/
const QUOTE = /^ {0,3}>/
const HTML_BLOCK = /^ {0,3}<(?:\/?[A-Za-z][\w-]*|!--)/
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:/
const NESTED_LINK_DEFINITION = /^[\s>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+[\s>]*)*\[[^\]]+\]:/
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?: +(.*))?$/
const INDENTED = /^(?: {4}|\t)/
const INDENTED_AT_ALL = /^\s/
const TALLIED_FROM_TASKS = 3

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function isSingleLine(line: string): boolean {
  return headingOf(line) !== null || THEMATIC_BREAK.test(line) || LINK_DEFINITION.test(line)
}

function startsRun(line: string): boolean {
  return QUOTE.test(line) || HTML_BLOCK.test(line)
}

function openingKind(line: string): UnitKind {
  if (INDENTED.test(line)) return 'engine'
  if (headingOf(line) !== null) return 'heading'
  if (QUOTE.test(line)) return 'quote'
  if (isSingleLine(line) || startsRun(line)) return 'engine'
  return LIST_ITEM.test(line) ? 'list' : 'paragraph'
}

function joins(unit: Unit | null, line: string, blanks: number): unit is Unit {
  if (unit === null) return false
  if (unit.kind === 'list' && INDENTED_AT_ALL.test(line)) return true
  if (isSingleLine(line) || startsRun(line)) {
    return (unit.kind === 'engine' || unit.kind === 'quote') && blanks === 0
  }
  if (unit.kind === 'list') return blanks === 0 || LIST_ITEM.test(line)
  return blanks === 0 && !interruptsText(line)
}

function unitsOf(lines: readonly string[]): Unit[] {
  const units: Unit[] = []
  let blanks = 0
  let current: Unit | null = null
  for (const line of lines) {
    if (isBlank(line)) {
      blanks += 1
      continue
    }
    if (current?.kind === 'paragraph' && blanks === 0 && SETEXT_UNDERLINE.test(line)) {
      current.kind = 'engine'
      current.lines.push(line)
    } else if (joins(current, line, blanks)) {
      current.lines.push(...(blanks > 0 ? [''] : []), line)
    } else {
      current = { kind: openingKind(line), lines: [line], blanksBefore: blanks }
      units.push(current)
      if (isSingleLine(line)) current = null
    }
    blanks = 0
  }
  return units
}

function hasParagraphAfterBlank(unit: Unit): boolean {
  return unit.lines.some(
    (line, index) =>
      index > 0 && isBlank(unit.lines[index - 1] ?? '') && !isBlank(line) && !LIST_ITEM.test(line),
  )
}

export function holdsLinkDefinition(lines: readonly string[]): boolean {
  return lines.some((line) => NESTED_LINK_DEFINITION.test(line))
}

function runsOf(text: string): Run[] {
  return proseRunsOf(text)
    .map((run) => ({ ...run, text: shownText(run.text) }))
    .filter((run) => run.text !== '')
}

function drawn(line: ListLine): ProsePart {
  const { indent, marker, mark, text } = line
  return { kind: 'drawn', line: { indent, marker, mark, runs: runsOf(text) } }
}

function paragraphParts(unit: Unit): ProsePart[] | null {
  const texts = unit.lines.map((line) => line.trim())
  if (!texts.every(isSimpleLine)) return null
  return texts.map((text) => drawn({ indent: 0, marker: '', mark: 'none', text }))
}

function listParts(unit: Unit, doneGlyph: string): ProsePart[] | null {
  if (hasParagraphAfterBlank(unit)) return null
  const list = listOf(unit.lines, doneGlyph)
  if (list === null || !list.lines.every((line) => isSimpleLine(line.text))) return null
  const lines = list.lines.map(drawn)
  if (list.tasks < TALLIED_FROM_TASKS) return lines
  return [...lines, { kind: 'tally', done: list.done, total: list.tasks }]
}

function headingParts(unit: Unit): ProsePart[] | null {
  const heading = headingOf(unit.lines[0] ?? '')
  if (heading === null || !isSimpleLine(heading.text)) return null
  return [{ kind: 'heading', level: heading.level, runs: runsOf(heading.text) }]
}

function quoteParts(unit: Unit): ProsePart[] | null {
  const quote = quoteOf(unit.lines)
  if (quote === null) return null
  if (quote.kind === 'alert') {
    if (!quote.rows.every(isSimpleLine)) return null
    return [{ kind: 'alert', alert: quote.alert, lines: quote.rows.map(runsOf) }]
  }
  if (!quote.rows.every((row) => isSimpleLine(row.text))) return null
  return [
    {
      kind: 'quote',
      lines: quote.rows.map((row) => ({ depth: row.depth, runs: runsOf(row.text) })),
    },
  ]
}

function partsOf(unit: Unit, doneGlyph: string): ProsePart[] | null {
  switch (unit.kind) {
    case 'engine':
      return null
    case 'paragraph':
      return paragraphParts(unit)
    case 'list':
      return listParts(unit, doneGlyph)
    case 'heading':
      return headingParts(unit)
    case 'quote':
      return quoteParts(unit)
  }
}

export function prosePartsOf(lines: readonly string[], doneGlyph: string): ProsePart[] {
  const parts: ProsePart[] = []
  let isAfterEngine = false
  let isAfterHeading = false
  for (const unit of unitsOf(lines)) {
    const follows = parts.length > 0 && unit.blanksBefore === 0
    const own: ProsePart[] | null = follows && isAfterEngine ? null : partsOf(unit, doneGlyph)
    const last = parts.at(-1)
    isAfterEngine = own === null
    if (own === null && last?.kind === 'engine') {
      last.text += `${'\n'.repeat(unit.blanksBefore + 1)}${unit.lines.join('\n')}`
      isAfterHeading = false
      continue
    }
    if (last !== undefined && (unit.blanksBefore > 0 || isAfterHeading)) {
      parts.push({ kind: 'blank' })
    }
    if (own === null) parts.push({ kind: 'engine', text: unit.lines.join('\n') })
    else parts.push(...own)
    isAfterHeading = own?.at(-1)?.kind === 'heading'
  }
  return parts
}
