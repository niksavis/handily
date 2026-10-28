import type { RenderElement, SessionRateLimit, ThemeKey } from 'claude-code'
import type { BoardChecks } from '../types'
import { elapsedText } from './activity'
import { drawChecks } from './checks'
import type { PaneElements, RowLayout } from './pane'
import { type Part, PART_LEAD, drawPartLines } from './parts'
import { escaped } from './tasks'
import { tokensText } from './tokens'
import { type LastTurn, type Vitals, dollars, hasReading, highPercent, lastCents } from './vitals'

export const SESSION_DETAILS = 'session:details'

const DETAIL_INDENT = 4
const WORD_LEAD = ' '
const ERROR_COLOR: ThemeKey = 'error'
const NEAR_LIMIT_NOTE = 'Claude Code compacts it near the limit. /compact or /clear frees it.'
const NO_LIMITS = 'limits: none reported'
const LIMIT_NAMES: Readonly<Partial<Record<string, string>>> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

export type SessionDetails = {
  vitals: Vitals
  checks: BoardChecks
  names: ReadonlyMap<string, string>
  now: number
}

type Group = { key: string; parts: readonly Part[]; lead: string }

function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`
}

function contextParts(vitals: Vitals): Part[] {
  const { tokens, window } = vitals
  const compactions = { text: counted(vitals.compactions, 'compaction', 'compactions') }
  if (!hasReading(vitals) || tokens === undefined || window === undefined) {
    return vitals.compactions > 0 ? [compactions] : []
  }
  return [{ text: `context ${tokensText(tokens)} of ${tokensText(window)}` }, compactions]
}

function nearLimitParts(vitals: Vitals): Part[] {
  if (highPercent(vitals) === undefined) return []
  return NEAR_LIMIT_NOTE.split(WORD_LEAD).map((text) => ({ text }))
}

function turnParts(vitals: Vitals, last: LastTurn): Part[] {
  const added = lastCents(vitals)
  return [
    { text: `last turn ${elapsedText(last.durationMs)}` },
    ...(added === undefined ? [] : [{ text: `+${dollars(added)}` }]),
    { text: counted(last.edits, 'edit', 'edits') },
    last.errors === 0
      ? { text: counted(last.errors, 'error', 'errors') }
      : { text: counted(last.errors, 'error', 'errors'), color: ERROR_COLOR },
    { text: counted(last.spawned, 'agent spawned', 'agents spawned') },
  ]
}

function limitName(limit: SessionRateLimit): string {
  return LIMIT_NAMES[limit.kind] ?? escaped(limit.kind)
}

function resetsInMs(limit: SessionRateLimit, now: number): number | undefined {
  if (limit.resetsAt === undefined) return undefined
  const at = Date.parse(limit.resetsAt)
  return Number.isFinite(at) ? at - now : undefined
}

function limitsParts(vitals: Vitals, now: number): Part[] {
  if (!hasReading(vitals)) return []
  if (vitals.limits.length === 0) return [{ text: NO_LIMITS }]
  const used = vitals.limits.map(
    (limit) => `${limitName(limit)} ${String(Math.round(limit.percentUsed))}%`,
  )
  const resets = vitals.limits.flatMap((limit) => {
    const inMs = resetsInMs(limit, now)
    return inMs === undefined ? [] : [`${limitName(limit)} in ${elapsedText(inMs)}`]
  })
  return [
    ...used.map((text, index) => ({ text: index === 0 ? `limits ${text}` : text })),
    ...resets.map((text, index) => ({ text: index === 0 ? `resets ${text}` : text })),
  ]
}

function detailGroups(vitals: Vitals, now: number): Group[] {
  const { lastTurn } = vitals
  return [
    { key: 'session-context', parts: contextParts(vitals), lead: PART_LEAD },
    { key: 'session-near-limit', parts: nearLimitParts(vitals), lead: WORD_LEAD },
    {
      key: 'session-turn',
      parts: lastTurn === undefined ? [] : turnParts(vitals, lastTurn),
      lead: PART_LEAD,
    },
    { key: 'session-limits', parts: limitsParts(vitals, now), lead: PART_LEAD },
  ].filter((group) => group.parts.length > 0)
}

export function detailsText(vitals: Vitals, now: number): string {
  return detailGroups(vitals, now)
    .map((group) => group.parts.map((part) => part.text).join(group.lead))
    .join('\n')
}

export function hasSessionDetails(details: SessionDetails): boolean {
  return detailGroups(details.vitals, details.now).length > 0 || details.checks.last.length > 0
}

export function drawSessionDetails(
  elements: PaneElements,
  details: SessionDetails,
  layout: RowLayout,
): RenderElement {
  const room = elements.bodyColumns - DETAIL_INDENT
  return elements.Box({
    key: 'session-details',
    flexDirection: 'column',
    paddingLeft: DETAIL_INDENT,
    children: [
      ...detailGroups(details.vitals, details.now).flatMap((group) =>
        drawPartLines(elements, group.key, group.parts, room, group.lead),
      ),
      ...drawChecks(elements, details.checks, details.names, layout, room),
    ],
  })
}
