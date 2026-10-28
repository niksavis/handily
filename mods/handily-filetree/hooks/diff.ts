import { type Budget, drawable } from './source'

export type Hunk = { text: string; lines: number }

export type FileDiff = {
  name: string
  hunks: readonly Hunk[]
  added: number
  removed: number
  isBinary: boolean
}

export type TakenDiff = { source: string; shownHunks: number }

const FILE_START = 'diff --git '
const NAMED = 'diff --git a/'
const OLD_NAME = '--- a/'
const NEW_NAME = '+++ b/'
const BINARY = 'Binary files '
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/
const NO_NEWLINE = '\\'

export function diffArgv(paths: readonly string[]): readonly string[] {
  return ['git', 'diff', 'HEAD', '--no-color', '--no-ext-diff', '--', ...paths]
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

function nameOfHeader(header: string): string | undefined {
  if (!header.startsWith(NAMED)) return undefined
  const rest = header.slice(NAMED.length)
  const half = (rest.length - ' b/'.length) / 2
  const name = rest.slice(0, half)
  return Number.isInteger(half) && rest === `${name} b/${name}` ? name : undefined
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
  if (line.startsWith(OLD_NAME)) file.oldName = line.slice(OLD_NAME.length)
  if (line.startsWith(NEW_NAME)) file.newName = line.slice(NEW_NAME.length)
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

export function takenHunks(hunks: readonly Hunk[], budget: Budget): TakenDiff {
  const taken: string[] = []
  for (const hunk of hunks) {
    const characters = hunk.text.length + 1
    if (hunk.lines > budget.lines || characters > budget.characters) break
    taken.push(hunk.text)
    budget.lines -= hunk.lines
    budget.characters -= characters
  }
  return { source: taken.join('\n'), shownHunks: taken.length }
}
