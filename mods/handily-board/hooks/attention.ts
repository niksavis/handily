import type { PluginOptions } from 'claude-code'
import type { BoardToolSight } from '../types'
import { callText } from './agent-rows'
import { type AgentRow, waitingRows } from './agents'
import type { SignalLooks } from './signals'
import { marked, type ToastParts } from './toast'

export type StatusLineSetting = 'attention' | 'off'

const STATUS_LINE_SETTINGS: readonly StatusLineSetting[] = ['attention', 'off']
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

export type Wait = { who: string; call: BoardToolSight | null }

function waitLead(wait: Wait): string {
  return `${wait.who} waits for permission`
}

function waitText(wait: Wait): string {
  return wait.call === null ? waitLead(wait) : `${waitLead(wait)}: ${callText(wait.call)}`
}

export function agentWait(row: AgentRow): Wait {
  return { who: row.shownName, call: row.call }
}

export function agentWaitLine(row: AgentRow, signals: SignalLooks): string {
  return `${signals.waitsForYou.mark} ${waitText(agentWait(row))}`
}

export function mainWait(call: BoardToolSight): Wait {
  return { who: MAIN_LOOP, call }
}

export function noticeText(session: string, wait: Wait): string {
  return `${session} needs you: ${waitText(wait)}`
}

export function noticeParts(session: string, wait: Wait): ToastParts {
  const head = marked('waitsForYou', `${session} needs you`)
  return wait.call === null ? [head, waitLead(wait)] : [head, waitLead(wait), callText(wait.call)]
}

export function attentionText(rows: readonly AgentRow[], signals: SignalLooks): string | undefined {
  const waiting = waitingRows(rows)
  const [first] = waiting
  if (first === undefined) return undefined
  if (waiting.length === 1) return agentWaitLine(first, signals)
  return `${signals.waitsForYou.mark} ${String(waiting.length)} agents wait for permission`
}
