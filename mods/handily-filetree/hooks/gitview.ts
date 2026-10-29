import { type LineMarks, lineMarks } from './lines'
import { type GitMarks, type GitStatus, gitMarks } from './status'
import { type GitFailure, type GitWatch, type LinesFailure, RUN_TIMEOUT_MS, SLOW_MS } from './watch'

export type NoteTone = 'plain' | 'dim' | 'error' | 'warning'

export type NoteLine = { text: string; tone: NoteTone; hasRetry: boolean }

export type HeaderPart = { text: string; color?: 'success' | 'warning' }

export type GitView = {
  header: readonly HeaderPart[]
  upstream: string | undefined
  lines: LineMarks | undefined
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

function aheadBehind(status: GitStatus): HeaderPart[] {
  const ahead: HeaderPart[] =
    status.ahead > 0 ? [{ text: ` ↑${String(status.ahead)}`, color: 'success' }] : []
  const behind: HeaderPart[] =
    status.behind > 0 ? [{ text: ` ↓${String(status.behind)}`, color: 'warning' }] : []
  return [...ahead, ...behind]
}

function changedText(status: GitStatus): string {
  if (status.entries.length > 0) return `${countText(status.entries.length)} changed`
  return status.isInitial ? 'no commits yet' : 'clean'
}

function summary(branch: string | undefined, status: GitStatus): HeaderPart[] {
  const head = branch === undefined ? [] : [{ text: ` · ${branch}` }, ...aheadBehind(status)]
  return [...head, { text: ` · ${changedText(status)}` }]
}

function linesReason(failure: LinesFailure): string {
  switch (failure.kind) {
    case 'exit':
      return `git diff exited ${String(failure.exitCode)}`
    case 'timeout':
      return `git diff gave no answer in ${seconds(RUN_TIMEOUT_MS)} s`
    case 'did-not-run':
      return 'git diff did not start'
    case 'cut':
      return 'git diff is over 4 MiB'
  }
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

const LINES_OFF: readonly NoteLine[] = [line('line counts off: git is slow here.', 'dim')]

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

function linesNotes(watch: GitWatch): readonly NoteLine[] {
  if (watch.isLinesSkipped) return LINES_OFF
  const failure = watch.linesFailure
  if (failure === undefined) return []
  return [line(`line counts not shown: ${linesReason(failure)}.`, 'dim', true)]
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

function plain(text: string): HeaderPart[] {
  return [{ text }]
}

export function gitView(watch: GitWatch, now: number): GitView {
  const none = { upstream: undefined, lines: undefined }
  if (watch.repo === null || watch.repo === undefined) {
    return {
      header: plain(' · not a git repo'),
      ...none,
      notes: NOT_A_REPO,
      footer: [],
      marks: undefined,
      isRepo: false,
    }
  }
  const { shown, repo } = watch
  const marks = shown === undefined ? undefined : gitMarks(shown.status, repo.prefix)
  const footer = shown === undefined ? [] : cutNote(shown.status)
  const base = { ...none, footer, marks, isRepo: true }
  if (watch.isGitMissing) return { ...base, header: plain(' · git not found'), notes: GIT_MISSING }
  if (watch.failure !== undefined) {
    const notes = failedNotes(watch, watch.failure, now)
    return { ...base, header: plain(' · git status failed'), notes }
  }
  if (shown === undefined) return { ...base, header: [], notes: READING }
  const age = ageText(now - shown.at)
  const header = [
    ...summary(watch.branch, shown.status),
    ...(watch.isSlow ? plain(` · ${age} old`) : []),
  ]
  return {
    ...base,
    header,
    upstream: shown.status.upstream,
    lines: watch.lines === undefined ? undefined : lineMarks(watch.lines, repo.prefix),
    notes: shownNotes(watch, age),
    footer: [...footer, ...linesNotes(watch)],
  }
}
