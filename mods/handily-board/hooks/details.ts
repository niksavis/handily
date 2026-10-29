import type { RenderElement, SessionRateLimit } from 'claude-code'
import type { BoardChecks } from '../types'
import { elapsedText } from './activity'
import { type ContextView, contextPartsText, drawContextParts } from './breakdown'
import { drawChecks } from './checks'
import type { PaneElements, RowLayout } from './pane'
import { type Part, PART_LEAD, drawFitLine, drawPartLines, fitLineText } from './parts'
import { escaped } from './tasks'
import { tokensText } from './tokens'
import { trendLine } from './trend'
import { type Vitals, hasReading, highPercent } from './vitals'

export const SESSION_DETAILS = 'session:details'

const DETAIL_INDENT = 4
const CONTEXT_GROUP = 'session-context'
const WORD_LEAD = ' '
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
  context: ContextView
  count: () => void
}

type Group = { key: string; parts: readonly Part[]; lead: string }

export function counted(count: number, one: string, many: string): string {
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

export function limitName(limit: SessionRateLimit): string {
  return LIMIT_NAMES[limit.kind] ?? escaped(limit.kind)
}

function resetsInMs(limit: SessionRateLimit, now: number): number | undefined {
  if (limit.resetsAt === undefined) return undefined
  const at = Date.parse(limit.resetsAt)
  return Number.isFinite(at) ? at - now : undefined
}

function resetText(limit: SessionRateLimit, now: number): string | undefined {
  const inMs = resetsInMs(limit, now)
  if (inMs === undefined) return undefined
  const name = limitName(limit)
  return inMs <= 0 ? `${name} now` : `${name} in ${elapsedText(inMs)}`
}

function limitsParts(vitals: Vitals, now: number): Part[] {
  if (vitals.limits.length === 0) return hasReading(vitals) ? [{ text: NO_LIMITS }] : []
  const used = vitals.limits.map(
    (limit) => `${limitName(limit)} ${String(Math.round(limit.percentUsed))}%`,
  )
  const resets = vitals.limits.flatMap((limit) => {
    const text = resetText(limit, now)
    return text === undefined ? [] : [text]
  })
  return [
    ...used.map((text, index) => ({ text: index === 0 ? `limits ${text}` : text })),
    ...resets.map((text, index) => ({ text: index === 0 ? `resets ${text}` : text })),
  ]
}

function detailGroups(vitals: Vitals, now: number): Group[] {
  return [
    { key: CONTEXT_GROUP, parts: contextParts(vitals), lead: PART_LEAD },
    { key: 'session-near-limit', parts: nearLimitParts(vitals), lead: WORD_LEAD },
    { key: 'session-limits', parts: limitsParts(vitals, now), lead: PART_LEAD },
  ].filter((group) => group.parts.length > 0)
}

function groupText(group: Group): string {
  return group.parts.map((part) => part.text).join(group.lead)
}

function hasContextLines(group: Group): boolean {
  return group.key === CONTEXT_GROUP
}

function contextTrend(vitals: Vitals, context: ContextView) {
  return trendLine(context.trend, vitals.window, hasReading(vitals))
}

export function detailsText(vitals: Vitals, now: number, context?: ContextView): string {
  return detailGroups(vitals, now)
    .flatMap((group) =>
      context !== undefined && hasContextLines(group)
        ? [
            groupText(group),
            fitLineText(contextTrend(vitals, context)),
            ...contextPartsText(context),
          ]
        : [groupText(group)],
    )
    .join('\n')
}

export function hasSessionDetails(details: SessionDetails): boolean {
  return detailGroups(details.vitals, details.now).length > 0 || details.checks.last.length > 0
}

export function drawSessionDetails(
  elements: PaneElements,
  details: SessionDetails,
  layout: RowLayout,
  indent = DETAIL_INDENT,
): RenderElement {
  const room = elements.bodyColumns - indent
  const { vitals, context } = details
  const press = { layout, count: details.count }
  return elements.Box({
    key: 'session-details',
    flexDirection: 'column',
    paddingLeft: indent,
    children: [
      ...detailGroups(vitals, details.now).flatMap((group) => [
        ...drawPartLines(elements, group.key, group.parts, room, group.lead),
        ...(hasContextLines(group)
          ? [
              drawFitLine(elements, contextTrend(vitals, context), room),
              ...drawContextParts(elements, context, press, room),
            ]
          : []),
      ]),
      ...drawChecks(elements, details.checks, details.names, layout, room),
    ],
  })
}
