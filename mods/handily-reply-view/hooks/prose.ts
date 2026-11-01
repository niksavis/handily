import { isSimpleInline, markedLine, shownText, type Run } from './markdown'

export type DrawnLine = { indent: number; marker: string; runs: Run[] }

export type ProsePart =
  { kind: 'drawn'; line: DrawnLine } | { kind: 'engine'; text: string } | { kind: 'blank' }

type UnitKind = 'paragraph' | 'list' | 'engine'

type Unit = { kind: UnitKind; lines: string[]; blanksBefore: number }

const ATX_HEADING = /^ {0,3}#{1,6}(?:\s|$)/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/
const QUOTE = /^ {0,3}>/
const HTML_BLOCK = /^ {0,3}<(?:\/?[A-Za-z][\w-]*|!--)/
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:/
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?: +(.*))?$/
const INDENTED = /^(?: {4}|\t)/
const INDENTED_AT_ALL = /^\s/
const LEADING_SPACES = /^ */

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function isSingleEngineLine(line: string): boolean {
  return ATX_HEADING.test(line) || THEMATIC_BREAK.test(line) || LINK_DEFINITION.test(line)
}

function startsEngineRun(line: string): boolean {
  return QUOTE.test(line) || HTML_BLOCK.test(line)
}

function openingKind(line: string): UnitKind {
  if (isSingleEngineLine(line) || startsEngineRun(line) || INDENTED.test(line)) return 'engine'
  return LIST_ITEM.test(line) ? 'list' : 'paragraph'
}

function joins(unit: Unit | null, line: string, blanks: number): unit is Unit {
  if (unit === null || isSingleEngineLine(line) || startsEngineRun(line)) {
    return unit?.kind === 'engine' && blanks === 0
  }
  if (unit.kind === 'list')
    return blanks === 0 || LIST_ITEM.test(line) || INDENTED_AT_ALL.test(line)
  return blanks === 0 && !LIST_ITEM.test(line)
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
      if (isSingleEngineLine(line)) current = null
    }
    blanks = 0
  }
  return units
}

function inlineOf(line: string, inList: boolean): string {
  const item = inList ? LIST_ITEM.exec(line) : null
  return (item === null ? line : (item[3] ?? '')).trim()
}

function hasParagraphAfterBlank(unit: Unit): boolean {
  return unit.lines.some(
    (line, index) =>
      index > 0 && isBlank(unit.lines[index - 1] ?? '') && !isBlank(line) && !LIST_ITEM.test(line),
  )
}

function needsEngine(unit: Unit): boolean {
  if (unit.kind === 'engine') return true
  const inList = unit.kind === 'list'
  if (inList && hasParagraphAfterBlank(unit)) return true
  return !unit.lines.every((line) => isBlank(line) || isSimpleInline(inlineOf(line, inList)))
}

export function holdsLinkDefinition(lines: readonly string[]): boolean {
  return lines.some((line) => LINK_DEFINITION.test(line))
}

function runsOf(text: string): Run[] {
  return markedLine(text)
    .map((run) => ({ text: shownText(run.text), mark: run.mark }))
    .filter((run) => run.text !== '')
}

function drawnLine(line: string, inList: boolean): DrawnLine {
  const item = inList ? LIST_ITEM.exec(line) : null
  const indent = LEADING_SPACES.exec(line)?.[0].length ?? 0
  if (item === null) {
    return { indent: inList ? indent : 0, marker: '', runs: runsOf(line.trim()) }
  }
  return { indent, marker: item[2] ?? '', runs: runsOf((item[3] ?? '').trim()) }
}

function drawnParts(unit: Unit): ProsePart[] {
  const inList = unit.kind === 'list'
  return unit.lines
    .filter((line) => !isBlank(line))
    .map((line) => ({ kind: 'drawn', line: drawnLine(line, inList) }))
}

export function prosePartsOf(lines: readonly string[]): ProsePart[] {
  const parts: ProsePart[] = []
  for (const unit of unitsOf(lines)) {
    const last = parts.at(-1)
    const isEngine = needsEngine(unit)
    if (isEngine && last?.kind === 'engine') {
      last.text += `${'\n'.repeat(unit.blanksBefore + 1)}${unit.lines.join('\n')}`
      continue
    }
    if (last !== undefined && unit.blanksBefore > 0) parts.push({ kind: 'blank' })
    if (isEngine) parts.push({ kind: 'engine', text: unit.lines.join('\n') })
    else parts.push(...drawnParts(unit))
  }
  return parts
}
