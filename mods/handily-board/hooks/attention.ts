import type { PluginOptions } from 'claude-code'
import type { BoardToolSight } from '../types'
import { callText } from './agent-rows'
import { type AgentRow, waitingRows } from './agents'
import { SIGNALS } from './signals'

export type StatusLineSetting = 'attention' | 'off'

const STATUS_LINE_SETTINGS: readonly StatusLineSetting[] = ['attention', 'off']
const WAIT_MARK = SIGNALS.waitsForYou.mark
const MAIN_LOOP = 'Claude'

export function statusLineSetting(options: PluginOptions): StatusLineSetting {
  const setting = options.statusLine ?? 'attention'
  const known = STATUS_LINE_SETTINGS.find((candidate) => candidate === setting)
  if (!known) {
    throw new Error(
      `handily-board: userConfig statusLine is ${JSON.stringify(setting)}; set it to attention or off in /config.`,
    )
  }
  return known
}

function waitText(who: string, call: BoardToolSight | null): string {
  const lead = `${who} waits for permission`
  return call === null ? lead : `${lead}: ${callText(call)}`
}

export function agentWaitText(row: AgentRow): string {
  return waitText(row.shownName, row.call)
}

export function agentWaitLine(row: AgentRow): string {
  return `${WAIT_MARK} ${agentWaitText(row)}`
}

export function mainWaitText(call: BoardToolSight): string {
  return waitText(MAIN_LOOP, call)
}

export function noticeText(session: string, wait: string): string {
  return `${session} needs you: ${wait}`
}

export function attentionText(rows: readonly AgentRow[]): string | undefined {
  const waiting = waitingRows(rows)
  const [first] = waiting
  if (first === undefined) return undefined
  if (waiting.length === 1) return agentWaitLine(first)
  return `${WAIT_MARK} ${String(waiting.length)} agents wait for permission`
}
