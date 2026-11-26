import { segments } from './command'
import { grepRows, type GrepQuery, type GrepRow } from './grep-lines'

export type OutputKind = 'grep' | 'log' | 'diff' | 'json' | 'markdown' | 'plain'

type Part = { program: string; words: string[] }

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const PREFIX_PROGRAMS: ReadonlySet<string> = new Set(['sudo', 'env', 'time', 'command', 'nice'])
const GREP_PROGRAMS: ReadonlySet<string> = new Set(['grep', 'egrep', 'fgrep', 'rg'])
const READ_PROGRAMS: ReadonlySet<string> = new Set(['cat', 'head', 'tail'])
const MARKDOWN_FILE = /\.(?:md|markdown)$/i
const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set(['-C', '-c', '--git-dir', '--work-tree'])
const GREP_VALUE_LETTERS = 'efmABCdD'
const RG_VALUE_LETTERS = 'efmABCgtTMrEjd'
const GREP_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '--regexp',
  '--file',
  '--max-count',
  '--after-context',
  '--before-context',
  '--context',
  '--include',
  '--exclude',
  '--exclude-dir',
  '--glob',
  '--iglob',
  '--type',
  '--type-not',
  '--max-columns',
  '--replace',
  '--encoding',
  '--threads',
  '--sort',
  '--sortr',
  '--max-depth',
])
const PATTERN_OPTIONS: ReadonlySet<string> = new Set(['-e', '--regexp'])
const REGEX_CHARACTERS = /[\\.[\]*^$+?(){}|]/
const HUNK_HEAD = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/
const FULL_COMMIT = /^[*|\\/ ]*commit [0-9a-f]{40}(?:\s|$)/
const ONE_LINE_ENTRY = /^[*|\\/ ]*[0-9a-f]{7,40}(?: \([^)]*\))? /
const GRAPH_ONLY = /^[*|\\/_ .-]+$/

function shellWords(segment: string): string[] {
  const found: string[] = []
  let word: string | null = null
  let quote: string | null = null
  let isEscaped = false
  for (const character of segment) {
    if (isEscaped) {
      word = (word ?? '') + character
      isEscaped = false
    } else if (character === '\\' && quote !== "'") {
      isEscaped = true
    } else if (quote !== null) {
      if (character === quote) quote = null
      else word = (word ?? '') + character
    } else if (character === '"' || character === "'") {
      quote = character
      word ??= ''
    } else if (/\s/.test(character)) {
      if (word !== null) found.push(word)
      word = null
    } else {
      word = (word ?? '') + character
    }
  }
  if (word !== null) found.push(word)
  return found
}

function baseName(word: string): string {
  return (
    word
      .split('/')
      .filter((part) => part !== '')
      .at(-1) ?? word
  )
}

function partOf(segment: string): Part | null {
  const words = shellWords(segment).filter((word) => !ASSIGNMENT.test(word))
  while (words[0] !== undefined && PREFIX_PROGRAMS.has(baseName(words[0]))) words.shift()
  const [program, ...rest] = words
  return program === undefined ? null : { program: baseName(program), words: rest }
}

function partsOf(command: string): Part[] {
  return segments(command)
    .map(partOf)
    .filter((part): part is Part => part !== null && part.program !== 'cd')
}

function gitVerb(part: Part): string | null {
  if (part.program !== 'git') return null
  const { words } = part
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (GIT_VALUE_OPTIONS.has(word)) index += 1
    else if (!word.startsWith('-')) return word
  }
  return null
}

function grepPart(parts: readonly Part[]): Part | null {
  for (const part of parts) {
    if (GREP_PROGRAMS.has(part.program)) return part
    if (gitVerb(part) === 'grep') {
      const words = part.words.slice(part.words.indexOf('grep') + 1)
      return { program: 'git-grep', words }
    }
  }
  return null
}

type Flags = { isFixed: boolean; isIgnoringCase: boolean; isSmartCase: boolean }

function readCluster(
  letters: string,
  flags: Flags,
  valueLetters: string,
): 'value' | 'joined' | 'none' {
  for (let index = 0; index < letters.length; index += 1) {
    const letter = letters.charAt(index)
    if (letter === 'F') flags.isFixed = true
    if (letter === 'i') flags.isIgnoringCase = true
    if (letter === 'S') flags.isSmartCase = true
    if (valueLetters.includes(letter)) return index === letters.length - 1 ? 'value' : 'joined'
  }
  return 'none'
}

function grepQuery(part: Part): GrepQuery {
  const flags: Flags = {
    isFixed: part.program === 'fgrep',
    isIgnoringCase: false,
    isSmartCase: false,
  }
  const valueLetters = part.program === 'rg' ? RG_VALUE_LETTERS : GREP_VALUE_LETTERS
  const patterns: string[] = []
  const positional: string[] = []
  const { words } = part
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (word === '--') {
      positional.push(...words.slice(index + 1))
      break
    }
    if (word === '--fixed-strings') flags.isFixed = true
    else if (word === '--ignore-case') flags.isIgnoringCase = true
    else if (word === '--smart-case') flags.isSmartCase = true
    else if (PATTERN_OPTIONS.has(word)) {
      patterns.push(words[index + 1] ?? '')
      index += 1
    } else if (GREP_VALUE_OPTIONS.has(word)) index += 1
    else if (word.startsWith('--')) continue
    else if (word.startsWith('-') && word.length > 1) {
      const read = readCluster(word.slice(1), flags, valueLetters)
      if (read === 'value') {
        if (word.endsWith('e')) patterns.push(words[index + 1] ?? '')
        index += 1
      }
    } else positional.push(word)
  }
  const pattern = patterns.length > 0 ? patterns : positional.slice(0, 1)
  const [only] = pattern
  const isLiteral =
    only !== undefined && only !== '' && (flags.isFixed || !REGEX_CHARACTERS.test(only))
  const isSmartLower = flags.isSmartCase && only !== undefined && only === only.toLowerCase()
  return {
    pattern: pattern.length === 1 && isLiteral ? only : null,
    isIgnoringCase: flags.isIgnoringCase || isSmartLower,
  }
}

function isMarkdownRead(parts: readonly Part[]): boolean {
  if (parts.length === 0 || !parts.every((part) => READ_PROGRAMS.has(part.program))) return false
  if (
    parts.some((part) => part.program === 'cat' && part.words.some((word) => word.startsWith('-')))
  ) {
    return false
  }
  return parts.some((part) =>
    part.words.some((word) => !word.startsWith('-') && MARKDOWN_FILE.test(word)),
  )
}

function firstFilled(lines: readonly string[]): string {
  return lines.find((line) => line.trim() !== '') ?? ''
}

function isDiffText(lines: readonly string[]): boolean {
  const first = firstFilled(lines)
  const start = lines.indexOf(first)
  const isDiffStart =
    first.startsWith('diff ') ||
    FULL_COMMIT.test(first) ||
    (first.startsWith('--- ') && (lines[start + 1] ?? '').startsWith('+++ '))
  return isDiffStart && lines.some((line) => HUNK_HEAD.test(line))
}

function isLogText(lines: readonly string[]): boolean {
  if (FULL_COMMIT.test(firstFilled(lines))) return true
  const filled = lines.filter((line) => line.trim() !== '')
  return (
    filled.some((line) => ONE_LINE_ENTRY.test(line)) &&
    filled.every((line) => ONE_LINE_ENTRY.test(line) || GRAPH_ONLY.test(line))
  )
}

export function isJsonText(text: string): boolean {
  const kept = text.trim()
  if (!kept.startsWith('{') && !kept.startsWith('[')) return false
  try {
    const parsed: unknown = JSON.parse(kept)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

export type Kind =
  { kind: Exclude<OutputKind, 'grep'> } | { kind: 'grep'; query: GrepQuery; rows: GrepRow[] }

export function kindOf(command: string | null, lines: readonly string[]): Kind {
  if (command === null || lines.length === 0) return { kind: 'plain' }
  const parts = partsOf(command)
  if (parts.some((part) => gitVerb(part) === 'log') && isLogText(lines)) return { kind: 'log' }
  if (isDiffText(lines)) return { kind: 'diff' }
  const grep = grepPart(parts)
  const rows = grep === null ? null : grepRows(lines)
  if (grep !== null && rows !== null) return { kind: 'grep', query: grepQuery(grep), rows }
  if (isJsonText(lines.join('\n'))) return { kind: 'json' }
  if (isMarkdownRead(parts)) return { kind: 'markdown' }
  return { kind: 'plain' }
}
