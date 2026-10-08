const EXIT_PREFIX = /^Error: Exit code (\d+)[^\n]*(?:\n|$)/

export type Totals = { added: number; removed: number }

export type StderrSummary = { lines: number; first: string }

export type BashEnd =
  | {
      kind: 'done'
      lines: number
      interpretation: string | null
      stderr: StderrSummary | null
      savedTo: string | null
    }
  | { kind: 'exit'; code: number; line: string }

export type FileChange = { path: string; verb: 'Updated' | 'Created' | 'Deleted'; totals: Totals }

export type BashChanges =
  { isTracked: true; files: FileChange[]; moreFiles: number } | { isTracked: false }

export type FileEdit = { path: string; totals: Totals | null }

type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHunk(value: unknown): value is Hunk {
  return (
    isRecord(value) &&
    typeof value.oldStart === 'number' &&
    typeof value.oldLines === 'number' &&
    typeof value.newStart === 'number' &&
    typeof value.newLines === 'number' &&
    Array.isArray(value.lines) &&
    value.lines.every((line) => typeof line === 'string')
  )
}

export function hunksOf(value: unknown): Hunk[] | null {
  if (!Array.isArray(value) || !value.every(isHunk)) return null
  return value
}

export function totalsOf(hunks: readonly Hunk[]): Totals {
  const lines = hunks.flatMap((hunk) => hunk.lines)
  return {
    added: lines.filter((line) => line.startsWith('+')).length,
    removed: lines.filter((line) => line.startsWith('-')).length,
  }
}

export function lineCount(text: string): number {
  const kept = text.trimEnd()
  return kept === '' ? 0 : kept.split(/\r?\n/).length
}

export function contentLines(content: string): string[] {
  return content === '' ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/)
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  )
}

function stderrSummary(stderr: unknown): StderrSummary | null {
  if (typeof stderr !== 'string' || stderr.trim() === '') return null
  return { lines: lineCount(stderr.trim()), first: firstNonEmptyLine(stderr) }
}

export function bashEnd(output: unknown, isErrored: boolean): BashEnd | null {
  if (isErrored) {
    if (typeof output !== 'string') return null
    const found = EXIT_PREFIX.exec(output)
    if (found?.[1] === undefined) return null
    return {
      kind: 'exit',
      code: Number(found[1]),
      line: firstNonEmptyLine(output.slice(found[0].length)),
    }
  }
  if (!isRecord(output) || typeof output.stdout !== 'string') return null
  if (output.interrupted !== false || output.isImage === true) return null
  if (output.backgroundTaskId !== undefined) return null
  const { returnCodeInterpretation: interpretation, persistedOutputPath: savedTo } = output
  return {
    kind: 'done',
    lines: lineCount(output.stdout),
    interpretation: typeof interpretation === 'string' ? interpretation : null,
    stderr: stderrSummary(output.stderr),
    savedTo: typeof savedTo === 'string' ? savedTo : null,
  }
}

function fileChange(value: unknown): FileChange | null {
  if (!isRecord(value) || typeof value.filePath !== 'string') return null
  const hunks = hunksOf(value.hunks)
  if (hunks === null) return null
  const verb = value.created === true ? 'Created' : value.deleted === true ? 'Deleted' : 'Updated'
  return { path: value.filePath, verb, totals: totalsOf(hunks) }
}

export function bashChanges(output: unknown): BashChanges | null {
  if (!isRecord(output)) return null
  const diff = output.bashEditDiff
  if (diff === undefined) return { isTracked: true, files: [], moreFiles: 0 }
  if (!isRecord(diff)) return null
  if (diff.unavailable === true || diff.skipped === true) return { isTracked: false }
  if (!Array.isArray(diff.files) || typeof diff.moreFiles !== 'number') return null
  const files = diff.files.map(fileChange)
  if (!files.every((file) => file !== null)) return null
  return { isTracked: true, files, moreFiles: diff.moreFiles }
}

function writeTotals(output: Record<string, unknown>, hunks: readonly Hunk[]): Totals | null {
  if (typeof output.content !== 'string') return null
  if (hunks.length > 0) return totalsOf(hunks)
  if (output.type === 'create') return { added: contentLines(output.content).length, removed: 0 }
  if (output.originalFile === output.content) return { added: 0, removed: 0 }
  return null
}

export function fileEdit(tool: string, output: unknown): FileEdit | null {
  if (!isRecord(output) || typeof output.filePath !== 'string') return null
  if (output.staged === true) return null
  const hunks = hunksOf(output.structuredPatch)
  if (hunks === null) return null
  if (tool === 'Edit') {
    return { path: output.filePath, totals: hunks.length > 0 ? totalsOf(hunks) : null }
  }
  if (tool === 'Write') return { path: output.filePath, totals: writeTotals(output, hunks) }
  return null
}

export function shownPath(path: string, root: string): string {
  const base = root.replace(/[\\/]+$/, '')
  const separator = path.charAt(base.length)
  if (base !== '' && path.startsWith(base) && (separator === '/' || separator === '\\')) {
    return path.slice(base.length + 1)
  }
  return path
}
