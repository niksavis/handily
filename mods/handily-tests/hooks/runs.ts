import type { TestsFailure, TestsOutcome, TestsRun, TestsRuns } from '../types'
import type { GlyphSet } from './glyphs'
import { marked, type ToastParts } from './toast'
import { fitted } from './width'

export const RUNS_KEPT = 20

export const FAILURES_SHOWN = 5

export type HeadRole = 'done' | 'blocked' | 'doing' | 'toDo'

export type Headline = { role: HeadRole; text: string; tail: string }

export type Running = { id: string; command: string; startedAt: number }

const COMMAND_COLUMNS = 24
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const TENTH_OF_SECOND_BELOW = 10 * SECOND
const QUOTED_NAME_COLUMNS = 24

export function shownCommand(command: string): string {
  return fitted(command.replace(/\s+/g, ' ').trim(), COMMAND_COLUMNS)
}

export function tookText(ms: number): string {
  if (ms < TENTH_OF_SECOND_BELOW) return `${(ms / SECOND).toFixed(1)}s`
  if (ms < MINUTE) return `${String(Math.round(ms / SECOND))}s`
  return `${String(Math.round(ms / MINUTE))}m`
}

export function ageText(ms: number): string {
  const age = Math.max(ms, 0)
  if (age < MINUTE) return `${String(Math.floor(age / SECOND))}s`
  if (age < HOUR) return `${String(Math.floor(age / MINUTE))}m`
  if (age < DAY) return `${String(Math.floor(age / HOUR))}h`
  return `${String(Math.floor(age / DAY))}d`
}

export function isFailing(outcome: TestsOutcome): boolean {
  if (outcome.kind === 'tests') return outcome.failed > 0
  return outcome.kind === 'broken' || outcome.kind === 'empty'
}

export function cutLinesText(count: number): string {
  return `+${String(count)} more ${count === 1 ? 'line' : 'lines'} in the transcript`
}

export function cutFailuresText(count: number): string {
  return `+${String(count)} more ${count === 1 ? 'failure' : 'failures'} in the transcript`
}

export function isPassing(outcome: TestsOutcome): boolean {
  return outcome.kind === 'tests' && outcome.failed === 0 && !outcome.isCut && outcome.total > 0
}

function testsHeadline(outcome: Extract<TestsOutcome, { kind: 'tests' }>): Headline {
  const { failed, passed, total, isCut } = outcome
  if (isCut) {
    if (failed === 0) return { role: 'toDo', text: 'output cut', tail: '' }
    return { role: 'blocked', text: `${String(failed)} failed`, tail: ' · output cut' }
  }
  const counts = `${String(passed)} of ${String(total)} passed`
  if (failed === 0) return { role: 'done', text: counts, tail: '' }
  return { role: 'blocked', text: `${String(failed)} failed`, tail: ` · ${counts}` }
}

export function headlineOf(run: TestsRun): Headline {
  const { outcome } = run
  const command = shownCommand(run.command)
  switch (outcome.kind) {
    case 'tests':
      return testsHeadline(outcome)
    case 'broken':
      return { role: 'blocked', text: `${outcome.runner} could not run the tests`, tail: '' }
    case 'empty':
      return { role: 'blocked', text: `${outcome.runner} found no tests`, tail: '' }
    case 'interrupted':
      return { role: 'blocked', text: `${command} was interrupted`, tail: '' }
    case 'background':
      return { role: 'doing', text: `${command} runs in the background`, tail: '' }
    case 'unreadable':
      return { role: 'blocked', text: 'the run could not be read', tail: '' }
  }
}

export function runningHeadline(running: Running, now: number): Headline {
  const took = tookText(Math.max(now - running.startedAt, 0))
  return { role: 'doing', text: `${shownCommand(running.command)} runs`, tail: ` · ${took}` }
}

export function headlineText(headline: Headline, marks: GlyphSet): string {
  return `${marks[headline.role]} ${headline.text}${headline.tail}`
}

export function metaLines(run: TestsRun, now: number): string[] {
  const { outcome } = run
  const command = shownCommand(run.command)
  switch (outcome.kind) {
    case 'tests':
      if (outcome.isCut) return [`${outcome.runner} · ${command} · counts may be short`]
      return [
        `${outcome.runner} · ${command} · ${ageText(now - run.endedAt)} ago · ${tookText(run.tookMs)}`,
      ]
    case 'broken':
    case 'empty':
      return [outcome.reason]
    case 'interrupted':
      return ['no result']
    case 'background':
      return ['its output is not read here', 'a run in the foreground shows here']
    case 'unreadable':
      return ['the transcript shows the raw output']
  }
}

export function failuresOf(run: TestsRun | undefined): readonly TestsFailure[] {
  return run?.outcome.kind === 'tests' ? run.outcome.failures : []
}

export function placeOf(failure: TestsFailure, isWhole: boolean): string {
  if (failure.file === null) return ''
  const file = isWhole ? failure.file : (failure.file.split('/').at(-1) ?? failure.file)
  return failure.line === null ? file : `${file}:${String(failure.line)}`
}

export function failureText(failure: TestsFailure): string {
  const place = placeOf(failure, true)
  return [failure.name, ...(place === '' ? [] : [place]), failure.message, ...failure.diff]
    .filter((line) => line !== '')
    .join('\n')
}

export function countsText(outcome: TestsOutcome): string {
  if (outcome.kind !== 'tests' || outcome.isCut) return '-'
  return `${String(outcome.passed)}/${String(outcome.total)}`
}

export function runRole(outcome: TestsOutcome): HeadRole {
  if (outcome.kind === 'tests') return testsHeadline(outcome).role
  return outcome.kind === 'background' ? 'doing' : 'blocked'
}

export function runnerText(outcome: TestsOutcome): string {
  return outcome.runner ?? '-'
}

export type StatusSetting = 'failures' | 'always' | 'off'

const STATUS_SETTINGS: readonly StatusSetting[] = ['failures', 'always', 'off']

export function statusSettingOf(value: unknown): StatusSetting {
  const setting = value ?? 'failures'
  const known = STATUS_SETTINGS.find((candidate) => candidate === setting)
  if (known === undefined) {
    throw new Error(
      `handily-tests: userConfig statusLine is ${JSON.stringify(setting)}; set it to failures, always or off in /config.`,
    )
  }
  return known
}

export type ToastSetting = 'on' | 'off'

export function toastSettingOf(value: unknown): ToastSetting {
  const setting = value ?? 'off'
  if (setting === 'on' || setting === 'off') return setting
  throw new Error(
    `handily-tests: userConfig toasts is ${JSON.stringify(setting)}; set it to on or off in /config.`,
  )
}

export function statusText(
  setting: StatusSetting,
  view: { last: TestsRun | undefined; running: Running | undefined },
  marks: GlyphSet,
): string | undefined {
  if (setting === 'off') return undefined
  const { last, running } = view
  if (setting === 'always' && running !== undefined) {
    return `${marks.doing} tests: ${shownCommand(running.command)} runs`
  }
  if (last === undefined) return undefined
  if (setting === 'failures' && !isFailing(last.outcome)) return undefined
  const headline = headlineOf(last)
  return `${marks[headline.role]} tests: ${headline.text}${headline.tail}`
}

function quotedName(name: string): string {
  return JSON.stringify(fitted(name, QUOTED_NAME_COLUMNS))
}

export function failedToastParts(run: TestsRun): ToastParts | undefined {
  const { outcome } = run
  if (outcome.kind !== 'tests' || outcome.failed === 0) return undefined
  const { failed, failures } = outcome
  const [first] = failures
  const lead = marked('blocked', `${String(failed)} ${failed === 1 ? 'test' : 'tests'} failed`)
  if (first === undefined) return [lead, '/tests shows the run']
  if (failed === 1) return [lead, { quoted: first.name }, '/tests shows the diff']
  return [
    lead,
    `${quotedName(first.name)} and ${String(failed - 1)} more`,
    '/tests shows the diffs',
  ]
}

export function passToastParts(run: TestsRun): ToastParts | undefined {
  const { outcome } = run
  if (outcome.kind !== 'tests' || !isPassing(outcome)) return undefined
  const counts = `${String(outcome.passed)} of ${String(outcome.total)} passed`
  return [marked('done', 'Tests pass again'), `${outcome.runner} · ${counts}`]
}

export function runToastParts(run: TestsRun, before: TestsRun | undefined): ToastParts | undefined {
  const wasFailing = before !== undefined && isFailing(before.outcome)
  if (isFailing(run.outcome)) return wasFailing ? undefined : failedToastParts(run)
  return wasFailing ? passToastParts(run) : undefined
}

export function lastVerdict(runs: TestsRuns): TestsRun | undefined {
  return runs.find((run) => run.outcome.kind === 'tests' || isFailing(run.outcome))
}

export function listText(run: TestsRun | undefined, now: number, marks: GlyphSet): string {
  if (run === undefined) {
    return 'No test run yet. A Bash call that runs vitest, jest, node --test or pytest fills the tests tab.'
  }
  const head = `Tests  ${headlineText(headlineOf(run), marks)}`
  const failures = failuresOf(run).flatMap((failure) => {
    const place = placeOf(failure, true)
    const row = place === '' ? failure.name : `${failure.name}  ${place}`
    const cut = failure.cutLines > 0 ? [cutLinesText(failure.cutLines)] : []
    const details = [failure.message, ...failure.diff, ...cut].filter((line) => line !== '')
    return [`${marks.blocked} ${row}`, ...details.map((line) => `    ${line}`)]
  })
  const { outcome } = run
  const notKept =
    outcome.kind === 'tests' && outcome.cutFailures > 0
      ? [cutFailuresText(outcome.cutFailures)]
      : []
  return [head, ...metaLines(run, now), ...failures, ...notKept].join('\n')
}

export function keptRuns(run: TestsRun, runs: TestsRuns): TestsRuns {
  return [run, ...runs.filter((kept) => kept.id !== run.id)].slice(0, RUNS_KEPT)
}
