import { plural } from './fold'
import { shownText } from './shown'
import type { Span, StyledLine } from './wrap'

type Token = { kind: 'string' | 'number' | 'literal' | 'punctuation'; text: string }

type Writer = { lines: StyledLine[]; tokens: readonly Token[]; at: number }

const TOKEN =
  /\s*(?:("(?:[^"\\]|\\.)*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\]:,]))/y
const INDENT = '  '
const FOLD_LEVEL = 5
const KEY_COLOR = 'planMode'
const STRING_COLOR = 'success'
const VALUE_COLOR = 'warning'

function tokensOf(text: string): Token[] | null {
  const tokens: Token[] = []
  TOKEN.lastIndex = 0
  const end = text.trimEnd().length
  while (TOKEN.lastIndex < end) {
    const found = TOKEN.exec(text)
    if (found === null) return null
    const [, string, number, literal, punctuation] = found
    if (string !== undefined) tokens.push({ kind: 'string', text: shownText(string) })
    else if (number !== undefined) tokens.push({ kind: 'number', text: number })
    else if (literal !== undefined) tokens.push({ kind: 'literal', text: literal })
    else tokens.push({ kind: 'punctuation', text: punctuation ?? '' })
  }
  return tokens
}

function next(writer: Writer): Token {
  const token = writer.tokens[writer.at] ?? { kind: 'punctuation', text: '' }
  writer.at += 1
  return token
}

function peek(writer: Writer): string {
  return writer.tokens[writer.at]?.text ?? ''
}

function scalar(token: Token): Span {
  return { text: token.text, color: token.kind === 'string' ? STRING_COLOR : VALUE_COLOR }
}

function skipped(writer: Writer, close: string): number {
  let depth = 0
  let children = 0
  for (;;) {
    const { text } = next(writer)
    if (text === '') return children
    if (depth === 0 && text === close) return children
    if (depth === 0 && children === 0) children = 1
    if (text === '{' || text === '[') depth += 1
    else if (text === '}' || text === ']') depth -= 1
    else if (depth === 0 && text === ',') children += 1
  }
}

function foldMark(open: string, count: number): Span {
  const words = open === '{' ? plural(count, 'key') : plural(count, 'item')
  return { text: `${open}…${open === '{' ? '}' : ']'} ${words}`, isDim: true }
}

function writeValue(writer: Writer, lead: Span[], level: number): void {
  const token = next(writer)
  const indent = INDENT.repeat(level - 1)
  if (token.text !== '{' && token.text !== '[') {
    writer.lines.push([...lead, scalar(token)])
    return
  }
  const close = token.text === '{' ? '}' : ']'
  if (peek(writer) === close) {
    next(writer)
    writer.lines.push([...lead, { text: `${token.text}${close}` }])
    return
  }
  if (level >= FOLD_LEVEL) {
    writer.lines.push([...lead, foldMark(token.text, skipped(writer, close))])
    return
  }
  writer.lines.push([...lead, { text: token.text }])
  const inner = INDENT.repeat(level)
  for (;;) {
    const key: Span[] = [{ text: inner }]
    if (token.text === '{') {
      key.push({ text: next(writer).text, color: KEY_COLOR }, { text: ': ' })
      next(writer)
    }
    writeValue(writer, key, level + 1)
    const after = next(writer).text
    if (after !== ',') break
    const last = writer.lines.at(-1)
    if (last !== undefined) writer.lines[writer.lines.length - 1] = [...last, { text: ',' }]
  }
  writer.lines.push([{ text: `${indent}${close}` }])
}

export function jsonLines(text: string): StyledLine[] | null {
  const tokens = tokensOf(text)
  if (tokens === null || tokens.length === 0) return null
  const writer: Writer = { lines: [], tokens, at: 0 }
  writeValue(writer, [], 1)
  return writer.at === tokens.length ? writer.lines : null
}
