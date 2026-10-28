import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import type { ReplyViewFold } from '../types'
import { drawFlowchart } from './flowchart'
import { shownText, type Block, type Fence, type Prose, type Table } from './markdown'
import { parseMermaid, type MermaidDiagram, type Refusal } from './mermaid'
import {
  columnWidths,
  fieldsOf,
  HEADER_RULE,
  labelWidth,
  linesOf,
  ROW_RULE,
  ruleLine,
  rowTitle,
  spanLines,
  tableLook,
  tableWidth,
  textCopy,
  type Span,
  type TableLook,
} from './table'
import { cutToWidth, displayWidth, fitted } from './width'

export const FOLD_AFTER_ROWS = 30
export const DEFAULT_COLUMNS = 80
const BULLET_COLUMNS = 2
const FIELD_INDENT = 2
const COPY_BUTTON_COLUMNS = '[ copy ]'.length
const TABLE_BUTTONS_COLUMNS = '[ copy ] [ copy as text ]'.length
const BUTTONS_GAP = 2
const BLOCKS_BELOW_COLUMNS = 40
const RULE = '─'
const LANGUAGE_TAG = /^[\w+#.-]{1,32}$/
const TAG_COLUMNS_AT_MOST = 24
const RULE_COLUMNS_AT_LEAST = 2
const MERMAID_TAG = 'mermaid'
const COPY_DRAWING_BUTTON_COLUMNS = '[ copy drawing ]'.length
const DRAWINGS_KEPT = 32
const SEQUENCE_NOT_DRAWN = 'sequenceDiagram does not draw yet'

export type DiagramDrawing = { kind: 'drawing'; name: string; lines: string[] }

export type DiagramOutcome = DiagramDrawing | Refusal

export type ReplyElements = Pick<
  Elements[RenderSurface],
  'Box' | 'Text' | 'Button' | 'Markdown' | 'Code'
>

export type ReplyActions = {
  copy: (text: string, what: string, surface: RenderSurface) => void
  fold: (next: ReplyViewFold) => void
}

export type ReplyLayout = {
  columns: number
  hasBullet: boolean
  isFirstOfReply: boolean
  surface: RenderSurface
  drawsDiagrams: boolean
}

type Drawing = { element: RenderElement; rows: number }

type Piece = { rows: number; whole: () => RenderElement; cut: (rows: number) => Drawing | null }

type Context = {
  elements: ReplyElements
  width: number
  columns: number
  surface: RenderSurface
  drawsDiagrams: boolean
  actions: ReplyActions
}

function rowsOf(line: string, width: number): number {
  return Math.max(1, Math.ceil(displayWidth(line) / Math.max(width, 1)))
}

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, value) => total + value, 0)
}

export function plural(count: number, word: string): string {
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

type Buttons = { element: RenderElement; columns: number }

function tableButtons(context: Context, table: Table, key: string): Buttons {
  const { Box } = context.elements
  const text = textCopy(table)
  return {
    columns: text === '' ? COPY_BUTTON_COLUMNS : TABLE_BUTTONS_COLUMNS,
    element: Box({
      flexDirection: 'row',
      flexShrink: 0,
      gap: 1,
      children: [
        copyButton(context, `${key}-copy`, 'copy', table.source, 'the table as markdown'),
        ...(text === ''
          ? []
          : [copyButton(context, `${key}-text`, 'copy as text', text, 'the table as text')]),
      ],
    }),
  }
}

function lineWithButtons(
  context: Context,
  text: RenderElement | null,
  buttons: Buttons,
  end: number,
  key = 'buttons-line',
): RenderElement {
  const { Box } = context.elements
  return Box({
    key,
    flexDirection: 'row',
    width: Math.max(end, buttons.columns),
    children: [
      text,
      Box({ flexGrow: 1, minWidth: text === null ? 0 : BUTTONS_GAP }),
      buttons.element,
    ],
  })
}

function boldLine(context: Context, text: string, key: string, wrap?: 'truncate-end') {
  const { Box, Text } = context.elements
  return Box({ key, flexShrink: 1, children: Text({ bold: true, wrap, children: text }) })
}

function tableLine(context: Context, spans: readonly Span[], key: string, isHeader: boolean) {
  const { Box, Text } = context.elements
  const children = spans.map((span) => {
    if (span.kind === 'rule') return Text({ dimColor: true, children: span.text })
    return isHeader && span.kind === 'cell' ? Text({ bold: true, children: span.text }) : span.text
  })
  return Box({ key, flexShrink: 1, children: Text({ wrap: 'truncate-end', children }) })
}

function ruleRow(context: Context, text: string, key: string) {
  const { Box, Text } = context.elements
  return Box({ key, children: Text({ dimColor: true, wrap: 'truncate-end', children: text }) })
}

type ButtonsPlace = 'header' | 'last-row' | 'under'

function buttonsPlace(
  context: Context,
  room: number,
  header: readonly string[],
  rows: readonly string[][],
): ButtonsPlace {
  const fitsAfter = (line: string) => displayWidth(line) + room <= context.width
  if (fitsAfter(header[0] ?? '')) return 'header'
  const last = rows.at(-1)?.at(-1)
  return last !== undefined && fitsAfter(last) ? 'last-row' : 'under'
}

function columnsPiece(
  context: Context,
  table: Table,
  look: TableLook,
  widths: readonly number[],
  key: string,
): Piece {
  const { Box } = context.elements
  const buttons = tableButtons(context, table, key)
  const room = buttons.columns + BUTTONS_GAP
  const width = tableWidth(widths)
  const header = linesOf(look, widths, look.header)
  const headerSpans = spanLines(look, widths, look.header)
  const rowSpans = look.rows.map((row) => spanLines(look, widths, row))
  const rows = look.rows.map((row) => linesOf(look, widths, row))
  const isWrapped = [header, ...rows].some((lines) => lines.length > 1)
  const linesBetweenRows = isWrapped ? 1 : 0
  const place = buttonsPlace(context, room, header, rows)
  const withButtons = (text: RenderElement, line: string) =>
    lineWithButtons(
      context,
      text,
      buttons,
      Math.min(context.width, Math.max(width, displayWidth(line) + room)),
    )
  const heading = [
    ...headerSpans.map((spans, index) => {
      const text = tableLine(
        context,
        spans,
        index === 0 ? 'header' : `header-${String(index)}`,
        true,
      )
      return index === 0 && place === 'header' ? withButtons(text, header[0] ?? '') : text
    }),
    ruleRow(context, ruleLine(widths, HEADER_RULE), 'header-rule'),
  ]
  const lastRow = rows.length - 1
  const drawnRows = rowSpans.map((lines, index) =>
    Box({
      key: `row-${String(index)}`,
      flexDirection: 'column',
      children: lines.map((spans, lineIndex) => {
        const text = tableLine(context, spans, `line-${String(lineIndex)}`, false)
        const isLast = index === lastRow && lineIndex === lines.length - 1
        return place === 'last-row' && isLast
          ? withButtons(text, rows[index]?.[lineIndex] ?? '')
          : text
      }),
    }),
  )
  const rowRule = ruleLine(widths, ROW_RULE)
  const ruled = (shown: readonly RenderElement[]) =>
    shown.flatMap((row, index) =>
      index > 0 && isWrapped ? [ruleRow(context, rowRule, `rule-${String(index)}`), row] : [row],
    )
  const under = place === 'under' ? [lineWithButtons(context, null, buttons, width)] : []
  const rowsBox = (shown: readonly RenderElement[]) =>
    Box({ key: 'rows', flexDirection: 'column', children: ruled(shown) })
  const column = (children: RenderElement[]) => Box({ key, flexDirection: 'column', children })
  const rowRules = linesBetweenRows * Math.max(rows.length - 1, 0)
  return {
    rows: heading.length + sum(rows.map((lines) => lines.length)) + rowRules + under.length,
    whole: () => column([...heading, rowsBox(drawnRows), ...under]),
    cut: (budget) => {
      let used = heading.length
      let count = 0
      for (const lines of rows) {
        const needed = lines.length + (count > 0 ? linesBetweenRows : 0)
        if (used + needed > budget) break
        used += needed
        count += 1
      }
      if (used > budget || (count === 0 && rows.length > 0)) return null
      return { element: column([...heading, rowsBox(drawnRows.slice(0, count))]), rows: used }
    },
  }
}

function titleLine(context: Context, buttons: Buttons | null, title: string): RenderElement {
  const text = boldLine(context, title, 'title', 'truncate-end')
  return buttons === null ? text : lineWithButtons(context, text, buttons, context.width)
}

function rowBlock(
  context: Context,
  look: TableLook,
  row: readonly string[],
  index: number,
  buttons: Buttons | null,
): Drawing {
  const { Box, Text } = context.elements
  const labels = labelWidth(look)
  const fields = fieldsOf(look, row)
  const valueWidth = context.width - FIELD_INDENT - labels - 1
  return {
    rows: 1 + sum(fields.map((field) => rowsOf(field.value, valueWidth))),
    element: Box({
      key: `row-${String(index)}`,
      flexDirection: 'column',
      children: [
        titleLine(context, buttons, rowTitle(row, index)),
        ...fields.map((field, fieldIndex) =>
          Box({
            key: `field-${String(fieldIndex)}`,
            flexDirection: 'row',
            paddingLeft: FIELD_INDENT,
            children: [
              Box({
                width: labels,
                flexShrink: 0,
                children: Text({ children: `${field.label}:` }),
              }),
              Box({ flexShrink: 1, marginLeft: 1, children: Text({ children: field.value }) }),
            ],
          }),
        ),
      ],
    }),
  }
}

function headingsBlock(context: Context, look: TableLook, buttons: Buttons | null): Drawing {
  const { Box } = context.elements
  const [first = '', ...more] = look.header
  return {
    rows: 1 + sum(more.map((heading) => rowsOf(heading, context.width))),
    element: Box({
      key: 'headings',
      flexDirection: 'column',
      children: [
        titleLine(context, buttons, first),
        ...more.map((heading, index) => boldLine(context, heading, `heading-${String(index)}`)),
      ],
    }),
  }
}

function blocksPiece(context: Context, table: Table, look: TableLook, key: string): Piece {
  const { Box } = context.elements
  const buttons = tableButtons(context, table, key)
  const firstRow = look.rows[0]
  const firstTitle = firstRow === undefined ? (look.header[0] ?? '') : rowTitle(firstRow, 0)
  const isOnTitle = displayWidth(firstTitle) + BUTTONS_GAP + buttons.columns <= context.width
  const titled = isOnTitle ? buttons : null
  const blocks =
    look.rows.length > 0
      ? look.rows.map((row, index) =>
          rowBlock(context, look, row, index, index === 0 ? titled : null),
        )
      : [headingsBlock(context, look, titled)]
  const under = isOnTitle ? [] : [lineWithButtons(context, null, buttons, context.width)]
  const column = (shown: readonly Drawing[]) =>
    Box({
      key: `${key}-blocks`,
      flexDirection: 'column',
      gap: 1,
      children: shown.map((block) => block.element),
    })
  return {
    rows: sum(blocks.map((block) => block.rows)) + blocks.length - 1 + under.length,
    whole: () => Box({ key, flexDirection: 'column', children: [column(blocks), ...under] }),
    cut: (budget) => {
      let used = 0
      let count = 0
      for (const block of blocks) {
        const needed = block.rows + (count > 0 ? 1 : 0)
        if (used + needed > budget) break
        used += needed
        count += 1
      }
      return count === 0 ? null : { element: column(blocks.slice(0, count)), rows: used }
    },
  }
}

function columnsFor(context: Context, look: TableLook): number[] | null {
  const isNarrow = context.columns < BLOCKS_BELOW_COLUMNS
  if (isNarrow && tableWidth(look.widths) > context.width) return null
  return columnWidths(look, context.width)
}

function tablePiece(context: Context, table: Table, key: string): Piece {
  const look = tableLook(table)
  const widths = columnsFor(context, look)
  return widths === null
    ? blocksPiece(context, table, look, key)
    : columnsPiece(context, table, look, widths, key)
}

function titleRule(title: string, columns: number): string {
  const head = title === '' ? '' : `${RULE.repeat(2)} ${title} `
  return head + RULE.repeat(Math.max(columns - displayWidth(head), RULE_COLUMNS_AT_LEAST))
}

function ruleWithButtons(
  context: Context,
  rule: string,
  buttons: RenderElement,
  key: string,
): RenderElement {
  const { Box, Text } = context.elements
  return Box({
    key: `${key}-title`,
    flexDirection: 'row',
    children: [
      Box({
        flexShrink: 1,
        children: Text({ dimColor: true, wrap: 'truncate-end', children: rule }),
      }),
      Box({ flexShrink: 0, marginLeft: BUTTONS_GAP, children: buttons }),
    ],
  })
}

function fenceTitle(context: Context, fence: Fence, key: string): RenderElement {
  const room = Math.max(context.width - COPY_BUTTON_COLUMNS - BUTTONS_GAP, 4)
  const tag = cutToWidth(shownText(fence.tag), TAG_COLUMNS_AT_MOST)
  const what = tag === '' ? 'the block' : `the ${tag} block`
  return ruleWithButtons(
    context,
    titleRule(tag, room),
    copyButton(context, `${key}-copy`, 'copy', fence.content, what),
    key,
  )
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

function drawnDiagram(diagram: MermaidDiagram | Refusal, width: number): DiagramOutcome {
  switch (diagram.kind) {
    case 'refused':
      return diagram
    case 'flowchart': {
      const drawn = drawFlowchart(diagram, width)
      return drawn.kind === 'drawing'
        ? { kind: 'drawing', name: 'flowchart', lines: drawn.lines }
        : drawn
    }
    case 'sequence':
      return { kind: 'refused', reason: SEQUENCE_NOT_DRAWN, line: null, limit: null }
  }
}

const drawings = new Map<string, DiagramOutcome>()

export function diagramOf(source: string, width: number, surface: RenderSurface): DiagramOutcome {
  const key = JSON.stringify([surface, width, source])
  const kept = drawings.get(key)
  if (kept !== undefined) {
    drawings.delete(key)
    drawings.set(key, kept)
    return kept
  }
  const outcome = drawnDiagram(parseMermaid(source), width)
  drawings.set(key, outcome)
  const oldest = drawings.keys().next()
  if (drawings.size > DRAWINGS_KEPT && oldest.done !== true) drawings.delete(oldest.value)
  return outcome
}

function buttonRow(context: Context, buttons: readonly Buttons[]): Buttons {
  return {
    columns: sum(buttons.map((button) => button.columns)) + buttons.length - 1,
    element: context.elements.Box({
      flexDirection: 'row',
      flexShrink: 0,
      gap: 1,
      children: buttons.map((button) => button.element),
    }),
  }
}

function diagramButtons(
  context: Context,
  fence: Fence,
  drawing: DiagramDrawing,
  key: string,
): Buttons[] {
  return [
    {
      columns: COPY_BUTTON_COLUMNS,
      element: copyButton(
        context,
        `${key}-copy`,
        'copy',
        fence.content,
        `the ${drawing.name} source`,
      ),
    },
    {
      columns: COPY_DRAWING_BUTTON_COLUMNS,
      element: copyButton(
        context,
        `${key}-drawing`,
        'copy drawing',
        drawing.lines.join('\n'),
        `the ${drawing.name} drawing`,
      ),
    },
  ]
}

function diagramTitle(
  context: Context,
  name: string,
  buttons: readonly Buttons[],
  key: string,
): Drawing {
  const title = `${MERMAID_TAG} · ${name}`
  const together = buttonRow(context, buttons)
  const room = context.width - together.columns - BUTTONS_GAP
  if (displayWidth(titleRule(title, 0)) <= room) {
    return {
      rows: 1,
      element: ruleWithButtons(context, titleRule(title, room), together.element, key),
    }
  }
  const lines =
    together.columns <= context.width
      ? [together]
      : buttons.map((button) => buttonRow(context, [button]))
  return {
    rows: 1 + lines.length,
    element: context.elements.Box({
      key: `${key}-title`,
      flexDirection: 'column',
      children: [
        ruleRow(context, fitted(titleRule(title, context.width), context.width), 'title-rule'),
        ...lines.map((line, index) =>
          lineWithButtons(context, null, line, context.width, `buttons-${String(index)}`),
        ),
      ],
    }),
  }
}

function diagramPiece(context: Context, fence: Fence, drawing: DiagramDrawing, key: string): Piece {
  const { Box, Code } = context.elements
  const title = diagramTitle(
    context,
    drawing.name,
    diagramButtons(context, fence, drawing, key),
    key,
  )
  const column = (children: RenderElement[]) => Box({ key, flexDirection: 'column', children })
  return {
    rows: title.rows + drawing.lines.length,
    whole: () => column([title.element, Code({ source: drawing.lines.join('\n') })]),
    cut: (budget) =>
      budget < title.rows ? null : { element: column([title.element]), rows: title.rows },
  }
}

function notDrawnPiece(context: Context, fence: Fence, refusal: Refusal, key: string): Piece {
  const { Box, Text } = context.elements
  const note = `diagram not drawn: ${refusal.reason}.`
  const noteRows = rowsOf(note, context.width)
  const fenced = fencePiece(context, fence, key)
  const noted = (element: RenderElement) =>
    Box({
      key: `${key}-noted`,
      flexDirection: 'column',
      children: [
        Box({ key: `${key}-note`, children: Text({ dimColor: true, children: note }) }),
        element,
      ],
    })
  return {
    rows: noteRows + fenced.rows,
    whole: () => noted(fenced.whole()),
    cut: (budget) => {
      const cut = fenced.cut(budget - noteRows)
      return cut === null ? null : { element: noted(cut.element), rows: noteRows + cut.rows }
    },
  }
}

function mermaidPiece(context: Context, fence: Fence, key: string): Piece {
  const outcome = diagramOf(fence.content, context.width, context.surface)
  return outcome.kind === 'drawing'
    ? diagramPiece(context, fence, outcome, key)
    : notDrawnPiece(context, fence, outcome, key)
}

function pieceOf(context: Context, block: Block, index: number): Piece {
  const key = `block-${String(index)}`
  switch (block.kind) {
    case 'prose':
      return prosePiece(context, block)
    case 'table':
      return tablePiece(context, block, key)
    case 'fence':
      return context.drawsDiagrams && block.isClosed && block.tag === MERMAID_TAG
        ? mermaidPiece(context, block, key)
        : fencePiece(context, block, key)
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
      copyButton(context, 'copy-reply', 'copy reply', text, 'the reply as markdown'),
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
            children: Text({
              dimColor: true,
              wrap: 'truncate-end',
              children: `… ${plural(hidden, 'more line')}`,
            }),
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
  const context: Context = {
    elements,
    width,
    columns: layout.columns,
    surface: layout.surface,
    drawsDiagrams: layout.drawsDiagrams,
    actions,
  }
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
  const isOpened = isLong && fold === 'open'
  const divider = (key: string) => (isOpened ? ruleRow(context, RULE.repeat(width), key) : null)
  const body = Box({
    flexDirection: 'column',
    children: [
      divider('opened-top'),
      Box({
        flexDirection: 'column',
        gap: 1,
        children: shown.map((drawing) => drawing.element),
      }),
      divider('opened-bottom'),
      isLong ? foldRow(context, fold, text, hidden) : null,
    ],
  })
  return withBullet(elements, layout, body)
}
