import type { BoardAgent, BoardCallOutcome, BoardCommand, BoardRetry } from '../types'
import { maskedCredentials } from './credentials'
import { isEditTool } from './vitals'

export const RETRY_TOOL = 'Bash'
export const RETRY_FAILS_AT_LEAST = 3

const RETRIES_KEPT_AT_MOST = 5
const SHOWN_CHARS_AT_MOST = 200
const DIGEST_ALGORITHM = 'SHA-256'
const HEX_BASE = 16
const HEX_DIGITS = 2

export type AgentRetry = { fails: number; shown: string; isRunning: boolean }

export type RetryCall = {
  tool: string
  command: BoardCommand | undefined
  outcome: BoardCallOutcome
}

function commandLines(command: string): string[] {
  return command
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, ' '))
    .filter((line) => line !== '')
}

function hexOf(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(HEX_BASE).padStart(HEX_DIGITS, '0'))
    .join('')
}

export async function commandOf(
  tool: string,
  input: Readonly<Record<string, unknown>>,
): Promise<BoardCommand | undefined> {
  const { command } = input
  if (tool !== RETRY_TOOL || typeof command !== 'string') return undefined
  const lines = commandLines(command)
  const [first] = lines
  if (first === undefined) return undefined
  const bytes = new TextEncoder().encode(lines.join('\n'))
  const digest = hexOf(await crypto.subtle.digest(DIGEST_ALGORITHM, bytes))
  return { digest, shown: maskedCredentials(first).slice(0, SHOWN_CHARS_AT_MOST) }
}

function withinCap(retries: readonly BoardRetry[]): readonly BoardRetry[] {
  if (retries.length <= RETRIES_KEPT_AT_MOST) return retries
  const unshown = retries.findIndex((retry) => retry.fails < RETRY_FAILS_AT_LEAST)
  const dropped = unshown < 0 ? 0 : unshown
  return retries.filter((_, index) => index !== dropped)
}

function afterFailure(
  retries: readonly BoardRetry[],
  command: BoardCommand,
): readonly BoardRetry[] {
  const known = retries.find((retry) => retry.digest === command.digest)
  if (known === undefined) {
    return withinCap([...retries, { ...command, fails: 1, isEditSince: false }])
  }
  if (!known.isEditSince) return retries
  return retries.map((retry) =>
    retry === known ? { ...command, fails: retry.fails + 1, isEditSince: false } : retry,
  )
}

export function retriesAfter(
  retries: readonly BoardRetry[],
  call: RetryCall,
): readonly BoardRetry[] {
  if (call.outcome === 'denied') return retries
  if (isEditTool(call.tool)) {
    if (call.outcome !== 'ok') return retries
    return retries.map((retry) => (retry.isEditSince ? retry : { ...retry, isEditSince: true }))
  }
  const { command } = call
  if (command === undefined) return retries
  if (call.outcome === 'ok') return retries.filter((retry) => retry.digest !== command.digest)
  return afterFailure(retries, command)
}

export function withRetries(agent: BoardAgent, retries: readonly BoardRetry[]): BoardAgent {
  if (retries.length > 0) return { ...agent, retries }
  const { retries: kept, ...rest } = agent
  return kept === undefined ? agent : rest
}

export function retryOf(agent: BoardAgent): AgentRetry | null {
  let top: BoardRetry | undefined
  for (const retry of agent.retries ?? []) {
    if (retry.fails < RETRY_FAILS_AT_LEAST) continue
    if (top === undefined || retry.fails >= top.fails) top = retry
  }
  if (top === undefined) return null
  const { digest } = top
  return {
    fails: top.fails,
    shown: top.shown,
    isRunning: agent.running.some((call) => call.command?.digest === digest),
  }
}
