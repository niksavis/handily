import { NO_AGENTS, agentStatsText, agentsTitleText } from './agent-rows'
import { type AgentRow, waitingRows } from './agents'
import { agentWaitLine } from './attention'
import type { SessionRateLimit } from 'claude-code'
import { familiesText, verdictWords, verdictsText } from './checks'
import { detailsText, limitName, resetsInMs } from './details'
import { DEFAULT_PALETTE } from './palette'
import type { PaneWork } from './pane'
import { requestWords, requestsWords } from './request'
import type { SignalLooks } from './signals'
import { type SessionView, receiptWords, sessionHeadWords, tokensOverWindow } from './session'
import type { Vitals } from './vitals'

const STATS_INDENT = '    '
const SECOND_MS = 1000
const UNITS: readonly { ms: number; one: string; many: string }[] = [
  { ms: 86_400_000, one: 'day', many: 'days' },
  { ms: 3_600_000, one: 'hour', many: 'hours' },
  { ms: 60_000, one: 'minute', many: 'minutes' },
  { ms: SECOND_MS, one: 'second', many: 'seconds' },
]

export type Stats = Pick<PaneWork, 'now' | 'vitals' | 'checks' | 'request' | 'agents' | 'context'>

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => `${STATS_INDENT}${line}`)
}

function present(texts: readonly (string | undefined)[]): string[] {
  return texts.filter((text) => text !== undefined)
}

function checkLines(stats: Stats): string[] {
  const summary = verdictWords(stats.checks)
  if (summary === undefined) return []
  return present([summary, familiesText(stats.checks), verdictsText(stats.checks)])
}

function durationWords(ms: number): string {
  const unit = UNITS.find((one) => ms >= one.ms) ?? {
    ms: SECOND_MS,
    one: 'second',
    many: 'seconds',
  }
  const count = Math.floor(Math.max(ms, 0) / unit.ms)
  return `${String(count)} ${count === 1 ? unit.one : unit.many}`
}

function resetWords(limit: SessionRateLimit, now: number): string | undefined {
  const inMs = resetsInMs(limit, now)
  if (inMs === undefined) return undefined
  const name = limitName(limit)
  return inMs <= 0 ? `${name} now` : `${name} in ${durationWords(inMs)}`
}

function contextWords(vitals: Vitals, now: number): string | undefined {
  const tokens = tokensOverWindow(vitals)
  const resets = vitals.limits.flatMap((limit) => {
    const words = resetWords(limit, now)
    return words === undefined ? [] : [words]
  })
  const sentences = [
    tokens === undefined ? null : `Context ${tokens} tokens.`,
    resets.length === 0 ? null : `Limits reset: ${resets.join(', ')}.`,
  ].filter((sentence) => sentence !== null)
  return sentences.length === 0 ? undefined : sentences.join(' ')
}

function sessionLines(stats: Stats, signals: SignalLooks): string[] {
  const waiting = waitingRows(stats.agents)
  const view: SessionView = {
    vitals: stats.vitals,
    waits: waiting.length,
    checks: stats.checks,
    request: stats.request,
    now: stats.now,
    signals,
    palette: DEFAULT_PALETTE,
    hasResets: false,
  }
  const details = detailsText(stats.vitals, stats.now, stats.context)
  return [
    sessionHeadWords(view),
    ...indented([
      ...waiting.map((row) => agentWaitLine(row, signals)),
      ...present([requestWords(stats.request), requestsWords(stats.request), receiptWords(view)]),
      ...(details === '' ? [] : details.split('\n')),
      ...present([contextWords(stats.vitals, stats.now)]),
      ...checkLines(stats),
    ]),
  ]
}

function agentLines(rows: readonly AgentRow[]): string[] {
  if (rows.length === 0) return [NO_AGENTS]
  return [agentsTitleText(rows), ...indented(rows.map(agentStatsText))]
}

export function statsText(stats: Stats, signals: SignalLooks): string {
  return [...sessionLines(stats, signals), ...agentLines(stats.agents)].join('\n')
}
