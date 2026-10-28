import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  RenderElement,
  SessionMeasureInput,
  SessionRateLimit,
  SessionUsage,
  TextProps,
} from 'claude-code'
import { SIGNALS } from './signals'
import { cutToWidth, displayWidth } from './width'

export const CONTEXT_HIGH = 80

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit'])

export type TurnCounts = { edits: number; errors: number; spawned: number }

export type LastTurn = TurnCounts & { durationMs: number; heldCents: number | undefined }

export type Vitals = {
  isMeasured: boolean
  hasNoUsage: boolean
  percent: number | undefined
  tokens: number | undefined
  window: number | undefined
  limits: readonly SessionRateLimit[]
  usd: number | undefined
  turnStartUsd: number | undefined
  isTurnRunning: boolean
  isTurnMeasured: boolean
  compactions: number
  turn: TurnCounts
  lastTurn: LastTurn | undefined
}

const NO_COUNTS: TurnCounts = { edits: 0, errors: 0, spawned: 0 }

export const EMPTY_VITALS: Vitals = {
  isMeasured: false,
  hasNoUsage: false,
  percent: undefined,
  tokens: undefined,
  window: undefined,
  limits: [],
  usd: undefined,
  turnStartUsd: undefined,
  isTurnRunning: false,
  isTurnMeasured: false,
  compactions: 0,
  turn: NO_COUNTS,
  lastTurn: undefined,
}

export type VitalsUsage = Pick<SessionUsage, 'context' | 'cost' | 'rateLimits'>

export type VitalsMeasure = Pick<SessionMeasureInput, 'context' | 'cost' | 'changed' | 'rateLimits'>

export function withUsage(vitals: Vitals, usage: VitalsUsage): Vitals {
  if (vitals.isMeasured) return vitals
  const { context } = usage
  return {
    ...vitals,
    percent: context.percent,
    tokens: context.tokens,
    window: context.window,
    limits: usage.rateLimits,
    usd: usage.cost?.usd,
  }
}

export function withoutUsage(vitals: Vitals): Vitals {
  return vitals.isMeasured ? vitals : { ...vitals, hasNoUsage: true }
}

function turnStartAfter(vitals: Vitals, usd: number | undefined): number | undefined {
  const { turnStartUsd } = vitals
  if (turnStartUsd === undefined || usd === undefined) return turnStartUsd
  const isDropped = vitals.usd !== undefined && usd < vitals.usd
  return isDropped || usd < turnStartUsd ? usd : turnStartUsd
}

function limitsAfter(
  vitals: Vitals,
  measure: VitalsMeasure,
  changed: ReadonlySet<string>,
): readonly SessionRateLimit[] {
  const isCarried = changed.has('rateLimits') || measure.rateLimits.length > 0
  return isCarried ? measure.rateLimits : vitals.limits
}

export function withMeasure(vitals: Vitals, measure: VitalsMeasure): Vitals {
  const changed = new Set(measure.changed)
  const usd = changed.has('cost') ? measure.cost?.usd : vitals.usd
  const isTurnMeasure = changed.has('cost') || changed.has('context')
  const context = changed.has('context') ? measure.context : vitals
  return {
    ...vitals,
    isMeasured: true,
    hasNoUsage: false,
    percent: context.percent,
    tokens: context.tokens,
    window: context.window,
    limits: limitsAfter(vitals, measure, changed),
    usd,
    turnStartUsd: turnStartAfter(vitals, usd),
    isTurnMeasured: vitals.isTurnMeasured || isTurnMeasure,
  }
}

export function withTurnStart(vitals: Vitals): Vitals {
  const { lastTurn } = vitals
  return {
    ...vitals,
    isTurnRunning: true,
    turnStartUsd: vitals.usd,
    isTurnMeasured: false,
    turn: NO_COUNTS,
    lastTurn: lastTurn === undefined ? undefined : { ...lastTurn, heldCents: lastCents(vitals) },
  }
}

export function withTurnEnd(vitals: Vitals, durationMs: number): Vitals {
  return {
    ...vitals,
    isTurnRunning: false,
    turn: NO_COUNTS,
    lastTurn: { ...vitals.turn, durationMs, heldCents: undefined },
  }
}

function withCount(vitals: Vitals, change: (counts: TurnCounts) => TurnCounts): Vitals {
  return vitals.isTurnRunning ? { ...vitals, turn: change(vitals.turn) } : vitals
}

export function withTurnCall(vitals: Vitals, tool: string, isError: boolean): Vitals {
  return withCount(vitals, (counts) => ({
    ...counts,
    edits: counts.edits + (EDIT_TOOLS.has(tool) && !isError ? 1 : 0),
    errors: counts.errors + (isError ? 1 : 0),
  }))
}

export function withTurnSpawn(vitals: Vitals): Vitals {
  return withCount(vitals, (counts) => ({ ...counts, spawned: counts.spawned + 1 }))
}

export function withCompaction(vitals: Vitals): Vitals {
  return { ...vitals, compactions: vitals.compactions + 1 }
}

export function withClear(vitals: Vitals): Vitals {
  return { ...EMPTY_VITALS, hasNoUsage: vitals.hasNoUsage }
}

type Span = { text: string; isWarning: boolean }

type Piece = { lead: string; spans: readonly Span[] }

const SESSION_TITLE = 'Session'
const TITLE_GAP = '  '
const PIECE_LEAD = ' · '
const CUT_MARK = '…'
const NO_USAGE = 'no context or cost on this host'
const NO_REPLY_YET = 'until the first reply'

function cents(usd: number): number {
  return Math.round(usd * 100)
}

export function dollars(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`
}

function plain(text: string, lead = PIECE_LEAD): Piece {
  return { lead, spans: [{ text, isWarning: false }] }
}

function isHighPercent(shown: number): boolean {
  return shown >= CONTEXT_HIGH
}

export function hasReading(vitals: Vitals): boolean {
  return !vitals.hasNoUsage && vitals.tokens !== undefined
}

export function highPercent(vitals: Vitals): number | undefined {
  if (vitals.hasNoUsage || vitals.percent === undefined) return undefined
  const shown = Math.round(vitals.percent)
  return isHighPercent(shown) ? shown : undefined
}

function contextPiece(percent: number): Piece {
  const shown = Math.round(percent)
  if (!isHighPercent(shown)) return plain(`ctx ${String(shown)}%`, '')
  return {
    lead: '',
    spans: [
      { text: 'ctx ', isWarning: false },
      { text: `${String(shown)}% high`, isWarning: true },
    ],
  }
}

function addedCents(vitals: Vitals): number | undefined {
  const { usd, turnStartUsd } = vitals
  if (usd === undefined || turnStartUsd === undefined) return undefined
  return cents(usd) - cents(turnStartUsd)
}

export function lastCents(vitals: Vitals): number | undefined {
  if (vitals.isTurnRunning) return vitals.lastTurn?.heldCents
  return vitals.isTurnMeasured ? addedCents(vitals) : undefined
}

function turnPiece(vitals: Vitals): Piece | undefined {
  if (!vitals.isTurnRunning) {
    const last = lastCents(vitals)
    return last === undefined ? undefined : plain(`last +${dollars(last)}`)
  }
  const added = addedCents(vitals)
  return added !== undefined && added > 0 ? plain(`turn +${dollars(added)}`) : undefined
}

function usagePieces(vitals: Vitals): Piece[] {
  if (vitals.hasNoUsage) return [plain(NO_USAGE, '')]
  const { percent, usd } = vitals
  const context = percent === undefined ? plain('ctx —', '') : contextPiece(percent)
  if (percent === undefined && (usd ?? 0) === 0) return [context, plain(NO_REPLY_YET, ' ')]
  const turn = turnPiece(vitals)
  return [
    context,
    ...(usd === undefined ? [] : [plain(dollars(cents(usd)))]),
    ...(turn === undefined ? [] : [turn]),
  ]
}

function waitsPiece(waits: number): Piece {
  const verb = waits === 1 ? 'waits' : 'wait'
  return {
    lead: '',
    spans: [{ text: `${SIGNALS.waitsForYou.mark} ${String(waits)} ${verb}`, isWarning: true }],
  }
}

function sessionPieces(vitals: Vitals, waits = 0): Piece[] {
  const usage = usagePieces(vitals)
  if (waits === 0) return usage
  const [first, ...rest] = usage
  return [waitsPiece(waits), ...(first ? [{ ...first, lead: PIECE_LEAD }] : []), ...rest]
}

function pieceText(piece: Piece): string {
  return piece.lead + piece.spans.map((span) => span.text).join('')
}

function piecesText(pieces: readonly Piece[]): string {
  return pieces.map(pieceText).join('')
}

export function sessionText(vitals: Vitals): string {
  return `${SESSION_TITLE}${TITLE_GAP}${piecesText(sessionPieces(vitals))}`
}

function fittedPieces(pieces: readonly Piece[], room: number): Piece[] {
  const kept = [...pieces]
  while (kept.length > 1 && displayWidth(piecesText(kept)) > room) kept.pop()
  return kept
}

function cutSpans(spans: readonly Span[], room: number): Span[] {
  const total = spans.reduce((sum, span) => sum + displayWidth(span.text), 0)
  if (total <= room) return [...spans]
  let left = Math.max(room - displayWidth(CUT_MARK), 0)
  const kept: Span[] = []
  for (const span of spans) {
    const text = cutToWidth(span.text, left)
    if (text !== '') kept.push({ ...span, text })
    left -= displayWidth(text)
    if (text !== span.text) break
  }
  return [...kept, { text: CUT_MARK, isWarning: false }]
}

function lineSpans(pieces: readonly Piece[], room: number): Span[] {
  const spans = fittedPieces(pieces, room).flatMap((piece) =>
    piece.lead === '' ? piece.spans : [{ text: piece.lead, isWarning: false }, ...piece.spans],
  )
  return cutSpans(spans, room)
}

export type VitalsElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  bodyColumns: number
}

export type SessionLine = { vitals: Vitals; waits: number; open: (() => void) | undefined }

export function drawSessionLine(elements: VitalsElements, line: SessionLine): RenderElement {
  const { Box, Text, Button } = elements
  const room = elements.bodyColumns - displayWidth(`${SESSION_TITLE}${TITLE_GAP}`)
  const pieces = sessionPieces(line.vitals, line.waits)
  const children = [
    Text({ bold: true, children: SESSION_TITLE }),
    Text({ children: TITLE_GAP }),
    ...lineSpans(pieces, room).map((span) =>
      span.isWarning
        ? Text({ color: 'warning', children: span.text })
        : Text({ dimColor: true, children: span.text }),
    ),
  ]
  if (line.open === undefined) return Box({ key: 'session', flexDirection: 'row', children })
  return Button({ key: 'session', plain: true, onPress: line.open, children })
}
