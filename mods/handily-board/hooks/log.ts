import type { RenderElement } from 'claude-code'
import { groupedCount } from './checks'
import { maskedCredentials } from './credentials'
import {
  FRAME_TITLE_CHROME,
  LOG_LOOK,
  type StyledPart,
  drawFrame,
  drawStyledParts,
  framedElements,
  isFramed,
  titlePart,
  wrappedText,
} from './frame'
import { paletteColor } from './palette'
import type { PaneElements, RowLayout } from './pane'
import { fitParts } from './parts'
import { SIGNALS, type SignalLooks } from './signals'
import { escaped } from './tasks'
import { cutToWidth, displayWidth, fitted, padToWidth } from './width'

export const LOG_KEPT = 100

export type LogKind =
  'prompt' | 'spawn' | 'done' | 'failed' | 'aborted' | 'edit' | 'error' | 'denied'

export type LogEvent = { at: number; kind: LogKind; agentId: string | null; detail: string }

export type BoardLog = { events: readonly LogEvent[]; seen: number }

export type LogFilter = { agentId: string; name: string; why: string }

export type LogView = {
  log: BoardLog
  names: ReadonlyMap<string, string>
  filter: LogFilter | undefined
  layout: RowLayout
}

type LogSize = { rows: number; whoWidth: number; hasSeconds: boolean }

export const EMPTY_LOG: BoardLog = { events: [], seen: 0 }

const DETAIL_CHARS_AT_MOST = 200
const EARLIER_GROUP = 'group:log-earlier'
const WIDE_FROM = 41
const SECONDS_FROM = 76
const ROWS_WIDE = 5
const ROWS_NARROW = 3
const WHO_WIDE = 9
const WHO_NARROW = 5
const GAP = ' '
const PERSON = 'you'
const MAIN_LOOP = 'main'
const EMPTY_TEXT = 'Prompts, spawns, edits, errors and denials show here, newest first.'
const NOTHING_YET = 'nothing yet'
const BUTTON_CHROME = 4
const CUT_MARK = '…'
const SHORT_ID = 8

export function withEvent(log: BoardLog, event: LogEvent): BoardLog {
  const events = [...log.events, event].sort((a, b) => a.at - b.at)
  return { events: events.slice(-LOG_KEPT), seen: log.seen + 1 }
}

export function logDetail(text: string): string {
  const line = text.split('\n').find((one) => one.trim() !== '') ?? ''
  return escaped(maskedCredentials(line.trim()).slice(0, DETAIL_CHARS_AT_MOST))
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function logTime(at: number, hasSeconds: boolean): string {
  const date = new Date(at)
  const minutes = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
  return hasSeconds ? `${minutes}:${twoDigits(date.getSeconds())}` : minutes
}

export function whoOf(event: LogEvent, names: ReadonlyMap<string, string>): string {
  if (event.kind === 'prompt') return PERSON
  if (event.agentId === null) return MAIN_LOOP
  return names.get(event.agentId) ?? escaped(event.agentId.slice(0, SHORT_ID))
}

function isAgentAsked(agentId: string, asked: string, who: LogWho): boolean {
  return (
    asked === agentId || asked === agentId.slice(0, SHORT_ID) || who.labels.get(agentId) === asked
  )
}

function askedAgents(log: BoardLog, who: LogWho, asked: string): ReadonlySet<string> {
  const drawn = [...who.names].filter(([, name]) => name === asked).map(([agentId]) => agentId)
  if (drawn.length > 0) return new Set(drawn)
  const logged = log.events.map((event) => event.agentId).filter((agentId) => agentId !== null)
  return new Set(logged.filter((agentId) => isAgentAsked(agentId, asked, who)))
}

function isEventOf(event: LogEvent, asked: string, agents: ReadonlySet<string>): boolean {
  if (event.kind === 'prompt') return asked === PERSON
  if (event.agentId === null) return asked === MAIN_LOOP
  return agents.has(event.agentId)
}

function marked(mark: string, word: string, detail: string, color: StyledPart['color']) {
  return [{ text: `${mark} ${word}`, color }, { text: detail === '' ? '' : ` ${detail}` }]
}

function whatParts(event: LogEvent, signals: SignalLooks): StyledPart[] {
  const { blocked, done } = signals
  switch (event.kind) {
    case 'prompt':
    case 'edit':
      return [{ text: event.detail }]
    case 'spawn':
      return [{ text: `spawned: ${event.detail}` }]
    case 'done':
      return marked(done.mark, 'done', event.detail, SIGNALS.done.color)
    case 'failed':
      return marked(blocked.mark, 'failed', event.detail, SIGNALS.blocked.color)
    case 'aborted':
      return marked(blocked.mark, 'aborted', event.detail, SIGNALS.blocked.color)
    case 'error':
      return marked(blocked.mark, 'failed', event.detail, SIGNALS.blocked.color)
    case 'denied':
      return marked(blocked.mark, 'denied', event.detail, SIGNALS.blocked.color)
  }
}

function partsText(parts: readonly StyledPart[]): string {
  return parts.map((part) => part.text).join('')
}

export function eventsOf(log: BoardLog, agentId: string | undefined): LogEvent[] {
  const newestFirst = [...log.events].reverse()
  return agentId === undefined
    ? newestFirst
    : newestFirst.filter((event) => event.agentId === agentId)
}

function countText(view: LogView, shown: number): string {
  const { log, filter } = view
  if (filter !== undefined) {
    return `${filter.name} · ${String(shown)} of ${groupedCount(log.events.length)}`
  }
  if (log.seen === 0) return NOTHING_YET
  const seen = `${groupedCount(log.seen)} ${log.seen === 1 ? 'event' : 'events'}`
  return log.seen > log.events.length ? `${seen} · ${String(log.events.length)} kept` : seen
}

function titleParts(elements: PaneElements, text: string): StyledPart[] {
  return [titlePart(LOG_LOOK, elements.palette), { text: `  ${text}`, dimColor: true }]
}

function sizeOf(outer: PaneElements): LogSize {
  const isWide = outer.bodyColumns >= WIDE_FROM
  return {
    rows: isWide ? ROWS_WIDE : ROWS_NARROW,
    whoWidth: isWide ? WHO_WIDE : WHO_NARROW,
    hasSeconds: outer.bodyColumns >= SECONDS_FROM,
  }
}

function fittedWhat(parts: readonly StyledPart[], room: number): StyledPart[] {
  if (displayWidth(partsText(parts)) <= room) return [...parts]
  const shown = fitParts(parts, room)
  if (partsText(shown).endsWith(CUT_MARK)) return shown
  return [...fitParts(parts, room - displayWidth(CUT_MARK)), { text: CUT_MARK }]
}

function eventRow(
  elements: PaneElements,
  event: LogEvent,
  view: LogView,
  size: LogSize,
  index: number,
): RenderElement {
  const { Box, Text } = elements
  const time = logTime(event.at, size.hasSeconds)
  const who = padToWidth(cutToWidth(whoOf(event, view.names), size.whoWidth), size.whoWidth)
  const room = elements.bodyColumns - displayWidth(time) - size.whoWidth - 2 * displayWidth(GAP)
  const what = whatParts(event, elements.signals).filter((part) => part.text !== '')
  return Box({
    key: `log:${String(index)}`,
    flexDirection: 'row',
    children: [
      Text({ dimColor: true, children: `${time}${GAP}` }),
      Text({ children: `${who}${GAP}` }),
      ...drawStyledParts(elements, fittedWhat(what, room)),
    ],
  })
}

function earlierButton(elements: PaneElements, layout: RowLayout, hidden: number, isAll: boolean) {
  const label = isAll ? `hide ${String(hidden)} earlier` : `+${String(hidden)} earlier`
  if (displayWidth(label) + BUTTON_CHROME > elements.bodyColumns) return null
  return elements.Button({
    key: EARLIER_GROUP,
    label,
    onPress: () => {
      layout.toggle(EARLIER_GROUP)
    },
  })
}

function dimLines(elements: PaneElements, text: string): RenderElement[] {
  return wrappedText(text, elements.bodyColumns).map((line) =>
    elements.Text({ dimColor: true, children: fitted(line, elements.bodyColumns) }),
  )
}

function logBody(
  elements: PaneElements,
  view: LogView,
  events: readonly LogEvent[],
  size: LogSize,
) {
  const { filter, layout } = view
  if (view.log.seen === 0 && filter === undefined) return dimLines(elements, EMPTY_TEXT)
  const isAll = layout.expanded.has(EARLIER_GROUP)
  const shown = isAll ? events : events.slice(0, size.rows)
  const hidden = events.length - size.rows
  return [
    ...(filter === undefined ? [] : dimLines(elements, filter.why)),
    ...shown.map((event, index) => eventRow(elements, event, view, size, index)),
    hidden > 0 ? earlierButton(elements, layout, hidden, isAll) : null,
  ].filter((element) => element !== null)
}

export function drawLog(outer: PaneElements, view: LogView): RenderElement[] {
  if (outer.isInline) return []
  const isFramedHere = isFramed(outer)
  const elements = isFramedHere ? framedElements(outer) : outer
  const events = eventsOf(view.log, view.filter?.agentId)
  const count = countText(view, events.length)
  const rows = logBody(elements, view, events, sizeOf(outer))
  const body = [elements.Box({ key: 'log-body', flexDirection: 'column', children: rows })]
  if (isFramedHere) {
    const room = outer.bodyColumns - FRAME_TITLE_CHROME
    const title = fitParts(titleParts(outer, count), room)
    return [drawFrame(outer, 'log', LOG_LOOK, title, body)]
  }
  const { Box, Text } = elements
  return [
    Box({
      key: 'log-rule',
      children: [
        Text({
          color: paletteColor('rules', elements.palette),
          children: '─'.repeat(elements.bodyColumns),
        }),
      ],
    }),
    Box({
      key: 'log',
      flexDirection: 'row',
      children: drawStyledParts(
        elements,
        fitParts(titleParts(elements, count), elements.bodyColumns),
      ),
    }),
    ...body,
  ]
}

export type LogWho = { names: ReadonlyMap<string, string>; labels: ReadonlyMap<string, string> }

export function logText(log: BoardLog, who: LogWho, signals: SignalLooks, asked: string): string {
  const { names } = who
  const agents = askedAgents(log, who, asked)
  const lines = eventsOf(log, undefined)
    .filter((event) => asked === '' || isEventOf(event, asked, agents))
    .map(
      (event) =>
        `${logTime(event.at, true)} ${whoOf(event, names)} ${partsText(whatParts(event, signals))}`,
    )
  if (lines.length > 0) return lines.join('\n')
  if (asked !== '') return `The log has no event of ${JSON.stringify(asked)}.`
  return 'The log is empty. It keeps the prompts, spawns, completions, edits, errors and denials that the board saw since it loaded.'
}
