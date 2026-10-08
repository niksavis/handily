import type { EngineInterface } from 'claude-code'

export type WriteVerbs = Awaited<ReturnType<EngineInterface['workitems']['writeVerbs']>>

export type TrackerCli = keyof WriteVerbs

export type TrackerWrite = { tracker: TrackerCli; verb: string }

export type OpaqueReason =
  'loop' | 'heredoc' | 'substitution' | 'redirection' | 'assignment' | 'fetch' | 'mixed'

export type ParsedCommand =
  | { kind: 'write'; writes: readonly TrackerWrite[] }
  | { kind: 'opaque'; reason: OpaqueReason; writes: readonly TrackerWrite[] }
  | { kind: 'none' }

const KIT_SCRIPT = '.basicly/core/kit/tracker/cli.py'
const KIT: TrackerCli = '.basicly/core/kit/tracker/cli.py'
const LOOP_WORDS = new Set(['for', 'while', 'until', 'select'])
const LEADING_KEYWORDS = new Set(['do', 'then', 'else', 'done', 'fi'])
const NOT_A_WRITE_FLAGS = new Set(['--help', '-h', '--dry-run'])
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const PYTHON = /^python(3(\.\d+)?)?$/
const PYTHON_VALUE_FLAGS = new Set(['-X', '-W'])
const PYTHON_NO_SCRIPT_FLAGS = new Set(['-c', '-m'])
const UV_RUN_VALUE_FLAGS = new Set([
  '--with',
  '-w',
  '--with-editable',
  '--with-requirements',
  '--python',
  '-p',
  '--project',
  '--directory',
  '--package',
  '--group',
  '--extra',
  '--env-file',
  '--index',
  '--from',
])
const NPX_VALUE_FLAGS = new Set(['--package', '-p'])
const UV_FETCH_FLAGS = new Set([
  '--from',
  '--with',
  '-w',
  '--with-editable',
  '--with-requirements',
  '--package',
])
const NPX_FETCH_FLAGS = new Set(['--package', '-p'])
const BR_GLOBAL_VALUE_FLAGS = new Set(['--db', '--actor', '--lock-timeout'])

type Lexed = {
  segments: string[][]
  hasHeredoc: boolean
  hasSubstitution: boolean
  hasRedirection: boolean
}

function startsSubstitution(command: string, i: number): boolean {
  const char = command.charAt(i)
  return char === '`' || ((char === '$' || char === '<') && command.charAt(i + 1) === '(')
}

function lex(command: string): Lexed {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  let hasHeredoc = false
  let hasSubstitution = false
  let hasRedirection = false
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i += 1) {
    const char = command.charAt(i)
    if (char === "'") {
      const close = command.indexOf("'", i + 1)
      const end = close === -1 ? command.length : close
      word += command.slice(i + 1, end)
      inWord = true
      i = end
    } else if (char === '"') {
      inWord = true
      for (i += 1; i < command.length && command.charAt(i) !== '"'; i += 1) {
        if (command.charAt(i) === '\\' && i + 1 < command.length) i += 1
        else if (startsSubstitution(command, i)) hasSubstitution = true
        word += command.charAt(i)
      }
    } else if (char === '\\' && i + 1 < command.length) {
      i += 1
      if (command.charAt(i) !== '\n') {
        word += command.charAt(i)
        inWord = true
      }
    } else if (startsSubstitution(command, i)) {
      hasSubstitution = true
      word += char
      inWord = true
    } else if (char === '#' && !inWord) {
      const newline = command.indexOf('\n', i)
      i = newline === -1 ? command.length : newline - 1
    } else if (char === '&' && (/[<>]$/.test(word) || command.charAt(i + 1) === '>')) {
      word += char
      inWord = true
    } else if (char === '<' && command.charAt(i + 1) === '<') {
      hasHeredoc = true
      endWord()
      i += 1
    } else if (char === '<' || char === '>') {
      hasRedirection = true
      word += char
      inWord = true
    } else if (';&|()\n'.includes(char)) {
      endSegment()
    } else if (char === ' ' || char === '\t') {
      endWord()
    } else {
      word += char
      inWord = true
    }
  }
  endSegment()
  return { segments, hasHeredoc, hasSubstitution, hasRedirection }
}

function skipOptions(words: readonly string[], start: number, valueFlags: Set<string>): number {
  let i = start
  while (i < words.length && (words[i] ?? '').startsWith('-')) {
    const flag = words[i] ?? ''
    i += valueFlags.has(flag) ? 2 : 1
  }
  return i
}

type Unwrapped = { command: readonly string[]; assigns: boolean; fetches: boolean }

function fetchesCode(options: readonly string[], fetchFlags: Set<string>): boolean {
  return options.some((option) => fetchFlags.has(option.split('=')[0] ?? ''))
}

function unwrap(words: readonly string[]): Unwrapped | null {
  let i = 0
  while (i < words.length && ENV_ASSIGNMENT.test(words[i] ?? '')) i += 1
  const assigns = i > 0
  let fetches = false
  const skipWrapper = (start: number, valueFlags: Set<string>, fetchFlags: Set<string>) => {
    const end = skipOptions(words, start, valueFlags)
    fetches ||= fetchesCode(words.slice(start, end), fetchFlags)
    return end
  }
  for (;;) {
    const head = words[i]
    if (head === 'uv' && words[i + 1] === 'run')
      i = skipWrapper(i + 2, UV_RUN_VALUE_FLAGS, UV_FETCH_FLAGS)
    else if (head === 'uvx') i = skipWrapper(i + 1, UV_RUN_VALUE_FLAGS, UV_FETCH_FLAGS)
    else if (head === 'npx') i = skipWrapper(i + 1, NPX_VALUE_FLAGS, NPX_FETCH_FLAGS)
    else if (head !== undefined && PYTHON.test(head)) {
      i += 1
      while (i < words.length && (words[i] ?? '').startsWith('-')) {
        const flag = words[i] ?? ''
        if (PYTHON_NO_SCRIPT_FLAGS.has(flag)) return null
        i += PYTHON_VALUE_FLAGS.has(flag) ? 2 : 1
      }
    } else break
  }
  return { command: words.slice(i), assigns, fetches }
}

function isKitScript(word: string): boolean {
  const path = word.replaceAll('\\', '/').replace(/^(\.\/)+/, '')
  return path === KIT_SCRIPT || path.endsWith(`/${KIT_SCRIPT}`)
}

function positionals(words: readonly string[], globalValueFlags: Set<string>): string[] {
  const start = skipOptions(words, 0, globalValueFlags)
  return words.slice(start).filter((word) => !word.startsWith('-'))
}

function verbOf(args: readonly string[], verbs: readonly string[]): string | null {
  for (const verb of verbs) {
    const parts = verb.split(' ')
    if (parts.every((part, index) => args[index] === part)) return verb
  }
  return null
}

function writeOf(command: readonly string[], table: WriteVerbs): TrackerWrite | null {
  const argv0 = command[0]
  if (argv0 === undefined) return null
  const name = argv0.replaceAll('\\', '/').split('/').pop() ?? ''
  const rest = command.slice(1)
  if (name === 'br' || name === 'bd') {
    const verb = verbOf(positionals(rest, BR_GLOBAL_VALUE_FLAGS), table.br)
    return verb === null ? null : { tracker: 'br', verb }
  }
  if (isKitScript(argv0)) {
    const verb = verbOf(positionals(rest, new Set()), table[KIT])
    return verb === null ? null : { tracker: KIT, verb }
  }
  if (name === 'basicly') {
    const args = positionals(rest, new Set())
    if (args[0] !== 'tracker') return null
    if (args[1] === 'write') {
      const verb = verbOf(args.slice(2), table[KIT])
      return verb === null ? null : { tracker: KIT, verb }
    }
    const verb = verbOf(args.slice(1), table['basicly tracker'])
    return verb === null ? null : { tracker: 'basicly tracker', verb }
  }
  return null
}

export function parseCommand(command: string, table: WriteVerbs): ParsedCommand {
  const { segments, hasHeredoc, hasSubstitution, hasRedirection } = lex(command)
  const writes: TrackerWrite[] = []
  let hasLoop = false
  let hasOtherCommand = false
  let hasAssignment = false
  let hasFetch = false
  for (const segment of segments) {
    let start = 0
    while (LEADING_KEYWORDS.has(segment[start] ?? '')) start += 1
    const words = segment.slice(start)
    if (words.length === 0 || words[0] === 'cd') continue
    if (LOOP_WORDS.has(words[0] ?? '')) {
      hasLoop = true
      continue
    }
    const isNotAWrite = words.some((word) => NOT_A_WRITE_FLAGS.has(word))
    const unwrapped = isNotAWrite ? null : unwrap(words)
    const write = unwrapped && writeOf(unwrapped.command, table)
    if (unwrapped && write) {
      writes.push(write)
      hasAssignment ||= unwrapped.assigns
      hasFetch ||= unwrapped.fetches
    } else hasOtherCommand = true
  }
  if (writes.length === 0) return { kind: 'none' }
  if (hasLoop) return { kind: 'opaque', reason: 'loop', writes }
  if (hasHeredoc) return { kind: 'opaque', reason: 'heredoc', writes }
  if (hasSubstitution) return { kind: 'opaque', reason: 'substitution', writes }
  if (hasRedirection) return { kind: 'opaque', reason: 'redirection', writes }
  if (hasAssignment) return { kind: 'opaque', reason: 'assignment', writes }
  if (hasFetch) return { kind: 'opaque', reason: 'fetch', writes }
  if (hasOtherCommand) return { kind: 'opaque', reason: 'mixed', writes }
  return { kind: 'write', writes }
}

const TRACKER_FILES: readonly RegExp[] = [
  /^\.beads\/issues\.jsonl$/,
  /^\.basicly\/ledger\/(?:events|pending)-[^/]+\.jsonl$/,
  /^\.basicly\/ledger\/snapshot\.jsonl$/,
  /^\.beans\/(?:[^/]+\/)*[^/]+--[^/]+\.md$/,
]

function slashed(path: string): string {
  return path.replaceAll('\\', '/')
}

export function trackerFileOf(filePath: string, root: string): string | null {
  const path = slashed(filePath)
  const prefix = `${slashed(root).replace(/\/+$/, '')}/`
  if (!path.startsWith(prefix)) return null
  const relative = path.slice(prefix.length)
  return TRACKER_FILES.some((marker) => marker.test(relative)) ? relative : null
}
