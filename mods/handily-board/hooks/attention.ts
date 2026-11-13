import type { PluginOptions } from 'claude-code'
import type { BoardToolSight } from '../types'
import { callText } from './agent-rows'
import { type AgentRow, waitingRows } from './agents'
import type { SignalLooks } from './signals'
import { escaped } from './tasks'
import { marked, type ToastParts } from './toast'
import { askSight, type AskSight } from './waits'

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

export type Wait = { who: string; call: BoardToolSight | null; question: string | null }

export type AskedQuestions = ReadonlyMap<string, string | null>

export const NO_QUESTIONS: AskedQuestions = new Map()

function sightOf(wait: Wait): AskSight {
  return wait.call === null
    ? { kind: 'permission' }
    : askSight({ ...wait.call, question: wait.question })
}

function waitLead(wait: Wait, sight: AskSight): string {
  switch (sight.kind) {
    case 'permission':
      return `${wait.who} waits for permission`
    case 'question':
      return `${wait.who} asks a question`
    case 'waits':
      return `${wait.who} waits`
  }
}

function waitDetail(wait: Wait, sight: AskSight): string | null {
  if (sight.kind !== 'permission') return escaped(sight.title)
  return wait.call === null ? null : callText(wait.call)
}

function waitWords(wait: Wait): { lead: string; detail: string | null } {
  const sight = sightOf(wait)
  return { lead: waitLead(wait, sight), detail: waitDetail(wait, sight) }
}

function waitText(wait: Wait): string {
  const { lead, detail } = waitWords(wait)
  return detail === null ? lead : `${lead}: ${detail}`
}

export function agentWait(row: AgentRow, question: string | null): Wait {
  return { who: row.shownName, call: row.call, question }
}

function questionOf(row: AgentRow, questions: AskedQuestions): string | null {
  return row.callId === null ? null : (questions.get(row.callId) ?? null)
}

export function agentWaitLine(
  row: AgentRow,
  signals: SignalLooks,
  questions: AskedQuestions,
): string {
  return `${signals.waitsForYou.mark} ${waitText(agentWait(row, questionOf(row, questions)))}`
}

export function mainWait(call: BoardToolSight, question: string | null): Wait {
  return { who: MAIN_LOOP, call, question }
}

export function noticeText(session: string, wait: Wait): string {
  return `${session} needs you: ${waitText(wait)}`
}

export function noticeParts(session: string, wait: Wait): ToastParts {
  const head = marked('waitsForYou', `${session} needs you`)
  const { lead, detail } = waitWords(wait)
  return detail === null ? [head, lead] : [head, lead, detail]
}

function isPermissionWait(row: AgentRow): boolean {
  return sightOf(agentWait(row, null)).kind === 'permission'
}

export function attentionText(
  rows: readonly AgentRow[],
  signals: SignalLooks,
  questions: AskedQuestions,
): string | undefined {
  const waiting = waitingRows(rows)
  const [first] = waiting
  if (first === undefined) return undefined
  if (waiting.length === 1) return agentWaitLine(first, signals, questions)
  const words = waiting.every(isPermissionWait) ? 'wait for permission' : 'wait for you'
  return `${signals.waitsForYou.mark} ${String(waiting.length)} agents ${words}`
}
