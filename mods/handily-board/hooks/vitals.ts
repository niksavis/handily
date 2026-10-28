import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  RenderElement,
  SessionMeasureInput,
  SessionUsage,
  TextProps,
} from 'claude-code'
import { SIGNALS } from './signals'
import { cutToWidth, displayWidth } from './width'

export const CONTEXT_HIGH = 80

export type Vitals = {
  isMeasured: boolean
  hasNoUsage: boolean
  percent: number | undefined
  usd: number | undefined
  turnStartUsd: number | undefined
  isTurnRunning: boolean
  isTurnMeasured: boolean
}

export const EMPTY_VITALS: Vitals = {
  isMeasured: false,
  hasNoUsage: false,
  percent: undefined,
  usd: undefined,
  turnStartUsd: undefined,
  isTurnRunning: false,
  isTurnMeasured: false,
}

export type VitalsUsage = Pick<SessionUsage, 'context' | 'cost'>

export type VitalsMeasure = Pick<SessionMeasureInput, 'context' | 'cost' | 'changed'>

export function withUsage(vitals: Vitals, usage: VitalsUsage): Vitals {
  if (vitals.isMeasured) return vitals
  return { ...vitals, percent: usage.context.percent, usd: usage.cost?.usd }
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

export function withMeasure(vitals: Vitals, measure: VitalsMeasure): Vitals {
  const changed = new Set(measure.changed)
  const usd = changed.has('cost') ? measure.cost?.usd : vitals.usd
  const isTurnMeasure = changed.has('cost') || changed.has('context')
  return {
    ...vitals,
    isMeasured: true,
    hasNoUsage: false,
    percent: changed.has('context') ? measure.context.percent : vitals.percent,
    usd,
    turnStartUsd: turnStartAfter(vitals, usd),
    isTurnMeasured: vitals.isTurnMeasured || isTurnMeasure,
  }
}

export function withTurnStart(vitals: Vitals): Vitals {
  return { ...vitals, isTurnRunning: true, turnStartUsd: vitals.usd, isTurnMeasured: false }
}

export function withTurnEnd(vitals: Vitals): Vitals {
  return { ...vitals, isTurnRunning: false }
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

function dollars(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`
}

function plain(text: string, lead = PIECE_LEAD): Piece {
  return { lead, spans: [{ text, isWarning: false }] }
}

function isHighPercent(shown: number): boolean {
  return shown >= CONTEXT_HIGH
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

function turnPiece(vitals: Vitals): Piece | undefined {
  const { usd, turnStartUsd, isTurnRunning, isTurnMeasured } = vitals
  if (usd === undefined || turnStartUsd === undefined) return undefined
  const added = cents(usd) - cents(turnStartUsd)
  if (!isTurnRunning) return isTurnMeasured ? plain(`last +${dollars(added)}`) : undefined
  return added > 0 ? plain(`turn +${dollars(added)}`) : undefined
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
