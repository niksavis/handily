import { NO_AGENTS, agentStatsText, agentsTitleText } from './agent-rows'
import { type AgentRow, waitingRows } from './agents'
import { agentWaitLine } from './attention'
import { checksText, familiesText, verdictsText } from './checks'
import { detailsText } from './details'
import type { PaneWork } from './pane'
import { requestWords } from './request'
import type { SignalLooks } from './signals'
import { receiptWords, sessionHeadWords } from './session'

const STATS_INDENT = '    '

export type Stats = Pick<PaneWork, 'now' | 'vitals' | 'checks' | 'request' | 'agents' | 'context'>

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => `${STATS_INDENT}${line}`)
}

function present(texts: readonly (string | undefined)[]): string[] {
  return texts.filter((text) => text !== undefined)
}

function checkLines(stats: Stats): string[] {
  const summary = checksText(stats.checks)
  if (summary === undefined) return []
  return present([summary, familiesText(stats.checks), verdictsText(stats.checks)])
}

function sessionLines(stats: Stats, signals: SignalLooks): string[] {
  const waiting = waitingRows(stats.agents)
  const view = {
    vitals: stats.vitals,
    waits: waiting.length,
    checks: stats.checks,
    request: stats.request,
    now: stats.now,
    signals,
  }
  const details = detailsText(stats.vitals, stats.now, stats.context)
  return [
    sessionHeadWords(view),
    ...indented([
      ...waiting.map((row) => agentWaitLine(row, signals)),
      ...present([requestWords(stats.request), receiptWords(view)]),
      ...(details === '' ? [] : details.split('\n')),
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
