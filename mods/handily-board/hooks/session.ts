import type { RenderElement, ThemeKey } from 'claude-code'
import type { BoardChecks } from '../types'
import { elapsedText } from './activity'
import { gateAtoms } from './checks'
import { counted, limitName } from './details'
import { SESSION_LOOK, drawStyledParts, titlePart } from './frame'
import { CONTEXT_CELLS, LIMIT_CELLS, gaugeForms } from './gauge'
import type { PaneElements } from './pane'
import { type Atom, type FlowAtom, type Part, fitAtoms, flowLines, spansWidth } from './parts'
import { type RequestFacts, requestAtoms } from './request'
import { SIGNALS } from './signals'
import { type Vitals, addedCents, cents, dollars, lastCents } from './vitals'
import { displayWidth } from './width'

export type SessionView = {
  vitals: Vitals
  waits: number
  checks: BoardChecks
  request: RequestFacts
  now: number
}

export type SessionLine = { key: string; parts: readonly Part[] }

export type SessionLines = { head: readonly SessionLine[]; rest: readonly SessionLine[] }

const TITLE_GAP = '  '
const INLINE_INDENT = 4
const GATE_LEAD = ' '
const NO_USAGE = 'no context or cost on this host'
const NO_REPLY_YET = 'until the first reply'
const NO_READING = '—'
const ERROR_COLOR: ThemeKey = 'error'
const WAITS_COLOR: ThemeKey = SIGNALS.waitsForYou.color
const ERRORS_RANK = 1
const SPAWNED_RANK = 2

function single(parts: readonly Part[]): FlowAtom {
  return { forms: [parts] }
}

function isBeforeReply(vitals: Vitals): boolean {
  return vitals.percent === undefined && (vitals.usd ?? 0) === 0
}

function waitsAtom(waits: number): FlowAtom {
  const verb = waits === 1 ? 'waits' : 'wait'
  const text = `${SIGNALS.waitsForYou.mark} ${String(waits)} ${verb}`
  return single([{ text, color: WAITS_COLOR }])
}

function untilReply(label: string): FlowAtom {
  return {
    forms: [
      [{ text: `${label} ${NO_READING} ${NO_REPLY_YET}` }],
      [{ text: `${label} ${NO_READING}` }],
    ],
  }
}

function readingAtoms(vitals: Vitals, hasGauge: boolean): FlowAtom[] {
  if (vitals.hasNoUsage) return [single([{ text: NO_USAGE }])]
  if (isBeforeReply(vitals)) return [untilReply('ctx')]
  const { percent } = vitals
  if (percent === undefined) return [single([{ text: `ctx ${NO_READING}` }])]
  const [gauge = [], words = []] = gaugeForms('ctx', percent, CONTEXT_CELLS)
  return [single(hasGauge ? gauge : words)]
}

function contextAtoms(view: SessionView, hasGauge = true): FlowAtom[] {
  const waits = view.waits === 0 ? [] : [waitsAtom(view.waits)]
  return [...waits, ...readingAtoms(view.vitals, hasGauge)]
}

function costAtoms(vitals: Vitals): FlowAtom[] {
  const { usd } = vitals
  return usd === undefined ? [] : [single([{ text: dollars(cents(usd)) }])]
}

function moneyAtoms(vitals: Vitals, hasPlaceholders: boolean): FlowAtom[] {
  if (vitals.hasNoUsage) return []
  if (isBeforeReply(vitals)) return hasPlaceholders ? [untilReply('limits')] : []
  return [
    ...costAtoms(vitals),
    ...vitals.limits.map((limit) => ({
      forms: gaugeForms(limitName(limit), limit.percentUsed, LIMIT_CELLS),
    })),
  ]
}

type TurnFacts = {
  label: string
  edits: number
  errors: number
  spawned: number
  cost: number | undefined
}

function turnFacts(vitals: Vitals, now: number): TurnFacts | undefined {
  if (vitals.isTurnRunning) {
    const since = now - (vitals.turnStartedAt ?? now)
    const cost = vitals.isTurnMeasured ? addedCents(vitals) : undefined
    return { label: `turn ${elapsedText(since)}`, ...vitals.turn, cost }
  }
  const { lastTurn } = vitals
  if (lastTurn === undefined) return undefined
  const label = `last ${elapsedText(lastTurn.durationMs)}`
  return { label, ...lastTurn, cost: lastCents(vitals) }
}

function errorsAtom(errors: number): Atom {
  const text = counted(errors, 'error', 'errors')
  return errors === 0
    ? { parts: [{ text }], dropRank: ERRORS_RANK }
    : { parts: [{ text, color: ERROR_COLOR }] }
}

function receiptAtoms(vitals: Vitals, now: number): Atom[] {
  const facts = turnFacts(vitals, now)
  if (facts === undefined) return []
  const spawned = counted(facts.spawned, 'agent spawned', 'agents spawned')
  return [
    { parts: [{ text: facts.label }] },
    { parts: [{ text: counted(facts.edits, 'edit', 'edits') }] },
    errorsAtom(facts.errors),
    ...(facts.cost === undefined ? [] : [{ parts: [{ text: `+${dollars(facts.cost)}` }] }]),
    ...(facts.spawned === 0 ? [] : [{ parts: [{ text: spawned }], dropRank: SPAWNED_RANK }]),
  ]
}

function atomsWidth(atoms: readonly Atom[]): number {
  return spansWidth(fitAtoms(atoms, Number.POSITIVE_INFINITY))
}

type RestLook = { isJoined: boolean; hasPlaceholders: boolean }

function restLines(view: SessionView, room: number, look: RestLook): SessionLine[] {
  const request = requestAtoms(view.request)
  const receipt = receiptAtoms(view.vitals, view.now)
  const both = [...request, ...receipt]
  const kept = both.filter((atom) => atom.dropRank === undefined)
  const isOneLine =
    look.isJoined && request.length > 0 && receipt.length > 0 && atomsWidth(kept) <= room
  const lines = isOneLine
    ? [{ key: 'session-request', parts: fitAtoms(both, room) }]
    : [
        { key: 'session-request', parts: fitAtoms(request, room) },
        { key: 'session-receipt', parts: fitAtoms(receipt, room) },
      ]
  const hasGate = look.hasPlaceholders || view.checks.last.length > 0
  const gate = hasGate ? fitAtoms(gateAtoms(view.checks, room), room, GATE_LEAD) : []
  return [...lines, { key: 'session-gate', parts: gate }].filter((line) => line.parts.length > 0)
}

function keyed(lines: readonly (readonly Part[])[], key: string): SessionLine[] {
  return lines
    .filter((parts) => parts.length > 0)
    .map((parts, index) => ({ key: index === 0 ? key : `${key}:${String(index)}`, parts }))
}

export function framedLines(view: SessionView, room: number): SessionLines {
  return {
    head: keyed(flowLines(contextAtoms(view), room, room), 'session'),
    rest: [
      ...keyed(flowLines(moneyAtoms(view.vitals, true), room, room), 'session-money'),
      ...restLines(view, room, { isJoined: false, hasPlaceholders: true }),
    ],
  }
}

function titleWidth(): number {
  return displayWidth(`${SESSION_LOOK.title}${TITLE_GAP}`)
}

function flatIndent(isInline: boolean): number {
  return isInline ? INLINE_INDENT : 0
}

export function flatLines(view: SessionView, room: number, isInline: boolean): SessionLines {
  const lineRoom = room - flatIndent(isInline)
  const atoms = [...contextAtoms(view), ...moneyAtoms(view.vitals, false)]
  const [first = [], ...more] = flowLines(atoms, room - titleWidth(), lineRoom)
  return {
    head: [{ key: 'session', parts: first }, ...keyed(more, 'session-more')],
    rest: restLines(view, lineRoom, { isJoined: isInline, hasPlaceholders: false }),
  }
}

function linesText(lines: readonly SessionLine[]): string[] {
  return lines.map((line) => line.parts.map((part) => part.text).join(''))
}

export function sessionBlockText(view: SessionView): string {
  const { head, rest } = flatLines(view, Number.POSITIVE_INFINITY, false)
  const [first = '', ...more] = linesText([...head, ...rest])
  return [`${SESSION_LOOK.title}${TITLE_GAP}${first}`.trimEnd(), ...more].join('\n')
}

export function sessionHeadWords(view: SessionView): string {
  const { vitals } = view
  const hasCost = !vitals.hasNoUsage && !isBeforeReply(vitals)
  const atoms = [...contextAtoms(view, false), ...(hasCost ? costAtoms(vitals) : [])]
  const [line = []] = flowLines(atoms, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  return `${SESSION_LOOK.title}${TITLE_GAP}${line.map((part) => part.text).join('')}`
}

export function receiptWords(view: SessionView): string | undefined {
  const atoms = receiptAtoms(view.vitals, view.now)
  if (atoms.length === 0) return undefined
  return fitAtoms(atoms, Number.POSITIVE_INFINITY)
    .map((part) => part.text)
    .join('')
}

function partTexts(elements: PaneElements, parts: readonly Part[]): RenderElement[] {
  return parts.map((part) =>
    part.color === undefined
      ? elements.Text({ dimColor: true, children: part.text })
      : elements.Text({ color: part.color, children: part.text }),
  )
}

export type SessionDraw = {
  lines: SessionLines
  hasTitle: boolean
  indent: number
  open: (() => void) | undefined
  details: RenderElement | null
}

function drawHead(elements: PaneElements, draw: SessionDraw, line: SessionLine): RenderElement {
  const { Box, Button, Text } = elements
  const title = titlePart(SESSION_LOOK)
  const children = [
    ...(draw.hasTitle
      ? [
          ...drawStyledParts(elements, [title]),
          Text({ children: line.parts.length === 0 ? '' : TITLE_GAP }),
        ]
      : []),
    ...partTexts(elements, line.parts),
  ]
  if (draw.open === undefined) return Box({ key: line.key, flexDirection: 'row', children })
  return Button({ key: line.key, plain: true, onPress: draw.open, children })
}

function drawLine(elements: PaneElements, line: SessionLine, indent: number): RenderElement {
  return elements.Box({
    key: line.key,
    flexDirection: 'row',
    paddingLeft: indent,
    children: partTexts(elements, line.parts),
  })
}

export function drawSessionLines(elements: PaneElements, draw: SessionDraw): RenderElement[] {
  const [first, ...more] = draw.lines.head
  return [
    first === undefined ? null : drawHead(elements, draw, first),
    ...more.map((line) => drawLine(elements, line, draw.indent)),
    draw.details,
    ...draw.lines.rest.map((line) => drawLine(elements, line, draw.indent)),
  ].filter((element) => element !== null)
}

export function sessionIndent(isInline: boolean): number {
  return flatIndent(isInline)
}
