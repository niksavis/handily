export type MarkdownKind =
  | 'heading'
  | 'minorHeading'
  | 'strong'
  | 'emphasis'
  | 'marker'
  | 'quote'
  | 'codeSpan'
  | 'link'
  | 'plain'

export type MarkdownToken = { text: string; kind: MarkdownKind }

type InlineKind = Exclude<MarkdownKind, 'heading' | 'minorHeading' | 'marker'>

type Inline = {
  line: string
  at: number
  tokens: MarkdownToken[]
  plain: InlineKind
  backticks: Map<number, number[]>
  closers: Map<number, number>
  unclosed: Set<string>
}

type Fence = { mark: string; length: number }

const HEADING = /^ {0,3}(#{1,6})(?=\s|$)/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const QUOTE_MARK = /\s*>/y
const QUOTE_GAP = / ?/y
const LIST_MARK = /(\s*)([-*+]|\d{1,9}[.)])(?=\s|$)/y
const SPECIAL = /[`*_[!]/g
const BACKTICKS = /`+/g
const LINK = /!?\[([^[\]]*)\]\([^()]*\)/y
const WORD_CHARACTER = /[\p{L}\p{N}]/u
const SPACE = /\s/
const RULED_LEVELS = 2
const MINOR_LEVEL = 3
const STRONG_CLOSERS: Readonly<Record<string, RegExp>> = {
  '**': /(?<=\S)\*\*/g,
  __: /(?<=\S)__(?![\p{L}\p{N}])/gu,
}
const EMPHASIS_CLOSERS: Readonly<Record<string, RegExp>> = {
  '*': /(?<=[^\s*])\*(?!\*)/g,
  _: /(?<=[^\s_])_(?![\p{L}\p{N}_])/gu,
}

function push(tokens: MarkdownToken[], text: string, kind: MarkdownKind): void {
  if (text === '') return
  const last = tokens.at(-1)
  if (last?.kind === kind) last.text += text
  else tokens.push({ text, kind })
}

function headingKind(level: number): MarkdownKind {
  if (level <= RULED_LEVELS) return 'heading'
  return level === MINOR_LEVEL ? 'minorHeading' : 'strong'
}

function backtickRuns(line: string): Map<number, number[]> {
  const runs = new Map<number, number[]>()
  for (const found of line.matchAll(BACKTICKS)) {
    const starts = runs.get(found[0].length) ?? []
    starts.push(found.index)
    runs.set(found[0].length, starts)
  }
  return runs
}

function codeSpanEnd(inline: Inline, length: number): number | null {
  const starts = inline.backticks.get(length) ?? []
  let next = inline.closers.get(length) ?? 0
  while (next < starts.length && (starts[next] ?? 0) <= inline.at) next += 1
  inline.closers.set(length, next)
  const close = starts[next]
  return close === undefined ? null : close + length
}

function scanBackticks(inline: Inline): void {
  BACKTICKS.lastIndex = inline.at
  const length = BACKTICKS.exec(inline.line)?.[0].length ?? 1
  const end = codeSpanEnd(inline, length)
  const stop = end ?? inline.at + length
  push(inline.tokens, inline.line.slice(inline.at, stop), end === null ? inline.plain : 'codeSpan')
  inline.at = stop
}

function delimitedEnd(inline: Inline, mark: string, closer: RegExp): number | null {
  const { line, at } = inline
  const after = line.charAt(at + mark.length)
  const before = line.charAt(at - 1)
  const opens =
    after !== '' && !SPACE.test(after) && !(mark.startsWith('_') && WORD_CHARACTER.test(before))
  if (!opens || inline.unclosed.has(mark)) return null
  closer.lastIndex = at + mark.length + 1
  const found = closer.exec(line)
  if (found === null) {
    inline.unclosed.add(mark)
    return null
  }
  return found.index + mark.length
}

function scanDelimiter(inline: Inline): void {
  const { line, at } = inline
  const character = line.charAt(at)
  const double = character.repeat(2)
  const isDouble = line.startsWith(double, at)
  const mark = isDouble ? double : character
  const closer = isDouble ? STRONG_CLOSERS[double] : EMPHASIS_CLOSERS[character]
  const end = closer === undefined ? null : delimitedEnd(inline, mark, closer)
  const stop = end ?? at + mark.length
  const kind = end === null ? inline.plain : isDouble ? 'strong' : 'emphasis'
  push(inline.tokens, line.slice(at, stop), kind)
  inline.at = stop
}

function scanLink(inline: Inline): void {
  const { line, at } = inline
  LINK.lastIndex = at
  const found = LINK.exec(line)
  if (found === null) {
    push(inline.tokens, line.charAt(at), inline.plain)
    inline.at = at + 1
    return
  }
  const label = found[1] ?? ''
  const open = line.indexOf('[', at) + 1
  push(inline.tokens, line.slice(at, open), inline.plain)
  push(inline.tokens, label, 'link')
  push(inline.tokens, line.slice(open + label.length, LINK.lastIndex), inline.plain)
  inline.at = LINK.lastIndex
}

function scanInline(line: string, from: number, plain: InlineKind, tokens: MarkdownToken[]): void {
  const inline: Inline = {
    line,
    at: from,
    tokens,
    plain,
    backticks: backtickRuns(line),
    closers: new Map(),
    unclosed: new Set(),
  }
  while (inline.at < line.length) {
    SPECIAL.lastIndex = inline.at
    const special = SPECIAL.exec(line)?.index ?? line.length
    push(tokens, line.slice(inline.at, special), plain)
    inline.at = special
    const character = line.charAt(special)
    if (character === '`') scanBackticks(inline)
    else if (character === '*' || character === '_') scanDelimiter(inline)
    else if (character !== '') scanLink(inline)
  }
}

function quotePrefix(line: string, tokens: MarkdownToken[]): number {
  let at = 0
  for (;;) {
    QUOTE_MARK.lastIndex = at
    const mark = QUOTE_MARK.exec(line)
    if (mark === null) return at
    push(tokens, mark[0].slice(0, -1), 'plain')
    push(tokens, '>', 'marker')
    QUOTE_GAP.lastIndex = QUOTE_MARK.lastIndex
    push(tokens, QUOTE_GAP.exec(line)?.[0] ?? '', 'plain')
    at = QUOTE_GAP.lastIndex
  }
}

function listPrefix(line: string, at: number, tokens: MarkdownToken[]): number {
  LIST_MARK.lastIndex = at
  const mark = LIST_MARK.exec(line)
  if (mark === null) return at
  push(tokens, mark[1] ?? '', 'plain')
  push(tokens, mark[2] ?? '', 'marker')
  return LIST_MARK.lastIndex
}

function fenceOf(line: string): Fence | null {
  const mark = FENCE.exec(line)?.[1]
  return mark === undefined ? null : { mark: mark.charAt(0), length: mark.length }
}

function closes(line: string, fence: Fence): boolean {
  const found = fenceOf(line)
  return (
    found !== null &&
    found.mark === fence.mark &&
    found.length >= fence.length &&
    line.trim() === fence.mark.repeat(line.trim().length)
  )
}

function proseLine(line: string): MarkdownToken[] {
  const heading = HEADING.exec(line)?.[1]
  if (heading !== undefined) return [{ text: line, kind: headingKind(heading.length) }]
  const tokens: MarkdownToken[] = []
  const afterQuote = quotePrefix(line, tokens)
  const afterList = listPrefix(line, afterQuote, tokens)
  scanInline(line, afterList, afterQuote > 0 ? 'quote' : 'plain', tokens)
  return tokens
}

export function markdownLines(lines: readonly string[]): MarkdownToken[][] {
  let fence: Fence | null = null
  return lines.map((line) => {
    if (fence !== null) {
      if (closes(line, fence)) fence = null
      return line === '' ? [] : [{ text: line, kind: 'codeSpan' }]
    }
    fence = fenceOf(line)
    return fence === null ? proseLine(line) : [{ text: line, kind: 'codeSpan' }]
  })
}
