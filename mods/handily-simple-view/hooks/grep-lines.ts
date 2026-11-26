import type { Span, StyledLine } from './wrap'

export type GrepQuery = { pattern: string | null; isIgnoringCase: boolean }

export type GrepRow =
  | { kind: 'match' | 'context'; path: string | null; line: string; text: string }
  | { kind: 'separator' }

const SEPARATOR = '--'
const MATCH_WITH_PATH = /^(.+?):(\d+):(.*)$/
const NUMBERED = /^(\d+)([:-])(.*)$/
const NUMBER_GAP = '  '
const NUMBER_COLOR = 'planMode'
const MATCH_COLOR = 'warning'

function numberedRows(lines: readonly string[]): GrepRow[] | null {
  const rows: GrepRow[] = []
  for (const line of lines) {
    if (line === SEPARATOR) {
      rows.push({ kind: 'separator' })
      continue
    }
    const found = NUMBERED.exec(line)
    if (found === null) return null
    const [, number = '', mark, text = ''] = found
    rows.push({ kind: mark === ':' ? 'match' : 'context', path: null, line: number, text })
  }
  return rows
}

function contextRow(line: string, paths: ReadonlySet<string>): GrepRow | null {
  for (const path of paths) {
    if (!line.startsWith(`${path}-`)) continue
    const found = /^(\d+)-(.*)$/.exec(line.slice(path.length + 1))
    if (found !== null) return { kind: 'context', path, line: found[1] ?? '', text: found[2] ?? '' }
  }
  return null
}

function pathRows(lines: readonly string[]): GrepRow[] | null {
  const matches = lines.map((line) => MATCH_WITH_PATH.exec(line))
  const paths = new Set(matches.flatMap((found) => (found?.[1] === undefined ? [] : [found[1]])))
  const rows: GrepRow[] = []
  for (const [index, line] of lines.entries()) {
    const found = matches[index]
    if (line === SEPARATOR) rows.push({ kind: 'separator' })
    else if (found !== null && found !== undefined) {
      rows.push({ kind: 'match', path: found[1] ?? '', line: found[2] ?? '', text: found[3] ?? '' })
    } else {
      const context = contextRow(line, paths)
      if (context === null) return null
      rows.push(context)
    }
  }
  return rows
}

export function grepRows(lines: readonly string[]): GrepRow[] | null {
  const filled = lines.filter((line) => line !== '')
  if (filled.length === 0) return null
  const rows = filled.every((line) => line === SEPARATOR || NUMBERED.test(line))
    ? numberedRows(filled)
    : pathRows(filled)
  if (rows === null || !rows.some((row) => row.kind === 'match')) return null
  return rows
}

function escaped(pattern: string): string {
  return pattern.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function marked(text: string, query: GrepQuery): Span[] {
  if (query.pattern === null) return [{ text }]
  const finder = new RegExp(escaped(query.pattern), query.isIgnoringCase ? 'giu' : 'gu')
  const spans: Span[] = []
  let from = 0
  for (const found of text.matchAll(finder)) {
    if (found.index > from) spans.push({ text: text.slice(from, found.index) })
    spans.push({ text: found[0], color: MATCH_COLOR, isBold: true })
    from = found.index + found[0].length
  }
  if (from < text.length || spans.length === 0) spans.push({ text: text.slice(from) })
  return spans
}

function numberWidth(rows: readonly GrepRow[], start: number, path: string | null): number {
  let widest = 0
  for (const row of rows.slice(start)) {
    if (row.kind === 'separator') continue
    if (row.path !== path) break
    widest = Math.max(widest, row.line.length)
  }
  return widest
}

export function grepLines(rows: readonly GrepRow[], query: GrepQuery): StyledLine[] {
  const drawn: StyledLine[] = []
  let path: string | null = null
  let width = 0
  for (const [index, row] of rows.entries()) {
    if (row.kind === 'separator') {
      drawn.push([{ text: SEPARATOR, isDim: true }])
      continue
    }
    if (index === 0 || row.path !== path) {
      path = row.path
      width = numberWidth(rows, index, path)
      if (path !== null) drawn.push([{ text: path, isDim: true }])
    }
    const number: Span = { text: row.line.padStart(width), color: NUMBER_COLOR }
    const text: Span[] =
      row.kind === 'context' ? [{ text: row.text, isDim: true }] : marked(row.text, query)
    drawn.push([number, { text: NUMBER_GAP }, ...text])
  }
  return drawn
}
