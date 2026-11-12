export type DiffKind = 'fileHeader' | 'hunk' | 'added' | 'removed' | 'plain'

export type DiffToken = { text: string; kind: DiffKind }

const OLD_FILE = '--- '
const NEW_FILE = '+++ '
const GIT_HEADER = 'diff '
const HUNK_MARK = '@@'

function isFilePair(first: string | undefined, second: string | undefined): boolean {
  return first?.startsWith(OLD_FILE) === true && second?.startsWith(NEW_FILE) === true
}

function hunkLine(line: string): DiffToken[] {
  const close = line.indexOf(HUNK_MARK, HUNK_MARK.length)
  const end = close === -1 ? line.length : close + HUNK_MARK.length
  const rest = line.slice(end)
  const hunk: DiffToken = { text: line.slice(0, end), kind: 'hunk' }
  return rest === '' ? [hunk] : [hunk, { text: rest, kind: 'plain' }]
}

function lineKind(lines: readonly string[], index: number): DiffKind {
  const line = lines[index] ?? ''
  if (line.startsWith(GIT_HEADER)) return 'fileHeader'
  if (isFilePair(line, lines[index + 1]) || isFilePair(lines[index - 1], line)) return 'fileHeader'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'plain'
}

export function diffLines(lines: readonly string[]): DiffToken[][] {
  return lines.map((line, index) => {
    if (line === '') return []
    if (line.startsWith(HUNK_MARK)) return hunkLine(line)
    return [{ text: line, kind: lineKind(lines, index) }]
  })
}
