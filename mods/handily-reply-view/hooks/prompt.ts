import type { Color, RenderElement, RenderNode } from 'claude-code'
import type { ReplyElements } from './draw'
import { shownText } from './markdown'
import { displayWidth, fitted } from './width'
import { wrappedAtWords } from './wrap'

export const PROMPT_STYLES = ['rule', 'bar', 'bubble'] as const

export type PromptStyle = (typeof PROMPT_STYLES)[number]

export const DEFAULT_PROMPT_STYLE: PromptStyle = 'rule'

export type PromptMark = { number: number | undefined; submittedAt: number | undefined }

export type PromptLook = { style: PromptStyle; columns: number; mark: PromptMark }

type PromptElements = Pick<ReplyElements, 'Box' | 'Text'>

type PromptRows = { text: string[]; note: string[] }

const RULE = '─'
const LABEL = 'you'
const LABEL_JOIN = ' · '
const PROMPT_COLOR: Color = 'suggestion'
const BAR = '▌ '
const FRAME_LEFT = '│ '
const FRAME_RIGHT = ' │'
const FRAME_SIDES = displayWidth(FRAME_LEFT + FRAME_RIGHT)
const BUBBLE_COLUMNS_AT_LEAST = 40
const BUBBLE_SHARE = { of: 4, taken: 3 } as const
const ROWS_AT_MOST = 6
const ROWS_FOLDED = 5
const LINE_BREAKS = /\r\n|\r|\n/
const TAB = '\t'
const TAB_SPACES = '    '
const INDENT = /^ +/

export function isPromptStyle(value: unknown): value is PromptStyle {
  return PROMPT_STYLES.some((style) => style === value)
}

export function clockTime(at: number): string {
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  return `${hours}:${String(date.getMinutes()).padStart(2, '0')}`
}

function labelOf(mark: PromptMark): string {
  const number = mark.number === undefined ? [] : [String(mark.number)]
  const time = mark.submittedAt === undefined ? [] : [clockTime(mark.submittedAt)]
  return [LABEL, ...number, ...time].join(LABEL_JOIN)
}

export function shownPromptStyle(style: PromptStyle, columns: number): PromptStyle {
  return style === 'bubble' && columns < BUBBLE_COLUMNS_AT_LEAST ? 'bar' : style
}

export function bubbleColumnsAtMost(columns: number): number {
  return Math.floor((columns * BUBBLE_SHARE.taken) / BUBBLE_SHARE.of)
}

function shownLinesOf(text: string): string[] {
  return text
    .trimEnd()
    .split(LINE_BREAKS)
    .map((line) => shownText(line.replaceAll(TAB, TAB_SPACES)))
}

function wrappedLine(line: string, columns: number): string[] {
  const indent = INDENT.exec(line)?.[0] ?? ''
  if (indent === '' || indent.length * 2 > columns) return wrappedAtWords(line, columns)
  return wrappedAtWords(line.slice(indent.length), columns - indent.length).map(
    (row) => indent + row,
  )
}

function rowsOf(text: string, columns: number): PromptRows {
  const rows = shownLinesOf(text).flatMap((line) => wrappedLine(line, columns))
  if (rows.length <= ROWS_AT_MOST) return { text: rows, note: [] }
  return { text: rows.slice(0, ROWS_FOLDED), note: [foldNote(rows.length - ROWS_FOLDED, columns)] }
}

function foldNote(hidden: number, columns: number): string {
  const count = `… ${String(hidden)} more lines`
  const whole = `${count} (ctrl+o shows all)`
  return displayWidth(whole) <= columns ? whole : fitted(count, columns)
}

function lineOf(elements: PromptElements, children: RenderNode[]): RenderElement {
  const { Box, Text } = elements
  return Box({ children: Text({ wrap: 'truncate-end', children }) })
}

function flushRight(elements: PromptElements, children: RenderNode[]): RenderElement {
  const { Box, Text } = elements
  return Box({
    flexDirection: 'row',
    justifyContent: 'flex-end',
    children: Text({ wrap: 'truncate-end', children }),
  })
}

function barPrompt(elements: PromptElements, text: string, look: PromptLook): RenderElement {
  const { Box, Text } = elements
  const rows = rowsOf(text, Math.max(look.columns - displayWidth(BAR), 1))
  const bar = () => Text({ color: PROMPT_COLOR, children: BAR })
  return Box({
    flexDirection: 'column',
    marginTop: 1,
    children: [
      ...rows.text.map((row) => lineOf(elements, [bar(), row])),
      ...rows.note.map((row) => lineOf(elements, [bar(), Text({ dimColor: true, children: row })])),
      lineOf(elements, [Text({ color: PROMPT_COLOR, children: `${BAR}${labelOf(look.mark)}` })]),
    ],
  })
}

function bubblePrompt(elements: PromptElements, text: string, look: PromptLook): RenderElement {
  const { Box, Text } = elements
  const rows = rowsOf(text, bubbleColumnsAtMost(look.columns) - FRAME_SIDES)
  const inner = Math.max(...[...rows.text, ...rows.note].map(displayWidth))
  const edge = (children: string) => Text({ color: PROMPT_COLOR, children })
  const framed = (row: RenderNode, width: number) =>
    flushRight(elements, [
      edge(FRAME_LEFT),
      row,
      ' '.repeat(Math.max(inner - width, 0)),
      edge(FRAME_RIGHT),
    ])
  const rule = RULE.repeat(inner + 2)
  return Box({
    flexDirection: 'column',
    marginTop: 1,
    children: [
      flushRight(elements, [edge(labelOf(look.mark))]),
      flushRight(elements, [edge(`╭${rule}╮`)]),
      ...rows.text.map((row) => framed(row, displayWidth(row))),
      ...rows.note.map((row) => framed(Text({ dimColor: true, children: row }), displayWidth(row))),
      flushRight(elements, [edge(`╰${rule}╯`)]),
    ],
  })
}

export function drawnPrompt(
  elements: PromptElements,
  text: string,
  look: PromptLook,
): RenderElement | null {
  if (text.trim() === '') return null
  const style = shownPromptStyle(look.style, look.columns)
  if (style === 'bubble') return bubblePrompt(elements, text, look)
  if (style === 'bar') return barPrompt(elements, text, look)
  return null
}

function promptRule(elements: PromptElements, columns: number, mark: PromptMark) {
  const { Box, Text } = elements
  return Box({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    flexDirection: 'row',
    children: [
      Box({
        flexShrink: 0,
        children: Text({
          color: PROMPT_COLOR,
          children: `${RULE.repeat(2)} ${labelOf(mark)} `,
        }),
      }),
      Box({
        flexGrow: 1,
        height: 1,
        overflow: 'hidden',
        children: Text({ color: PROMPT_COLOR, children: RULE.repeat(columns) }),
      }),
    ],
  })
}

export function framedPrompt(
  elements: PromptElements,
  engineRow: RenderElement,
  look: PromptLook,
): RenderElement {
  const { Box } = elements
  return Box({
    flexDirection: 'column',
    marginTop: 1,
    children: [promptRule(elements, look.columns, look.mark), engineRow],
  })
}
