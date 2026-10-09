import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import type { ReplyViewFold } from '../types'
import { shownText, type Block, type Fence, type Prose, type Table } from './markdown'
import {
  fieldsOf,
  labelWidth,
  lineOf,
  rowTitle,
  tableLook,
  tableWidth,
  textCopy,
  type TableLook,
} from './table'
import { cutToWidth, displayWidth } from './width'

export const FOLD_AFTER_ROWS = 12
export const DEFAULT_COLUMNS = 80
const BULLET_COLUMNS = 2
const FIELD_INDENT = 2
const COPY_BUTTON_COLUMNS = '[ copy ]'.length
const TABLE_BUTTONS_COLUMNS = '[ copy ] [ copy as text ]'.length
const RULE = '─'
const LANGUAGE_TAG = /^[\w+#.-]{1,32}$/
const TAG_COLUMNS_AT_MOST = 24

export type ReplyElements = Pick<
  Elements[RenderSurface],
  'Box' | 'Text' | 'Button' | 'Markdown' | 'Code'
>

export type ReplyActions = {
  copy: (text: string, what: string, surface: RenderSurface) => void
  fold: (next: ReplyViewFold) => void
}

export type ReplyLayout = { columns: number; hasBullet: boolean; isFirstOfReply: boolean }

type Drawing = { element: RenderElement; rows: number }

type Piece = { rows: number; whole: () => RenderElement; cut: (rows: number) => Drawing | null }

type Context = { elements: ReplyElements; width: number; actions: ReplyActions }

function rowsOf(line: string, width: number): number {
  return Math.max(1, Math.ceil(displayWidth(line) / Math.max(width, 1)))
}

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, value) => total + value, 0)
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`
}

function copyButton(context: Context, key: string, label: string, text: string, what: string) {
  return context.elements.Button({
    key,
    label,
    dimColor: true,
    onPress: (press) => {
      context.actions.copy(text, what, press.surface)
    },
  })
}

function cutLine(line: string, columns: number): string {
  const kept = cutToWidth(line, Math.max(columns - 1, 1))
  const space = kept.lastIndexOf(' ')
  const word = space > kept.length / 2 ? kept.slice(0, space) : kept
  return `${word.trimEnd()}…`
}

function prosePiece(context: Context, prose: Prose): Piece {
  const lines = prose.lines.map(shownText)
  const rows = lines.map((line, index) => {
    if (line.trim() !== '') return rowsOf(line, context.width)
    return (lines[index - 1] ?? '').trim() === '' ? 0 : 1
  })
  const draw = (shown: readonly string[]) => context.elements.Markdown({ text: shown.join('\n') })
  return {
    rows: sum(rows),
    whole: () => draw(lines),
    cut: (budget) => {
      const shown: string[] = []
      let used = 0
      for (const [index, line] of lines.entries()) {
        const needed = rows[index] ?? 1
        if (used + needed <= budget) {
          shown.push(line)
          used += needed
          continue
        }
        if (budget > used) {
          shown.push(cutLine(line, (budget - used) * context.width))
          used = budget
        }
        break
      }
      return shown.length === 0 ? null : { element: draw(shown), rows: used }
    },
  }
}

function tableButtons(context: Context, table: Table, look: TableLook, key: string, width: number) {
  const { Box } = context.elements
  return Box({
    key: `${key}-buttons`,
    width: Math.max(width, TABLE_BUTTONS_COLUMNS),
    justifyContent: 'flex-end',
    children: Box({
      flexDirection: 'row',
      gap: 1,
      children: [
        copyButton(context, `${key}-copy`, 'copy', table.source, 'the table as markdown'),
        copyButton(context, `${key}-text`, 'copy as text', textCopy(look), 'the table as text'),
      ],
    }),
  })
}

function wideLines(context: Context, look: TableLook, rows: readonly string[][]) {
  const { Box, Text } = context.elements
  const line = (text: string, key: string, isHeader: boolean) =>
    Box({ key, children: Text({ bold: isHeader, wrap: 'truncate-end', children: text }) })
  return [
    line(lineOf(look, look.header), 'header', true),
    ...rows.map((row, index) => line(lineOf(look, row), `row-${String(index)}`, false)),
  ]
}

function rowBlock(
  context: Context,
  look: TableLook,
  key: string,
  row: readonly string[],
  index: number,
) {
  const { Box, Text } = context.elements
  const labels = labelWidth(look)
  return Box({
    key: `${key}-row-${String(index)}`,
    flexDirection: 'column',
    children: [
      Text({ bold: true, wrap: 'truncate-end', children: rowTitle(row, index) }),
      ...fieldsOf(look, row).map((field, fieldIndex) =>
        Box({
          key: `field-${String(fieldIndex)}`,
          flexDirection: 'row',
          paddingLeft: FIELD_INDENT,
          children: [
            Box({ width: labels, flexShrink: 0, children: Text({ children: `${field.label}:` }) }),
            Box({ flexShrink: 1, marginLeft: 1, children: Text({ children: field.value }) }),
          ],
        }),
      ),
    ],
  })
}

function blockRows(context: Context, look: TableLook, row: readonly string[]): number {
  const valueWidth = context.width - FIELD_INDENT - labelWidth(look) - 1
  return 1 + sum(fieldsOf(look, row).map((field) => rowsOf(field.value, valueWidth)))
}

function tablePiece(context: Context, table: Table, key: string): Piece {
  const { Box } = context.elements
  const look = tableLook(table)
  const width = tableWidth(look)
  const column = (children: RenderElement[], gap = 0) =>
    Box({ key, flexDirection: 'column', gap, children })
  if (width <= context.width) {
    return {
      rows: 2 + look.rows.length,
      whole: () =>
        column([
          ...wideLines(context, look, look.rows),
          tableButtons(context, table, look, key, width),
        ]),
      cut: (budget) => {
        if (budget < 2) return null
        const rows = look.rows.slice(0, budget - 1)
        return { element: column(wideLines(context, look, rows)), rows: rows.length + 1 }
      },
    }
  }
  const heights = look.rows.map((row) => blockRows(context, look, row))
  const blocks = look.rows.map((row, index) => rowBlock(context, look, key, row, index))
  return {
    rows: sum(heights) + Math.max(look.rows.length - 1, 0) + 1,
    whole: () =>
      Box({
        key,
        flexDirection: 'column',
        children: [column(blocks, 1), tableButtons(context, table, look, key, context.width)],
      }),
    cut: (budget) => {
      let used = 0
      let count = 0
      for (const height of heights) {
        const needed = height + (count > 0 ? 1 : 0)
        if (used + needed > budget) break
        used += needed
        count += 1
      }
      return count === 0 ? null : { element: column(blocks.slice(0, count), 1), rows: used }
    },
  }
}

function fenceTitle(context: Context, fence: Fence, key: string): RenderElement {
  const { Box, Text } = context.elements
  const room = Math.max(context.width - COPY_BUTTON_COLUMNS - 2, 4)
  const tag = cutToWidth(shownText(fence.tag), TAG_COLUMNS_AT_MOST)
  const head = tag === '' ? '' : `${RULE.repeat(2)} ${tag} `
  const rule = head + RULE.repeat(Math.max(room - displayWidth(head), 2))
  const what = tag === '' ? 'the block' : `the ${tag} block`
  return Box({
    key: `${key}-title`,
    flexDirection: 'row',
    children: [
      Box({
        flexShrink: 1,
        children: Text({ dimColor: true, wrap: 'truncate-end', children: rule }),
      }),
      Box({
        flexShrink: 0,
        marginLeft: 2,
        children: copyButton(context, `${key}-copy`, 'copy', fence.content, what),
      }),
    ],
  })
}

function fencePiece(context: Context, fence: Fence, key: string): Piece {
  const { Box, Code } = context.elements
  const lines = fence.content === '' ? [] : shownText(fence.content).split('\n')
  const rows = lines.map((line) => rowsOf(line, context.width))
  const language = LANGUAGE_TAG.test(fence.tag) ? fence.tag : undefined
  const draw = (shown: readonly string[]) =>
    Box({
      key,
      flexDirection: 'column',
      children: [
        fenceTitle(context, fence, key),
        shown.length === 0 ? null : Code({ source: shown.join('\n'), language }),
      ],
    })
  return {
    rows: 1 + sum(rows),
    whole: () => draw(lines),
    cut: (budget) => {
      if (budget < 1) return null
      let used = 1
      let count = 0
      for (const height of rows) {
        if (used + height > budget) break
        used += height
        count += 1
      }
      return { element: draw(lines.slice(0, count)), rows: used }
    },
  }
}

function pieceOf(context: Context, block: Block, index: number): Piece {
  const key = `block-${String(index)}`
  switch (block.kind) {
    case 'prose':
      return prosePiece(context, block)
    case 'table':
      return tablePiece(context, block, key)
    case 'fence':
      return fencePiece(context, block, key)
  }
}

function foldedPieces(pieces: readonly Piece[]): Drawing[] {
  const shown: Drawing[] = []
  let left = FOLD_AFTER_ROWS
  for (const piece of pieces) {
    const gap = shown.length > 0 ? 1 : 0
    if (piece.rows + gap <= left) {
      shown.push({ element: piece.whole(), rows: piece.rows + gap })
      left -= piece.rows + gap
      continue
    }
    const cut = left - gap > 0 ? piece.cut(left - gap) : null
    if (cut !== null) shown.push({ element: cut.element, rows: cut.rows + gap })
    break
  }
  return shown
}

function replyButtons(context: Context, fold: ReplyViewFold, text: string): RenderElement {
  const { Box, Button } = context.elements
  return Box({
    flexDirection: 'row',
    flexShrink: 0,
    gap: 1,
    children: [
      Button({
        key: 'fold',
        label: fold === 'folded' ? 'more' : 'less',
        dimColor: true,
        onPress: () => {
          context.actions.fold(fold === 'folded' ? 'open' : 'folded')
        },
      }),
      copyButton(context, 'copy-reply', 'copy', text, 'the reply as markdown'),
    ],
  })
}

function foldRow(context: Context, fold: ReplyViewFold, text: string, hidden: number) {
  const { Box, Text } = context.elements
  return Box({
    key: 'fold-row',
    flexDirection: 'row',
    children: [
      fold === 'folded'
        ? Box({
            flexShrink: 1,
            children: Text({ dimColor: true, children: `… ${plural(hidden, 'more line')}` }),
          })
        : null,
      Box({ flexGrow: 1, minWidth: 2 }),
      replyButtons(context, fold, text),
    ],
  })
}

function withBullet(elements: ReplyElements, layout: ReplyLayout, body: RenderElement) {
  if (!layout.hasBullet) return body
  const { Box, Text } = elements
  return Box({
    flexDirection: 'row',
    children: [
      Box({
        width: BULLET_COLUMNS,
        flexShrink: 0,
        children: layout.isFirstOfReply ? Text({ children: '●' }) : null,
      }),
      Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: body }),
    ],
  })
}

export function replyTree(
  elements: ReplyElements,
  text: string,
  blocks: readonly Block[],
  layout: ReplyLayout,
  fold: ReplyViewFold,
  actions: ReplyActions,
): RenderElement | null {
  const width = layout.columns - (layout.hasBullet ? BULLET_COLUMNS : 0)
  const context: Context = { elements, width, actions }
  const pieces = blocks.map((block, index) => pieceOf(context, block, index))
  const total = sum(pieces.map((piece) => piece.rows)) + Math.max(pieces.length - 1, 0)
  const isLong = total > FOLD_AFTER_ROWS
  if (!isLong && blocks.every((block) => block.kind === 'prose')) return null
  const { Box } = elements
  const shown =
    isLong && fold === 'folded'
      ? foldedPieces(pieces)
      : pieces.map((piece) => ({ element: piece.whole(), rows: piece.rows }))
  const hidden = total - sum(shown.map((drawing) => drawing.rows))
  const body = Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'column',
        gap: 1,
        children: shown.map((drawing) => drawing.element),
      }),
      isLong ? foldRow(context, fold, text, hidden) : null,
    ],
  })
  return withBullet(elements, layout, body)
}
