import type { SimpleViewCall } from '../types'
import { bashChanges, contentLines, hunksOf, isRecord } from './output'

export const KEPT_CALLS = 50
export const PART_LIMIT = 8000

type Answer = { result?: unknown; text?: string; deny?: string; isError?: true }

export function capped(text: string, limit = PART_LIMIT): string {
  if (text.length <= limit) return text
  const left = text.length - limit
  return `${text.slice(0, limit)}\n[simple-view kept the first ${String(limit)} characters; ${String(left)} more were cut]`
}

function hunkText(hunks: ReturnType<typeof hunksOf>): string[] {
  return (hunks ?? []).flatMap((hunk) => [
    `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`,
    ...hunk.lines,
  ])
}

function fileDiff(path: string, hunks: ReturnType<typeof hunksOf>): string[] {
  const body = hunkText(hunks)
  return body.length === 0 ? [] : [`--- ${path}`, `+++ ${path}`, ...body]
}

function createdDiff(path: string, content: string): string[] {
  const lines = contentLines(content)
  return [
    '--- /dev/null',
    `+++ ${path}`,
    `@@ -0,0 +1,${String(lines.length)} @@`,
    ...lines.map((line) => `+${line}`),
  ]
}

export function diffText(result: unknown): string {
  if (!isRecord(result)) return ''
  if (typeof result.filePath === 'string') {
    const hunks = hunksOf(result.structuredPatch)
    if (hunks?.length === 0 && result.type === 'create' && typeof result.content === 'string') {
      return createdDiff(result.filePath, result.content).join('\n')
    }
    return fileDiff(result.filePath, hunks).join('\n')
  }
  const diff = result.bashEditDiff
  if (!isRecord(diff) || !Array.isArray(diff.files)) return ''
  const lines = diff.files.flatMap((file: unknown) =>
    isRecord(file) && typeof file.filePath === 'string'
      ? fileDiff(file.filePath, hunksOf(file.hunks))
      : [],
  )
  if (typeof diff.moreFiles === 'number' && diff.moreFiles > 0) {
    lines.push(`(${String(diff.moreFiles)} more changed files have no diff here)`)
  }
  return lines.join('\n')
}

function savedNote(result: unknown): string {
  if (!isRecord(result) || typeof result.persistedOutputPath !== 'string') return ''
  return `Full output saved to ${result.persistedOutputPath}\n\n`
}

function outputText(answer: Answer): string {
  if (answer.deny !== undefined) return `Refused: ${answer.deny}`
  if (answer.text !== undefined) return `${savedNote(answer.result)}${answer.text}`
  if (typeof answer.result === 'string') return answer.result
  return JSON.stringify(answer.result ?? null, null, 2)
}

export type CallFacts = {
  generation: number
  seq: number
  tool_use_id: string
  tool: string
  input: Record<string, unknown>
  answer: Answer
  elapsedMs: number
}

function isDiffUnreported(facts: CallFacts): boolean {
  return facts.tool === 'Bash' && bashChanges(facts.answer.result)?.kind === 'unreported'
}

export function callRecord(facts: CallFacts): SimpleViewCall {
  return {
    generation: facts.generation,
    seq: facts.seq,
    tool_use_id: facts.tool_use_id,
    tool: facts.tool,
    input: capped(JSON.stringify(facts.input, null, 2)),
    output: capped(outputText(facts.answer)),
    diff: isDiffUnreported(facts) ? null : capped(diffText(facts.answer.result)),
    isErrored: facts.answer.deny !== undefined || facts.answer.isError === true,
    elapsedMs: facts.elapsedMs,
  }
}

export function slotOf(seq: number): string {
  return String(seq % KEPT_CALLS)
}

function fenced(language: string, text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${text}\n${fence}`
}

export function elapsedText(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`
}

function diffHeading(diff: string | null): string {
  if (diff === null) return 'File diff: not reported by the engine.'
  return diff === '' ? 'File diff: none.' : 'File diff:'
}

export function showText(call: SimpleViewCall, back: number, kept: number): string {
  const ending = call.isErrored ? 'errored' : 'answered'
  return [
    `Call ${String(back)} of the last ${String(kept)} (1 is the last): ${call.tool}, ${ending}, ${elapsedText(call.elapsedMs)}`,
    'Input:',
    fenced('json', call.input),
    'Output:',
    fenced('text', call.output),
    diffHeading(call.diff),
    ...(call.diff === null || call.diff === '' ? [] : [fenced('diff', call.diff)]),
  ].join('\n\n')
}
