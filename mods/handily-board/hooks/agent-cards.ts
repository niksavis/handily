import type { Color, RenderElement, TextProps } from 'claude-code'
import { cutName } from './names'
import type { PaneElements } from './pane'
import { cutToWidth, displayWidth, fitted } from './width'

export const CARD_COLUMNS_AT_LEAST = 18
export const CARDS_AT_MOST = 5

const CARD_GAP = 1
const SIDE_COLUMNS = 2
const HOTKEY_COLUMNS = 3
const MARK_COLUMNS = 2
const EDGE = '─'
const TOP = ['╭', '╮'] as const
const BOTTOM = ['╰', '╯'] as const
const SIDES = ['│ ', ' │'] as const
const SECOND_MS = 1000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

type TextStyle = Omit<TextProps, 'children'>

export type CardText = { text: string; style: TextStyle }

export type CardFacts = {
  id: string
  digit: string | undefined
  name: string
  mark: { mark: string; color: Color }
  state: CardText
  wait: string | null
  task: string
  type: string
  tokens: readonly string[]
  steps: number
  clockMs: number
  border: Color
  onPress: () => void
}

export function cardSlots(room: number): number {
  const fits = Math.floor((room + CARD_GAP) / (CARD_COLUMNS_AT_LEAST + CARD_GAP))
  return Math.min(CARDS_AT_MOST, Math.max(fits, 0))
}

function cardWidth(room: number, slots: number): number {
  return Math.floor((room + CARD_GAP) / slots) - CARD_GAP
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function clockText(ms: number): string {
  const seconds = Math.floor(Math.max(ms, 0) / SECOND_MS)
  const hours = Math.floor(seconds / SECONDS_PER_HOUR)
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const rest = twoDigits(seconds % SECONDS_PER_MINUTE)
  if (hours > 0) return `${String(hours)}:${twoDigits(minutes)}:${rest}`
  return `${String(minutes)}:${rest}`
}

function stepsText(steps: number): string {
  return steps === 1 ? '1 step' : `${String(steps)} steps`
}

function firstFitting(forms: readonly string[], room: number): string {
  const fitting = forms.find((form) => displayWidth(form) <= room)
  return fitting ?? fitted(forms.at(-1) ?? '', room)
}

function bodyTexts(card: CardFacts, inner: number): CardText[] {
  const steps = stepsText(card.steps)
  const clock = clockText(card.clockMs)
  const gap = Math.max(inner - displayWidth(steps) - displayWidth(clock), 1)
  return [
    { text: fitted(card.state.text, inner), style: card.state.style },
    ...(card.wait === null ? [] : [{ text: fitted(card.wait, inner), style: { dimColor: true } }]),
    { text: fitted(card.task, inner), style: {} },
    { text: cutName(card.type, inner), style: { dimColor: true } },
    { text: firstFitting(card.tokens, inner), style: { dimColor: true } },
    { text: fitted(`${steps}${' '.repeat(gap)}${clock}`, inner), style: { dimColor: true } },
  ]
}

function cutCardName(name: string, room: number): string {
  if (displayWidth(name) <= room) return name
  return `${cutToWidth(name, Math.max(room - 1, 0))}…`
}

type Segment = RenderElement[]

function edge(elements: PaneElements, card: CardFacts, width: number, ends: readonly string[]) {
  const [left = '', right = ''] = ends
  return [
    elements.Text({
      color: card.border,
      children: `${left}${EDGE.repeat(Math.max(width - 2, 0))}${right}`,
    }),
  ]
}

function padded(elements: PaneElements, used: number, inner: number): RenderElement[] {
  const pad = inner - used
  return pad > 0 ? [elements.Text({ children: ' '.repeat(pad) })] : []
}

function sided(elements: PaneElements, card: CardFacts, middle: RenderElement[]): Segment {
  const [left, right] = SIDES
  return [
    elements.Text({ color: card.border, children: left }),
    ...middle,
    elements.Text({ color: card.border, children: right }),
  ]
}

function titleSegment(elements: PaneElements, card: CardFacts, inner: number): Segment {
  const { Button, Text } = elements
  const nameRoom = inner - HOTKEY_COLUMNS - MARK_COLUMNS
  const name = cutCardName(card.name, nameRoom)
  const used = HOTKEY_COLUMNS + MARK_COLUMNS + displayWidth(name)
  const label = [
    Text({ color: card.mark.color, children: `${card.mark.mark} ` }),
    Text({ bold: true, children: name }),
  ]
  const button = Button({
    key: `open:agent:${card.id}`,
    plain: true,
    ...(card.digit === undefined ? {} : { hotkey: card.digit }),
    onPress: card.onPress,
    children: label,
  })
  const lead = card.digit === undefined ? [Text({ children: ' '.repeat(HOTKEY_COLUMNS) })] : []
  return sided(elements, card, [...lead, button, ...padded(elements, used, inner)])
}

function textSegment(
  elements: PaneElements,
  card: CardFacts,
  line: CardText | undefined,
  inner: number,
) {
  const text = line?.text ?? ''
  return sided(elements, card, [
    elements.Text({ ...(line?.style ?? {}), children: text }),
    ...padded(elements, displayWidth(text), inner),
  ])
}

function cardSegments(
  elements: PaneElements,
  card: CardFacts,
  width: number,
  height: number,
): Segment[] {
  const inner = width - 2 * SIDE_COLUMNS
  const body = bodyTexts(card, inner)
  return [
    edge(elements, card, width, TOP),
    titleSegment(elements, card, inner),
    ...Array.from({ length: height }, (_, index) =>
      textSegment(elements, card, body[index], inner),
    ),
    edge(elements, card, width, BOTTOM),
  ]
}

export function drawCards(
  elements: PaneElements,
  cards: readonly CardFacts[],
  slots: number,
): RenderElement[] {
  const { Box, Text } = elements
  const width = cardWidth(elements.bodyColumns, slots)
  const inner = width - 2 * SIDE_COLUMNS
  const height = Math.max(...cards.map((card) => bodyTexts(card, inner).length))
  const columns = cards.map((card) => cardSegments(elements, card, width, height))
  const lines = columns[0]?.length ?? 0
  return Array.from({ length: lines }, (_, line) =>
    Box({
      key: `cards:${String(line)}`,
      flexDirection: 'row',
      children: columns.flatMap((segments, index) => [
        index === 0 ? null : Text({ children: ' '.repeat(CARD_GAP) }),
        Box({
          width,
          flexShrink: 0,
          flexDirection: 'row',
          children: segments[line] ?? [],
        }),
      ]),
    }),
  )
}
