const LABEL_LENGTH = 60
const DIRECTORY_CHANGES = new Set(['cd', 'pushd', 'popd'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const TWO_CHARACTER_SEPARATORS = new Set(['&&', '||'])
const ONE_CHARACTER_SEPARATORS = new Set([';', '|', '\n'])

type Quote = '"' | "'" | '`'
type Scan = { quote: Quote | null; depth: number; isEscaped: boolean }

const QUOTES: ReadonlySet<string> = new Set(['"', "'", '`'])

function isQuote(character: string): character is Quote {
  return QUOTES.has(character)
}

function isQuiet(scan: Scan): boolean {
  return scan.quote === null && scan.depth === 0 && !scan.isEscaped
}

function step(scan: Scan, character: string, following: string): void {
  if (scan.isEscaped) {
    scan.isEscaped = false
  } else if (character === '\\' && scan.quote !== "'") {
    scan.isEscaped = true
  } else if (scan.quote !== null) {
    if (character === scan.quote) scan.quote = null
  } else if (isQuote(character)) {
    scan.quote = character
  } else if (character === '$' && following === '(') {
    scan.depth += 1
  } else if (character === ')' && scan.depth > 0) {
    scan.depth -= 1
  }
}

export function segments(command: string): string[] {
  const found: string[] = []
  const scan: Scan = { quote: null, depth: 0, isEscaped: false }
  let start = 0
  let index = 0
  while (index < command.length) {
    const character = command.charAt(index)
    const pair = command.slice(index, index + 2)
    if (isQuiet(scan) && TWO_CHARACTER_SEPARATORS.has(pair)) {
      found.push(command.slice(start, index))
      index += 2
      start = index
      continue
    }
    if (isQuiet(scan) && ONE_CHARACTER_SEPARATORS.has(character)) {
      found.push(command.slice(start, index))
      index += 1
      start = index
      continue
    }
    step(scan, character, command.charAt(index + 1))
    index += 1
  }
  found.push(command.slice(start))
  return found.map((segment) => segment.replace(/\s+/g, ' ').trim()).filter((s) => s !== '')
}

function words(segment: string): string[] {
  return segment.split(' ').filter((word) => !ASSIGNMENT.test(word))
}

function unquoted(word: string): string {
  return word.replace(/^(['"])(.*)\1$/, '$2')
}

function baseName(word: string): string {
  return (
    word
      .split('/')
      .filter((part) => part !== '')
      .at(-1) ?? word
  )
}

export function programOf(command: string): string {
  const firstWords = segments(command)
    .map((segment) => words(segment)[0])
    .filter((word): word is string => word !== undefined)
    .map((word) => baseName(unquoted(word)))
  return firstWords.find((word) => !DIRECTORY_CHANGES.has(word)) ?? firstWords[0] ?? ''
}

export function cutLabel(text: string, length = LABEL_LENGTH): string {
  const graphemes = Array.from(new Intl.Segmenter().segment(text), (part) => part.segment)
  if (graphemes.length <= length) return text
  return `${graphemes.slice(0, length).join('').trimEnd()}…`
}

export function commandLabel(command: string): string {
  const [first = '', ...rest] = segments(command)
  const label = cutLabel(first)
  if (rest.length === 0 || label.endsWith('…')) return label
  return `${label} …`
}
