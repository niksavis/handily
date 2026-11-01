export const MASK = '***'

const SECRET_WORDS =
  'token|secret|passw(?:or)?d|pwd|api[_-]?key|credentials?|private[_-]?key|access[_-]?key|authorization|cookie'

const URL_USER_INFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi

const SECRET_VALUE = `(?:"[^"]*"|'[^']*'|(?:(?:bearer|basic)\\s+)?[^\\s"'&]+)`

const SECRET_ASSIGNMENT = new RegExp(
  `(\\b[\\w.-]*(?:${SECRET_WORDS})[\\w.-]*)(\\s*[=:]\\s*)${SECRET_VALUE}`,
  'gi',
)

const SECRET_FLAG_VALUE = new RegExp(
  `(--?[\\w-]*(?:${SECRET_WORDS})[\\w-]*)(\\s+)${SECRET_VALUE}`,
  'gi',
)

const COMMAND_SEPARATORS: ReadonlySet<string> = new Set([';', '|', '&', '\n', '\r'])

const QUOTES: ReadonlySet<string> = new Set(['"', "'"])

const MYSQL_COMMAND = /^(?:mysql\w*|mariadb[\w-]*)(?:\.exe)?$/i

const VARIABLE_ASSIGNMENT = /^[A-Za-z_]\w*=/

const GLUED_PASSWORD_FLAG = /^-p./s

const GLUED_FLAG_CHARS = 2

type ShellWord = { start: number; end: number; text: string }

type WordScan = { commands: ShellWord[][]; start: number; quote: string | null }

function closeWord(scan: WordScan, text: string, end: number): void {
  if (scan.start < 0) return
  scan.commands.at(-1)?.push({ start: scan.start, end, text: text.slice(scan.start, end) })
  scan.start = -1
}

function quotedStep(scan: WordScan, char: string): number {
  if (char === scan.quote) scan.quote = null
  return char === '\\' && scan.quote === '"' ? 2 : 1
}

function wordStep(scan: WordScan, text: string, index: number): number {
  const char = text.charAt(index)
  if (scan.quote !== null) return quotedStep(scan, char)
  if (COMMAND_SEPARATORS.has(char)) {
    closeWord(scan, text, index)
    scan.commands.push([])
    return 1
  }
  if (/\s/.test(char)) {
    closeWord(scan, text, index)
    return 1
  }
  if (scan.start < 0) scan.start = index
  if (QUOTES.has(char)) scan.quote = char
  return char === '\\' ? 2 : 1
}

function simpleCommands(text: string): ShellWord[][] {
  const scan: WordScan = { commands: [[]], start: -1, quote: null }
  let index = 0
  while (index < text.length) index += wordStep(scan, text, index)
  closeWord(scan, text, text.length)
  return scan.commands
}

function commandName(word: string): string {
  const unquoted = word.replace(/["']/g, '')
  return unquoted.slice(Math.max(unquoted.lastIndexOf('/'), unquoted.lastIndexOf('\\')) + 1)
}

function gluedPasswords(words: readonly ShellWord[]): ShellWord[] {
  const commandAt = words.findIndex((word) => !VARIABLE_ASSIGNMENT.test(word.text))
  const command = words[commandAt]
  if (command === undefined || !MYSQL_COMMAND.test(commandName(command.text))) return []
  return words.slice(commandAt + 1).filter((word) => GLUED_PASSWORD_FLAG.test(word.text))
}

function maskedMysqlPasswords(text: string): string {
  const flags = simpleCommands(text).flatMap(gluedPasswords)
  return flags.reduceRight(
    (masked, flag) =>
      `${masked.slice(0, flag.start + GLUED_FLAG_CHARS)}${MASK}${masked.slice(flag.end)}`,
    text,
  )
}

const USER_FLAG_PASSWORD = /(\s(?:-u|--user)\s+["']?[^\s:"']+):[^\s"']+/g

const AUTH_SCHEME_VALUE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi

const TOKEN_SHAPES = new RegExp(
  [
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'glpat-[A-Za-z0-9_-]{20,}',
    'xox[abprs]-[A-Za-z0-9-]{10,}',
    'sk-[A-Za-z0-9_-]{20,}',
    'AKIA[0-9A-Z]{16}',
    'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}',
  ]
    .map((shape) => `\\b${shape}`)
    .join('|'),
  'g',
)

export function maskedCredentials(text: string): string {
  return maskedMysqlPasswords(text)
    .replace(URL_USER_INFO, `$1${MASK}@`)
    .replace(SECRET_ASSIGNMENT, `$1$2${MASK}`)
    .replace(SECRET_FLAG_VALUE, `$1$2${MASK}`)
    .replace(USER_FLAG_PASSWORD, `$1:${MASK}`)
    .replace(AUTH_SCHEME_VALUE, `$1 ${MASK}`)
    .replace(TOKEN_SHAPES, MASK)
}
