import type { EngineInterface, ProcessRunResult, Timer } from 'claude-code'
import { FILES_PANE } from './commands'
import { type GitRepo, branchOf, findRepo, joinPath } from './repo'
import { type GitStatus, parseStatus, statusArgv } from './status'

const POLL_MS = 2000
const RUN_GAP_MS = 2000
export const RUN_TIMEOUT_MS = 10_000
export const SLOW_MS = 5000
const RETRY_MS = 10_000
const SLOW_RUNS_BEFORE_NO_UNTRACKED = 2

const NOT_ON_PATH = /ENOENT|not found|no such file|cannot find/i
const NO_FILE = 'none'

export type GitFailure =
  { kind: 'exit'; exitCode: number } | { kind: 'timeout' } | { kind: 'did-not-run' }

export type ShownStatus = { status: GitStatus; at: number }

type Stamps = { index: string; head: string }

export type GitWatch = {
  cwd: string | undefined
  repo: GitRepo | null | undefined
  branch: string | undefined
  stamps: Stamps | undefined
  shown: ShownStatus | undefined
  failure: GitFailure | undefined
  failures: number
  isGitMissing: boolean
  isRunning: boolean
  isSlow: boolean
  isWanted: boolean
  isStale: boolean
  lastStartAt: number | undefined
  slowRuns: number
  isUntrackedSkipped: boolean
  retryAt: number | undefined
  wasFocused: boolean | undefined
  poll: Timer | undefined
  gap: Timer | undefined
  retry: Timer | undefined
  slowMark: Timer | undefined
}

export function newWatch(): GitWatch {
  return {
    cwd: undefined,
    repo: undefined,
    branch: undefined,
    stamps: undefined,
    shown: undefined,
    failure: undefined,
    failures: 0,
    isGitMissing: false,
    isRunning: false,
    isSlow: false,
    isWanted: false,
    isStale: false,
    lastStartAt: undefined,
    slowRuns: 0,
    isUntrackedSkipped: false,
    retryAt: undefined,
    wasFocused: undefined,
    poll: undefined,
    gap: undefined,
    retry: undefined,
    slowMark: undefined,
  }
}

function log($: EngineInterface, text: string): void {
  $.ui.log(`handily-filetree: ${text}`)
}

function redraw($: EngineInterface): void {
  $.ui.invalidate('ui.render')
}

export function stopWatch(watch: GitWatch): void {
  if (watch.gap !== undefined || watch.retry !== undefined) watch.isStale = true
  for (const timer of [watch.poll, watch.gap, watch.retry]) timer?.cancel()
  watch.poll = undefined
  watch.gap = undefined
  watch.retry = undefined
  watch.retryAt = undefined
}

export function resetWatch(watch: GitWatch): void {
  stopWatch(watch)
  watch.slowMark?.cancel()
  Object.assign(watch, newWatch())
}

export function forgetRepo(watch: GitWatch): void {
  stopWatch(watch)
  watch.repo = undefined
  watch.isGitMissing = false
  watch.failures = 0
  watch.isStale = true
}

async function stampOf($: EngineInterface, path: string): Promise<string> {
  try {
    const { size, mtimeMs } = await $.fs.stat(path)
    return `${String(mtimeMs)} ${String(size)}`
  } catch {
    return NO_FILE
  }
}

async function readStamps($: EngineInterface, repo: GitRepo): Promise<Stamps> {
  return {
    index: await stampOf($, joinPath(repo.gitDir, 'index')),
    head: await stampOf($, joinPath(repo.gitDir, 'HEAD')),
  }
}

async function readBranch($: EngineInterface, repo: GitRepo): Promise<string | undefined> {
  try {
    return branchOf(await $.fs.read(joinPath(repo.gitDir, 'HEAD')))
  } catch (error) {
    log($, `cannot read HEAD: ${String(error)}`)
    return undefined
  }
}

export async function syncRepo($: EngineInterface, watch: GitWatch, cwd: string): Promise<void> {
  if (watch.cwd !== cwd) {
    resetWatch(watch)
    watch.cwd = cwd
  }
  if (watch.repo !== undefined) return
  const fs = {
    stat: (path: string) => $.fs.stat(path).catch(() => undefined),
    read: (path: string) => $.fs.read(path),
  }
  watch.repo =
    (await findRepo(fs, cwd).catch((error: unknown) => {
      log($, `cannot read the git folder: ${String(error)}`)
      return undefined
    })) ?? null
  if (watch.repo === null) watch.shown = undefined
}

async function isFilesShown($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some((pane) => pane.id === FILES_PANE.id && pane.isShown)
}

async function checkStamps($: EngineInterface, watch: GitWatch): Promise<boolean> {
  const repo = watch.repo
  if (repo === null || repo === undefined) return false
  const stamps = await readStamps($, repo)
  const before = watch.stamps
  watch.stamps = stamps
  if (before?.head !== stamps.head) watch.branch = await readBranch($, repo)
  return before?.index !== stamps.index || before.head !== stamps.head
}

async function tick($: EngineInterface, watch: GitWatch): Promise<void> {
  if (!(await isFilesShown($))) {
    stopWatch(watch)
    return
  }
  if (await checkStamps($, watch)) requestStatus($, watch)
  if (watch.retryAt !== undefined) redraw($)
}

async function beginWatch($: EngineInterface, watch: GitWatch): Promise<void> {
  const hasChanged = await checkStamps($, watch)
  if (hasChanged || watch.isStale || watch.lastStartAt === undefined) {
    watch.isStale = false
    requestStatus($, watch)
  }
}

export function watchShown($: EngineInterface, watch: GitWatch): void {
  if (watch.repo === null || watch.repo === undefined || watch.poll !== undefined) return
  watch.poll = $.clock.every(POLL_MS, () => {
    tick($, watch).catch((error: unknown) => {
      log($, `the git poll failed: ${String(error)}`)
    })
  })
  beginWatch($, watch).catch((error: unknown) => {
    log($, `the git watch did not start: ${String(error)}`)
  })
}

export function noticeFocus($: EngineInterface, watch: GitWatch, isFocused: boolean): void {
  const wasFocused = watch.wasFocused
  watch.wasFocused = isFocused
  if (wasFocused === false && isFocused) requestStatus($, watch)
}

function failureOf(error: unknown, tookMs: number): GitFailure | 'missing' {
  if (NOT_ON_PATH.test(String(error))) return 'missing'
  return tookMs >= RUN_TIMEOUT_MS ? { kind: 'timeout' } : { kind: 'did-not-run' }
}

function scheduleRetry($: EngineInterface, watch: GitWatch, now: number): void {
  watch.retry?.cancel()
  watch.retryAt = now + RETRY_MS
  watch.retry = $.clock.after(RETRY_MS, () => {
    watch.retry = undefined
    watch.retryAt = undefined
    requestStatus($, watch)
  })
}

function fail($: EngineInterface, watch: GitWatch, failure: GitFailure, now: number): void {
  watch.failure = failure
  watch.failures += 1
  if (watch.failures === 1) scheduleRetry($, watch, now)
}

function settle(
  $: EngineInterface,
  watch: GitWatch,
  outcome: { result: ProcessRunResult } | { error: unknown },
  timing: { startedAt: number; endedAt: number },
): void {
  if ('error' in outcome) {
    log($, `git status did not run: ${String(outcome.error)}`)
    const failure = failureOf(outcome.error, timing.endedAt - timing.startedAt)
    if (failure === 'missing') watch.isGitMissing = true
    else fail($, watch, failure, timing.endedAt)
    return
  }
  const { result } = outcome
  if (result.exitCode !== 0) {
    log($, `git status exited ${String(result.exitCode)}: ${result.stderr.trim()}`)
    fail($, watch, { kind: 'exit', exitCode: result.exitCode }, timing.endedAt)
    return
  }
  watch.shown = { status: parseStatus(result.stdout, result.isStdoutTruncated), at: timing.endedAt }
  watch.failure = undefined
  watch.failures = 0
  watch.retry?.cancel()
  watch.retry = undefined
  watch.retryAt = undefined
}

function countSlowRun(watch: GitWatch, tookMs: number): void {
  if (tookMs <= SLOW_MS) return
  watch.slowRuns += 1
  if (watch.slowRuns >= SLOW_RUNS_BEFORE_NO_UNTRACKED) watch.isUntrackedSkipped = true
}

async function runStatus($: EngineInterface, watch: GitWatch, startedAt: number): Promise<void> {
  watch.lastStartAt = startedAt
  watch.isSlow = false
  const slowMark = $.clock.after(SLOW_MS, () => {
    watch.isSlow = true
    redraw($)
  })
  watch.slowMark = slowMark
  const { cwd } = watch
  const argv = statusArgv(watch.isUntrackedSkipped)
  const outcome = await $.process.run(argv, { cwd, timeoutMs: RUN_TIMEOUT_MS }).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  )
  const endedAt = await $.clock.now()
  slowMark.cancel()
  if (watch.cwd !== cwd) return
  watch.slowMark = undefined
  watch.isSlow = false
  countSlowRun(watch, endedAt - startedAt)
  settle($, watch, outcome, { startedAt, endedAt })
}

async function startRun($: EngineInterface, watch: GitWatch): Promise<void> {
  try {
    const now = await $.clock.now()
    const wait = watch.lastStartAt === undefined ? 0 : watch.lastStartAt + RUN_GAP_MS - now
    if (wait > 0) {
      watch.gap = $.clock.after(wait, () => {
        watch.gap = undefined
        requestStatus($, watch)
      })
      return
    }
    await runStatus($, watch, now)
    redraw($)
  } finally {
    watch.isRunning = false
  }
  if (watch.isWanted) {
    watch.isWanted = false
    requestStatus($, watch)
  }
}

export function requestStatus($: EngineInterface, watch: GitWatch): void {
  if (watch.repo === null || watch.repo === undefined || watch.isGitMissing) return
  if (watch.poll === undefined) {
    watch.isStale = true
    return
  }
  if (watch.gap !== undefined) return
  if (watch.isRunning) {
    watch.isWanted = true
    return
  }
  watch.isRunning = true
  startRun($, watch).catch((error: unknown) => {
    log($, `git status failed: ${String(error)}`)
  })
}
