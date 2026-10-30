import type { RenderElement, RenderNode } from 'claude-code'
import { plural, type ReplyElements } from './draw'
import { clockTime } from './prompt'
import {
  atNumber,
  promptsOf,
  shownLinesOf,
  toolCount,
  toolsByCount,
  type Rail,
  type RailPrompt,
} from './rail'
import { cutToWidth, displayWidth, fitted, padToWidth } from './width'

export type RailElements = Pick<ReplyElements, 'Box' | 'Text' | 'Button'>

export type RailLayout = {
  bodyColumns: number
  placement: 'dock' | 'inline'
  now: number
  doing: string
  blocked: string
}

export type RailActions = {
  jump: (number: number) => void
  copy: (prompt: RailPrompt) => void
}

export const PROMPTS_DRAWN = 100
const INLINE_ROWS = 8
const SELECTED_MARK = '▸'
const RULE = '─'
const TIME_COLUMNS = 5
const LEAST_NUMBER_COLUMNS = 2
const LEAST_TEXT_COLUMNS = 12
const DETAIL_INDENT = 4
const DETAIL_PROMPT_LINES = 3
const MORE_LINES_MARK = ' ⏎ …'
const CUT_MARK = '…'
const SEPARATOR = ' · '
const INLINE_GAP = 3
const BUTTON_CHROME_COLUMNS = '[  ]'.length
const CONTROLS = [
  { key: 'prev', hotkey: 'p' },
  { key: 'next', hotkey: 'n' },
  { key: 'last', hotkey: 'l' },
] as const
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

type Row = { number: number; prompt: RailPrompt; isAt: boolean; isRunning: boolean }

type RowLayout = {
  numberColumns: number
  isWordy: boolean
  toolsColumns: number
  textColumns: number
}

type Context = {
  elements: RailElements
  layout: RailLayout
  actions: RailActions
  rail: Rail
}

function durationOf(ms: number): string {
  const whole = Math.max(0, ms)
  if (whole < MINUTE) return `${String(Math.floor(whole / SECOND))}s`
  if (whole < HOUR) return `${String(Math.floor(whole / MINUTE))}m`
  return `${String(Math.floor(whole / HOUR))}h ${String(Math.floor((whole % HOUR) / MINUTE))}m`
}

function toolsWord(row: Row, isWordy: boolean, doing: string): string {
  const count = toolCount(row.prompt)
  const shown = isWordy ? plural(count, 'tool') : String(count)
  return row.isRunning ? `${doing} ${shown}` : shown
}

function widest(texts: readonly string[]): number {
  return Math.max(0, ...texts.map(displayWidth))
}

function rowLayoutOf(rows: readonly Row[], layout: RailLayout): RowLayout {
  const numberColumns = Math.max(
    LEAST_NUMBER_COLUMNS,
    widest(rows.map((row) => String(row.number))),
  )
  const fixed = 1 + numberColumns + 1 + TIME_COLUMNS + 1 + 1
  const wordyColumns = widest(rows.map((row) => toolsWord(row, true, layout.doing)))
  const isWordy = layout.bodyColumns - fixed - wordyColumns >= LEAST_TEXT_COLUMNS
  const toolsColumns = isWordy
    ? wordyColumns
    : widest(rows.map((row) => toolsWord(row, false, layout.doing)))
  return {
    numberColumns,
    isWordy,
    toolsColumns,
    textColumns: Math.max(1, layout.bodyColumns - fixed - toolsColumns),
  }
}

function rowText(prompt: RailPrompt): string {
  const lines = shownLinesOf(prompt.text)
  const first = lines[0] ?? ''
  return lines.length > 1 ? `${first}${MORE_LINES_MARK}` : first
}

function promptRow(context: Context, row: Row, rowLayout: RowLayout): RenderElement {
  const { Button, Text } = context.elements
  const mark = row.isAt ? SELECTED_MARK : ' '
  const number = `${mark}${String(row.number).padStart(rowLayout.numberColumns)}`
  const text = padToWidth(fitted(rowText(row.prompt), rowLayout.textColumns), rowLayout.textColumns)
  const tools = toolsWord(row, rowLayout.isWordy, context.layout.doing)
  const toolsCell = ' '.repeat(Math.max(rowLayout.toolsColumns - displayWidth(tools), 0)) + tools
  return Button({
    key: `prompt-${String(row.number)}`,
    label: `prompt ${String(row.number)}`,
    plain: true,
    onPress: () => {
      context.actions.jump(row.number)
    },
    children: [
      Text({ bold: row.isAt, children: number }),
      ' ',
      Text({ dimColor: true, children: clockTime(row.prompt.at) }),
      ' ',
      Text({ bold: row.isAt, children: text }),
      ' ',
      row.isRunning
        ? Text({ color: 'claude', children: toolsCell })
        : Text({ children: toolsCell }),
    ],
  })
}

function wrappedLine(line: string, columns: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    const joined = current === '' ? word : `${current} ${word}`
    if (displayWidth(joined) <= columns) {
      current = joined
      continue
    }
    if (current !== '') lines.push(current)
    let rest = word
    while (displayWidth(rest) > columns) {
      const head = cutToWidth(rest, columns)
      if (head === '') break
      lines.push(head)
      rest = rest.slice(head.length)
    }
    current = rest
  }
  return [...lines, current]
}

function detailPromptLines(prompt: RailPrompt, columns: number): string[] {
  const lines = shownLinesOf(prompt.text).flatMap((line) => wrappedLine(line, columns))
  if (lines.length <= DETAIL_PROMPT_LINES) return lines
  const kept = lines.slice(0, DETAIL_PROMPT_LINES)
  const last = kept.at(-1) ?? ''
  kept[DETAIL_PROMPT_LINES - 1] =
    `${cutToWidth(last, columns - displayWidth(CUT_MARK)).trimEnd()}${CUT_MARK}`
  return kept
}

function statsLine(row: Row, now: number, columns: number): string {
  const { prompt } = row
  const ran = row.isRunning
    ? `runs ${durationOf(now - prompt.at)}`
    : `ran ${durationOf((prompt.endedAt ?? now) - prompt.at)}`
  const tools = toolsByCount(prompt).map(([tool, count]) => `${tool} ${String(count)}`)
  return fitted([ran, ...(tools.length === 0 ? ['no tools'] : tools)].join(SEPARATOR), columns)
}

function detail(context: Context, row: Row): RenderElement {
  const { Box, Text, Button } = context.elements
  const columns = Math.max(1, context.layout.bodyColumns - DETAIL_INDENT)
  return Box({
    flexDirection: 'column',
    paddingLeft: DETAIL_INDENT,
    children: [
      ...detailPromptLines(row.prompt, columns).map((line) => Text({ children: line })),
      Text({ dimColor: true, children: statsLine(row, context.layout.now, columns) }),
      Box({
        flexDirection: 'row',
        children: Button({
          key: 'copy-prompt',
          label: 'copy prompt',
          hotkey: 'y',
          onPress: () => {
            context.actions.copy(row.prompt)
          },
        }),
      }),
    ],
  })
}

function compactionLine(context: Context, at: number): RenderElement {
  const { Text } = context.elements
  return Text({
    dimColor: true,
    children: fitted(`── compacted at ${clockTime(at)} ──`, context.layout.bodyColumns),
  })
}

function rule(context: Context): RenderElement {
  return context.elements.Text({
    color: 'subtle',
    children: RULE.repeat(context.layout.bodyColumns),
  })
}

function controls(context: Context): RenderElement {
  const { Box, Button } = context.elements
  const count = promptsOf(context.rail).length
  const at = atNumber(context.rail)
  const targets: Record<(typeof CONTROLS)[number]['key'], number> = {
    prev: at - 1,
    next: at + 1,
    last: count,
  }
  return Box({
    flexDirection: 'row',
    gap: 1,
    children: CONTROLS.map(({ key, hotkey }) =>
      Button({
        key,
        label: key,
        hotkey,
        ...(key === 'next' ? { autoFocus: true as const } : {}),
        onPress: () => {
          const target = targets[key]
          if (target >= 1 && target <= count && target !== at) context.actions.jump(target)
        },
      }),
    ),
  })
}

function controlsColumns(): number {
  return (
    CONTROLS.reduce((sum, { key }) => sum + key.length + BUTTON_CHROME_COLUMNS, 0) +
    CONTROLS.length -
    1
  )
}

function headerText(rail: Rail, columns: number, room: number): string {
  const prompts = promptsOf(rail)
  const first = prompts[0]
  if (first === undefined) return fitted('Prompts  none yet', columns)
  const counts = `${String(prompts.length)} · at ${String(atNumber(rail))}`
  const full = `Prompts  ${counts} · since ${clockTime(first.at)}`
  if (displayWidth(full) <= room) return full
  return fitted(`Prompts ${counts}`, columns)
}

function failureLines(context: Context): RenderElement[] {
  const { failure } = context.rail
  if (failure === undefined) return []
  const { Text } = context.elements
  const columns = context.layout.bodyColumns
  return [
    rule(context),
    Text({
      color: 'error',
      children: fitted(
        `${context.layout.blocked} could not jump to prompt ${String(failure.number)}`,
        columns,
      ),
    }),
    Text({ dimColor: true, children: fitted('  the transcript did not move:', columns) }),
    Text({ dimColor: true, children: fitted(`  ${failure.words}`, columns) }),
  ]
}

function rowsOf(rail: Rail): Row[] {
  const prompts = promptsOf(rail)
  const at = atNumber(rail)
  return prompts.map((prompt, index) => ({
    number: index + 1,
    prompt,
    isAt: index + 1 === at,
    isRunning: index === prompts.length - 1 && prompt.endedAt === undefined,
  }))
}

function earlierLine(context: Context, hidden: number): RenderElement[] {
  if (hidden <= 0) return []
  const at = atNumber(context.rail)
  const among = at <= hidden ? ` · at ${String(at)} is among them` : ''
  return [
    context.elements.Text({
      dimColor: true,
      children: fitted(`${plural(hidden, 'earlier prompt')}${among}`, context.layout.bodyColumns),
    }),
  ]
}

function dockedList(context: Context, rows: readonly Row[]): RenderElement[] {
  const hidden = Math.max(rows.length - PROMPTS_DRAWN, 0)
  const drawn = rows.slice(hidden)
  const rowLayout = rowLayoutOf(drawn, context.layout)
  const list: RenderElement[] = earlierLine(context, hidden)
  let seen = 0
  for (const entry of context.rail.entries) {
    if (entry.kind === 'compaction') {
      if (seen >= hidden) list.push(compactionLine(context, entry.at))
      continue
    }
    seen += 1
    const row = rows[seen - 1]
    if (row === undefined || seen <= hidden) continue
    list.push(promptRow(context, row, rowLayout))
    if (row.isAt) list.push(detail(context, row))
  }
  return list
}

function docked(context: Context): RenderNode[] {
  const { Text } = context.elements
  const columns = context.layout.bodyColumns
  const rows = rowsOf(context.rail)
  const header = Text({ bold: true, children: headerText(context.rail, columns, columns) })
  if (rows.length === 0) return [header]
  return [
    header,
    controls(context),
    rule(context),
    ...dockedList(context, rows),
    ...failureLines(context),
  ]
}

function inlineWindow(rows: readonly Row[], at: number): Row[] {
  const first = Math.min(
    Math.max(at - INLINE_ROWS / 2, 1),
    Math.max(rows.length - INLINE_ROWS + 1, 1),
  )
  return rows.slice(first - 1, first - 1 + INLINE_ROWS)
}

function inlineHead(context: Context, window: readonly Row[]): RenderElement[] {
  const { Box, Text } = context.elements
  const columns = context.layout.bodyColumns
  const first = window[0]?.number ?? 0
  const last = window.at(-1)?.number ?? 0
  const range = `rows ${String(first)}-${String(last)}`
  const room = columns - INLINE_GAP - controlsColumns() - INLINE_GAP - displayWidth(range)
  const header = headerText(context.rail, columns, room)
  if (displayWidth(header) <= room) {
    return [
      Box({
        flexDirection: 'row',
        gap: INLINE_GAP,
        children: [
          Text({ bold: true, children: header }),
          controls(context),
          Text({ dimColor: true, children: range }),
        ],
      }),
    ]
  }
  return [
    Text({ bold: true, children: headerText(context.rail, columns, columns) }),
    controls(context),
  ]
}

function inline(context: Context): RenderNode[] {
  const rows = rowsOf(context.rail)
  if (rows.length === 0) {
    const columns = context.layout.bodyColumns
    return [
      context.elements.Text({ bold: true, children: headerText(context.rail, columns, columns) }),
    ]
  }
  const window = inlineWindow(rows, atNumber(context.rail))
  const rowLayout = rowLayoutOf(window, context.layout)
  return [
    ...inlineHead(context, window),
    ...window.map((row) => promptRow(context, row, rowLayout)),
    ...failureLines(context),
  ]
}

export function drawRail(
  elements: RailElements,
  rail: Rail,
  layout: RailLayout,
  actions: RailActions,
): RenderElement {
  const context: Context = { elements, layout, actions, rail }
  return elements.Box({
    flexDirection: 'column',
    children: layout.placement === 'inline' ? inline(context) : docked(context),
  })
}
