const QUOTE = '"'
const BACKSLASH = '\\'
const OCTAL = /^[0-7]{3}$/
const NAMED_ESCAPES: Readonly<Record<string, string>> = {
  a: '%07',
  b: '%08',
  t: '%09',
  n: '%0A',
  v: '%0B',
  f: '%0C',
  r: '%0D',
  [QUOTE]: '%22',
  [BACKSLASH]: '%5C',
}
const SHELL_SAFE = /^[A-Za-z0-9@%+=:,./_-]+$/
const SINGLE_QUOTE = /'/g
const ESCAPED_SINGLE_QUOTE = "'\\''"

export type Unquoted = { value: string; end: number }

function percentOf(code: number): string {
  return `%${code.toString(16).padStart(2, '0')}`
}

function escapeAt(text: string, at: number): { encoded: string; length: number } | undefined {
  const digits = text.slice(at + 1, at + 4)
  if (OCTAL.test(digits)) return { encoded: percentOf(parseInt(digits, 8)), length: 4 }
  const named = NAMED_ESCAPES[text.charAt(at + 1)]
  return named === undefined ? undefined : { encoded: named, length: 2 }
}

function decoded(encoded: string): string | undefined {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}

function encodedOf(character: string): string | undefined {
  try {
    return encodeURIComponent(character)
  } catch {
    return undefined
  }
}

export function gitUnquoted(text: string, start: number): Unquoted | undefined {
  if (text.charAt(start) !== QUOTE) return undefined
  let encoded = ''
  let at = start + 1
  while (at < text.length) {
    const character = String.fromCodePoint(text.codePointAt(at) ?? 0)
    if (character === QUOTE) {
      const value = decoded(encoded)
      return value === undefined ? undefined : { value, end: at + 1 }
    }
    if (character === BACKSLASH) {
      const escape = escapeAt(text, at)
      if (escape === undefined) return undefined
      encoded += escape.encoded
      at += escape.length
      continue
    }
    const plain = encodedOf(character)
    if (plain === undefined) return undefined
    encoded += plain
    at += character.length
  }
  return undefined
}

export function shellQuoted(argument: string): string {
  if (SHELL_SAFE.test(argument)) return argument
  return `'${argument.replace(SINGLE_QUOTE, ESCAPED_SINGLE_QUOTE)}'`
}
