import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'
import type { ReplyViewCopyMark, ReplyViewFold } from '../types'
import { drawBlock } from './block'
import { isCutDrawing } from './drawing'
import { ALERT_WORDS, runsWidth, wrappedRuns, type AlertKind, type HeadingStyle } from './blocks'
import { drawArchitecture } from './architecture'
import { drawC4 } from './c4'
import { chartName, drawChart, isChartSource, type ChartShape } from './charts'
import { drawClasses } from './classes'
import { drawEntities } from './er'
import { drawFlowchart, widthClause } from './flowchart'
import {
  DEFAULT_REPLY_STYLE,
  FRAME_COLUMNS,
  framedReply,
  shownReplyStyle,
  type ReplyStyle,
} from './frame'
import { drawGantt } from './gantt'
import { GLYPH_SETS } from './glyphs'
import { drawGitGraph } from './gitgraph'
import { highlightedRuns } from './highlight'
import { drawJourney } from './journey'
import { drawKanban } from './kanban'
import { textPropsOf, type Ink, type InkedDrawing, type InkRun } from './ink'
import {
  PLAIN_MARK,
  shownText,
  textOfRuns,
  type Block,
  type Fence,
  type Mark,
  type Prose,
  type Run,
  type Table,
} from './markdown'
import { DIAGRAM_NAMES, parseMermaid, type MermaidDiagram, type Refusal } from './mermaid'
import { drawMindmap } from './mindmap'
import { drawPacket } from './packet'
import { drawRequirements } from './requirement'
import { paletteColor, type PaletteRole, type PaletteSetting } from './palette'
import { drawQuadrant } from './quadrant'
import {
  holdsLinkDefinition,
  prosePartsOf,
  type DrawnLine,
  type ProsePart,
  type QuoteLine,
} from './prose'
import { drawRadar } from './radar'
import { DIAGRAM_CYCLES, ROLE_LOOKS, type ReplyRole, type RoleLook } from './roles'
import { drawSankey } from './sankey'
import { drawSequence } from './sequence'
import { COLUMNS_BETWEEN, DEFAULT_SIDE_BY_SIDE, sharedRows, type SideBySide } from './side'
import { drawState } from './state'
import {
  codeDrawingOf,
  codeFoldKey,
  contentHash,
  FOLDED_LINES,
  foldsCode,
  grouped,
  GUTTER_LOOK,
  gutterColumns,
  gutterNumber,
  CODE_NODES_AT_MOST,
  isOwnDrawing,
  type CodeDrawing,
  type CodeLook,
  type CodeToken,
} from './syntax'
import {
  columnWidths,
  CUT_MARK,
  fieldsOf,
  fittedCell,
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
  type Cell,
  type Span,
  type TableFrame,
  type TableLook,
  type TableStyle,
} from './table'
import { drawTimeline } from './timeline'
import { drawTreemap } from './treemap'
import { cutToWidth, displayWidth, fitted, graphemesOf } from './width'

export const FOLD_AFTER_ROWS = 30
const PREVIEW_ROWS_AT_MOST = 60
const DIAGRAM_ROWS_IN_PREVIEW_AT_LEAST = 5
export const DEFAULT_COLUMNS = 80

export const DRAWN_CHARACTERS_AT_MOST = 60_000
const BULLET_COLUMNS = 2
const FIELD_INDENT = 2
const BUTTON_CHROME_COLUMNS = '[  ]'.length
const BUTTONS_GAP = 2
const BLOCKS_BELOW_COLUMNS = 40
const KINDS_BESIDE_FROM_COLUMNS = 60
const KINDS_INDENT = 2
const HEAD_SEPARATOR = ' · '
export const COPY_WORD = 'copy'
const NOT_DRAWN_WORD = 'not drawn'
export const REPLY_COPY_LABEL = `${COPY_WORD} reply`
const RULE = '─'
const LANGUAGE_TAG = /^[\w+#.-]{1,32}$/
const TAG_COLUMNS_AT_MOST = 24
const RULE_COLUMNS_AT_LEAST = 2
const MERMAID_TAG = 'mermaid'
const DRAWINGS_KEPT = 32
const DRAW_FAILED = 'reply-view could not draw it'
const CUT_REMEDY = 'Widen the window to see this drawing'
const INK_ROLES: Readonly<Record<Exclude<Ink, number | 'plain'>, PaletteRole>> = {
  line: 'diagramLine',
  head: 'diagramHead',
  label: 'diagramLine',
}
const PROSE_SURFACE: RenderSurface = 'terminal'
const COLOUR_SURFACE: RenderSurface = 'terminal'
const GUTTER_COLUMNS_AT_LEAST = 40
const BOX_SURFACE: RenderSurface = 'terminal'
const MARGIN_SURFACE: RenderSurface = 'terminal'
const ROW_SURFACE: RenderSurface = 'terminal'
const MOCHA = 'catppuccin-mocha'
const BOX_SIDES = '│  │'.length
const QUOTE_BAR = '▌ '
const HEADING_RULE = '━'
const RULED_LEVELS = 2
const MINOR_LEVEL = 3
const MARKER_ROLES: Readonly<Record<DrawnLine['mark'], ReplyRole | undefined>> = {
  none: undefined,
  bullet: 'marker',
  number: 'marker',
  open: 'taskOpen',
  done: 'taskDone',
}
const ALERT_ROLES: Readonly<Record<AlertKind, ReplyRole>> = {
  note: 'alertNote',
  tip: 'alertTip',
  important: 'alertImportant',
  warning: 'alertWarning',
  caution: 'alertCaution',
}

export type DiagramDrawing = InkedDrawing & { name: string; plain: string; shape?: ChartShape }

export type DiagramOutcome = DiagramDrawing | Refusal

export type BlockCopy = { text: string; what: string }

export type MarkedCopy = BlockCopy & { mark: string }

export type ReplyMarks = { done: string; blocked: string; folded: string; opened: string }

export const PLAIN_MARKS: ReplyMarks = {
  done: GLYPH_SETS.plain.done,
  blocked: GLYPH_SETS.plain.blocked,
  folded: GLYPH_SETS.plain.folderClosed,
  opened: GLYPH_SETS.plain.folderOpen,
}

export function copyMarkKey(label: string, text: string): string {
  return `${label}:${contentHash(text)}:${String(text.length)}`
}

export type BlockKind = 'diagram' | 'chart' | 'table' | 'code'

export type KindCopy = { kind: BlockKind; copy: BlockCopy }

export type CopyLayout = { width: number; surface: RenderSurface; drawsDiagrams: boolean }

export type ReplyElements = Pick<
  Elements[RenderSurface],
  'Box' | 'Text' | 'Button' | 'Markdown' | 'Code' | 'Link'
>

export type ReplyActions = {
  copy: (copy: MarkedCopy, surface: RenderSurface) => void
  fold: (next: ReplyViewFold, block?: string) => void
}

export type ReplyLayout = {
  columns: number
  hasBullet: boolean
  isFirstOfReply: boolean
  surface: RenderSurface
  drawsDiagrams: boolean
  tableStyle: TableStyle
  headingStyle: HeadingStyle
  doneGlyph: string
  highlight: boolean
  palette: PaletteSetting
  codeFolds?: ReadonlyMap<string, ReplyViewFold>
  replyStyle?: ReplyStyle
  sideBySide?: SideBySide
  marks?: ReplyMarks
  copyMark?: ReplyViewCopyMark | null
}

type ReplyEdge = 'none' | 'bullet' | 'frame'

type Drawing = { element: RenderElement; rows: number }

type KindWord = { word: string; role: ReplyRole }

type Piece = {
  rows: number
  kinds?: readonly KindWord[]
  diagram?: string
  isOpened?: boolean
  beside?: Beside
  whole: () => RenderElement
  cut: (rows: number) => Cut | null
}

type Cut = Drawing & { diagram?: string }

type Beside = { columns: number; at: (width: number) => Piece }

type CutDiagram = { name: string; rows: number }

type Preview = { shown: Drawing[]; cutDiagram: CutDiagram | null; hiddenFrom: number }

type Context = {
  elements: ReplyElements
  width: number
  columns: number
  surface: RenderSurface
  drawsDiagrams: boolean
  tableStyle: TableStyle
  headingStyle: HeadingStyle
  doneGlyph: string
  highlight: boolean
  palette: PaletteSetting
  drawsProse: boolean
  codeFolds: ReadonlyMap<string, ReplyViewFold>
  codeBudget: { nodesLeft: number }
  actions: ReplyActions
  marks: ReplyMarks
  copyMark: ReplyViewCopyMark | null
}

function rowsOf(line: string, width: number): number {
  const room = Math.max(width, 1)
  let rows = 1
  let used = 0
  for (const grapheme of graphemesOf(line)) {
    const columns = displayWidth(grapheme)
    if (used > 0 && used + columns > room) {
      rows += 1
      used = 0
    }
    used += columns
  }
  return rows
}

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, value) => total + value, 0)
}

export function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`
}

function cutLine(line: string, columns: number): string {
  const kept = cutToWidth(line, Math.max(columns - 1, 1))
  const space = kept.lastIndexOf(' ')
  const word = space > kept.length / 2 ? kept.slice(0, space) : kept
  return `${word.trimEnd()}${CUT_MARK}`
}

type ProseItem = {
  rows: number
  whole: () => RenderElement
  cut: (rows: number) => RenderElement | null
}

function paint(context: Context, role: PaletteRole): Color {
  return paletteColor(role, context.palette)
}

function tokenColor(context: Context, mark: Mark): Color | undefined {
  if (!context.highlight || mark.token === null) return undefined
  return paint(context, mark.token)
}

function shownLookColor(palette: PaletteSetting, look: RoleLook): Color | undefined {
  return palette === MOCHA ? (look.mocha ?? look.key) : look.key
}

function lookColor(context: Context, look: RoleLook): Color | undefined {
  return shownLookColor(context.palette, look)
}

function roleColor(context: Context, role: ReplyRole): Color | undefined {
  return lookColor(context, ROLE_LOOKS[role])
}

type SpanLook = {
  color: Color | undefined
  isBold: boolean
  isDim?: boolean
  isItalic?: boolean
  isStrike?: boolean
  isUnderline?: boolean
}

function styledSpan(context: Context, text: string, mark: Mark, look: SpanLook): CellChild {
  const style = {
    ...(look.color === undefined ? {} : { color: look.color }),
    ...(look.isBold ? { bold: true } : {}),
    ...(look.isDim === true ? { dimColor: true } : {}),
    ...(mark.isLink || look.isUnderline === true ? { underline: true } : {}),
    ...(mark.isItalic || look.isItalic === true ? { italic: true } : {}),
    ...(mark.isStrike || look.isStrike === true ? { strikethrough: true } : {}),
  }
  return Object.keys(style).length === 0
    ? text
    : context.elements.Text({ ...style, children: text })
}

function proseColor(context: Context, mark: Mark, base?: Color): Color | undefined {
  if (mark.isLink) return paint(context, 'link')
  if (mark.isCode) return paint(context, 'inlineCode')
  return tokenColor(context, mark) ?? base
}

type ProseLook = Omit<SpanLook, 'color' | 'isBold'> & { base?: Color; isBold?: boolean }

function linkedSpans(
  context: Context,
  runs: readonly Run[],
  spanOf: (run: Run) => CellChild,
): CellChild[] {
  const groups: { href: string | undefined; runs: Run[] }[] = []
  for (const run of runs) {
    const last = groups.at(-1)
    if (last !== undefined && run.href !== undefined && last.href === run.href) last.runs.push(run)
    else groups.push({ href: run.href, runs: [run] })
  }
  return groups.flatMap((group) =>
    group.href === undefined
      ? group.runs.map(spanOf)
      : [context.elements.Link({ href: group.href, children: group.runs.map(spanOf) })],
  )
}

function proseSpans(context: Context, runs: readonly Run[], look: ProseLook): CellChild[] {
  const { base, isBold = false, ...flags } = look
  return linkedSpans(context, runs, (run) =>
    styledSpan(context, run.text, run.mark, {
      ...flags,
      color: proseColor(context, run.mark, base),
      isBold: run.mark.isBold || isBold,
      isDim: run.isDim === true || flags.isDim === true,
    }),
  )
}

function shownRuns(context: Context, runs: readonly Run[]): readonly Run[] {
  return context.highlight ? highlightedRuns(runs) : runs
}

function cutRuns(runs: readonly Run[], kept: number): Run[] {
  const cut: Run[] = []
  let left = kept
  for (const run of runs) {
    if (left <= 0) break
    cut.push({ ...run, text: run.text.slice(0, left) })
    left -= run.text.length
  }
  return [...cut, { text: CUT_MARK, mark: PLAIN_MARK }]
}

function indentOf(context: Context, line: DrawnLine): string {
  return ' '.repeat(Math.min(line.indent, Math.floor(context.width / 2)))
}

function leadOf(context: Context, line: DrawnLine): string {
  const indent = indentOf(context, line)
  return line.marker === '' ? indent : `${indent}${line.marker} `
}

function leadText(context: Context, line: DrawnLine): RenderElement {
  const { Text } = context.elements
  const role = MARKER_ROLES[line.mark]
  if (role === undefined || line.marker === '') return Text({ children: leadOf(context, line) })
  const marker = Text({ color: roleColor(context, role), children: line.marker })
  return Text({ children: [indentOf(context, line), marker, ' '] })
}

function drawnLineElement(
  context: Context,
  line: DrawnLine,
  runs: readonly Run[],
  key: string,
): RenderElement {
  const { Box, Text } = context.elements
  const isDone = line.mark === 'done'
  const spans = proseSpans(context, shownRuns(context, runs), { isDim: isDone, isStrike: isDone })
  const text = Text({ children: spans.length === 0 ? ' ' : spans })
  const lead = leadOf(context, line)
  if (lead === '') return Box({ key, children: text })
  return Box({
    key,
    flexDirection: 'row',
    children: [
      Box({ width: displayWidth(lead), flexShrink: 0, children: leadText(context, line) }),
      Box({ flexShrink: 1, children: text }),
    ],
  })
}

function drawsBoxes(context: Context): boolean {
  return context.columns >= BLOCKS_BELOW_COLUMNS
}

function lineBox(context: Context, children: CellChild[], key: string): RenderElement {
  const { Box, Text } = context.elements
  return Box({ key, children: Text({ wrap: 'truncate-end', children }) })
}

function linesItem(context: Context, lines: readonly RenderElement[], key: string): ProseItem {
  const column = (shown: RenderElement[]) =>
    context.elements.Box({ key, flexDirection: 'column', children: shown })
  return {
    rows: lines.length,
    whole: () => column([...lines]),
    cut: (budget) => (budget <= 0 ? null : column(lines.slice(0, budget))),
  }
}

type Frame = { top: RenderElement; bottom: RenderElement }

function framedItem(
  context: Context,
  frame: Frame,
  body: readonly RenderElement[],
  key: string,
): ProseItem {
  const column = (shown: readonly RenderElement[]) =>
    context.elements.Box({
      key,
      flexDirection: 'column',
      children: [frame.top, ...shown, frame.bottom],
    })
  const edges = 2
  return {
    rows: body.length + edges,
    whole: () => column(body),
    cut: (budget) => (budget <= edges ? null : column(body.slice(0, budget - edges))),
  }
}

function headingRole(level: number): ReplyRole | undefined {
  if (level <= RULED_LEVELS) return 'heading'
  return level === MINOR_LEVEL ? 'minorHeading' : undefined
}

function headingItem(
  context: Context,
  part: Extract<ProsePart, { kind: 'heading' }>,
  key: string,
): ProseItem {
  const { Text } = context.elements
  const style = context.headingStyle
  const role = headingRole(part.level)
  const color = role === undefined ? undefined : roleColor(context, role)
  const isUpper = style === 'uppercase' && part.level === 1
  const runs = isUpper
    ? part.runs.map((run) =>
        run.mark.isCode || run.isDim === true ? run : { ...run, text: run.text.toUpperCase() },
      )
    : part.runs
  const isBanner = style === 'banner' && part.level <= RULED_LEVELS
  const isBoxed = isBanner && part.level === 1 && drawsBoxes(context)
  const look = {
    base: color,
    isBold: true,
    isUnderline: style === 'underline' && part.level <= RULED_LEVELS,
  }
  const lines = wrappedRuns(runs, isBoxed ? context.width - BOX_SIDES : context.width)
  const widest = Math.max(1, ...lines.map(runsWidth))
  const edge = (text: string) => Text({ color, bold: true, children: text })
  const textLines = lines.map((line, index) => {
    const spans = proseSpans(context, line, look)
    const children = isBoxed
      ? [edge('│ '), ...spans, edge(`${' '.repeat(widest - runsWidth(line))} │`)]
      : spans
    return lineBox(context, children, `${key}-line-${String(index)}`)
  })
  if (isBoxed) {
    const rule = RULE.repeat(widest + 2)
    return framedItem(
      context,
      {
        top: lineBox(context, [edge(`╭${rule}╮`)], `${key}-top`),
        bottom: lineBox(context, [edge(`╰${rule}╯`)], `${key}-bottom`),
      },
      textLines,
      key,
    )
  }
  const rule = isBanner
    ? [lineBox(context, [edge(HEADING_RULE.repeat(widest))], `${key}-rule`)]
    : []
  return linesItem(context, [...textLines, ...rule], key)
}

type BarRow = { depth: number; runs: Run[]; base?: Color }

function barRows(context: Context, lines: readonly QuoteLine[]): BarRow[] {
  const deepest = Math.max(Math.floor(context.width / 2 / QUOTE_BAR.length), 1)
  return lines.flatMap((line) => {
    const depth = Math.min(line.depth, deepest)
    return wrappedRuns(line.runs, context.width - QUOTE_BAR.length * depth).map((runs) => ({
      depth,
      runs,
    }))
  })
}

function barItem(
  context: Context,
  rows: readonly BarRow[],
  look: { bar: Color | undefined; text: ProseLook },
  key: string,
): ProseItem {
  const { Box, Text } = context.elements
  const drawn = rows.map((row, index) =>
    lineBox(
      context,
      [
        Text({ color: look.bar, children: QUOTE_BAR.repeat(row.depth) }),
        ...proseSpans(context, row.runs, { ...look.text, base: row.base ?? look.text.base }),
      ],
      `${key}-row-${String(index)}`,
    ),
  )
  const column = (shown: RenderElement[]) => Box({ key, flexDirection: 'column', children: shown })
  return {
    rows: drawn.length,
    whole: () => column(drawn),
    cut: (budget) => (budget <= 0 ? null : column(drawn.slice(0, budget))),
  }
}

function quoteItem(
  context: Context,
  part: Extract<ProsePart, { kind: 'quote' }>,
  key: string,
): ProseItem {
  return barItem(
    context,
    barRows(context, part.lines),
    {
      bar: roleColor(context, 'marker'),
      text: { base: roleColor(context, 'quoteText'), isItalic: true },
    },
    key,
  )
}

function alertItem(
  context: Context,
  part: Extract<ProsePart, { kind: 'alert' }>,
  key: string,
): ProseItem {
  const { Text } = context.elements
  const color = roleColor(context, ALERT_ROLES[part.alert])
  const word = ALERT_WORDS[part.alert]
  if (!drawsBoxes(context)) {
    const wordRow = { depth: 1, runs: [{ text: word, mark: PLAIN_MARK }], base: color }
    const body = barRows(
      context,
      part.lines.map((runs) => ({ depth: 1, runs })),
    )
    return barItem(context, [wordRow, ...body], { bar: color, text: {} }, key)
  }
  const inner = context.width - BOX_SIDES
  const edge = (text: string) => Text({ color, children: text })
  const body = part.lines.flatMap((runs) => wrappedRuns(runs, inner))
  const top = `╭${RULE} ${word} ${RULE.repeat(Math.max(inner - displayWidth(word) - 1, 0))}╮`
  return framedItem(
    context,
    {
      top: lineBox(context, [edge(top)], `${key}-top`),
      bottom: lineBox(context, [edge(`╰${RULE.repeat(inner + 2)}╯`)], `${key}-bottom`),
    },
    body.map((runs, index) =>
      lineBox(
        context,
        [
          edge('│ '),
          ...proseSpans(context, runs, {}),
          edge(`${' '.repeat(Math.max(inner - runsWidth(runs), 0))} │`),
        ],
        `${key}-line-${String(index)}`,
      ),
    ),
    key,
  )
}

function tallyItem(
  context: Context,
  part: Extract<ProsePart, { kind: 'tally' }>,
  key: string,
): ProseItem {
  const { Text } = context.elements
  const text = `${String(part.done)} of ${String(part.total)} done`
  return linesItem(
    context,
    [lineBox(context, [Text({ dimColor: true, children: text })], `${key}-line`)],
    key,
  )
}

function drawnItem(context: Context, line: DrawnLine, key: string): ProseItem {
  const text = textOfRuns(line.runs)
  const room = Math.max(context.width - displayWidth(leadOf(context, line)), 1)
  const rows = rowsOf(text, room)
  return {
    rows,
    whole: () => drawnLineElement(context, line, line.runs, key),
    cut: (budget) => {
      if (budget <= 0) return null
      const kept = cutLine(text, budget * room)
      const runs = cutRuns(line.runs, kept.length - CUT_MARK.length)
      return drawnLineElement(context, line, runs, key)
    },
  }
}

function markdownItem(context: Context, lines: readonly string[], key?: string): ProseItem {
  const rows = lines.map((line, index) => {
    if (line.trim() !== '') return rowsOf(line, context.width)
    return (lines[index - 1] ?? '').trim() === '' ? 0 : 1
  })
  const draw = (shown: readonly string[]) =>
    context.elements.Markdown({ ...(key === undefined ? {} : { key }), text: shown.join('\n') })
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
        if (budget > used) shown.push(cutLine(line, (budget - used) * context.width))
        break
      }
      return shown.length === 0 ? null : draw(shown)
    },
  }
}

function proseItem(
  context: Context,
  part: Exclude<ProsePart, { kind: 'blank' }>,
  key: string,
): ProseItem {
  switch (part.kind) {
    case 'drawn':
      return drawnItem(context, part.line, key)
    case 'engine':
      return markdownItem(context, shownText(part.text).split('\n'), key)
    case 'heading':
      return headingItem(context, part, key)
    case 'quote':
      return quoteItem(context, part, key)
    case 'alert':
      return alertItem(context, part, key)
    case 'tally':
      return tallyItem(context, part, key)
  }
}

function spacedItem(context: Context, item: ProseItem): ProseItem {
  const spaced = (element: RenderElement) =>
    context.elements.Box({ flexDirection: 'column', marginTop: 1, children: element })
  return {
    rows: item.rows + 1,
    whole: () => spaced(item.whole()),
    cut: (budget) => {
      const cut = budget > 1 ? item.cut(budget - 1) : null
      return cut === null ? null : spaced(cut)
    },
  }
}

function proseItems(context: Context, parts: readonly ProsePart[]): ProseItem[] {
  const items: ProseItem[] = []
  let isSpaced = false
  for (const [index, part] of parts.entries()) {
    if (part.kind === 'blank') {
      isSpaced = items.length > 0
      continue
    }
    const item = proseItem(context, part, `prose-${String(index)}`)
    items.push(isSpaced ? spacedItem(context, item) : item)
    isSpaced = false
  }
  return items
}

function itemsPiece(context: Context, items: readonly ProseItem[]): Piece {
  const column = (children: RenderElement[]) =>
    context.elements.Box({ flexDirection: 'column', children })
  return {
    rows: sum(items.map((item) => item.rows)),
    whole: () => column(items.map((item) => item.whole())),
    cut: (budget) => {
      const shown: RenderElement[] = []
      let used = 0
      for (const item of items) {
        if (used + item.rows <= budget) {
          shown.push(item.whole())
          used += item.rows
          continue
        }
        const cut = item.cut(budget - used)
        if (cut !== null) {
          shown.push(cut)
          used = budget
        }
        break
      }
      return shown.length === 0 ? null : { element: column(shown), rows: used }
    },
  }
}

function prosePiece(context: Context, prose: Prose): Piece {
  if (!context.drawsProse) {
    const item = markdownItem(context, prose.lines.map(shownText))
    return {
      rows: item.rows,
      whole: item.whole,
      cut: (budget) => {
        const element = item.cut(budget)
        return element === null ? null : { element, rows: Math.min(budget, item.rows) }
      },
    }
  }
  return itemsPiece(context, proseItems(context, prosePartsOf(prose.lines, context.doneGlyph)))
}

type Buttons = { element: RenderElement; columns: number; shown: number }

type CopyAction = { key: string; label: string; text: string; what: string }

type FoldAction = { key: string; label: string; next: ReplyViewFold; block?: string }

type ButtonAction = CopyAction | FoldAction

type CopyState = 'rest' | 'copied' | 'failed'

const COPY_ROLES: Readonly<Record<Exclude<CopyState, 'rest'>, ReplyRole>> = {
  copied: 'copied',
  failed: 'notCopied',
}

function copyLabels(context: Context, label: string): Readonly<Record<CopyState, string>> {
  const rest = label.startsWith(COPY_WORD) ? label.slice(COPY_WORD.length) : ` ${label}`
  return {
    rest: label,
    copied: `${context.marks.done} copied${rest}`,
    failed: `${context.marks.blocked} not copied`,
  }
}

function copyStateOf(context: Context, action: CopyAction): CopyState {
  const mark = context.copyMark
  if (mark === null || mark.key !== copyMarkKey(action.label, action.text)) return 'rest'
  return mark.isCopied ? 'copied' : 'failed'
}

function copyButton(
  context: Context,
  action: CopyAction,
  label: string,
  state: CopyState,
): RenderElement {
  const { Button, Text } = context.elements
  const onPress = (press: { surface: RenderSurface }) => {
    context.actions.copy(
      { text: action.text, what: action.what, mark: copyMarkKey(action.label, action.text) },
      press.surface,
    )
  }
  if (state === 'rest') return Button({ key: action.key, label, dimColor: true, onPress })
  return Button({
    key: action.key,
    label,
    onPress,
    children: Text({ color: roleColor(context, COPY_ROLES[state]), children: label }),
  })
}

function buttonRoom(context: Context): number {
  return Math.max(context.width - BUTTON_CHROME_COLUMNS, 1)
}

type FittedButton = { element: RenderElement; rest: number; shown: number; widest: number }

function fittedButton(context: Context, action: ButtonAction): FittedButton {
  const room = buttonRoom(context)
  const columnsOf = (label: string) => displayWidth(fitted(label, room)) + BUTTON_CHROME_COLUMNS
  if ('next' in action) {
    const label = fitted(action.label, room)
    const columns = columnsOf(label)
    return {
      rest: columns,
      shown: columns,
      widest: columns,
      element: context.elements.Button({
        key: action.key,
        label,
        dimColor: true,
        onPress: () => {
          context.actions.fold(action.next, action.block)
        },
      }),
    }
  }
  const labels = copyLabels(context, action.label)
  const state = copyStateOf(context, action)
  const label = fitted(labels[state], room)
  return {
    rest: columnsOf(labels.rest),
    shown: columnsOf(labels[state]),
    widest: Math.max(...Object.values(labels).map(columnsOf)),
    element: copyButton(context, action, label, state),
  }
}

function buttonRow(context: Context, buttons: readonly FittedButton[]): Buttons {
  const gaps = Math.max(buttons.length - 1, 0)
  const reserve = Math.max(0, ...buttons.map((button) => button.widest - button.rest))
  return {
    columns: sum(buttons.map((button) => button.rest)) + gaps + reserve,
    shown: sum(buttons.map((button) => button.shown)) + gaps,
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
  const markdown = { key: `${key}-copy`, label: COPY_WORD, ...tableCopy(table) }
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

function isHeading(role: CellRole): boolean {
  return role === 'header' || role === 'heading' || role === 'label'
}

function cellColor(context: Context, mark: Mark, role: CellRole): Color | undefined {
  if (mark.isLink) return paint(context, 'link')
  if (mark.isCode) return paint(context, 'inlineCode')
  if (isHeading(role)) return paint(context, 'tableHeader')
  return tokenColor(context, mark)
}

function isBoldCell(mark: Mark, role: CellRole): boolean {
  if (role === 'header') return true
  return (role === 'label' || role === 'value') && mark.isBold
}

function cellSpan(context: Context, text: string, mark: Mark, role: CellRole): CellChild {
  return styledSpan(context, text, mark, {
    color: cellColor(context, mark, role),
    isBold: isBoldCell(mark, role),
  })
}

function cellSpans(context: Context, cell: Cell, role: CellRole): CellChild[] {
  return cell.runs.map((run) => cellSpan(context, run.text, run.mark, role))
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
    if (span.kind === 'rule') return Text({ color: paint(context, 'rules'), children: span.text })
    if (span.kind === 'space') return span.text
    return cellSpan(context, span.text, span.mark, isHeader ? 'header' : 'value')
  })
  return Box({ key, flexShrink: 1, children: Text({ wrap: 'truncate-end', children }) })
}

function tableRule(context: Context, text: string, key: string) {
  const { Box, Text } = context.elements
  return Box({
    key,
    children: Text({ color: paint(context, 'rules'), wrap: 'truncate-end', children: text }),
  })
}

function ruleRow(context: Context, text: string, key: string) {
  const { Box, Text } = context.elements
  return Box({ key, children: Text({ dimColor: true, wrap: 'truncate-end', children: text }) })
}

function tableHead(look: TableLook): Head {
  return { kind: 'table', role: 'tableKind', detail: [plural(look.rows.length, 'row')] }
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
  const head = tableHead(look)
  const title = titleWithButtons(
    context,
    head,
    actions,
    key,
    headEnd(context, head, actions, framedWidth(widths, frame)),
  )
  const headerSpans = spanLines(look, widths, look.header, frame)
  const rowSpans = look.rows.map((row) => spanLines(look, widths, row, frame))
  const isWrapped = [headerSpans, ...rowSpans].some((lines) => lines.length > 1)
  const linesBetweenRows = frame.rulesEveryRow || isWrapped ? 1 : 0
  const top = frame.top === null ? null : ruleLine(widths, frame.top)
  const bottom = frame.bottom === null ? null : ruleLine(widths, frame.bottom)
  const width = framedWidth(widths, frame)
  const columns = headEnd(context, head, actions, width)
  const heading = [
    title.element,
    ...(top === null ? [] : [tableRule(context, top, 'top')]),
    ...headerSpans.map((spans, index) =>
      tableLine(context, spans, index === 0 ? 'header' : `header-${String(index)}`, true),
    ),
    ...(frame.hasSides && rowSpans.length === 0
      ? []
      : [tableRule(context, ruleLine(widths, frame.header), 'header-rule')]),
  ]
  const closing = bottom === null ? [] : [tableRule(context, bottom, 'bottom')]
  const drawnRows = rowSpans.map((lines, index) =>
    Box({
      key: `row-${String(index)}`,
      flexDirection: 'column',
      children: lines.map((spans, lineIndex) =>
        tableLine(context, spans, `line-${String(lineIndex)}`, false),
      ),
    }),
  )
  const rowRule = ruleLine(widths, frame.row)
  const ruled = (shown: readonly RenderElement[]) =>
    shown.flatMap((row, index) =>
      index > 0 && linesBetweenRows > 0
        ? [tableRule(context, rowRule, `rule-${String(index)}`), row]
        : [row],
    )
  const rowsBox = (shown: readonly RenderElement[]) =>
    Box({ key: 'rows', flexDirection: 'column', children: ruled(shown) })
  const column = (children: RenderElement[]) => Box({ key, flexDirection: 'column', children })
  const rowRules = linesBetweenRows * Math.max(rowSpans.length - 1, 0)
  const frameRows = title.rows + heading.length - 1 + closing.length
  return {
    rows: frameRows + sum(rowSpans.map((lines) => lines.length)) + rowRules,
    beside: {
      columns,
      at: (narrowed) => columnsPiece({ ...context, width: narrowed }, table, look, layout, key),
    },
    whole: () => column([...heading, rowsBox(drawnRows), ...closing]),
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

function labelRoom(context: Context): number {
  return Math.max(Math.floor((context.width - FIELD_INDENT - 1) / 2), 2)
}

function rowBlock(context: Context, look: TableLook, row: readonly Cell[], index: number): Drawing {
  const { Box, Text } = context.elements
  const labels = Math.min(labelWidth(look), labelRoom(context))
  const fields = fieldsOf(look, row)
  const valueWidth = context.width - FIELD_INDENT - labels - 1
  const title = cellLine(context, rowTitle(row, index), 'title', 'title', 'truncate-end')
  return {
    rows: 1 + sum(fields.map((field) => rowsOf(field.value.text, valueWidth))),
    element: Box({
      key: `row-${String(index)}`,
      flexDirection: 'column',
      children: [
        title,
        ...fields.map((field, fieldIndex) =>
          Box({
            key: `field-${String(fieldIndex)}`,
            flexDirection: 'row',
            paddingLeft: FIELD_INDENT,
            children: [
              Box({
                width: labels,
                flexShrink: 0,
                children: Text({
                  children: cellSpans(
                    context,
                    labelOf(fittedCell(field.label, labels - 1)),
                    'label',
                  ),
                }),
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

function headingsBlock(context: Context, look: TableLook): Drawing {
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
        title,
        ...more.map((heading, index) =>
          cellLine(context, heading, 'heading', `heading-${String(index)}`),
        ),
      ],
    }),
  }
}

function blocksPiece(context: Context, table: Table, look: TableLook, key: string): Piece {
  const { Box } = context.elements
  const title = titleWithButtons(context, tableHead(look), tableActions(table, key), key)
  const blocks =
    look.rows.length > 0
      ? look.rows.map((row, index) => rowBlock(context, look, row, index))
      : [headingsBlock(context, look)]
  const column = (shown: readonly Drawing[]) =>
    blocksColumn(
      context.elements,
      context.surface,
      shown.map((block) => block.element),
      `${key}-blocks`,
    )
  const titled = (shown: readonly Drawing[]) =>
    Box({ key, flexDirection: 'column', children: [title.element, column(shown)] })
  return {
    rows: title.rows + sum(blocks.map((block) => block.rows)) + blocks.length - 1,
    whole: () => titled(blocks),
    cut: (budget) => {
      let used = title.rows
      let count = 0
      for (const block of blocks) {
        const needed = block.rows + (count > 0 ? 1 : 0)
        if (used + needed > budget) break
        used += needed
        count += 1
      }
      return count === 0 ? null : { element: titled(blocks.slice(0, count)), rows: used }
    },
  }
}

function frameOf(context: Context): TableFrame {
  const isBoxed = context.surface === BOX_SURFACE && drawsBoxes(context)
  return TABLE_FRAMES[isBoxed ? context.tableStyle : 'rules']
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

type Head = { kind: string; role: ReplyRole; detail: readonly string[]; state?: string }

function headText(head: Head): string {
  return [head.kind, ...head.detail, head.state ?? '']
    .filter((part) => part !== '')
    .join(HEAD_SEPARATOR)
}

type HeadPart = { text: string; look: 'dim' | 'kind' | 'state' }

function headParts(head: Head, rule: string): HeadPart[] {
  const lead = `${RULE.repeat(2)} `
  const parts: HeadPart[] = [{ text: lead, look: 'dim' }]
  const add = (text: string, look: HeadPart['look']) => {
    if (text === '') return
    if (parts.length > 1) parts.push({ text: HEAD_SEPARATOR, look: 'dim' })
    parts.push({ text, look })
  }
  add(head.kind, 'kind')
  for (const part of head.detail) add(part, 'dim')
  add(head.state ?? '', 'state')
  parts.push({ text: rule.slice(lead.length + headText(head).length), look: 'dim' })
  return parts.reduce<HeadPart[]>((merged, part) => {
    const last = merged.at(-1)
    if (last?.look === 'dim' && part.look === 'dim') last.text += part.text
    else merged.push({ ...part })
    return merged
  }, [])
}

function fittedParts(parts: readonly HeadPart[], columns: number): HeadPart[] {
  const total = sum(parts.map((part) => displayWidth(part.text)))
  if (total <= columns) return [...parts]
  const shown: HeadPart[] = []
  let room = Math.max(columns - displayWidth(CUT_MARK), 0)
  for (const part of parts) {
    const kept = cutToWidth(part.text, room)
    room -= displayWidth(kept)
    if (kept.length < part.text.length) {
      shown.push({ ...part, text: `${kept}${CUT_MARK}` })
      break
    }
    shown.push(part)
  }
  return shown
}

function headLine(context: Context, head: Head, columns: number, key: string): RenderElement {
  const { Box, Text } = context.elements
  const text = headText(head)
  const rule = titleRule(text, columns)
  if (text === '') {
    return Box({ key, children: Text({ dimColor: true, wrap: 'truncate-end', children: rule }) })
  }
  const looks = {
    dim: { dimColor: true },
    kind: { bold: true, color: roleColor(context, head.role) },
    state: { color: roleColor(context, 'notDrawn') },
  } as const
  return Box({
    key,
    flexShrink: 1,
    children: Text({
      wrap: 'truncate-end',
      children: fittedParts(headParts(head, rule), columns).map((part) =>
        Text({ ...looks[part.look], children: part.text }),
      ),
    }),
  })
}

function ruleWithButtons(
  context: Context,
  head: Head,
  room: number,
  buttons: RenderElement,
  key: string,
): RenderElement {
  const { Box } = context.elements
  return Box({
    key: `${key}-title`,
    flexDirection: 'row',
    children: [
      headLine(context, head, room, 'title-rule'),
      Box({ flexShrink: 0, marginLeft: BUTTONS_GAP, children: buttons }),
    ],
  })
}

type FenceLook = { role: ReplyRole; state?: string; note?: string }

const CODE_LOOK: FenceLook = { role: 'codeKind' }

function fenceTitle(
  context: Context,
  fence: Fence,
  actions: readonly ButtonAction[],
  key: string,
  count: number | null,
  look: FenceLook,
): Drawing {
  const lines = count === null ? '' : `${grouped(count)} lines`
  return titleWithButtons(
    context,
    {
      kind: fenceTag(fence),
      role: look.role,
      detail: lines === '' ? [] : [lines],
      ...(look.state === undefined ? {} : { state: look.state }),
    },
    actions,
    key,
  )
}

function cutNote(lines: readonly string[], width: number): string {
  const widest = Math.max(...lines.map(displayWidth))
  return `drawing cut: ${widthClause(widest, width)}. ${CUT_REMEDY}.`
}

function codeSpan(context: Context, text: string, look: CodeLook): CellChild {
  return styledSpan(context, text, PLAIN_MARK, {
    color: lookColor(context, look),
    isBold: look.isBold === true,
    isDim: look.isDim === true,
    isItalic: look.isItalic === true,
    isUnderline: look.isUnderline === true,
  })
}

function tokenSpan(context: Context, token: CodeToken): CellChild {
  return !context.highlight || token.look === null
    ? token.text
    : codeSpan(context, token.text, token.look)
}

type CodeLines = {
  drawing: CodeDrawing
  lineCount: number
  gutter: number
  wrap: { wrap?: 'truncate-end' }
}

function ownBody(context: Context, lines: readonly CodeToken[][], look: CodeLines, key: string) {
  const { Box, Text } = context.elements
  return Box({
    key: `${key}-lines`,
    flexDirection: 'column',
    children: lines.map((tokens, index) => {
      const lineKey = `${key}-line-${String(index + 1)}`
      const text = Text({
        children: tokens.length === 0 ? ' ' : tokens.map((token) => tokenSpan(context, token)),
      })
      if (look.gutter === 0) return Box({ key: lineKey, children: text })
      const number = gutterNumber(index + 1, look.lineCount)
      return Box({
        key: lineKey,
        flexDirection: 'row',
        children: [
          Box({
            width: look.gutter,
            flexShrink: 0,
            children: codeSpan(context, number, GUTTER_LOOK),
          }),
          Box({ flexShrink: 1, flexGrow: 1, children: text }),
        ],
      })
    }),
  })
}

function codeBody(
  context: Context,
  fence: Fence,
  lines: readonly string[],
  look: CodeLines,
  key: string,
): RenderElement | null {
  if (lines.length === 0) return null
  const { drawing } = look
  if (isOwnDrawing(drawing)) {
    return ownBody(context, drawing.lines.slice(0, lines.length), look, key)
  }
  const language =
    drawing.kind === 'engine' && LANGUAGE_TAG.test(fence.tag) ? { language: fence.tag } : {}
  const gutter = look.gutter === 0 ? {} : { startLine: 1 }
  return context.elements.Code({ source: lines.join('\n'), ...language, ...gutter, ...look.wrap })
}

function codeFoldRow(context: Context, hidden: number, key: string): RenderElement {
  const { Box, Text } = context.elements
  return Box({
    key: `${key}-fold-row`,
    children: Text({
      dimColor: true,
      wrap: 'truncate-end',
      children: `${context.marks.folded} ${plural(hidden, 'more line')}`,
    }),
  })
}

function codeFoldAction(fold: ReplyViewFold, block: string, key: string): FoldAction {
  return {
    key: `${key}-fold`,
    label: fold === 'folded' ? 'more' : 'less',
    next: fold === 'folded' ? 'open' : 'folded',
    block,
  }
}

function fencePiece(
  context: Context,
  fence: Fence,
  key: string,
  copy: BlockCopy = codeCopy(fence),
  fenceLook: FenceLook = CODE_LOOK,
): Piece {
  const { Box, Text } = context.elements
  const lines = fence.content === '' ? [] : shownText(fence.content).split('\n')
  const isCut = isCutDrawing(fence.tag, lines, context.width)
  const drawing = codeDrawingOf(
    fence.tag,
    lines,
    context.surface === COLOUR_SURFACE,
    context.codeBudget.nodesLeft,
  )
  if (isOwnDrawing(drawing)) context.codeBudget.nodesLeft -= drawing.nodes
  const folds = foldsCode(lines.length)
  const block = codeFoldKey(fence.tag, fence.content)
  const fold = folds ? (context.codeFolds.get(block) ?? 'folded') : 'open'
  const shown = fold === 'folded' ? lines.slice(0, FOLDED_LINES) : lines
  const gutter =
    folds && context.columns >= GUTTER_COLUMNS_AT_LEAST ? gutterColumns(lines.length) : 0
  const look: CodeLines = {
    drawing,
    lineCount: lines.length,
    gutter,
    wrap: isCut ? { wrap: 'truncate-end' } : {},
  }
  const drawnLines = isOwnDrawing(drawing)
    ? drawing.lines
        .slice(0, shown.length)
        .map((tokens) => tokens.map((token) => token.text).join(''))
    : shown
  const rows = drawnLines.map((line) => (isCut ? 1 : rowsOf(line, context.width - gutter)))
  const actions: ButtonAction[] = [
    ...(folds ? [codeFoldAction(fold, block, key)] : []),
    { key: `${key}-copy`, label: COPY_WORD, ...copy },
  ]
  const title = fenceTitle(context, fence, actions, key, folds ? lines.length : null, fenceLook)
  const notes = [
    ...(fenceLook.note === undefined ? [] : [fenceLook.note]),
    ...(drawing.kind === 'plain' ? [drawing.note] : []),
  ]
  const note =
    notes.length === 0
      ? null
      : Box({
          key: `${key}-plain`,
          flexDirection: 'column',
          children: notes.map((text, index) =>
            Box({
              key: `note-${String(index)}`,
              children: Text({ dimColor: true, children: text }),
            }),
          ),
        })
  const head = title.rows + sum(notes.map((text) => rowsOf(text, context.width)))
  const foot =
    folds && fold === 'folded' ? codeFoldRow(context, lines.length - shown.length, key) : null
  const footRows = foot === null ? 0 : 1
  const draw = (count: number, hasFoot: boolean) =>
    Box({
      key,
      flexDirection: 'column',
      children: [
        title.element,
        note,
        codeBody(context, fence, shown.slice(0, count), look, key),
        hasFoot ? foot : null,
      ],
    })
  const piece: Piece = {
    rows: head + sum(rows) + footRows,
    isOpened: folds && fold === 'open',
    whole: () => draw(shown.length, true),
    cut: (budget) => {
      if (budget < head) return null
      let used = head
      let count = 0
      for (const height of rows) {
        if (used + height > budget) break
        used += height
        count += 1
      }
      const hasFoot = count === shown.length && used + footRows <= budget
      return { element: draw(count, hasFoot), rows: used + (hasFoot ? footRows : 0) }
    },
  }
  return isCut ? notedPiece(context, cutNote(lines, context.width), piece, `${key}-cut`) : piece
}

function notedPiece(context: Context, note: string, piece: Piece, key: string): Piece {
  const { Box, Text } = context.elements
  const noteRows = rowsOf(note, context.width)
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
    rows: noteRows + piece.rows,
    whole: () => noted(piece.whole()),
    cut: (budget) => {
      const cut = piece.cut(budget - noteRows)
      return cut === null ? null : { element: noted(cut.element), rows: noteRows + cut.rows }
    },
    ...(piece.isOpened === undefined ? {} : { isOpened: piece.isOpened }),
  }
}

function named(drawn: InkedDrawing | Refusal, name: string, plain: string): DiagramOutcome {
  return drawn.kind === 'drawing' ? { ...drawn, name, plain } : drawn
}

function drawnDiagram(diagram: MermaidDiagram | Refusal, width: number): DiagramOutcome {
  switch (diagram.kind) {
    case 'refused':
      return diagram
    case 'flowchart': {
      const drawn = drawFlowchart(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'sequence': {
      const drawn = drawSequence(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'state': {
      const drawn = drawState(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'class': {
      const drawn = drawClasses(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'er': {
      const drawn = drawEntities(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'chart': {
      const drawn = drawChart(diagram, width)
      const name = chartName(diagram)
      return drawn.kind === 'drawing' ? { ...drawn, name, plain: name } : drawn
    }
    case 'gantt': {
      const drawn = drawGantt(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'gitgraph': {
      const drawn = drawGitGraph(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'mindmap': {
      const drawn = drawMindmap(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'timeline': {
      const drawn = drawTimeline(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'journey': {
      const drawn = drawJourney(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'quadrant': {
      const drawn = drawQuadrant(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'kanban': {
      const drawn = drawKanban(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'packet': {
      const drawn = drawPacket(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'sankey': {
      const drawn = drawSankey(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'radar': {
      const drawn = drawRadar(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'treemap': {
      const drawn = drawTreemap(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'block': {
      const drawn = drawBlock(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'requirement': {
      const drawn = drawRequirements(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'c4': {
      const drawn = drawC4(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
    case 'architecture': {
      const drawn = drawArchitecture(diagram, width)
      return named(drawn, diagram.kind, DIAGRAM_NAMES[diagram.kind])
    }
  }
}

const drawings = new Map<string, DiagramOutcome>()

export function guardedOutcome(draw: () => DiagramOutcome): DiagramOutcome {
  try {
    return draw()
  } catch {
    return { kind: 'refused', reason: DRAW_FAILED, line: null, limit: null }
  }
}

export function diagramOf(source: string, width: number, surface: RenderSurface): DiagramOutcome {
  const key = JSON.stringify([surface, width, source])
  const kept = drawings.get(key)
  if (kept !== undefined) {
    drawings.delete(key)
    drawings.set(key, kept)
    return kept
  }
  const outcome = guardedOutcome(() => drawnDiagram(parseMermaid(source), width))
  drawings.set(key, outcome)
  const oldest = drawings.keys().next()
  if (drawings.size > DRAWINGS_KEPT && oldest.done !== true) drawings.delete(oldest.value)
  return outcome
}

function diagramActions(fence: Fence, drawing: DiagramDrawing, key: string): CopyAction[] {
  return [
    { key: `${key}-copy`, label: COPY_WORD, ...mermaidCopy(fence, drawing) },
    {
      key: `${key}-drawing`,
      label: 'copy drawing',
      text: drawing.lines.join('\n'),
      what: `the ${drawing.name} drawing`,
    },
  ]
}

function headEnd(
  context: Context,
  head: Head,
  actions: readonly ButtonAction[],
  bodyWidth: number,
): number {
  const together = titleColumns(context, head, actions)
  if (together <= context.width) return Math.max(bodyWidth, together)
  return Math.max(
    bodyWidth,
    Math.min(context.width, displayWidth(titleRule(headText(head), 0))),
    ...stackedButtons(context, actions).map((line) => line.columns),
  )
}

function titleWithButtons(
  context: Context,
  head: Head,
  actions: readonly ButtonAction[],
  key: string,
  end = context.width,
): Drawing {
  const together = buttonsTogether(context, actions)
  const room = end - together.columns - BUTTONS_GAP
  if (displayWidth(titleRule(headText(head), 0)) <= room) {
    const ruleRoom = end - together.shown - BUTTONS_GAP
    return { rows: 1, element: ruleWithButtons(context, head, ruleRoom, together.element, key) }
  }
  const lines = buttonsUnder(context, actions, end)
  return {
    rows: 1 + lines.length,
    element: context.elements.Box({
      key: `${key}-title`,
      flexDirection: 'column',
      children: [headLine(context, head, Math.min(end, context.width), 'title-rule'), ...lines],
    }),
  }
}

function inkColor(context: Context, ink: Ink): Color | undefined {
  if (typeof ink === 'number') {
    const cycle = DIAGRAM_CYCLES[context.palette]
    return cycle[ink % cycle.length]
  }
  return ink === 'plain' ? undefined : paint(context, INK_ROLES[ink])
}

function inkSpan(context: Context, run: InkRun): CellChild {
  const color = inkColor(context, run.ink)
  const look = {
    ...(color === undefined ? {} : { color }),
    ...textPropsOf(run.looks),
  }
  return Object.keys(look).length === 0
    ? run.text
    : context.elements.Text({ ...look, children: run.text })
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

function titleColumns(context: Context, head: Head, actions: readonly ButtonAction[]): number {
  return (
    displayWidth(titleRule(headText(head), 0)) +
    BUTTONS_GAP +
    buttonsTogether(context, actions).columns
  )
}

function diagramHead(fence: Fence, name: string): Head {
  return {
    kind: MERMAID_TAG,
    role: isChartSource(fence.content) ? 'chartKind' : 'diagramKind',
    detail: [name],
  }
}

function chartBeside(
  context: Context,
  fence: Fence,
  drawing: DiagramDrawing,
  key: string,
): { beside?: Beside } {
  const head = diagramHead(fence, drawing.name)
  const columns = titleColumns(context, head, diagramActions(fence, drawing, key))
  if (columns >= context.width) return {}
  const narrow = diagramOf(fence.content, columns, context.surface)
  if (narrow.kind !== 'drawing' || narrow.shape !== drawing.shape) return {}
  return {
    beside: {
      columns,
      at: (narrowed) => diagramPiece({ ...context, width: narrowed }, fence, narrow, key),
    },
  }
}

function diagramBeside(
  context: Context,
  fence: Fence,
  drawing: DiagramDrawing,
  key: string,
): { beside?: Beside } {
  if (isChartSource(fence.content)) return chartBeside(context, fence, drawing, key)
  const head = diagramHead(fence, drawing.name)
  const columns = Math.max(
    titleColumns(context, head, diagramActions(fence, drawing, key)),
    ...drawing.lines.map(displayWidth),
  )
  return {
    beside: {
      columns,
      at: (narrowed) => diagramPiece({ ...context, width: narrowed }, fence, drawing, key),
    },
  }
}

function diagramPiece(context: Context, fence: Fence, drawing: DiagramDrawing, key: string): Piece {
  const { Box } = context.elements
  const title = titleWithButtons(
    context,
    diagramHead(fence, drawing.name),
    diagramActions(fence, drawing, key),
    key,
  )
  const column = (children: RenderElement[]) => Box({ key, flexDirection: 'column', children })
  return {
    rows: title.rows + drawing.lines.length,
    diagram: drawing.plain,
    ...diagramBeside(context, fence, drawing, key),
    whole: () => column([title.element, drawingBody(context, drawing, key)]),
    cut: (budget) => {
      const count = budget - title.rows
      if (count < DIAGRAM_ROWS_IN_PREVIEW_AT_LEAST) return null
      const first = {
        ...drawing,
        lines: drawing.lines.slice(0, count),
        inked: drawing.inked.slice(0, count),
      }
      return {
        element: column([title.element, drawingBody(context, first, key)]),
        rows: budget,
        diagram: drawing.plain,
      }
    },
  }
}

function notDrawnPiece(context: Context, fence: Fence, refusal: Refusal, key: string): Piece {
  return fencePiece(context, fence, key, mermaidCopy(fence, refusal), {
    role: isChartSource(fence.content) ? 'chartKind' : 'diagramKind',
    state: NOT_DRAWN_WORD,
    note: `${isChartSource(fence.content) ? 'chart' : 'diagram'} ${NOT_DRAWN_WORD}: ${refusal.reason}.`,
  })
}

function mermaidPiece(context: Context, fence: Fence, key: string): Piece {
  const outcome = diagramOf(fence.content, context.width, context.surface)
  return outcome.kind === 'drawing'
    ? diagramPiece(context, fence, outcome, key)
    : notDrawnPiece(context, fence, outcome, key)
}

function fenceKind(context: Context, fence: Fence): KindWord {
  if (!drawsAsDiagram(context.drawsDiagrams, fence)) {
    const tag = fenceTag(fence)
    return { word: tag === '' ? 'code block' : `${tag} block`, role: 'codeKind' }
  }
  const isChart = isChartSource(fence.content)
  const role = isChart ? 'chartKind' : 'diagramKind'
  const outcome = diagramOf(fence.content, context.width, context.surface)
  if (outcome.kind === 'drawing') return { word: outcome.plain, role }
  return { word: isChart ? 'chart' : 'diagram', role }
}

function blockPiece(context: Context, block: Block, key: string): Piece {
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

function pieceOf(context: Context, block: Block, index: number): Piece {
  const piece = blockPiece(context, block, `block-${String(index)}`)
  if (block.kind === 'prose') return piece
  const kind: KindWord =
    block.kind === 'table' ? { word: 'table', role: 'tableKind' } : fenceKind(context, block)
  return { ...piece, kinds: [kind] }
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
            kind: isChartSource(block.content) ? 'chart' : 'diagram',
            copy: mermaidCopy(block, diagramOf(block.content, layout.width, layout.surface)),
          }
        : { kind: 'code', copy: codeCopy(block) }
  }
}

function isProse(block: Block): boolean {
  return block.kind === 'prose'
}

function isDefiningProse(block: Block): boolean {
  return block.kind === 'prose' && holdsLinkDefinition(block.lines)
}

const EDGE_COLUMNS: Readonly<Record<ReplyEdge, number>> = {
  none: 0,
  bullet: BULLET_COLUMNS,
  frame: FRAME_COLUMNS,
}

function replyEdge(columns: number, hasBullet: boolean, replyStyle: ReplyStyle): ReplyEdge {
  if (!hasBullet) return 'none'
  return shownReplyStyle(replyStyle, columns) === 'frame' ? 'frame' : 'bullet'
}

export function replyWidth(
  columns: number,
  hasBullet: boolean,
  replyStyle: ReplyStyle = DEFAULT_REPLY_STYLE,
): number {
  return columns - EDGE_COLUMNS[replyEdge(columns, hasBullet, replyStyle)]
}

type RowCell = { columns: number; piece: Piece }

type ShownCell = { columns: number; element: RenderElement }

function shownAt(piece: Piece, budget: number): Cut | null {
  return piece.rows <= budget ? { element: piece.whole(), rows: piece.rows } : piece.cut(budget)
}

function cellsAt(cells: readonly RowCell[], budget: number): (Cut & ShownCell)[] | null {
  const shown: (Cut & ShownCell)[] = []
  for (const cell of cells) {
    const cut = shownAt(cell.piece, budget)
    if (cut === null) return null
    shown.push({ ...cut, columns: cell.columns })
  }
  return shown
}

function rowPiece(
  context: Context,
  besides: readonly Beside[],
  key: string,
  kinds: readonly KindWord[],
): Piece {
  const { Box } = context.elements
  const cells = besides.map((beside) => ({
    columns: beside.columns,
    piece: beside.at(beside.columns),
  }))
  const row = (shown: readonly ShownCell[]) =>
    Box({
      key,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: COLUMNS_BETWEEN,
      children: shown.map((cell, index) =>
        Box({
          key: `${key}-${String(index)}`,
          flexDirection: 'column',
          width: cell.columns,
          flexShrink: 0,
          children: cell.element,
        }),
      ),
    })
  return {
    rows: Math.max(...cells.map((cell) => cell.piece.rows)),
    kinds,
    whole: () => row(cells.map((cell) => ({ columns: cell.columns, element: cell.piece.whole() }))),
    cut: (budget) => {
      const shown = cellsAt(cells, budget)
      if (shown === null) return null
      const diagram = shown.find((cell) => cell.diagram !== undefined)?.diagram
      return {
        element: row(shown),
        rows: Math.max(...shown.map((cell) => cell.rows)),
        ...(diagram === undefined ? {} : { diagram }),
      }
    },
  }
}

function sharesRows(layout: ReplyLayout): boolean {
  return layout.surface === ROW_SURFACE && (layout.sideBySide ?? DEFAULT_SIDE_BY_SIDE) === 'on'
}

function rowsOfPieces(context: Context, pieces: readonly Piece[]): Piece[] {
  const rows = sharedRows(pieces, (piece) => piece.beside?.columns ?? null, context.width)
  return rows.map((row, index) => {
    const [only, ...more] = row
    if (only !== undefined && more.length === 0) return only
    const besides = row.flatMap((piece) => (piece.beside === undefined ? [] : [piece.beside]))
    return rowPiece(
      context,
      besides,
      `row-${String(index)}`,
      row.flatMap((piece) => piece.kinds ?? []),
    )
  })
}

function foldedPreview(pieces: readonly Piece[]): Preview {
  const shown: Drawing[] = []
  let used = 0
  for (const piece of pieces) {
    const hiddenFrom = shown.length + 1
    const gap = shown.length > 0 ? 1 : 0
    const end = used + gap + piece.rows
    if (end <= FOLD_AFTER_ROWS) {
      shown.push({ element: piece.whole(), rows: piece.rows + gap })
      used = end
      continue
    }
    const budget = FOLD_AFTER_ROWS - used - gap
    if (budget <= 0) break
    if (piece.isOpened === true || (piece.diagram !== undefined && end <= PREVIEW_ROWS_AT_MOST)) {
      shown.push({ element: piece.whole(), rows: piece.rows + gap })
      return { shown, cutDiagram: null, hiddenFrom }
    }
    const cut = piece.cut(budget)
    if (cut === null) break
    shown.push({ element: cut.element, rows: cut.rows + gap })
    const cutDiagram =
      cut.diagram === undefined ? null : { name: cut.diagram, rows: piece.rows - cut.rows }
    return { shown, cutDiagram, hiddenFrom }
  }
  return { shown, cutDiagram: null, hiddenFrom: shown.length }
}

type KindCount = { text: string; role: ReplyRole }

function kindCounts(kinds: readonly KindWord[]): KindCount[] {
  const counts = new Map<string, { count: number; role: ReplyRole }>()
  for (const kind of kinds) {
    const known = counts.get(kind.word)
    if (known === undefined) counts.set(kind.word, { count: 1, role: kind.role })
    else known.count += 1
  }
  return [...counts].map(([word, { count, role }]) => ({ text: plural(count, word), role }))
}

function hiddenText(lead: string, hidden: number, cutDiagram: CutDiagram | null): string {
  if (cutDiagram === null) return `${lead} ${plural(hidden, 'more line')}`
  const rest = `${lead} ${cutDiagram.name}, ${plural(cutDiagram.rows, 'more row')}`
  const after = hidden - cutDiagram.rows
  return after > 0 ? `${rest}, then ${plural(after, 'more line')}` : rest
}

function foldActions(fold: ReplyViewFold, text: string): ButtonAction[] {
  return [
    {
      key: 'fold',
      label: fold === 'folded' ? 'more' : 'less',
      next: fold === 'folded' ? 'open' : 'folded',
    },
    { key: 'copy-reply', label: REPLY_COPY_LABEL, ...replyCopy(text) },
  ]
}

function kindSpans(context: Context, kinds: readonly KindCount[]): CellChild[] {
  const { Text } = context.elements
  return kinds.flatMap((kind, index) => [
    ...(index === 0 ? [] : [Text({ dimColor: true, children: HEAD_SEPARATOR })]),
    Text({ color: roleColor(context, kind.role), children: kind.text }),
  ])
}

function countLine(context: Context, text: string): RenderElement {
  const { Box, Text } = context.elements
  return Box({
    key: 'fold-count',
    flexShrink: 0,
    children: Text({ dimColor: true, children: text }),
  })
}

type FoldLine = { fold: ReplyViewFold; text: string; hidden: string; kinds: readonly KindCount[] }

function foldRow(context: Context, line: FoldLine) {
  const { Box, Text } = context.elements
  const { fold, kinds } = line
  const shown = fold === 'folded' ? line.hidden : context.marks.opened
  const actions = foldActions(fold, line.text)
  const together = buttonsTogether(context, actions)
  const named = fold === 'folded' && kinds.length > 0
  const fitsBeside =
    context.columns >= KINDS_BESIDE_FROM_COLUMNS &&
    displayWidth(shown) + BUTTONS_GAP + together.columns <= context.width
  const kindsList = (separated: boolean) =>
    Text({
      ...(separated ? { wrap: 'truncate-end' as const } : {}),
      children: [
        ...(separated ? [Text({ dimColor: true, children: HEAD_SEPARATOR })] : []),
        ...kindSpans(context, kinds),
      ],
    })
  if (fitsBeside) {
    return Box({
      key: 'fold-row',
      flexDirection: 'row',
      children: [
        countLine(context, shown),
        named ? Box({ key: 'fold-kinds', flexShrink: 1, children: kindsList(true) }) : null,
        Box({ flexGrow: 1, minWidth: BUTTONS_GAP }),
        together.element,
      ],
    })
  }
  return Box({
    key: 'fold-row',
    flexDirection: 'column',
    children: [
      countLine(context, shown),
      named
        ? Box({ key: 'fold-kinds', paddingLeft: KINDS_INDENT, children: kindsList(false) })
        : null,
      ...buttonsUnder(context, actions, context.width),
    ],
  })
}

function blocksColumn(
  elements: ReplyElements,
  surface: RenderSurface,
  blocks: readonly RenderElement[],
  key?: string,
): RenderElement {
  const { Box } = elements
  const keyed = key === undefined ? {} : { key }
  if (surface !== MARGIN_SURFACE) {
    return Box({ ...keyed, flexDirection: 'column', gap: 1, children: blocks })
  }
  return Box({
    ...keyed,
    flexDirection: 'column',
    children: blocks.map((block, index) =>
      index === 0 ? block : Box({ flexDirection: 'column', marginTop: 1, children: block }),
    ),
  })
}

function withEdge(elements: ReplyElements, layout: ReplyLayout, body: RenderElement) {
  const replyStyle = layout.replyStyle ?? DEFAULT_REPLY_STYLE
  const edge = replyEdge(layout.columns, layout.hasBullet, replyStyle)
  if (edge === 'none') return body
  if (edge === 'frame') {
    const color = shownLookColor(layout.palette, ROLE_LOOKS.replyFrame)
    return framedReply(elements, { color, isFirstOfReply: layout.isFirstOfReply }, body)
  }
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
  const width = replyWidth(layout.columns, layout.hasBullet, layout.replyStyle)
  const context: Context = {
    elements,
    width,
    columns: layout.columns,
    surface: layout.surface,
    drawsDiagrams: layout.drawsDiagrams,
    tableStyle: layout.tableStyle,
    headingStyle: layout.headingStyle,
    doneGlyph: layout.doneGlyph,
    highlight: layout.highlight,
    palette: layout.palette,
    codeFolds: layout.codeFolds ?? new Map(),
    codeBudget: { nodesLeft: CODE_NODES_AT_MOST },
    drawsProse: layout.surface === PROSE_SURFACE && !blocks.some(isDefiningProse),
    actions,
    marks: layout.marks ?? PLAIN_MARKS,
    copyMark: layout.copyMark ?? null,
  }
  const blockPieces = blocks.map((block, index) => pieceOf(context, block, index))
  const pieces = sharesRows(layout) ? rowsOfPieces(context, blockPieces) : blockPieces
  const total = sum(pieces.map((piece) => piece.rows)) + Math.max(pieces.length - 1, 0)
  const preview = total > FOLD_AFTER_ROWS ? foldedPreview(pieces) : null
  const previewRows = sum(preview?.shown.map((drawing) => drawing.rows) ?? [])
  const isLong = preview !== null && previewRows < total
  const isEngineReply = layout.surface !== PROSE_SURFACE && blocks.every(isProse)
  if (blocks.length === 0 || (!isLong && isEngineReply)) return null
  const { Box } = elements
  const shown =
    isLong && fold === 'folded'
      ? preview.shown
      : pieces.map((piece) => ({ element: piece.whole(), rows: piece.rows }))
  const hidden = hiddenText(context.marks.folded, total - previewRows, preview?.cutDiagram ?? null)
  const kinds = kindCounts(
    pieces.slice(preview?.hiddenFrom ?? pieces.length).flatMap((piece) => piece.kinds ?? []),
  )
  const isOpened = isLong && fold === 'open'
  const divider = (key: string) => (isOpened ? ruleRow(context, RULE.repeat(width), key) : null)
  const body = Box({
    flexDirection: 'column',
    children: [
      divider('opened-top'),
      blocksColumn(
        elements,
        layout.surface,
        shown.map((drawing) => drawing.element),
      ),
      divider('opened-bottom'),
      isLong ? foldRow(context, { fold, text, hidden, kinds }) : null,
    ],
  })
  return withEdge(elements, layout, body)
}
