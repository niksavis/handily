import { type GitMarks, type GitStatus, gitMarks } from './status'
import { type GitFailure, type GitWatch, RUN_TIMEOUT_MS, SLOW_MS } from './watch'

export type NoteTone = 'plain' | 'dim' | 'error' | 'warning'

export type NoteLine = { text: string; tone: NoteTone; hasRetry: boolean }

export type GitView = {
  header: string
  notes: readonly NoteLine[]
  footer: readonly NoteLine[]
  marks: GitMarks | undefined
  isRepo: boolean
}

const SECOND_MS = 1000
const MINUTE_S = 60
const HOUR_S = 3600

function line(text: string, tone: NoteTone, hasRetry = false): NoteLine {
  return { text, tone, hasRetry }
}

function countText(count: number): string {
  return count.toLocaleString('en-US')
}

function seconds(ms: number): string {
  return String(Math.round(ms / SECOND_MS))
}

function ageText(ms: number): string {
  const total = Math.max(Math.floor(ms / SECOND_MS), 0)
  if (total < MINUTE_S) return `${String(total)}s`
  if (total < HOUR_S) return `${String(Math.floor(total / MINUTE_S))}m`
  return `${String(Math.floor(total / HOUR_S))}h`
}

function aheadBehind(status: GitStatus): string {
  const ahead = status.ahead > 0 ? ` ↑${String(status.ahead)}` : ''
  const behind = status.behind > 0 ? ` ↓${String(status.behind)}` : ''
  return `${ahead}${behind}`
}

function changedText(status: GitStatus): string {
  if (status.entries.length > 0) return `${countText(status.entries.length)} changed`
  return status.isInitial ? 'no commits yet' : 'clean'
}

function summary(branch: string | undefined, status: GitStatus): string {
  const head = branch === undefined ? '' : ` · ${branch}${aheadBehind(status)}`
  return `${head} · ${changedText(status)}`
}

function failureReason(failure: GitFailure): string {
  switch (failure.kind) {
    case 'exit':
      return `exit ${String(failure.exitCode)}`
    case 'timeout':
      return `no answer in ${seconds(RUN_TIMEOUT_MS)} s`
    case 'did-not-run':
      return 'it did not start'
  }
}

function retryLine(watch: GitWatch, now: number): NoteLine {
  if (watch.retryAt === undefined) return line('', 'dim', true)
  const left = Math.max(Math.ceil((watch.retryAt - now) / SECOND_MS), 0)
  return line(`retry in ${String(left)}s`, 'dim', true)
}

const NOT_A_REPO: readonly NoteLine[] = [line('No git status here; git init adds it.', 'dim')]

const GIT_MISSING: readonly NoteLine[] = [
  line('git is not on PATH, so git status', 'plain'),
  line('is not shown.', 'plain'),
]

const READING: readonly NoteLine[] = [line('Reading git status…', 'dim')]

const NO_UNTRACKED: readonly NoteLine[] = [
  line(`git status took over ${seconds(SLOW_MS)} s twice, so`, 'dim'),
  line('untracked files are not shown.', 'dim'),
]

function cutNote(status: GitStatus): readonly NoteLine[] {
  if (!status.isCut) return []
  const marked = countText(status.entries.length)
  return [
    line('git status is over 4 MiB; the first', 'warning'),
    line(`${marked} entries are marked.`, 'warning'),
  ]
}

function failedNotes(watch: GitWatch, failure: GitFailure, now: number): NoteLine[] {
  return [
    line(`git status failed: ${failureReason(failure)}.`, 'error'),
    line('Run git status in a shell to see why.', 'plain'),
    retryLine(watch, now),
  ]
}

function shownNotes(watch: GitWatch, age: string): NoteLine[] {
  const slow = watch.isSlow
    ? [
        line(`git status took over ${seconds(SLOW_MS)} s; showing`, 'warning'),
        line(`the status of ${age} ago.`, 'warning', true),
      ]
    : []
  return [...slow, ...(watch.isUntrackedSkipped ? NO_UNTRACKED : [])]
}

export function gitView(watch: GitWatch, now: number): GitView {
  if (watch.repo === null || watch.repo === undefined) {
    return {
      header: ' · not a git repo',
      notes: NOT_A_REPO,
      footer: [],
      marks: undefined,
      isRepo: false,
    }
  }
  const shown = watch.shown
  const marks = shown === undefined ? undefined : gitMarks(shown.status, watch.repo.prefix)
  const footer = shown === undefined ? [] : cutNote(shown.status)
  if (watch.isGitMissing)
    return { header: ' · git not found', notes: GIT_MISSING, footer, marks, isRepo: true }
  if (watch.failure !== undefined) {
    const notes = failedNotes(watch, watch.failure, now)
    return { header: ' · git status failed', notes, footer, marks, isRepo: true }
  }
  if (shown === undefined) return { header: '', notes: READING, footer, marks, isRepo: true }
  const age = ageText(now - shown.at)
  const header = `${summary(watch.branch, shown.status)}${watch.isSlow ? ` · ${age} old` : ''}`
  return { header, notes: shownNotes(watch, age), footer, marks, isRepo: true }
}
