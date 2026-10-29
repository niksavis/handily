import type { Elements, RenderElement, RenderSurface, ThemeKey } from 'claude-code'
import type { ReplyViewFold } from '../types'
import { drawFlowchart } from './flowchart'
import type { Ink, InkedDrawing, InkRun } from './ink'
import { shownText, type Block, type Fence, type Prose, type Table } from './markdown'
import { parseMermaid, type MermaidDiagram, type Refusal } from './mermaid'
import { drawSequence } from './sequence'
import {
  columnWidths,
  fieldsOf,
  framedWidth,
  labelOf,
  labelWidth,
  roomInside,
  ruleLine,
  rowTitle,
  spanLines,
  TABLE_FRAMES,
  tableLook,
  tableWidth,
  textCopy,
  textOfSpans,
  type Cell,
  type CellMark,
  type Span,
  type TableFrame,
  type TableLook,
  type TableStyle,
} from './table'
import { cutToWidth, displayWidth, fitted } from './width'

export const FOLD_AFTER_ROWS = 30
export const DEFAULT_COLUMNS = 80
const BULLET_COLUMNS = 2
const FIELD_INDENT = 2
const BUTTON_CHROME_COLUMNS = '[  ]'.length
const BUTTONS_GAP = 2
const BLOCKS_BELOW_COLUMNS = 40
const RULE = '─'
const LANGUAGE_TAG = /^[\w+#.-]{1,32}$/
const TAG_COLUMNS_AT_MOST = 24
const RULE_COLUMNS_AT_LEAST = 2
const MERMAID_TAG = 'mermaid'
const DRAWINGS_KEPT = 32
const DIAGRAM_CYCLE: readonly ThemeKey[] = ['suggestion', 'planMode', 'merged']
const INK_COLORS: Readonly<Record<Exclude<Ink, number | 'plain'>, ThemeKey>> = {
  line: 'inactive',
  head: 'claude',
  label: 'inactive',
}
const RULE_COLOR: ThemeKey = 'subtle'

export type DiagramDrawing = InkedDrawing & { name: string }

export type DiagramOutcome = DiagramDrawing | Refusal

export type BlockCopy = { text: string; what: string }

export type BlockKind = 'diagram' | 'table' | 'code'

export type KindCopy = { kind: BlockKind; copy: BlockCopy }

export type CopyLayout = { width: number; surface: RenderSurface; drawsDiagrams: boolean }

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
  tableStyle: TableStyle
}

type Drawing = { element: RenderElement; rows: number }

type Piece = { rows: number; whole: () => RenderElement; cut: (rows: number) => Drawing | null }

type Context = {
  elements: ReplyElements
  width: number
  columns: number
  surface: RenderSurface
  drawsDiagrams: boolean
  tableStyle: TableStyle
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

type CopyAction = { key: string; label: string; text: string; what: string }

type FoldAction = { key: string; label: string; next: ReplyViewFold }

type ButtonAction = CopyAction | FoldAction

function actionButton(context: Context, action: ButtonAction, label: string): RenderElement {
  if ('next' in action) {
    return context.elements.Button({
      key: action.key,
      label,
      dimColor: true,
      onPress: () => {
        context.actions.fold(action.next)
      },
    })
  }
  return copyButton(context, action.key, label, action.text, action.what)
}

function fittedButton(context: Context, action: ButtonAction): Buttons {
  const label = fitted(action.label, Math.max(context.width - BUTTON_CHROME_COLUMNS, 1))
  return {
    columns: displayWidth(label) + BUTTON_CHROME_COLUMNS,
    element: actionButton(context, action, label),
  }
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

function buttonsTogether(context: Context, actions: readonly ButtonAction[]): Buttons {
  return buttonRow(
    context,
    actions.map((action) => fittedButton(context, action)),
  )
}

function stackedButtons(context: Context, actions: readonly ButtonAction[]): Buttons[] {
  const together = buttonsTogether(context, actions)
  return together.columns <= context.width
    ? [together]
    : actions.map((action) => buttonRow(context, [fittedButton(context, action)]))
}

function tableCopy(table: Table): BlockCopy {
  return { text: table.source, what: 'the table as markdown' }
}

function codeCopy(fence: Fence): BlockCopy {
  const tag = fenceTag(fence)
  return { text: fence.content, what: tag === '' ? 'the block' : `the ${tag} block` }
}

function diagramCopy(fence: Fence, name: string): BlockCopy {
  return { text: fence.content, what: `the ${name} source` }
}

function mermaidCopy(fence: Fence, outcome: DiagramOutcome): BlockCopy {
  return outcome.kind === 'drawing' ? diagramCopy(fence, outcome.name) : codeCopy(fence)
}

export function replyCopy(text: string): BlockCopy {
  return { text, what: 'the reply as markdown' }
}

function drawsAsDiagram(drawsDiagrams: boolean, fence: Fence): boolean {
  return drawsDiagrams && fence.isClosed && fence.tag === MERMAID_TAG
}

function fenceTag(fence: Fence): string {
  return cutToWidth(shownText(fence.tag), TAG_COLUMNS_AT_MOST)
}

function tableActions(table: Table, key: string): CopyAction[] {
  const text = textCopy(table)
  const markdown = { key: `${key}-copy`, label: 'copy', ...tableCopy(table) }
  return text === ''
    ? [markdown]
    : [markdown, { key: `${key}-text`, label: 'copy as text', text, what: 'the table as text' }]
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

function buttonsUnder(
  context: Context,
  actions: readonly ButtonAction[],
  end: number,
): RenderElement[] {
  return stackedButtons(context, actions).map((line, index) =>
    lineWithButtons(context, null, line, end, `buttons-${String(index)}`),
  )
}

type CellRole = 'header' | 'heading' | 'label' | 'title' | 'value'

type CellChild = RenderElement | string

function cellColor(mark: CellMark, role: CellRole): ThemeKey | undefined {
  if (mark.isLink) return 'suggestion'
  if (mark.isCode) return 'permission'
  if (role === 'header' || role === 'heading' || role === 'label') return 'claude'
  return mark.isNumber ? 'planMode' : undefined
}

function isBoldCell(mark: CellMark, role: CellRole): boolean {
  if (role === 'header') return true
  return (role === 'label' || role === 'value') && mark.isBold
}

function cellSpan(context: Context, text: string, mark: CellMark, role: CellRole): CellChild {
  const color = cellColor(mark, role)
  const isBold = isBoldCell(mark, role)
  if (color === undefined && !isBold && !mark.isLink) return text
  return context.elements.Text({
    children: text,
    ...(color === undefined ? {} : { color }),
    ...(isBold ? { bold: true } : {}),
    ...(mark.isLink ? { underline: true } : {}),
  })
}

function cellSpans(context: Context, cell: Cell, role: CellRole): CellChild[] {
  return cell.runs.map((run) =>
    cellSpan(context, run.text, { ...run.mark, isNumber: cell.isNumber }, role),
  )
}

function cellLine(
  context: Context,
  cell: Cell,
  role: CellRole,
  key: string,
  wrap?: 'truncate-end',
) {
  const { Box, Text } = context.elements
  return Box({
    key,
    flexShrink: 1,
    children: Text({ bold: true, wrap, children: cellSpans(context, cell, role) }),
  })
}

function tableLine(context: Context, spans: readonly Span[], key: string, isHeader: boolean) {
  const { Box, Text } = context.elements
  const children = spans.map((span) => {
    if (span.kind === 'rule') return Text({ color: RULE_COLOR, children: span.text })
    if (span.kind === 'space') return span.text
    return cellSpan(context, span.text, span.mark, isHeader ? 'header' : 'value')
  })
  return Box({ key, flexShrink: 1, children: Text({ wrap: 'truncate-end', children }) })
}

function tableRule(context: Context, text: string, key: string) {
  const { Box, Text } = context.elements
  return Box({ key, children: Text({ color: RULE_COLOR, wrap: 'truncate-end', children: text }) })
}

function ruleRow(context: Context, text: string, key: string) {
  const { Box, Text } = context.elements
  return Box({ key, children: Text({ dimColor: true, wrap: 'truncate-end', children: text }) })
}

type ButtonsPlace = 'header' | 'last-row' | 'under'

function buttonsPlace(
  context: Context,
  room: number,
  first: string,
  last: string | undefined,
): ButtonsPlace {
  const fitsAfter = (line: string) => displayWidth(line) + room <= context.width
  if (fitsAfter(first)) return 'header'
  return last !== undefined && fitsAfter(last) ? 'last-row' : 'under'
}

function columnsPiece(
  context: Context,
  table: Table,
  look: TableLook,
  layout: { widths: readonly number[]; frame: TableFrame },
  key: string,
): Piece {
  const { Box } = context.elements
  const { widths, frame } = layout
  const actions = tableActions(table, key)
  const buttons = buttonsTogether(context, actions)
  const room = buttons.columns + BUTTONS_GAP
  const width = framedWidth(widths, frame)
  const headerSpans = spanLines(look, widths, look.header, frame)
  const rowSpans = look.rows.map((row) => spanLines(look, widths, row, frame))
  const isWrapped = [headerSpans, ...rowSpans].some((lines) => lines.length > 1)
  const linesBetweenRows = frame.rulesEveryRow || isWrapped ? 1 : 0
  const top = frame.top === null ? null : ruleLine(widths, frame.top)
  const bottom = frame.bottom === null ? null : ruleLine(widths, frame.bottom)
  const lastRowLine = rowSpans.at(-1)?.at(-1)
  const place = buttonsPlace(
    context,
    room,
    top ?? textOfSpans(headerSpans[0] ?? []),
    bottom ?? (lastRowLine === undefined ? undefined : textOfSpans(lastRowLine)),
  )
  const placed = (text: RenderElement, line: string, at: ButtonsPlace) =>
    place === at
      ? lineWithButtons(
          context,
          text,
          buttons,
          Math.min(context.width, Math.max(width, displayWidth(line) + room)),
        )
      : text
  const heading = [
    ...(top === null ? [] : [placed(tableRule(context, top, 'top'), top, 'header')]),
    ...headerSpans.map((spans, index) => {
      const text = tableLine(
        context,
        spans,
        index === 0 ? 'header' : `header-${String(index)}`,
        true,
      )
      return index === 0 && top === null ? placed(text, textOfSpans(spans), 'header') : text
    }),
    tableRule(context, ruleLine(widths, frame.header), 'header-rule'),
  ]
  const closing =
    bottom === null ? [] : [placed(tableRule(context, bottom, 'bottom'), bottom, 'last-row')]
  const lastRow = rowSpans.length - 1
  const drawnRows = rowSpans.map((lines, index) =>
    Box({
      key: `row-${String(index)}`,
      flexDirection: 'column',
      children: lines.map((spans, lineIndex) => {
        const text = tableLine(context, spans, `line-${String(lineIndex)}`, false)
        const isLast = bottom === null && index === lastRow && lineIndex === lines.length - 1
        return isLast ? placed(text, textOfSpans(spans), 'last-row') : text
      }),
    }),
  )
  const rowRule = ruleLine(widths, frame.row)
  const ruled = (shown: readonly RenderElement[]) =>
    shown.flatMap((row, index) =>
      index > 0 && linesBetweenRows > 0
        ? [tableRule(context, rowRule, `rule-${String(index)}`), row]
        : [row],
    )
  const under = place === 'under' ? buttonsUnder(context, actions, width) : []
  const rowsBox = (shown: readonly RenderElement[]) =>
    Box({ key: 'rows', flexDirection: 'column', children: ruled(shown) })
  const column = (children: RenderElement[]) => Box({ key, flexDirection: 'column', children })
  const rowRules = linesBetweenRows * Math.max(rowSpans.length - 1, 0)
  const frameRows = heading.length + closing.length
  return {
    rows: frameRows + sum(rowSpans.map((lines) => lines.length)) + rowRules + under.length,
    whole: () => column([...heading, rowsBox(drawnRows), ...closing, ...under]),
    cut: (budget) => {
      let used = frameRows
      let count = 0
      for (const lines of rowSpans) {
        const needed = lines.length + (count > 0 ? linesBetweenRows : 0)
        if (used + needed > budget) break
        used += needed
        count += 1
      }
      if (used > budget || (count === 0 && rowSpans.length > 0)) return null
      return {
        element: column([...heading, rowsBox(drawnRows.slice(0, count)), ...closing]),
        rows: used,
      }
    },
  }
}

function titleLine(context: Context, buttons: Buttons | null, title: RenderElement): RenderElement {
  return buttons === null ? title : lineWithButtons(context, title, buttons, context.width)
}

function rowBlock(
  context: Context,
  look: TableLook,
  row: readonly Cell[],
  index: number,
  buttons: Buttons | null,
): Drawing {
  const { Box, Text } = context.elements
  const labels = labelWidth(look)
  const fields = fieldsOf(look, row)
  const valueWidth = context.width - FIELD_INDENT - labels - 1
  const title = cellLine(context, rowTitle(row, index), 'title', 'title', 'truncate-end')
  return {
    rows: 1 + sum(fields.map((field) => rowsOf(field.value.text, valueWidth))),
    element: Box({
      key: `row-${String(index)}`,
      flexDirection: 'column',
      children: [
        titleLine(context, buttons, title),
        ...fields.map((field, fieldIndex) =>
          Box({
            key: `field-${String(fieldIndex)}`,
            flexDirection: 'row',
            paddingLeft: FIELD_INDENT,
            children: [
              Box({
                width: labels,
                flexShrink: 0,
                children: Text({ children: cellSpans(context, labelOf(field.label), 'label') }),
              }),
              Box({
                flexShrink: 1,
                marginLeft: 1,
                children: Text({ children: cellSpans(context, field.value, 'value') }),
              }),
            ],
          }),
        ),
      ],
    }),
  }
}

function headingsBlock(context: Context, look: TableLook, buttons: Buttons | null): Drawing {
  const { Box } = context.elements
  const [first, ...more] = look.header
  const title =
    first === undefined ? null : cellLine(context, first, 'heading', 'title', 'truncate-end')
  return {
    rows: 1 + sum(more.map((heading) => rowsOf(heading.text, context.width))),
    element: Box({
      key: 'headings',
      flexDirection: 'column',
      children: [
        title === null ? null : titleLine(context, buttons, title),
        ...more.map((heading, index) =>
          cellLine(context, heading, 'heading', `heading-${String(index)}`),
        ),
      ],
    }),
  }
}

function blocksPiece(context: Context, table: Table, look: TableLook, key: string): Piece {
  const { Box } = context.elements
  const actions = tableActions(table, key)
  const buttons = buttonsTogether(context, actions)
  const firstRow = look.rows[0]
  const firstTitle =
    firstRow === undefined ? (look.header[0]?.text ?? '') : rowTitle(firstRow, 0).text
  const isOnTitle = displayWidth(firstTitle) + BUTTONS_GAP + buttons.columns <= context.width
  const titled = isOnTitle ? buttons : null
  const blocks =
    look.rows.length > 0
      ? look.rows.map((row, index) =>
          rowBlock(context, look, row, index, index === 0 ? titled : null),
        )
      : [headingsBlock(context, look, titled)]
  const under = isOnTitle ? [] : buttonsUnder(context, actions, context.width)
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

function frameOf(context: Context): TableFrame {
  return TABLE_FRAMES[context.columns < BLOCKS_BELOW_COLUMNS ? 'rules' : context.tableStyle]
}

function columnsFor(context: Context, look: TableLook, frame: TableFrame): number[] | null {
  const isNarrow = context.columns < BLOCKS_BELOW_COLUMNS
  if (isNarrow && tableWidth(look.widths) > context.width) return null
  return columnWidths(look, roomInside(context.width, frame))
}

function tablePiece(context: Context, table: Table, key: string): Piece {
  const look = tableLook(table)
  const frame = frameOf(context)
  const widths = columnsFor(context, look, frame)
  return widths === null
    ? blocksPiece(context, table, look, key)
    : columnsPiece(context, table, look, { widths, frame }, key)
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

function fenceTitle(context: Context, fence: Fence, copy: BlockCopy, key: string): Drawing {
  return titleWithButtons(
    context,
    fenceTag(fence),
    [{ key: `${key}-copy`, label: 'copy', ...copy }],
    key,
  )
}

function fencePiece(
  context: Context,
  fence: Fence,
  key: string,
  copy: BlockCopy = codeCopy(fence),
): Piece {
  const { Box, Code } = context.elements
  const lines = fence.content === '' ? [] : shownText(fence.content).split('\n')
  const rows = lines.map((line) => rowsOf(line, context.width))
  const language = LANGUAGE_TAG.test(fence.tag) ? fence.tag : undefined
  const title = fenceTitle(context, fence, copy, key)
  const draw = (shown: readonly string[]) =>
    Box({
      key,
      flexDirection: 'column',
      children: [
        title.element,
        shown.length === 0 ? null : Code({ source: shown.join('\n'), language }),
      ],
    })
  return {
    rows: title.rows + sum(rows),
    whole: () => draw(lines),
    cut: (budget) => {
      if (budget < title.rows) return null
      let used = title.rows
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
      return drawn.kind === 'drawing' ? { ...drawn, name: diagram.kind } : drawn
    }
    case 'sequence': {
      const drawn = drawSequence(diagram, width)
      return drawn.kind === 'drawing' ? { ...drawn, name: diagram.kind } : drawn
    }
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

function diagramActions(fence: Fence, drawing: DiagramDrawing, key: string): CopyAction[] {
  return [
    { key: `${key}-copy`, label: 'copy', ...mermaidCopy(fence, drawing) },
    {
      key: `${key}-drawing`,
      label: 'copy drawing',
      text: drawing.lines.join('\n'),
      what: `the ${drawing.name} drawing`,
    },
  ]
}

function titleWithButtons(
  context: Context,
  title: string,
  actions: readonly ButtonAction[],
  key: string,
): Drawing {
  const together = buttonsTogether(context, actions)
  const room = context.width - together.columns - BUTTONS_GAP
  if (displayWidth(titleRule(title, 0)) <= room) {
    return {
      rows: 1,
      element: ruleWithButtons(context, titleRule(title, room), together.element, key),
    }
  }
  const lines = buttonsUnder(context, actions, context.width)
  return {
    rows: 1 + lines.length,
    element: context.elements.Box({
      key: `${key}-title`,
      flexDirection: 'column',
      children: [
        ruleRow(context, fitted(titleRule(title, context.width), context.width), 'title-rule'),
        ...lines,
      ],
    }),
  }
}

function inkColor(ink: Ink): ThemeKey | undefined {
  if (typeof ink === 'number') return DIAGRAM_CYCLE[ink % DIAGRAM_CYCLE.length]
  return ink === 'plain' ? undefined : INK_COLORS[ink]
}

function inkSpan(context: Context, run: InkRun): CellChild {
  const color = inkColor(run.ink)
  return color === undefined ? run.text : context.elements.Text({ color, children: run.text })
}

function drawingBody(context: Context, drawing: DiagramDrawing, key: string): RenderElement {
  const { Box, Code, Text } = context.elements
  if (context.surface !== 'terminal') return Code({ source: drawing.lines.join('\n') })
  return Box({
    key: `${key}-drawing-lines`,
    flexDirection: 'column',
    children: drawing.inked.map((runs, index) =>
      Box({
        key: `line-${String(index)}`,
        children: Text({
          wrap: 'truncate-end',
          children: runs.length === 0 ? ' ' : runs.map((run) => inkSpan(context, run)),
        }),
      }),
    ),
  })
}

function diagramPiece(context: Context, fence: Fence, drawing: DiagramDrawing, key: string): Piece {
  const { Box } = context.elements
  const title = titleWithButtons(
    context,
    `${MERMAID_TAG} · ${drawing.name}`,
    diagramActions(fence, drawing, key),
    key,
  )
  const column = (children: RenderElement[]) => Box({ key, flexDirection: 'column', children })
  return {
    rows: title.rows + drawing.lines.length,
    whole: () => column([title.element, drawingBody(context, drawing, key)]),
    cut: (budget) =>
      budget < title.rows ? null : { element: column([title.element]), rows: title.rows },
  }
}

function notDrawnPiece(context: Context, fence: Fence, refusal: Refusal, key: string): Piece {
  const { Box, Text } = context.elements
  const note = `diagram not drawn: ${refusal.reason}.`
  const noteRows = rowsOf(note, context.width)
  const fenced = fencePiece(context, fence, key, mermaidCopy(fence, refusal))
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
      return drawsAsDiagram(context.drawsDiagrams, block)
        ? mermaidPiece(context, block, key)
        : fencePiece(context, block, key)
  }
}

export function blockCopyOf(block: Block, layout: CopyLayout): KindCopy | null {
  switch (block.kind) {
    case 'prose':
      return null
    case 'table':
      return { kind: 'table', copy: tableCopy(block) }
    case 'fence':
      return drawsAsDiagram(layout.drawsDiagrams, block)
        ? {
            kind: 'diagram',
            copy: mermaidCopy(block, diagramOf(block.content, layout.width, layout.surface)),
          }
        : { kind: 'code', copy: codeCopy(block) }
  }
}

export function replyWidth(columns: number, hasBullet: boolean): number {
  return columns - (hasBullet ? BULLET_COLUMNS : 0)
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

function foldActions(fold: ReplyViewFold, text: string): ButtonAction[] {
  return [
    {
      key: 'fold',
      label: fold === 'folded' ? 'more' : 'less',
      next: fold === 'folded' ? 'open' : 'folded',
    },
    { key: 'copy-reply', label: 'copy reply', ...replyCopy(text) },
  ]
}

function foldRow(context: Context, fold: ReplyViewFold, text: string, hidden: number) {
  const { Box, Text } = context.elements
  const count =
    fold === 'folded'
      ? Box({
          flexShrink: 1,
          children: Text({
            dimColor: true,
            wrap: 'truncate-end',
            children: `… ${plural(hidden, 'more line')}`,
          }),
        })
      : null
  const actions = foldActions(fold, text)
  const together = buttonsTogether(context, actions)
  if (together.columns + BUTTONS_GAP <= context.width) {
    return Box({
      key: 'fold-row',
      flexDirection: 'row',
      children: [count, Box({ flexGrow: 1, minWidth: BUTTONS_GAP }), together.element],
    })
  }
  return Box({
    key: 'fold-row',
    flexDirection: 'column',
    children: [count, ...buttonsUnder(context, actions, context.width)],
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
  const width = replyWidth(layout.columns, layout.hasBullet)
  const context: Context = {
    elements,
    width,
    columns: layout.columns,
    surface: layout.surface,
    drawsDiagrams: layout.drawsDiagrams,
    tableStyle: layout.tableStyle,
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
