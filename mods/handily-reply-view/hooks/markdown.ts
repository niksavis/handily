import { graphemesOf, isEmoji } from './width'

export type Alignment = 'left' | 'right' | 'center'

export type Prose = { kind: 'prose'; lines: string[] }

export type Table = {
  kind: 'table'
  source: string
  header: string[]
  rows: string[][]
  alignments: Alignment[]
}

export type Fence = { kind: 'fence'; tag: string; content: string; isClosed: boolean }

export type Block = Prose | Table | Fence

const FENCE_OPENING = /^( {0,3})(`{3,}|~{3,})(.*)$/
const FENCE_CLOSING = /^ {0,3}(`{3,}|~{3,})\s*$/
const DELIMITER_CELL = /^:?-+:?$/
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const KEPT_CONTROLS: ReadonlySet<string> = new Set(['\t', '\n'])
const EMOJI_JOINER = /^[\u200D\u{E0020}-\u{E007F}]$/u
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
const INDENTED_CODE = /^(?: {4}|\t)/
const LEADING_SPACES = /^ */

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

function shownGrapheme(grapheme: string): string {
  const keepsJoiners = isEmoji(grapheme)
  return grapheme.replace(HIDDEN_CHARACTER, (found) =>
    KEPT_CONTROLS.has(found) || (keepsJoiners && EMOJI_JOINER.test(found))
      ? found
      : escapedUnits(found),
  )
}

export function shownText(text: string): string {
  return graphemesOf(text).map(shownGrapheme).join('')
}

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

export type Mark = { isCode: boolean; isBold: boolean; isLink: boolean }

export type Run = { text: string; mark: Mark }

type MarkFlag = keyof Mark

const MARK_FLAGS: readonly MarkFlag[] = ['isCode', 'isBold', 'isLink']

export const PLAIN_MARK: Mark = { isCode: false, isBold: false, isLink: false }

type Hold = (literal: string) => string

type Wrap = (flag: MarkFlag, text: string) => string

type Brackets = Map<string, { flag: MarkFlag; step: 1 | -1 }>

function linkOf(text: string, address: string, keepsAddress: boolean, held: Hold, wrap: Wrap) {
  if (text === '') return wrap('isLink', held(address))
  const link = wrap('isLink', text)
  return !keepsAddress || address === '' || address === text ? link : `${link} (${held(address)})`
}

export function sameMark(one: Mark, other: Mark): boolean {
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

export function textOfRuns(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join('')
}

export function markedCell(cell: string): Run[] {
  return markedText(cell, false)
}

export function copiedCell(cell: string): string {
  return textOfRuns(markedText(cell, true))
}

export function cellsOf(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index)
    if (character === '\\' && text.charAt(index + 1) === '|') {
      cell += '\\|'
      index += 1
    } else if (character === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell.trim())
  return cells
}

function alignmentOf(cell: string): Alignment {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
  return cell.endsWith(':') ? 'right' : 'left'
}

function delimiterOf(line: string, columns: number): Alignment[] | null {
  if (!line.includes('-')) return null
  const cells = cellsOf(line)
  if (cells.length !== columns || !cells.every((cell) => DELIMITER_CELL.test(cell))) return null
  return cells.map(alignmentOf)
}

function isTableRow(line: string): boolean {
  return line.trim() !== '' && line.includes('|') && !INDENTED_CODE.test(line)
}

function fitted(cells: string[], columns: number): string[] {
  return Array.from({ length: columns }, (_, index) => cells[index] ?? '')
}

function tableAt(lines: readonly string[], start: number): { table: Table; end: number } | null {
  const headerLine = lines[start] ?? ''
  if (!isTableRow(headerLine)) return null
  const header = cellsOf(headerLine)
  const alignments = delimiterOf(lines[start + 1] ?? '', header.length)
  if (alignments === null) return null
  let end = start + 2
  while (
    end < lines.length &&
    isTableRow(lines[end] ?? '') &&
    openingOf(lines[end] ?? '') === null
  ) {
    end += 1
  }
  return {
    table: {
      kind: 'table',
      source: lines.slice(start, end).join('\n'),
      header,
      rows: lines.slice(start + 2, end).map((line) => fitted(cellsOf(line), header.length)),
      alignments,
    },
    end,
  }
}

function isClosing(line: string, fence: string): boolean {
  const marks = FENCE_CLOSING.exec(line)?.[1]
  return marks !== undefined && marks[0] === fence[0] && marks.length >= fence.length
}

type Opening = { indent: number; marks: string; info: string }

function openingOf(line: string): Opening | null {
  const found = FENCE_OPENING.exec(line)
  const indent = found?.[1]
  const marks = found?.[2]
  const info = found?.[3] ?? ''
  if (indent === undefined || marks === undefined) return null
  if (marks.startsWith('`') && info.includes('`')) return null
  return { indent: indent.length, marks, info }
}

function withoutIndent(line: string, indent: number): string {
  const spaces = LEADING_SPACES.exec(line)?.[0].length ?? 0
  return line.slice(Math.min(spaces, indent))
}

function fenceAt(lines: readonly string[], start: number): { fence: Fence; end: number } | null {
  const opening = openingOf(lines[start] ?? '')
  if (opening === null) return null
  let end = start + 1
  while (end < lines.length && !isClosing(lines[end] ?? '', opening.marks)) end += 1
  const tag = opening.info.trim().split(/\s+/)[0] ?? ''
  const content = lines.slice(start + 1, end).map((line) => withoutIndent(line, opening.indent))
  return {
    fence: { kind: 'fence', tag, content: content.join('\n'), isClosed: end < lines.length },
    end: Math.min(end + 1, lines.length),
  }
}

function trimmedProse(lines: readonly string[]): Prose | null {
  let first = 0
  let last = lines.length
  while (first < last && (lines[first] ?? '').trim() === '') first += 1
  while (last > first && (lines[last - 1] ?? '').trim() === '') last -= 1
  return first === last ? null : { kind: 'prose', lines: lines.slice(first, last) }
}

export function blocksOf(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: Block[] = []
  let prose: string[] = []
  const endProse = () => {
    const kept = trimmedProse(prose)
    if (kept !== null) blocks.push(kept)
    prose = []
  }
  let index = 0
  while (index < lines.length) {
    const fence = fenceAt(lines, index)
    const table = fence === null ? tableAt(lines, index) : null
    const found = fence?.fence ?? table?.table
    if (found === undefined) {
      prose.push(lines[index] ?? '')
      index += 1
      continue
    }
    endProse()
    blocks.push(found)
    index = fence?.end ?? table?.end ?? index + 1
  }
  endProse()
  return blocks
}
