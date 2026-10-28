import type { EngineInterface, ProcessRunResult } from 'claude-code'
import { type FileDiff, type Hunk, diffArgv, parseDiff } from './diff'
import { absolutePath } from './paths'
import { reasonOf } from './reason'
import { READ_LIMIT_BYTES, type SourceLines, isBinary, isMarkdown, sourceLines } from './source'
import type { ChangedEntry, GitLetter, GitMarks } from './status'
import { RUN_TIMEOUT_MS } from './watch'

export const FOLDER_FILES = 50

export type PreviewResult =
  | { kind: 'text'; source: SourceLines; isMarkdown: boolean }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'deleted' }

export type FileChange =
  | { kind: 'hunks'; hunks: readonly Hunk[]; added: number; removed: number }
  | { kind: 'new'; source: SourceLines }
  | { kind: 'new-folder' }
  | { kind: 'binary' }
  | { kind: 'none' }
  | { kind: 'too-large'; size: number }
  | { kind: 'unreadable'; reason: string }

export type ChangedFile = { path: string; letter: GitLetter | undefined; change: FileChange }

export type DiffResult =
  | {
      kind: 'files'
      files: readonly ChangedFile[]
      total: number
      isInitial: boolean
      isCut: boolean
    }
  | { kind: 'failed'; reason: string }

export type Look =
  | { kind: 'preview'; path: string; result: PreviewResult | undefined }
  | { kind: 'diff'; path: string; isFolder: boolean; result: DiffResult | undefined }

export type LookSite = { cwd: string; prefix: string; marks: GitMarks | undefined }

type DiffRun =
  | { kind: 'files'; files: readonly FileDiff[]; isCut: boolean }
  | { kind: 'no-head' }
  | { kind: 'failed'; reason: string }

type Read =
  | { kind: 'text'; text: string; size: number }
  | { kind: 'too-large'; size: number }
  | { kind: 'unreadable'; reason: string }

const TOO_LARGE = /\b4 ?MiB\b|too large|EFBIG/i
const NO_HEAD = /\bHEAD\b/
const NO_HEAD_EXIT = 128

function log($: EngineInterface, text: string): void {
  $.ui.log(`handily-filetree: ${text}`)
}

async function readText($: EngineInterface, cwd: string, path: string): Promise<Read> {
  const at = absolutePath(cwd, path)
  try {
    const { size } = await $.fs.stat(at)
    if (size > READ_LIMIT_BYTES) return { kind: 'too-large', size }
    return { kind: 'text', text: await $.fs.read(at), size }
  } catch (error) {
    log($, `cannot read ${path}: ${String(error)}`)
    if (TOO_LARGE.test(String(error))) return { kind: 'too-large', size: READ_LIMIT_BYTES }
    return { kind: 'unreadable', reason: reasonOf(error) }
  }
}

export async function loadPreview(
  $: EngineInterface,
  site: LookSite,
  path: string,
): Promise<PreviewResult> {
  if (site.marks?.letterOf(path) === 'D') return { kind: 'deleted' }
  const read = await readText($, site.cwd, path)
  if (read.kind !== 'text') return read
  if (isBinary(read.text)) return { kind: 'binary', size: read.size }
  return { kind: 'text', source: sourceLines(read.text), isMarkdown: isMarkdown(path) }
}

function topPath(prefix: string, path: string): string {
  return prefix === '' ? path : `${prefix}/${path}`
}

function failedReason(result: ProcessRunResult): string {
  return `exit ${String(result.exitCode)}`
}

async function runDiff(
  $: EngineInterface,
  cwd: string,
  paths: readonly string[],
): Promise<DiffRun> {
  const startedAt = await $.clock.now()
  try {
    const result = await $.process.run(diffArgv(paths), { cwd, timeoutMs: RUN_TIMEOUT_MS })
    if (result.exitCode === NO_HEAD_EXIT && NO_HEAD.test(result.stderr)) return { kind: 'no-head' }
    if (result.exitCode !== 0) {
      log($, `git diff exited ${String(result.exitCode)}: ${result.stderr.trim()}`)
      return { kind: 'failed', reason: failedReason(result) }
    }
    const isCut = result.isStdoutTruncated
    return { kind: 'files', files: parseDiff(result.stdout, isCut), isCut }
  } catch (error) {
    log($, `git diff did not run: ${String(error)}`)
    const tookMs = (await $.clock.now()) - startedAt
    const reason = tookMs >= RUN_TIMEOUT_MS ? 'no answer in 10 s' : 'it did not start'
    return { kind: 'failed', reason }
  }
}

async function addedChange($: EngineInterface, cwd: string, path: string): Promise<FileChange> {
  const read = await readText($, cwd, path)
  if (read.kind !== 'text') return read
  if (isBinary(read.text)) return { kind: 'binary' }
  return { kind: 'new', source: sourceLines(read.text) }
}

function hunksChange(diff: FileDiff | undefined): FileChange {
  if (diff === undefined) return { kind: 'none' }
  if (diff.isBinary) return { kind: 'binary' }
  if (diff.hunks.length === 0) return { kind: 'none' }
  return { kind: 'hunks', hunks: diff.hunks, added: diff.added, removed: diff.removed }
}

function targetsOf(site: LookSite, path: string, isFolder: boolean): readonly ChangedEntry[] {
  if (isFolder) return site.marks?.changedIn(path) ?? []
  const letter = site.marks?.letterOf(path)
  return [{ path, letter: letter ?? 'M', isFolder: false }]
}

function isReadWhole(entry: ChangedEntry, isInitial: boolean): boolean {
  return isInitial || entry.letter === '?'
}

export async function loadDiff(
  $: EngineInterface,
  site: LookSite,
  target: { path: string; isFolder: boolean },
): Promise<DiffResult> {
  const entries = targetsOf(site, target.path, target.isFolder)
  const shown = entries.slice(0, FOLDER_FILES)
  let isInitial = site.marks?.isInitial === true
  const tracked = shown.filter((entry) => !entry.isFolder && !isReadWhole(entry, isInitial))
  const run: DiffRun =
    tracked.length === 0
      ? { kind: 'files', files: [], isCut: false }
      : await runDiff(
          $,
          site.cwd,
          tracked.map((entry) => entry.path),
        )
  if (run.kind === 'failed') return run
  if (run.kind === 'no-head') isInitial = true
  const byName = new Map(run.kind === 'files' ? run.files.map((diff) => [diff.name, diff]) : [])
  const files: ChangedFile[] = []
  for (const entry of shown) {
    const letter = target.isFolder ? entry.letter : site.marks?.letterOf(entry.path)
    const change = entry.isFolder
      ? { kind: 'new-folder' as const }
      : isReadWhole(entry, isInitial)
        ? await addedChange($, site.cwd, entry.path)
        : hunksChange(byName.get(topPath(site.prefix, entry.path)))
    files.push({ path: entry.path, letter, change })
  }
  const isCut = run.kind === 'files' && run.isCut
  return { kind: 'files', files, total: entries.length, isInitial, isCut }
}
