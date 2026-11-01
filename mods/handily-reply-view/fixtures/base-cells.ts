const LINK = /!?\[([^\]]*)\]\(\s*<?([^)\s>]*)>?[^)]*\)/g
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^>\s]+)>/g
const STAR_STRONG = /\*\*(.+?)\*\*/g
const UNDERSCORE_STRONG = /(^|[^\p{L}\p{N}_])__(.+?)__(?![\p{L}\p{N}_])/gu
const STRIKETHROUGH = /~~(.+?)~~/g
const ESCAPE_OR_CODE_SPAN =
  /\\([\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e])|(?<!`)(`+)(?!`)(.+?)(?<!`)\2(?!`)/g
const PADDED_CODE = /^ (.*[^ ].*) $/
const PRIVATE_USE_START = 0xe000
const STAR_EMPHASIS = /\*(\S(?:[^*]*\S)?)\*/g
const UNDERSCORE_EMPHASIS = /(^|[^\p{L}\p{N}_])_([^\s_](?:[^_]*[^\s_])?)_(?![\p{L}\p{N}_])/gu
const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}
const LAST_CODE_POINT = 0x10ffff
const FIRST_SURROGATE = 0xd800
const LAST_SURROGATE = 0xdfff
const LINE_BREAK_TAG = /<br\s*\/?>/gi

function unusedCharacters(text: string, count: number): string[] {
  const found: string[] = []
  for (let code = PRIVATE_USE_START; found.length < count; code += 1) {
    const character = String.fromCodePoint(code)
    if (!text.includes(character)) found.push(character)
  }
  return found
}

function entityText(found: string, decimal?: string, hex?: string, name?: string): string {
  if (name !== undefined) return NAMED_ENTITIES[name] ?? found
  const code = decimal === undefined ? Number.parseInt(hex ?? '', 16) : Number(decimal)
  const isSurrogate = code >= FIRST_SURROGATE && code <= LAST_SURROGATE
  const isCharacter = code > 0 && code <= LAST_CODE_POINT && !isSurrogate
  return isCharacter ? String.fromCodePoint(code) : found
}

type Mark = { isCode: boolean; isBold: boolean; isLink: boolean }

type Run = { text: string; mark: Mark }

type MarkFlag = keyof Mark

const MARK_FLAGS: readonly MarkFlag[] = ['isCode', 'isBold', 'isLink']

type Hold = (literal: string) => string

type Wrap = (flag: MarkFlag, text: string) => string

type Brackets = Map<string, { flag: MarkFlag; step: 1 | -1 }>

function linkOf(text: string, address: string, keepsAddress: boolean, held: Hold, wrap: Wrap) {
  if (text === '') return wrap('isLink', held(address))
  const link = wrap('isLink', text)
  return !keepsAddress || address === '' || address === text ? link : `${link} (${held(address)})`
}

function sameMark(one: Mark, other: Mark): boolean {
  return MARK_FLAGS.every((flag) => one[flag] === other[flag])
}

type Marking = { brackets: Brackets; held: RegExp; literals: readonly string[] }

function runsOf(text: string, marking: Marking): Run[] {
  const depths = new Map<MarkFlag, number>(MARK_FLAGS.map((flag) => [flag, 0]))
  const runs: Run[] = []
  const add = (found: string) => {
    if (found === '') return
    const shown = found.replace(/\t/g, ' ')
    const mark: Mark = {
      isCode: (depths.get('isCode') ?? 0) > 0,
      isBold: (depths.get('isBold') ?? 0) > 0,
      isLink: (depths.get('isLink') ?? 0) > 0,
    }
    const last = runs.at(-1)
    if (last !== undefined && sameMark(last.mark, mark)) last.text += shown
    else runs.push({ text: shown, mark })
  }
  text.split(marking.held).forEach((part, index) => {
    if (index % 2 === 1) {
      add(marking.literals[Number(part)] ?? '')
      return
    }
    for (const character of part) {
      const bracket = marking.brackets.get(character)
      if (bracket === undefined) add(character)
      else depths.set(bracket.flag, (depths.get(bracket.flag) ?? 0) + bracket.step)
    }
  })
  return runs
}

function codeText(code: string): string {
  return code.replace(PADDED_CODE, '$1')
}

function markedText(cell: string, keepsAddress: boolean): Run[] {
  const [mark = '', ...ends] = unusedCharacters(cell, 1 + 2 * MARK_FLAGS.length)
  const brackets: Brackets = new Map()
  const wrappers = new Map<MarkFlag, [string, string]>()
  MARK_FLAGS.forEach((flag, index) => {
    const open = ends[2 * index] ?? ''
    const close = ends[2 * index + 1] ?? ''
    brackets.set(open, { flag, step: 1 })
    brackets.set(close, { flag, step: -1 })
    wrappers.set(flag, [open, close])
  })
  const wrap: Wrap = (flag, text) => {
    const [open = '', close = ''] = wrappers.get(flag) ?? []
    return `${open}${text}${close}`
  }
  const literals: string[] = []
  const hold: Hold = (literal) => {
    literals.push(literal)
    return `${mark}${String(literals.length - 1)}${mark}`
  }
  const held = cell.replace(
    ESCAPE_OR_CODE_SPAN,
    (_found, escaped: string | undefined, _ticks: string | undefined, code?: string) =>
      escaped === undefined ? wrap('isCode', hold(codeText(code ?? ''))) : hold(escaped),
  )
  const text = held
    .replace(LINE_BREAK_TAG, ' ')
    .replace(LINK, (_found, linkText: string, address: string) =>
      linkOf(linkText, address, keepsAddress, hold, wrap),
    )
    .replace(AUTOLINK, (_found, address: string) => wrap('isLink', hold(address)))
    .replace(STAR_STRONG, (_found, inner: string) => wrap('isBold', inner))
    .replace(
      UNDERSCORE_STRONG,
      (_found, before: string, inner: string) => before + wrap('isBold', inner),
    )
    .replace(STRIKETHROUGH, '$1')
    .replace(STAR_EMPHASIS, '$1')
    .replace(UNDERSCORE_EMPHASIS, '$1$2')
    .replace(ENTITY, (found, decimal?: string, hex?: string, name?: string) =>
      hold(entityText(found, decimal, hex, name)),
    )
  return runsOf(text, { brackets, held: new RegExp(`${mark}(\\d+)${mark}`, 'u'), literals })
}

function textOfRuns(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join('')
}

export function markedCell(cell: string): Run[] {
  return markedText(cell, false)
}

export function copiedCell(cell: string): string {
  return textOfRuns(markedText(cell, true))
}
