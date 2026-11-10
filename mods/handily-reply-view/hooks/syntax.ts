import type { Block } from './markdown'
import type { RoleLook } from './roles'

export type ShellKind =
  'command' | 'keyword' | 'flag' | 'string' | 'variable' | 'operator' | 'comment' | 'plain'

export type ShellToken = { text: string; kind: ShellKind }

export type CodeLook = RoleLook & { isBold?: boolean; isDim?: boolean; isItalic?: boolean }

export type CodeDrawing =
  | { kind: 'engine' }
  | { kind: 'plain'; note: string }
  | { kind: 'shell'; lines: ShellToken[][]; nodes: number }

export const SHELL_LOOKS: Readonly<Record<Exclude<ShellKind, 'plain'>, CodeLook>> = {
  command: { key: 'suggestion', mocha: '#89b4fa', isBold: true },
  keyword: { key: 'merged', mocha: '#cba6f7' },
  flag: { key: 'permission', mocha: '#89dceb' },
  string: { key: 'planMode', mocha: '#a6e3a1' },
  variable: { key: 'merged', mocha: '#cba6f7' },
  operator: { key: 'inactive', mocha: '#9399b2' },
  comment: { mocha: '#9399b2', isDim: true, isItalic: true },
}

export const GUTTER_LOOK: CodeLook = { mocha: '#9399b2', isDim: true }

export const FOLDED_LINES = 15
const FOLD_LINES_ABOVE = 20
const COLOURED_LINES_AT_MOST = 2000
const COLOURED_CHARACTERS_AT_MOST = 100_000
const SHELL_WORD_CHARACTERS_AT_MOST = 1000
export const SHELL_NODES_AT_MOST = 10_000
const NODES_PER_LINE = 5
const GUTTER_GAP = 2
const TAB = ' '.repeat(4)
const SHELL_TAGS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'shell', 'console'])
const OPERATORS = [
  '&>>',
  '<<<',
  '||',
  '|&',
  '&&',
  ';;',
  '&>',
  '>>',
  '>&',
  '>|',
  '<<',
  '<&',
  '<>',
  '|',
  ';',
  '&',
  '(',
  ')',
  '>',
  '<',
]
const COMMAND_OPERATORS: ReadonlySet<string> = new Set(['||', '|&', '&&', ';;', '|', ';', '&', '('])
const REDIRECTS: ReadonlySet<string> = new Set([
  '&>>',
  '<<<',
  '&>',
  '>>',
  '>&',
  '>|',
  '<<',
  '<&',
  '<>',
  '>',
  '<',
])
const KEYWORDS: ReadonlySet<string> = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'case',
  'esac',
  'for',
  'select',
  'while',
  'until',
  'do',
  'done',
  'function',
  'time',
  '!',
])
const KEYWORDS_BEFORE_COMMAND: ReadonlySet<string> = new Set([
  'if',
  'then',
  'else',
  'elif',
  'while',
  'until',
  'do',
  'time',
  '!',
])
const WORD_BREAK = /[\s|&;<>()'"`$]/
const ASSIGNMENT = /^[A-Za-z_]\w*\+?=/
const VARIABLE_NAME = /[A-Za-z_]\w*|\d|[?@#$!*-]/y
const SPACE = /\s+/y
const HEREDOC_END = /-?[ \t]*(['"]?)([\w-]+)\1/y
const LONG_WORD = new RegExp(String.raw`\S{${String(SHELL_WORD_CHARACTERS_AT_MOST + 1)},}`)
const GROUPS = /\B(?=(\d{3})+(?!\d))/g
const HASH_SEED = 0x811c9dc5
const HASH_PRIME = 0x01000193
const HASH_RADIX = 36

type Quote = '"' | "'"

type Scan = {
  line: string
  at: number
  tokens: ShellToken[]
  expectsCommand: boolean
  afterRedirect: boolean
  atWordStart: boolean
  openQuote: Quote | null
  heredocEnd: string | null
}

export function isShellTag(tag: string): boolean {
  return SHELL_TAGS.has(tag.trim().toLowerCase())
}

export function foldsCode(lineCount: number): boolean {
  return lineCount > FOLD_LINES_ABOVE
}

export function grouped(count: number): string {
  return String(count).replace(GROUPS, ',')
}

export function gutterColumns(lineCount: number): number {
  return String(lineCount).length + GUTTER_GAP
}

export function gutterNumber(line: number, lineCount: number): string {
  return String(line).padStart(String(lineCount).length)
}

function contentHash(text: string): string {
  let hash = HASH_SEED
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), HASH_PRIME) >>> 0
  }
  return hash.toString(HASH_RADIX)
}

export function codeFoldKey(tag: string, content: string): string {
  return `code-${contentHash(`${tag}\n${content}`)}-${String(content.length)}`
}

function lineCountOf(content: string): number {
  return content === '' ? 0 : content.split('\n').length
}

export function codeFoldKeysOf(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === 'fence' && foldsCode(lineCountOf(block.content))
      ? [codeFoldKey(block.tag, block.content)]
      : [],
  )
}

function push(scan: Scan, text: string, kind: ShellKind): void {
  if (text === '') return
  const last = scan.tokens.at(-1)
  if (last?.kind === kind && kind !== 'command') last.text += text
  else scan.tokens.push({ text, kind })
}

function wordKind(scan: Scan, word: string): ShellKind {
  if (!scan.atWordStart) return 'plain'
  if (scan.afterRedirect) {
    scan.afterRedirect = false
    return 'plain'
  }
  if (scan.expectsCommand) {
    if (ASSIGNMENT.test(word)) return 'plain'
    if (KEYWORDS.has(word)) {
      scan.expectsCommand = KEYWORDS_BEFORE_COMMAND.has(word)
      return 'keyword'
    }
    scan.expectsCommand = false
    return 'command'
  }
  return word.startsWith('-') ? 'flag' : 'plain'
}

function takesWordSlot(scan: Scan): void {
  if (!scan.atWordStart) return
  if (scan.afterRedirect) scan.afterRedirect = false
  else scan.expectsCommand = false
}

function closingAt(line: string, from: number, open: string, close: string): number {
  let depth = 0
  for (let at = from; at < line.length; at += 1) {
    const character = line[at]
    if (character === '\\') at += 1
    else if (character === open) depth += 1
    else if (character === close) {
      depth -= 1
      if (depth === 0) return at + 1
    }
  }
  return line.length
}

function variableEnd(line: string, at: number): number {
  const next = line[at + 1]
  if (next === '(') return closingAt(line, at + 1, '(', ')')
  if (next === '{') return closingAt(line, at + 1, '{', '}')
  VARIABLE_NAME.lastIndex = at + 1
  const name = VARIABLE_NAME.exec(line)
  return name === null ? at : at + 1 + name[0].length
}

function quoteClose(line: string, at: number, quote: string): number | null {
  for (let index = at + 1; index < line.length; index += 1) {
    if (line[index] === '\\' && quote !== "'") index += 1
    else if (line[index] === quote) return index + 1
  }
  return null
}

function quotedEnd(line: string, at: number, quote: string): number {
  return quoteClose(line, at, quote) ?? line.length
}

function scanDoubleQuoted(scan: Scan, start: number, from: number): void {
  const { line } = scan
  let at = from
  while (at < line.length && line[at] !== '"') {
    const end = line[at] === '$' ? variableEnd(line, at) : at
    if (end > at) {
      push(scan, line.slice(start, at), 'string')
      push(scan, line.slice(at, end), 'variable')
      start = end
      at = end
    } else if (line[at] === '`') {
      const close = quotedEnd(line, at, '`')
      push(scan, line.slice(start, at), 'string')
      push(scan, line.slice(at, close), 'variable')
      start = close
      at = close
    } else at += line[at] === '\\' ? 2 : 1
  }
  const end = Math.min(at + 1, line.length)
  push(scan, line.slice(start, end), 'string')
  scan.openQuote = at < line.length ? null : '"'
  scan.at = end
}

function scanSingleQuoted(scan: Scan, from: number): void {
  const close = quoteClose(scan.line, from, "'")
  push(scan, scan.line.slice(scan.at, close ?? scan.line.length), 'string')
  scan.openQuote = close === null ? "'" : null
  scan.at = close ?? scan.line.length
}

function resumeQuote(scan: Scan, quote: Quote): void {
  if (quote === '"') scanDoubleQuoted(scan, 0, 0)
  else scanSingleQuoted(scan, -1)
  scan.atWordStart = false
}

function scanOperator(scan: Scan, operator: string): void {
  push(scan, operator, 'operator')
  scan.at += operator.length
  scan.atWordStart = true
  if (COMMAND_OPERATORS.has(operator)) {
    scan.expectsCommand = true
    scan.afterRedirect = false
  } else if (REDIRECTS.has(operator)) scan.afterRedirect = true
  if (operator === '<<') {
    HEREDOC_END.lastIndex = scan.at
    scan.heredocEnd = HEREDOC_END.exec(scan.line)?.[2] ?? null
  }
}

function wordEnd(line: string, at: number): number {
  let end = at
  while (end < line.length && !WORD_BREAK.test(line.charAt(end))) {
    end += line[end] === '\\' ? 2 : 1
  }
  return Math.min(Math.max(end, at + 1), line.length)
}

function scanWord(scan: Scan): void {
  const end = wordEnd(scan.line, scan.at)
  const word = scan.line.slice(scan.at, end)
  const kind = wordKind(scan, word)
  const equals = word.indexOf('=')
  if (kind === 'flag' && equals > 0) {
    push(scan, word.slice(0, equals), 'flag')
    push(scan, word.slice(equals), 'plain')
  } else push(scan, word, kind)
  scan.at = end
  scan.atWordStart = false
}

function scanQuoted(scan: Scan, kind: ShellKind, end: number): void {
  takesWordSlot(scan)
  push(scan, scan.line.slice(scan.at, end), kind)
  scan.at = end
  scan.atWordStart = false
}

function scanDollar(scan: Scan): void {
  const { line, at } = scan
  if (line[at + 1] === "'") {
    scanQuoted(scan, 'string', quotedEnd(line, at + 1, "'"))
    return
  }
  const end = variableEnd(line, at)
  if (end > at) {
    scanQuoted(scan, 'variable', end)
    return
  }
  push(scan, '$', 'plain')
  scan.at += 1
}

function scanSpace(scan: Scan, space: string): void {
  push(scan, space, 'plain')
  scan.at += space.length
  scan.atWordStart = true
}

function scanComment(scan: Scan): void {
  push(scan, scan.line.slice(scan.at), 'comment')
  scan.at = scan.line.length
}

function scanString(scan: Scan): void {
  takesWordSlot(scan)
  scanDoubleQuoted(scan, scan.at, scan.at + 1)
  scan.atWordStart = false
}

function scanSingle(scan: Scan): void {
  takesWordSlot(scan)
  scanSingleQuoted(scan, scan.at)
  scan.atWordStart = false
}

function scanNext(scan: Scan): void {
  const { line, at } = scan
  const character = line.charAt(at)
  SPACE.lastIndex = at
  const space = SPACE.exec(line)
  const operator = OPERATORS.find((candidate) => line.startsWith(candidate, at))
  if (space !== null) scanSpace(scan, space[0])
  else if (character === '#' && scan.atWordStart) scanComment(scan)
  else if (operator !== undefined) scanOperator(scan, operator)
  else if (character === '"') scanString(scan)
  else if (character === "'") scanSingle(scan)
  else if (character === '`') scanQuoted(scan, 'variable', quotedEnd(line, at, '`'))
  else if (character === '$') scanDollar(scan)
  else scanWord(scan)
}

function continues(line: string): boolean {
  const trailing = /\\+$/.exec(line)
  return trailing !== null && trailing[0].length % 2 === 1
}

type Carried = {
  expectsCommand: boolean
  afterRedirect: boolean
  openQuote: Quote | null
  heredocEnd: string | null
}

function heredocLine(line: string, carried: Carried): ShellToken[] {
  if (line.trim() === carried.heredocEnd) carried.heredocEnd = null
  return line === '' ? [] : [{ text: line, kind: 'plain' }]
}

function scannedLine(line: string, carried: Carried): ShellToken[] {
  const scan: Scan = { ...carried, line, at: 0, tokens: [], atWordStart: true, heredocEnd: null }
  if (scan.openQuote !== null) resumeQuote(scan, scan.openQuote)
  while (scan.at < line.length) scanNext(scan)
  const isContinued = continues(line) || scan.openQuote !== null
  carried.expectsCommand = isContinued ? scan.expectsCommand : true
  carried.afterRedirect = isContinued && scan.afterRedirect
  carried.openQuote = scan.openQuote
  carried.heredocEnd = scan.heredocEnd
  return scan.tokens
}

export function shellLines(lines: readonly string[]): ShellToken[][] {
  const carried: Carried = {
    expectsCommand: true,
    afterRedirect: false,
    openQuote: null,
    heredocEnd: null,
  }
  return lines.map((raw) => {
    const line = raw.replaceAll('\t', TAB)
    return carried.heredocEnd === null ? scannedLine(line, carried) : heredocLine(line, carried)
  })
}

export function shellNodes(lines: readonly ShellToken[][]): number {
  return lines.reduce(
    (total, tokens) =>
      total +
      NODES_PER_LINE +
      tokens.reduce((parts, token) => parts + (token.kind === 'plain' ? 1 : 2), 0),
    0,
  )
}

function plainNote(reason: string): CodeDrawing {
  return { kind: 'plain', note: `too long to colour: ${reason}, so it draws plain.` }
}

export function codeDrawingOf(
  tag: string,
  lines: readonly string[],
  colours: boolean,
  nodesLeft: number,
): CodeDrawing {
  if (lines.length > COLOURED_LINES_AT_MOST) {
    return plainNote(`over ${grouped(COLOURED_LINES_AT_MOST)} lines`)
  }
  if (lines.join('\n').length > COLOURED_CHARACTERS_AT_MOST) {
    return plainNote(`over ${grouped(COLOURED_CHARACTERS_AT_MOST)} characters`)
  }
  if (!colours || !isShellTag(tag)) return { kind: 'engine' }
  if (lines.some((line) => LONG_WORD.test(line))) {
    return plainNote(`a word over ${grouped(SHELL_WORD_CHARACTERS_AT_MOST)} characters`)
  }
  const tokens = shellLines(lines)
  const nodes = shellNodes(tokens)
  if (nodes > nodesLeft) return plainNote(`over ${grouped(SHELL_NODES_AT_MOST)} drawn parts`)
  return { kind: 'shell', lines: tokens, nodes }
}
