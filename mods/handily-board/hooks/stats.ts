import { NO_AGENTS, agentStatsText, agentsTitleText } from './agent-rows'
import { type AgentRow, waitingRows } from './agents'
import { agentWaitLine } from './attention'
import { checksText } from './checks'
import { detailsText } from './details'
import type { PaneWork } from './pane'
import { sessionText } from './vitals'

const STATS_INDENT = '    '

export type Stats = Pick<PaneWork, 'now' | 'vitals' | 'checks' | 'agents'>

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => `${STATS_INDENT}${line}`)
}

function sessionLines(stats: Stats): string[] {
  const waiting = waitingRows(stats.agents)
  const details = detailsText(stats.vitals, stats.now)
  const checks = checksText(stats.checks)
  return [
    sessionText(stats.vitals, waiting.length),
    ...indented([
      ...waiting.map(agentWaitLine),
      ...(details === '' ? [] : details.split('\n')),
      ...(checks === undefined ? [] : [checks]),
    ]),
  ]
}

function agentLines(rows: readonly AgentRow[]): string[] {
  if (rows.length === 0) return [NO_AGENTS]
  return [agentsTitleText(rows), ...indented(rows.map(agentStatsText))]
}

export function statsText(stats: Stats): string {
  return [...sessionLines(stats), ...agentLines(stats.agents)].join('\n')
}
