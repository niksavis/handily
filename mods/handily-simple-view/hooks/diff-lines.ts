import type { Span, StyledLine } from './wrap'

export type DiffFile = {
  kind: 'file'
  path: string
  head: string[]
  hunks: string[]
  isWhole: boolean
}

export type DiffPiece = { kind: 'lines'; lines: StyledLine[] } | DiffFile

type Reading = {
  pieces: DiffPiece[]
  file: DiffFile | null
  old: number
  added: number
  isMessage: boolean
  isSubjectDue: boolean
}

const HUNK_HEAD = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/
const COMMIT_LINE = /^([*|\\/_ ]*)(commit )([0-9a-f]{40})(.*)$/
const ONE_LINE = /^([*|\\/_ .-]*?)([0-9a-f]{7,40})((?: \([^)]*\))?)( .*)$/
const GRAPH = /^[*|\\/_ ]*/
const META = /^(?:Author|AuthorDate|Commit|CommitDate|Date|Merge):/
const FILE_META =
  /^(?:index |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |--- |\+\+\+ )/
const HASH_COLOR = 'warning'
const REFS_COLOR = 'success'
const ADDED_COLOR = 'success'
const REMOVED_COLOR = 'error'
const HUNK_COLOR = 'suggestion'

function pathOf(head: readonly string[]): string {
  const after = (prefix: string) =>
    head
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length)
      .replace(/\t.*$/, '')
  const plus = after('+++ ')
  if (plus !== undefined && plus !== '/dev/null') return plus.replace(/^b\//, '')
  const minus = after('--- ')
  if (minus !== undefined && minus !== '/dev/null') return minus.replace(/^a\//, '')
  const git = after('diff --git ')
  return git?.replace(/^.* b\//, '') ?? 'diff'
}

function closeFile(reading: Reading): void {
  const { file } = reading
  if (file === null) return
  file.isWhole = file.hunks.length > 0 && reading.old <= 0 && reading.added <= 0
  file.path = pathOf(file.head)
  reading.pieces.push(file)
  reading.file = null
  reading.old = 0
  reading.added = 0
}

function pushLine(reading: Reading, line: StyledLine): void {
  const last = reading.pieces.at(-1)
  if (last?.kind === 'lines') last.lines.push(line)
  else reading.pieces.push({ kind: 'lines', lines: [line] })
}

function isInHunk(reading: Reading): boolean {
  return reading.file !== null && (reading.old > 0 || reading.added > 0)
}

function readHunkLine(reading: Reading, line: string): boolean {
  if (reading.file === null) return false
  if (line.startsWith('\\') && reading.file.hunks.length > 0) {
    reading.file.hunks.push(line)
    return true
  }
  if (!isInHunk(reading)) return false
  const mark = line.charAt(0)
  if (mark === '-') reading.old -= 1
  else if (mark === '+') reading.added -= 1
  else if (mark === ' ' || line === '') {
    reading.old -= 1
    reading.added -= 1
  } else return false
  reading.file.hunks.push(line)
  return true
}

function readHunkHead(reading: Reading, line: string): boolean {
  const found = HUNK_HEAD.exec(line)
  if (found === null || reading.file === null) return false
  reading.old = Number(found[1] ?? '1')
  reading.added = Number(found[2] ?? '1')
  reading.file.hunks.push(line)
  return true
}

function startsFile(reading: Reading, line: string): boolean {
  if (line.startsWith('diff ')) return true
  return line.startsWith('--- ') && (reading.file === null || reading.file.hunks.length > 0)
}

function readEntryLine(reading: Reading, line: string): void {
  const commit = COMMIT_LINE.exec(line)
  if (commit !== null) {
    const [, graph = '', word = '', hash = '', refs = ''] = commit
    const spans: Span[] = [
      { text: `${graph}${word}`, isDim: true },
      { text: hash, color: HASH_COLOR },
      { text: refs, color: REFS_COLOR },
    ]
    pushLine(
      reading,
      spans.filter((span) => span.text !== ''),
    )
    reading.isMessage = false
    reading.isSubjectDue = true
    return
  }
  const bare = line.replace(GRAPH, '')
  if (!reading.isMessage && META.test(bare)) {
    pushLine(reading, [{ text: line, isDim: true }])
    return
  }
  if (bare === '') {
    reading.isMessage = reading.isSubjectDue
    pushLine(reading, [{ text: line }])
    return
  }
  const isSubject = reading.isMessage && reading.isSubjectDue
  if (isSubject) reading.isSubjectDue = false
  pushLine(reading, [isSubject ? { text: line, isBold: true } : { text: line }])
}

function readLine(reading: Reading, line: string): void {
  if (readHunkLine(reading, line)) return
  if (readHunkHead(reading, line)) return
  if (startsFile(reading, line)) {
    closeFile(reading)
    reading.file = { kind: 'file', path: '', head: [line], hunks: [], isWhole: false }
    reading.isMessage = false
    return
  }
  if (reading.file !== null && reading.file.hunks.length === 0 && FILE_META.test(line)) {
    reading.file.head.push(line)
    return
  }
  closeFile(reading)
  readEntryLine(reading, line)
}

export function diffPieces(lines: readonly string[]): DiffPiece[] {
  const reading: Reading = {
    pieces: [],
    file: null,
    old: 0,
    added: 0,
    isMessage: false,
    isSubjectDue: false,
  }
  for (const line of lines) readLine(reading, line)
  closeFile(reading)
  return reading.pieces
}

function hunkLine(line: string): StyledLine {
  if (HUNK_HEAD.test(line)) return [{ text: line, color: HUNK_COLOR }]
  const mark = line.charAt(0)
  if (mark === '+') return [{ text: line, color: ADDED_COLOR }]
  if (mark === '-') return [{ text: line, color: REMOVED_COLOR }]
  if (mark === '\\') return [{ text: line, isDim: true }]
  return [{ text: line === '' ? ' ' : line }]
}

export function fileLines(file: DiffFile): StyledLine[] {
  return [
    ...file.head.map((line): StyledLine => [{ text: line, isBold: true }]),
    ...file.hunks.map(hunkLine),
  ]
}

export function pieceLines(pieces: readonly DiffPiece[]): StyledLine[] {
  return pieces.flatMap((piece) => (piece.kind === 'lines' ? piece.lines : fileLines(piece)))
}

export function oneLineLog(lines: readonly string[]): StyledLine[] {
  return lines.map((line): StyledLine => {
    const found = ONE_LINE.exec(line)
    if (found === null) return [{ text: line === '' ? ' ' : line, isDim: true }]
    const [, graph = '', hash = '', refs = '', subject = ''] = found
    const spans: Span[] = [
      { text: graph, isDim: true },
      { text: hash, color: HASH_COLOR },
      { text: refs, color: REFS_COLOR },
      { text: subject, isBold: true },
    ]
    return spans.filter((span) => span.text !== '')
  })
}
