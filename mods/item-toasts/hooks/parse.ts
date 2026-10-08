import type { EngineInterface } from 'claude-code'

export type WriteVerbs = Awaited<ReturnType<EngineInterface['workitems']['writeVerbs']>>

export type TrackerCli = keyof WriteVerbs

export type TrackerWrite = { tracker: TrackerCli; verb: string }

export type OpaqueReason =
  'expansion' | 'redirection' | 'syntax' | 'shape' | 'mixed' | 'hidden-status'

export type ParsedCommand =
  | { kind: 'write'; writes: readonly TrackerWrite[] }
  | { kind: 'echoed'; writes: readonly TrackerWrite[]; line: string }
  | { kind: 'opaque'; reason: OpaqueReason; writes: readonly TrackerWrite[] }
  | { kind: 'none' }

const KIT_SCRIPT = '.basicly/core/kit/tracker/cli.py'
const KIT: TrackerCli = '.basicly/core/kit/tracker/cli.py'
const TRACKER_NAMES = new Set(['br', 'bd', 'basicly'])
const PYTHON_NAMES = new Set(['python3', 'python'])
const NOT_A_WRITE_FLAGS = new Set(['--help', '-h', '--dry-run'])
const BR_GLOBAL_VALUE_FLAGS = new Set(['--db', '--actor', '--lock-timeout'])
const MAX_COMMAND_LENGTH = 8192
const EXIT_STATUS = '$?'
const WRITE_CHAIN = '&&'
const LINE_BREAK = '\n'
const OPERATORS = [WRITE_CHAIN, '||', '|', ';', LINE_BREAK]
const TRAILING_OPERATORS = new Set([';', LINE_BREAK])
const STATUS_ECHO_SEPARATORS = new Set([';', LINE_BREAK, WRITE_CHAIN])
const BARE_WORD_CHAR = /^[A-Za-z0-9._/:=@,+%-]$/
const DOUBLE_QUOTED_EXPANSION = /[$`\\]/
const NOT_A_NAME_CHAR = /[^A-Za-z0-9._/:=@,+%\\-]+/
const EXPANSION_CHARS = '$`\\*?[]{}~'
const REDIRECTION_CHARS = '<>'

type Segment = { words: string[]; separator: string; hasStatus: boolean }

type Shape = { kind: 'read'; segments: Segment[] } | { kind: 'refused'; reason: OpaqueReason }

function refusalOf(char: string): OpaqueReason {
  if (REDIRECTION_CHARS.includes(char)) return 'redirection'
  if (EXPANSION_CHARS.includes(char)) return 'expansion'
  return 'syntax'
}

function readShape(command: string): Shape {
  const segments: Segment[] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  let hasStatus = false
  let separator = ''
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  for (let i = 0; i < command.length; i += 1) {
    const char = command.charAt(i)
    if (char === "'" || char === '"') {
      const close = command.indexOf(char, i + 1)
      if (close === -1) return { kind: 'refused', reason: 'syntax' }
      const quoted = command.slice(i + 1, close)
      if (char === '"') {
        if (DOUBLE_QUOTED_EXPANSION.test(quoted.replaceAll(EXIT_STATUS, ''))) {
          return { kind: 'refused', reason: 'expansion' }
        }
        hasStatus ||= quoted.includes(EXIT_STATUS)
      }
      word += quoted
      inWord = true
      i = close
    } else if (command.startsWith(EXIT_STATUS, i)) {
      hasStatus = true
      word += EXIT_STATUS
      inWord = true
      i += EXIT_STATUS.length - 1
    } else if (BARE_WORD_CHAR.test(char)) {
      word += char
      inWord = true
    } else if (char === ' ' || char === '\t') {
      endWord()
    } else {
      const operator = OPERATORS.find((each) => command.startsWith(each, i))
      if (operator === undefined) return { kind: 'refused', reason: refusalOf(char) }
      endWord()
      i += operator.length - 1
      if (words.length > 0) {
        segments.push({ words, separator, hasStatus })
        words = []
        hasStatus = false
        separator = operator
      } else if (operator !== LINE_BREAK) {
        return { kind: 'refused', reason: 'syntax' }
      }
    }
  }
  endWord()
  if (words.length > 0) segments.push({ words, separator, hasStatus })
  else if (segments.length > 0 && !TRAILING_OPERATORS.has(separator)) {
    return { kind: 'refused', reason: 'syntax' }
  }
  return { kind: 'read', segments }
}

type StatusEcho = { line: string; isAfterAnd: boolean }

function statusEchoOf({ words, separator }: Segment): StatusEcho | null {
  const [first, ...args] = words
  if (first !== 'echo' || !STATUS_ECHO_SEPARATORS.has(separator)) return null
  if (args.some((word) => word.startsWith('-'))) return null
  return { line: args.join(' '), isAfterAnd: separator === WRITE_CHAIN }
}

export function hasEchoedSuccess(line: string, stdout: string): boolean {
  const printed = stdout.trimEnd().split(/\r?\n/).at(-1) ?? ''
  return printed.trimEnd() === line.replaceAll(EXIT_STATUS, '0').trimEnd()
}

function slashed(path: string): string {
  return path.replaceAll('\\', '/')
}

function isKitScript(word: string): boolean {
  const path = slashed(word).replace(/^(\.\/)+/, '')
  return path === KIT_SCRIPT || path.endsWith(`/${KIT_SCRIPT}`)
}

function isTrackerProgram(word: string): boolean {
  return TRACKER_NAMES.has(slashed(word).split('/').pop() ?? '') || isKitScript(word)
}

function allowedTrackerCommand(words: readonly string[]): readonly string[] | null {
  const [first = '', second] = words
  if (TRACKER_NAMES.has(first) || first === KIT_SCRIPT) return words
  if (PYTHON_NAMES.has(first) && second === KIT_SCRIPT) return words.slice(1)
  return null
}

function isNotAWrite(words: readonly string[]): boolean {
  return words.some((word) => NOT_A_WRITE_FLAGS.has(word))
}

function skipOptions(words: readonly string[], start: number, valueFlags: Set<string>): number {
  let i = start
  while (i < words.length && (words[i] ?? '').startsWith('-')) {
    const flag = words[i] ?? ''
    i += valueFlags.has(flag) ? 2 : 1
  }
  return i
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
  const name = slashed(argv0).split('/').pop() ?? ''
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

function looseWritesOf(words: readonly string[], table: WriteVerbs): TrackerWrite[] {
  if (isNotAWrite(words)) return []
  return words.flatMap((word, index) =>
    isTrackerProgram(word) ? (writeOf(words.slice(index), table) ?? []) : [],
  )
}

function parseSegments(segments: readonly Segment[], table: WriteVerbs): ParsedCommand {
  const last = segments.at(-1)
  const echo = last !== undefined && segments.length > 1 ? statusEchoOf(last) : null
  const checked = echo === null ? segments : segments.slice(0, -1)
  const writes: TrackerWrite[] = []
  let hasStatus = false
  let hasOutsideShape = false
  let hasOtherCommand = false
  let hasHiddenStatus = false
  let hasChangedDirectory = false
  for (const [index, segment] of checked.entries()) {
    const { words } = segment
    hasStatus ||= segment.hasStatus
    hasHiddenStatus ||= index > 0 && segment.separator !== WRITE_CHAIN
    if (words[0] === 'cd') {
      hasChangedDirectory = true
      hasOtherCommand ||= words.length !== 2
      continue
    }
    const allowed = allowedTrackerCommand(words)
    const runsKitElsewhere = hasChangedDirectory && allowed?.[0] === KIT_SCRIPT
    if (runsKitElsewhere || (allowed === null && words.some(isTrackerProgram))) {
      hasOutsideShape = true
      writes.push(...looseWritesOf(words, table))
      continue
    }
    const write = allowed === null || isNotAWrite(words) ? null : writeOf(allowed, table)
    if (write) writes.push(write)
    else hasOtherCommand = true
  }
  if (hasOutsideShape) return { kind: 'opaque', reason: 'shape', writes }
  if (writes.length === 0) return { kind: 'none' }
  if (hasStatus) return { kind: 'opaque', reason: 'expansion', writes }
  if (hasOtherCommand) return { kind: 'opaque', reason: 'mixed', writes }
  if (hasHiddenStatus) return { kind: 'opaque', reason: 'hidden-status', writes }
  if (echo === null) return { kind: 'write', writes }
  if (echo.line.includes(EXIT_STATUS)) return { kind: 'echoed', writes, line: echo.line }
  if (echo.isAfterAnd) return { kind: 'write', writes }
  return { kind: 'opaque', reason: 'hidden-status', writes }
}

export function parseCommand(command: string, table: WriteVerbs): ParsedCommand {
  const names = () => command.split(NOT_A_NAME_CHAR)
  if (command.length > MAX_COMMAND_LENGTH) {
    if (!names().some(isTrackerProgram)) return { kind: 'none' }
    return { kind: 'opaque', reason: 'syntax', writes: [] }
  }
  const shape = readShape(command)
  if (shape.kind === 'read') return parseSegments(shape.segments, table)
  const words = names()
  if (!words.some(isTrackerProgram)) return { kind: 'none' }
  return { kind: 'opaque', reason: shape.reason, writes: looseWritesOf(words, table) }
}

const TRACKER_FILES: readonly RegExp[] = [
  /^\.beads\/issues\.jsonl$/,
  /^\.basicly\/ledger\/(?:events|pending)-[^/]+\.jsonl$/,
  /^\.basicly\/ledger\/snapshot\.jsonl$/,
  /^\.beans\/(?:[^/]+\/)*[^/]+--[^/]+\.md$/,
]

export function trackerFileOf(filePath: string, root: string): string | null {
  const path = slashed(filePath)
  const prefix = `${slashed(root).replace(/\/+$/, '')}/`
  if (!path.startsWith(prefix)) return null
  const relative = path.slice(prefix.length)
  return TRACKER_FILES.some((marker) => marker.test(relative)) ? relative : null
}
