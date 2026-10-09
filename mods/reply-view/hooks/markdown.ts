export type Alignment = 'left' | 'right' | 'center'

export type Prose = { kind: 'prose'; lines: string[] }

export type Table = {
  kind: 'table'
  source: string
  header: string[]
  rows: string[][]
  alignments: Alignment[]
}

export type Fence = { kind: 'fence'; tag: string; content: string }

export type Block = Prose | Table | Fence

const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSING = /^ {0,3}(`{3,}|~{3,})\s*$/
const DELIMITER_CELL = /^:?-+:?$/
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const KEPT_CONTROLS: ReadonlySet<string> = new Set(['\t', '\n'])
const LINK = /!?\[([^\]]*)\]\([^)]*\)/g
const PAIRED_MARK = /(\*\*|__|~~)(.+?)\1/g
const CODE_SPAN = /`([^`]*)`/g
const STAR_EMPHASIS = /\*(\S(?:[^*]*\S)?)\*/g
const LINE_BREAK_TAG = /<br\s*\/?>/gi

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

export function shownText(text: string): string {
  return text.replace(HIDDEN_CHARACTER, (found) =>
    KEPT_CONTROLS.has(found) ? found : escapedUnits(found),
  )
}

export function plainCell(cell: string): string {
  const plain = cell
    .replace(LINE_BREAK_TAG, ' ')
    .replace(LINK, '$1')
    .replace(CODE_SPAN, '$1')
    .replace(PAIRED_MARK, '$2')
    .replace(STAR_EMPHASIS, '$1')
    .replace(/\\([\\`*_~|[\]])/g, '$1')
    .replace(/\t/g, ' ')
  return shownText(plain)
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
  return line.trim() !== '' && line.includes('|')
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
  while (end < lines.length && isTableRow(lines[end] ?? '')) end += 1
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

function fenceAt(lines: readonly string[], start: number): { fence: Fence; end: number } | null {
  const opening = FENCE_OPENING.exec(lines[start] ?? '')
  const marks = opening?.[1]
  const info = opening?.[2] ?? ''
  if (marks === undefined || (marks.startsWith('`') && info.includes('`'))) return null
  let end = start + 1
  while (end < lines.length && !isClosing(lines[end] ?? '', marks)) end += 1
  const tag = info.trim().split(/\s+/)[0] ?? ''
  return {
    fence: { kind: 'fence', tag, content: lines.slice(start + 1, end).join('\n') },
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
