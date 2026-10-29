import type { RenderElement, TextProps, ThemeKey } from 'claude-code'
import type { PaneElements } from './pane'
import { fitParts } from './parts'
import { cutToWidth, displayWidth } from './width'

const FRAME_FROM = 41
export const FRAME_COLUMNS = 4

const TOP_LEAD = '╭─ '
const TOP_END = '╮'
const BOTTOM_LEAD = '╰'
const BOTTOM_END = '╯'
const EDGE = '─'
const SIDE_LEFT = '│ '
const SIDE_RIGHT = ' │'
const TITLE_GAP = 1
const EDGE_AT_LEAST = 1

export const FRAME_TITLE_CHROME =
  displayWidth(TOP_LEAD) + TITLE_GAP + EDGE_AT_LEAST + displayWidth(TOP_END)

export type StyledPart = { text: string } & Omit<TextProps, 'children'>

export type SectionLook = { title: string; color: ThemeKey }

export const SESSION_LOOK: SectionLook = { title: 'Session', color: 'claude' }
export const TASKS_LOOK: SectionLook = { title: 'Tasks', color: 'planMode' }
export const AGENTS_LOOK: SectionLook = { title: 'Agents', color: 'merged' }

export function titlePart(look: SectionLook): StyledPart {
  return { text: look.title, bold: true, color: look.color }
}

export function isFramed(elements: PaneElements): boolean {
  return elements.canFrame && !elements.isInline && elements.bodyColumns >= FRAME_FROM
}

export function framedElements(elements: PaneElements): PaneElements {
  return { ...elements, bodyColumns: elements.bodyColumns - FRAME_COLUMNS }
}

export function drawStyledParts(
  elements: PaneElements,
  parts: readonly StyledPart[],
): RenderElement[] {
  return parts.map(({ text, ...style }) => elements.Text({ ...style, children: text }))
}

function isElement(node: unknown): node is RenderElement {
  return typeof node === 'object' && node !== null && 'type' in node
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function chunks(word: string, room: number): string[] {
  const parts: string[] = []
  let rest = word
  while (displayWidth(rest) > room) {
    const head = cutToWidth(rest, room)
    if (head === '') break
    parts.push(head)
    rest = rest.slice(head.length)
  }
  return [...parts, rest]
}

function wrappedText(text: string, room: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ').flatMap((one) => chunks(one, Math.max(room, 1)))) {
    const next = line === '' ? word : `${line} ${word}`
    if (line !== '' && displayWidth(next) > room) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  return [...lines, line]
}

function textOf(element: RenderElement): string | undefined {
  if (element.type !== 'Text') return undefined
  const children = element.children ?? []
  const strings = children.filter((child) => typeof child === 'string')
  return strings.length === children.length ? strings.join('') : undefined
}

function wrappedLeaf(elements: PaneElements, leaf: RenderElement, room: number): RenderElement[] {
  const text = textOf(leaf)
  const props = leaf.type === 'Text' ? (leaf.props ?? {}) : {}
  if (text === undefined || props.wrap !== undefined || displayWidth(text) <= room) return [leaf]
  return wrappedText(text, room).map((line) =>
    elements.Text({
      color: stringOf(props.color),
      dimColor: props.dimColor === true,
      bold: props.bold === true,
      children: line,
    }),
  )
}

function sideRow(
  elements: PaneElements,
  color: ThemeKey,
  leaf: RenderElement,
  indent: number,
): RenderElement {
  const { Box, Text } = elements
  return Box({
    flexDirection: 'row',
    children: [
      Text({ color, children: SIDE_LEFT }),
      Box({
        width: elements.bodyColumns - FRAME_COLUMNS,
        flexShrink: 0,
        flexDirection: 'column',
        children: [Box({ paddingLeft: indent, flexDirection: 'column', children: [leaf] })],
      }),
      Text({ color, children: SIDE_RIGHT }),
    ],
  })
}

function framedLines(
  elements: PaneElements,
  color: ThemeKey,
  element: RenderElement,
  indent: number,
): RenderElement[] {
  const props = element.type === 'Box' ? (element.props ?? {}) : {}
  if (element.type !== 'Box' || props.flexDirection !== 'column') {
    const room = elements.bodyColumns - FRAME_COLUMNS - indent
    return wrappedLeaf(elements, element, room).map((leaf) =>
      sideRow(elements, color, leaf, indent),
    )
  }
  const inner = indent + numberOf(props.paddingLeft) + numberOf(props.marginLeft)
  const children = (element.children ?? [])
    .filter(isElement)
    .flatMap((child) => framedLines(elements, color, child, inner))
  const key = stringOf(props.key)
  return key === undefined ? children : [elements.Box({ key, flexDirection: 'column', children })]
}

function topEdge(
  elements: PaneElements,
  key: string,
  color: ThemeKey,
  title: readonly StyledPart[],
): RenderElement {
  const { Box, Text } = elements
  const room = elements.bodyColumns - FRAME_TITLE_CHROME
  const shown = fitParts(title, room)
  const used = shown.reduce((sum, part) => sum + displayWidth(part.text), 0)
  const fill = room - used + EDGE_AT_LEAST
  return Box({
    key: `${key}-header`,
    flexDirection: 'row',
    children: [
      Text({ color, children: TOP_LEAD }),
      ...drawStyledParts(elements, shown),
      Text({ color, children: `${' '.repeat(TITLE_GAP)}${EDGE.repeat(fill)}${TOP_END}` }),
    ],
  })
}

function bottomEdge(elements: PaneElements, color: ThemeKey): RenderElement {
  const edge = EDGE.repeat(Math.max(elements.bodyColumns - 2, 0))
  return elements.Text({ color, children: `${BOTTOM_LEAD}${edge}${BOTTOM_END}` })
}

export function drawFrame(
  elements: PaneElements,
  key: string,
  look: SectionLook,
  title: readonly StyledPart[],
  lines: readonly (RenderElement | null)[],
): RenderElement {
  return elements.Box({
    key: `frame:${key}`,
    flexDirection: 'column',
    children: [
      topEdge(elements, key, look.color, title),
      ...lines
        .filter((line) => line !== null)
        .flatMap((line) => framedLines(elements, look.color, line, 0)),
      bottomEdge(elements, look.color),
    ],
  })
}
