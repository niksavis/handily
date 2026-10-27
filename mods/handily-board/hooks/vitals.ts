import type {
  BoxProps,
  ElementConstructor,
  RenderElement,
  SessionMeasureInput,
  SessionUsage,
  TextProps,
} from 'claude-code'
import { cutToWidth, displayWidth } from './width'

export const CONTEXT_HIGH = 80

export type Vitals = {
  isMeasured: boolean
  hasNoUsage: boolean
  percent: number | undefined
  usd: number | undefined
  turnStartUsd: number | undefined
  isTurnRunning: boolean
}

export const EMPTY_VITALS: Vitals = {
  isMeasured: false,
  hasNoUsage: false,
  percent: undefined,
  usd: undefined,
  turnStartUsd: undefined,
  isTurnRunning: false,
}

export type VitalsUsage = Pick<SessionUsage, 'context' | 'cost'>

export type VitalsMeasure = Pick<SessionMeasureInput, 'context' | 'cost' | 'changed'>

function hasHistory(usage: VitalsUsage): boolean {
  return usage.context.percent !== undefined || (usage.cost?.usd ?? 0) > 0
}

export function withUsage(vitals: Vitals, usage: VitalsUsage): Vitals {
  if (vitals.isMeasured || !hasHistory(usage)) return vitals
  return { ...vitals, percent: usage.context.percent, usd: usage.cost?.usd }
}

export function withoutUsage(vitals: Vitals): Vitals {
  return vitals.isMeasured ? vitals : { ...vitals, hasNoUsage: true }
}

export function withMeasure(vitals: Vitals, measure: VitalsMeasure): Vitals {
  const changed = new Set(measure.changed)
  return {
    ...vitals,
    isMeasured: true,
    hasNoUsage: false,
    percent: changed.has('context') ? measure.context.percent : vitals.percent,
    usd: changed.has('cost') ? measure.cost?.usd : vitals.usd,
  }
}

export function withTurnStart(vitals: Vitals): Vitals {
  return { ...vitals, isTurnRunning: true, turnStartUsd: vitals.usd ?? 0 }
}

export function withTurnEnd(vitals: Vitals): Vitals {
  return { ...vitals, isTurnRunning: false }
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

function dollars(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`
}

function plain(text: string, lead = PIECE_LEAD): Piece {
  return { lead, spans: [{ text, isWarning: false }] }
}

function contextPiece(percent: number): Piece {
  const shown = Math.round(percent)
  if (shown < CONTEXT_HIGH) return plain(`ctx ${String(shown)}%`, '')
  return {
    lead: '',
    spans: [
      { text: 'ctx ', isWarning: false },
      { text: `${String(shown)}% high`, isWarning: true },
    ],
  }
}

function turnPiece(vitals: Vitals): Piece | undefined {
  const { usd, turnStartUsd, isTurnRunning } = vitals
  if (usd === undefined || turnStartUsd === undefined) return undefined
  const added = cents(usd) - cents(turnStartUsd)
  if (!isTurnRunning) return plain(`last +${dollars(added)}`)
  return added > 0 ? plain(`turn +${dollars(added)}`) : undefined
}

function sessionPieces(vitals: Vitals): Piece[] {
  if (vitals.hasNoUsage) return [plain(NO_USAGE, '')]
  const { percent, usd } = vitals
  const context = percent === undefined ? plain('ctx —', '') : contextPiece(percent)
  if (percent === undefined && usd === undefined) return [context, plain(NO_REPLY_YET, ' ')]
  const turn = turnPiece(vitals)
  return [
    context,
    ...(usd === undefined ? [] : [plain(dollars(cents(usd)))]),
    ...(turn === undefined ? [] : [turn]),
  ]
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
  bodyColumns: number
}

export function drawSessionLine(elements: VitalsElements, vitals: Vitals): RenderElement {
  const { Box, Text } = elements
  const room = elements.bodyColumns - displayWidth(`${SESSION_TITLE}${TITLE_GAP}`)
  return Box({
    key: 'session',
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: SESSION_TITLE }),
      Text({ children: TITLE_GAP }),
      ...lineSpans(sessionPieces(vitals), room).map((span) =>
        span.isWarning
          ? Text({ color: 'warning', children: span.text })
          : Text({ dimColor: true, children: span.text }),
      ),
    ],
  })
}
