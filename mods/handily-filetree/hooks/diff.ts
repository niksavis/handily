import { gitUnquoted } from './quoting'
import { type Budget, drawable, takenLines } from './source'

export type Hunk = { text: string; lines: number }

export type FileDiff = {
  name: string
  hunks: readonly Hunk[]
  added: number
  removed: number
  isBinary: boolean
}

export type CutHunk = { shownLines: number; lines: number }

export type TakenDiff = { source: string; shownHunks: number; cut: CutHunk | undefined }

const FILE_START = 'diff --git '
const OLD_PREFIX = 'a/'
const NEW_PREFIX = 'b/'
const OLD_MARKER = '--- '
const NEW_MARKER = '+++ '
const NO_FILE = '/dev/null'
const TRAILING_TAB = /\t$/
const BINARY = 'Binary files '
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/
const HUNK_STARTS = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
const NO_NEWLINE = '\\'
const SHOWN_HEADER_LINES = 1

export function diffArgv(paths: readonly string[]): readonly string[] {
  return [
    'git',
    '-c',
    'core.quotePath=false',
    '--literal-pathspecs',
    'diff',
    'HEAD',
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    `--src-prefix=${OLD_PREFIX}`,
    `--dst-prefix=${NEW_PREFIX}`,
    '--no-relative',
    '--',
    ...paths,
  ]
}

type OpenHunk = { lines: string[]; old: number; new: number; added: number; removed: number }

type OpenFile = {
  header: string
  oldName: string | undefined
  newName: string | undefined
  hunks: Hunk[]
  added: number
  removed: number
  isBinary: boolean
}

function withoutPrefix(path: string, prefix: string): string | undefined {
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined
}

function nameOfHeader(header: string): string | undefined {
  const rest = header.slice(FILE_START.length)
  const quoted = gitUnquoted(rest, 0)
  if (quoted !== undefined) return withoutPrefix(quoted.value, OLD_PREFIX)
  const named = withoutPrefix(rest, OLD_PREFIX)
  if (named === undefined) return undefined
  const half = (named.length - ` ${NEW_PREFIX}`.length) / 2
  const name = named.slice(0, half)
  return Number.isInteger(half) && named === `${name} ${NEW_PREFIX}${name}` ? name : undefined
}

function nameOfMarker(line: string, marker: string, prefix: string): string | undefined {
  if (!line.startsWith(marker)) return undefined
  const rest = line.slice(marker.length).replace(TRAILING_TAB, '')
  if (rest === NO_FILE) return undefined
  return withoutPrefix(gitUnquoted(rest, 0)?.value ?? rest, prefix)
}

function nameOf(file: OpenFile): string {
  return (
    nameOfHeader(file.header) ??
    file.newName ??
    file.oldName ??
    file.header.slice(FILE_START.length)
  )
}

function closed(file: OpenFile): FileDiff {
  return {
    name: nameOf(file),
    hunks: file.hunks,
    added: file.added,
    removed: file.removed,
    isBinary: file.isBinary,
  }
}

function countOf(group: string | undefined): number {
  return group === undefined ? 1 : Number(group)
}

function isDone(hunk: OpenHunk): boolean {
  return hunk.old <= 0 && hunk.new <= 0
}

function addLine(hunk: OpenHunk, line: string): void {
  hunk.lines.push(line)
  switch (line[0]) {
    case '+':
      hunk.new -= 1
      hunk.added += 1
      break
    case '-':
      hunk.old -= 1
      hunk.removed += 1
      break
    case NO_NEWLINE:
      break
    default:
      hunk.old -= 1
      hunk.new -= 1
  }
}

function keep(file: OpenFile, hunk: OpenHunk): void {
  const text = drawable(hunk.lines.join('\n'))
  file.hunks.push({ text, lines: hunk.lines.length })
  file.added += hunk.added
  file.removed += hunk.removed
}

function readHeaderLine(file: OpenFile, line: string): OpenHunk | undefined {
  const counts = HUNK_HEADER.exec(line)
  if (counts !== null) {
    return { lines: [line], old: countOf(counts[1]), new: countOf(counts[2]), added: 0, removed: 0 }
  }
  if (line.startsWith(BINARY)) file.isBinary = true
  file.oldName ??= nameOfMarker(line, OLD_MARKER, OLD_PREFIX)
  file.newName ??= nameOfMarker(line, NEW_MARKER, NEW_PREFIX)
  return undefined
}

function newFile(header: string): OpenFile {
  return {
    header,
    oldName: undefined,
    newName: undefined,
    hunks: [],
    added: 0,
    removed: 0,
    isBinary: false,
  }
}

function wholeLines(stdout: string, isTruncated: boolean): string[] {
  const lines = stdout.split('\n')
  if (isTruncated || lines.at(-1) === '') lines.pop()
  return lines
}

export function parseDiff(stdout: string, isTruncated: boolean): FileDiff[] {
  const files: FileDiff[] = []
  let file: OpenFile | undefined
  let hunk: OpenHunk | undefined
  for (const line of wholeLines(stdout, isTruncated)) {
    if (hunk !== undefined && file !== undefined) {
      if (!isDone(hunk) || line.startsWith(NO_NEWLINE)) {
        addLine(hunk, line)
        continue
      }
      keep(file, hunk)
      hunk = undefined
    }
    if (line.startsWith(FILE_START)) {
      if (file !== undefined) files.push(closed(file))
      file = newFile(line)
      continue
    }
    if (file !== undefined) hunk = readHeaderLine(file, line)
  }
  if (file !== undefined && hunk !== undefined && isDone(hunk)) keep(file, hunk)
  if (file !== undefined) files.push(closed(file))
  return files
}

function countedLines(lines: readonly string[], kinds: string): number {
  return lines.filter((line) => kinds.includes(line.charAt(0))).length
}

function cutHunk(hunk: Hunk, budget: Budget): { text: string; cut: CutHunk } | undefined {
  const [header = '', ...body] = hunk.text.split('\n')
  const starts = HUNK_STARTS.exec(header)
  if (starts === null || budget.lines <= SHOWN_HEADER_LINES) return undefined
  const room = {
    lines: budget.lines - SHOWN_HEADER_LINES,
    characters: budget.characters - header.length - 1,
  }
  const taken = takenLines(body, room)
  if (taken.length === 0) return undefined
  const [, oldStart = '', newStart = '', context = ''] = starts
  const old = countedLines(taken, ' -')
  const added = countedLines(taken, ' +')
  const shownHeader = `@@ -${oldStart},${String(old)} +${newStart},${String(added)} @@${context}`
  budget.lines = room.lines
  budget.characters = room.characters
  return {
    text: [shownHeader, ...taken].join('\n'),
    cut: { shownLines: taken.length, lines: body.length },
  }
}

export function takenHunks(hunks: readonly Hunk[], budget: Budget): TakenDiff {
  const taken: string[] = []
  for (const hunk of hunks) {
    const characters = hunk.text.length + 1
    if (hunk.lines > budget.lines || characters > budget.characters) {
      const cut = taken.length === 0 ? cutHunk(hunk, budget) : undefined
      if (cut === undefined) break
      return { source: cut.text, shownHunks: 1, cut: cut.cut }
    }
    taken.push(hunk.text)
    budget.lines -= hunk.lines
    budget.characters -= characters
  }
  return { source: taken.join('\n'), shownHunks: taken.length, cut: undefined }
}
