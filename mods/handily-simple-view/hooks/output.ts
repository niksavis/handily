import type { SimpleViewDiffGap } from '../types'
import { shownLine, shownText } from './shown'

const EXIT_PREFIX = /^Error: Exit code (\d+)[^\n]*(?:\n|$)/
const HOOK_REFUSAL_PREFIX = /^Error: \w+:\S+ hook error: \[[^\n]*?\]: /
const ERROR_PREFIX = 'Error: '
const CLASSIFIER_DENIAL =
  /^Error: Permission for this action was denied by the Claude Code auto mode classifier\. Reason: (?:\[([^\]\r\n]+)\]|The server-side auto mode classifier judged this action dangerous \(it gave no explanation\))\.(?: |$)/
const RULE_DENIAL = /^(?:Error: )?Permission to use \S+ with command [\s\S]+ has been denied\.$/
const PERSON_DENIAL = /^(?:Error: )?The user doesn't want to proceed with this tool use\.(?:\s|$)/

export const FILE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])

export type Totals = { added: number; removed: number }

export type StderrSummary = { lines: number; first: string }

export type ErrorEnd = { kind: 'exit'; code: number } | { kind: 'refused' } | { kind: 'error' }

export type ErroredOutput = { end: ErrorEnd; body: string }

export type Denier = 'classifier' | 'rule' | 'person'

export type Denial = { kind: 'denied'; denier: Denier; reason: string | null }

export type BashEnd =
  | {
      kind: 'done'
      lines: number
      interpretation: string | null
      stderr: StderrSummary | null
      savedTo: string | null
    }
  | (ErrorEnd & { line: string })
  | Denial

export type FileChange = { path: string; verb: 'Updated' | 'Created' | 'Deleted'; totals: Totals }

export type BashChanges =
  | { kind: 'tracked'; files: FileChange[]; moreFiles: number }
  | { kind: 'untracked' }
  | { kind: 'unreported' }

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
  for (const line of text.split(/\r?\n/)) {
    const shown = shownLine(line).trim()
    if (shown !== '') return shown
  }
  return ''
}

function stderrSummary(stderr: unknown): StderrSummary | null {
  if (typeof stderr !== 'string' || stderr.trim() === '') return null
  return { lines: lineCount(stderr.trim()), first: firstNonEmptyLine(stderr) }
}

export function erroredOutput(output: unknown): ErroredOutput | null {
  if (typeof output !== 'string') return null
  const exit = EXIT_PREFIX.exec(output)
  if (exit?.[1] !== undefined) {
    return { end: { kind: 'exit', code: Number(exit[1]) }, body: output.slice(exit[0].length) }
  }
  const refusal = HOOK_REFUSAL_PREFIX.exec(output)
  if (refusal !== null) return { end: { kind: 'refused' }, body: output.slice(refusal[0].length) }
  if (!output.startsWith(ERROR_PREFIX)) return null
  return { end: { kind: 'error' }, body: output.slice(ERROR_PREFIX.length) }
}

export function refusalLine(output: unknown): string | null {
  const errored = erroredOutput(output)
  return errored?.end.kind === 'refused' ? firstNonEmptyLine(errored.body) : null
}

export function deniedCall(output: unknown): Denial | null {
  if (typeof output !== 'string') return null
  if (RULE_DENIAL.test(output)) return { kind: 'denied', denier: 'rule', reason: null }
  if (PERSON_DENIAL.test(output)) return { kind: 'denied', denier: 'person', reason: null }
  const denial = CLASSIFIER_DENIAL.exec(output)
  if (denial === null) return null
  const reason = denial[1]
  return {
    kind: 'denied',
    denier: 'classifier',
    reason: reason === undefined ? null : shownText(reason),
  }
}

export function bashEnd(output: unknown, isErrored: boolean): BashEnd | null {
  if (isErrored) {
    const denial = deniedCall(output)
    if (denial !== null) return denial
    const errored = erroredOutput(output)
    if (errored === null) return null
    return { ...errored.end, line: firstNonEmptyLine(errored.body) }
  }
  if (!isRecord(output) || typeof output.stdout !== 'string') return null
  if (output.interrupted !== false || output.isImage === true) return null
  if (output.backgroundTaskId !== undefined) return null
  const { returnCodeInterpretation: interpretation, persistedOutputPath: savedTo } = output
  return {
    kind: 'done',
    lines: lineCount(output.stdout),
    interpretation: typeof interpretation === 'string' ? shownText(interpretation) : null,
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
  if (diff === undefined) return { kind: 'unreported' }
  if (!isRecord(diff)) return null
  if (diff.unavailable === true || diff.skipped === true) return { kind: 'untracked' }
  if (!Array.isArray(diff.files) || typeof diff.moreFiles !== 'number') return null
  const files = diff.files.map(fileChange)
  if (!files.every((file) => file !== null)) return null
  return { kind: 'tracked', files, moreFiles: diff.moreFiles }
}

export function diffGap(tool: string, output: unknown): SimpleViewDiffGap | null {
  if (tool !== 'Bash') return null
  const changes = bashChanges(output)
  if (changes === null) return 'unreported'
  return changes.kind === 'tracked' ? null : changes.kind
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
  if (base !== '' && path.replace(/[\\/]+$/, '') === base) return '.'
  const separator = path.charAt(base.length)
  if (base !== '' && path.startsWith(base) && (separator === '/' || separator === '\\')) {
    return shownText(path.slice(base.length + 1))
  }
  return shownText(path)
}
