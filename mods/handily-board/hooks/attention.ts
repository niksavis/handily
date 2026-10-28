import type { PluginOptions } from 'claude-code'
import { callText } from './agent-rows'
import type { AgentRow } from './agents'
import { SIGNALS } from './signals'
import { highPercent, type Vitals } from './vitals'

export type StatusLineSetting = 'attention' | 'off'

const STATUS_LINE_SETTINGS: readonly StatusLineSetting[] = ['attention', 'off']
const WAIT_MARK = SIGNALS.waitsForYou.mark
const PIECE_LEAD = ' · '
const COMPACT_HINT = '/compact frees it'

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

function waitText(row: AgentRow): string {
  const lead = `${row.shownName} waits for permission`
  return row.call === null ? lead : `${lead}: ${callText(row.call)}`
}

function waitsText(rows: readonly AgentRow[]): string | undefined {
  const waiting = rows.filter((row) => row.look === 'needsYou')
  const [first] = waiting
  if (first === undefined) return undefined
  if (waiting.length === 1) return `${WAIT_MARK} ${waitText(first)}`
  return `${WAIT_MARK} ${String(waiting.length)} agents wait for permission`
}

export function attentionText(rows: readonly AgentRow[], vitals: Vitals): string | undefined {
  const waits = waitsText(rows)
  const percent = highPercent(vitals)
  const high = percent === undefined ? undefined : `ctx ${String(percent)}% high`
  if (waits === undefined)
    return high === undefined ? undefined : `${high}${PIECE_LEAD}${COMPACT_HINT}`
  return high === undefined ? waits : `${waits}${PIECE_LEAD}${high}`
}
