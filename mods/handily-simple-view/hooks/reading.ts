import { isRecord, shownPath } from './output'

export const READING_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob'])

type Noun = { one: string; many: string }

const LINES: Noun = { one: 'line', many: 'lines' }
const FILES: Noun = { one: 'file', many: 'files' }
const MATCHES: Noun = { one: 'match', many: 'matches' }

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function counted(count: number, noun: Noun): string {
  return `${String(count)} ${count === 1 ? noun.one : noun.many}`
}

function shownOfTotal(shown: number, total: unknown, noun: Noun): string {
  if (!isCount(total) || total <= shown) return counted(shown, noun)
  return `${String(shown)} of ${counted(total, noun)}`
}

function readCount(output: unknown): string | null {
  if (!isRecord(output) || output.type !== 'text' || !isRecord(output.file)) return null
  const { numLines, startLine, totalLines } = output.file
  if (!isCount(numLines) || !isCount(startLine) || !isCount(totalLines)) return null
  const isWholeFile = startLine <= 1 && numLines >= totalLines
  if (isWholeFile || numLines === 0) return counted(numLines, LINES)
  const lastLine = startLine + numLines - 1
  return `lines ${String(startLine)}-${String(lastLine)} of ${String(totalLines)}`
}

function grepCount(output: unknown): string | null {
  if (!isRecord(output)) return null
  switch (output.mode) {
    case 'content':
      return isCount(output.numLines)
        ? shownOfTotal(output.numLines, output.totalLines, LINES)
        : null
    case 'count':
      return isCount(output.numMatches) ? counted(output.numMatches, MATCHES) : null
    case 'files_with_matches':
      return isCount(output.numFiles)
        ? shownOfTotal(output.numFiles, output.totalFiles, FILES)
        : null
    default:
      return null
  }
}

function globCount(output: unknown): string | null {
  if (!isRecord(output) || !isCount(output.numFiles) || typeof output.truncated !== 'boolean') {
    return null
  }
  const total = isCount(output.totalMatches) ? output.totalMatches : output.numFiles
  const isFloor =
    output.countIsComplete === false || (output.truncated && output.totalMatches === undefined)
  return isFloor ? `${String(total)}+ ${FILES.many}` : counted(total, FILES)
}

export function readingCount(tool: string, output: unknown): string | null {
  switch (tool) {
    case 'Read':
      return readCount(output)
    case 'Grep':
      return grepCount(output)
    case 'Glob':
      return globCount(output)
    default:
      return null
  }
}

function searchTarget(pattern: string, input: Record<string, unknown>, root: string): string[] {
  if (typeof input.path !== 'string') return [pattern]
  return [pattern, `in ${shownPath(input.path, root)}`]
}

export function streamingTarget(tool: string, input: unknown, root: string): string[] | null {
  if (!isRecord(input)) return null
  const named = tool === 'Read' ? input.file_path : input.pattern
  if (named !== undefined && typeof named !== 'string') return null
  if (tool === 'Read') return named === undefined ? [] : [shownPath(named, root)]
  if (input.path !== undefined && typeof input.path !== 'string') return null
  if (named === undefined) return []
  return searchTarget(tool === 'Grep' ? `"${named}"` : named, input, root)
}

export function readingTarget(
  tool: string,
  input: unknown,
  output: unknown,
  root: string,
): string[] | null {
  if (tool === 'Read') {
    if (!isRecord(output) || !isRecord(output.file)) return null
    const { filePath } = output.file
    return typeof filePath === 'string' ? [shownPath(filePath, root)] : null
  }
  const target = streamingTarget(tool, input, root)
  return target === null || target.length === 0 ? null : target
}
