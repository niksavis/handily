import type { RenderElement, TextProps, ThemeKey } from 'claude-code'
import type { BoardTask, BoardToolSight } from '../types'
import { elapsedText } from './activity'
import type { AgentLook, AgentRow } from './agents'
import type { PaneElements, RowLayout } from './pane'
import { SIGNALS } from './signals'
import { escaped, paneTaskText, statusLook } from './tasks'
import { cutToWidth, displayWidth, fitted, lastToWidth } from './width'

export const AGENT_ROWS_AT_MOST = 6
export const NAME_CUT_ABOVE = 9

const MORE_AGENTS = 'group:more-agents'
const ENDED_AGENTS = 'group:ended-agents'
const NAME_HEAD = 4
const NAME_GAP = 1
const MARK_COLUMNS = 2
const TIME_COLUMNS = 3
const DOCKED_COLUMNS = 9
const INLINE_COLUMNS = 10
const TOOL_COLUMN_FROM = 36
const DETAIL_INDENT = 4
const PLAN_FOLD_ABOVE = 5
const PLAN_SIDE = 2
const FOLD_GAP = 2
const BUTTON_CHROME = 4
const OPEN_LABEL = 'open'
const MAIN_LOOP = 'main'
const UNLISTED_LOOK = { mark: '?', color: 'subtle' } as const satisfies {
  mark: string
  color: ThemeKey
}

type TextStyle = Omit<TextProps, 'children'>

type Look = { mark: string; color: ThemeKey }

const LOOKS: Record<AgentLook, Look> = {
  failed: SIGNALS.blocked,
  running: SIGNALS.doing,
  held: SIGNALS.doing,
  pending: SIGNALS.toDo,
  idle: SIGNALS.toDo,
  done: SIGNALS.done,
  killed: SIGNALS.done,
  unlisted: UNLISTED_LOOK,
}

const STATE_WORDS: Record<AgentLook, string> = {
  failed: 'failed',
  running: 'running',
  held: 'on hold',
  pending: 'pending',
  idle: 'idle',
  done: 'done',
  killed: 'killed',
  unlisted: 'not listed',
}

export function cutName(name: string, width: number): string {
  if (displayWidth(name) <= width) return name
  const head = cutToWidth(name, NAME_HEAD)
  return `${head}…${lastToWidth(name, Math.max(width - displayWidth(head) - 1, 0))}`
}

export function numberedNames(labels: readonly string[], cutAbove: number): string[] {
  const seen = new Map<string, number>()
  return labels.map((label) => {
    const base = cutName(label, cutAbove)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    const suffix = count === 1 ? '' : ` ${String(count)}`
    return `${cutName(label, cutAbove - suffix.length)}${suffix}`
  })
}

export function shownNames(rows: readonly AgentRow[]): Map<string, string> {
  const sorted = [...rows].sort((a, b) => a.startedAt - b.startedAt)
  const names = numberedNames(
    sorted.map((row) => escaped(row.label)),
    NAME_CUT_ABOVE,
  )
  return new Map(sorted.map((row, index) => [row.id, names[index] ?? '']))
}

function callText(sight: BoardToolSight): string {
  const tool = escaped(sight.tool)
  return sight.target === null ? tool : `${tool} ${escaped(sight.target)}`
}

function failureText(row: AgentRow): string {
  return row.call === null
    ? 'failed before its first tool call'
    : `failed after ${callText(row.call)}`
}

function stateText(row: AgentRow): { text: string; style: TextStyle } {
  if (row.look === 'running' && row.plan !== null) {
    const done = row.plan.filter((task) => task.status === 'completed').length
    return { text: `plan ${String(done)}/${String(row.plan.length)}`, style: { dimColor: true } }
  }
  return { text: STATE_WORDS[row.look], style: { color: LOOKS[row.look].color } }
}

function detailText(row: AgentRow, isInline: boolean): string {
  if (row.look === 'failed') return isInline ? failureText(row) : ''
  if (row.call === null) return ''
  return row.isCallRunning ? `▸ ${callText(row.call)}` : callText(row.call)
}

function fixedBox(elements: PaneElements, width: number, child: RenderElement): RenderElement {
  return elements.Box({ width, flexShrink: 0, children: [child] })
}

function agentLine(
  elements: PaneElements,
  row: AgentRow,
  name: string,
  layout: RowLayout,
  openAgents: () => void,
): RenderElement {
  const { Box, Text, Button } = elements
  const look = LOOKS[row.look]
  const columns = elements.isInline ? INLINE_COLUMNS : DOCKED_COLUMNS
  const state = stateText(row)
  const nameWidth = Math.max(columns, displayWidth(name)) + NAME_GAP
  const stateWidth = Math.max(columns, displayWidth(state.text)) + NAME_GAP
  const time = elapsedText(row.ageMs)
  const timeWidth = NAME_GAP + Math.max(TIME_COLUMNS, displayWidth(time))
  const hasToolColumn = elements.isInline || elements.bodyColumns >= TOOL_COLUMN_FROM
  const isOpenable = row.look === 'running'
  const openWidth = isOpenable ? displayWidth(OPEN_LABEL) + (hasToolColumn ? NAME_GAP : 0) : 0
  const detailWidth = Math.max(
    elements.bodyColumns - MARK_COLUMNS - nameWidth - stateWidth - openWidth - timeWidth,
    0,
  )
  const detail = hasToolColumn ? fitted(detailText(row, elements.isInline), detailWidth) : ''
  return Box({
    key: `row:agent:${row.id}`,
    flexDirection: 'row',
    children: [
      fixedBox(elements, MARK_COLUMNS, Text({ color: look.color, children: `${look.mark} ` })),
      fixedBox(
        elements,
        nameWidth,
        Button({
          key: `open:agent:${row.id}`,
          plain: true,
          onPress: () => {
            layout.toggle(`agent:${row.id}`)
          },
          children: [Text({ bold: true, children: name })],
        }),
      ),
      fixedBox(elements, stateWidth, Text({ ...state.style, children: state.text })),
      Box({
        flexGrow: 1,
        flexShrink: 1,
        children: [Text({ dimColor: true, children: detail })],
      }),
      isOpenable
        ? Box({
            flexShrink: 0,
            marginLeft: openWidth - displayWidth(OPEN_LABEL),
            children: [
              Button({
                key: `tasks:agent:${row.id}`,
                label: OPEN_LABEL,
                plain: true,
                dimColor: true,
                onPress: openAgents,
              }),
            ],
          })
        : null,
      fixedBox(elements, timeWidth, Text({ dimColor: true, children: time.padStart(timeWidth) })),
    ],
  })
}

function indented(elements: PaneElements, key: string, children: RenderElement[]): RenderElement {
  return elements.Box({ key, flexDirection: 'column', paddingLeft: DETAIL_INDENT, children })
}

function line(elements: PaneElements, text: string, style: TextStyle = {}): RenderElement {
  return elements.Text({ ...style, children: fitted(text, elements.bodyColumns - DETAIL_INDENT) })
}

function anchorIndex(tasks: readonly BoardTask[]): number {
  const running = tasks.findIndex((task) => task.status === 'in_progress')
  if (running >= 0) return running
  const next = tasks.findIndex((task) => task.status === 'pending')
  return next >= 0 ? next : tasks.length - 1
}

function planLines(elements: PaneElements, row: AgentRow, layout: RowLayout): RenderElement[] {
  const { Box, Text, Button } = elements
  const tasks = row.plan ?? []
  if (tasks.length === 0) return []
  const key = `plan:${row.id}`
  const isFoldable = tasks.length > PLAN_FOLD_ABOVE
  const isUnfolded = layout.expanded.has(key)
  const anchor = anchorIndex(tasks)
  const shown =
    isFoldable && !isUnfolded
      ? tasks.slice(Math.max(anchor - PLAN_SIDE, 0), anchor + PLAN_SIDE + 1)
      : tasks
  const room = elements.bodyColumns - DETAIL_INDENT - MARK_COLUMNS
  const taskLines = shown.map((task) => {
    const { mark, color } = statusLook(task.status)
    return Box({
      key: `plan:${row.id}:${String(task.id)}`,
      flexDirection: 'row',
      children: [
        Text({ color, children: `${mark} ` }),
        Text({
          dimColor: task.status === 'completed',
          bold: task.status === 'in_progress',
          children: fitted(paneTaskText(task), room),
        }),
      ],
    })
  })
  if (!isFoldable) return taskLines
  const total = String(tasks.length)
  const toggle = Button({
    key,
    label: isUnfolded ? 'fold' : `all ${total}`,
    onPress: () => {
      layout.toggle(key)
    },
  })
  return [
    ...taskLines,
    Box({
      key: `plan-fold:${row.id}`,
      flexDirection: 'row',
      children: [
        toggle,
        isUnfolded ? Text({ dimColor: true, children: `  all ${total} shown` }) : null,
      ],
    }),
  ]
}

function toolCountText(tools: number): string {
  if (tools === 0) return 'no tool calls yet'
  return tools === 1 ? '1 tool call' : `${String(tools)} tool calls`
}

function parentText(row: AgentRow, names: ReadonlyMap<string, string>): string | null {
  if (!row.isParentKnown) return null
  if (row.parentId === null) return MAIN_LOOP
  return names.get(row.parentId) ?? row.parentId.slice(0, 8)
}

function openedLines(
  elements: PaneElements,
  row: AgentRow,
  names: ReadonlyMap<string, string>,
  layout: RowLayout,
  now: number,
): RenderElement[] {
  const age = `${elapsedText(now - row.startedAt)} ago`
  const since = row.isSpawnSeen ? `spawned ${age}` : `first seen ${age}`
  const parent = parentText(row, names)
  const description = row.description === null ? null : escaped(row.description)
  return [
    description === null || description === escaped(row.label) ? null : line(elements, description),
    line(elements, parent === null ? since : `under ${parent} · ${since}`, { dimColor: true }),
    line(elements, toolCountText(row.tools), { dimColor: true }),
    ...planLines(elements, row, layout),
  ].filter((element) => element !== null)
}

function drawAgent(
  elements: PaneElements,
  row: AgentRow,
  names: ReadonlyMap<string, string>,
  layout: RowLayout,
  now: number,
  openAgents: () => void,
): RenderElement {
  const name = names.get(row.id) ?? escaped(row.label)
  const head = agentLine(elements, row, name, layout, openAgents)
  const failure =
    row.look === 'failed' && !elements.isInline
      ? line(elements, failureText(row), { dimColor: true })
      : null
  const isOpen = layout.expanded.has(`agent:${row.id}`)
  const under = [failure, ...(isOpen ? openedLines(elements, row, names, layout, now) : [])]
  const shown = under.filter((element) => element !== null)
  if (shown.length === 0) return head
  return elements.Box({
    key: `agent:${row.id}`,
    flexDirection: 'column',
    children: [head, indented(elements, `under:agent:${row.id}`, shown)],
  })
}

function countPart(count: number, words: string): string | null {
  return count > 0 ? `${String(count)} ${words}` : null
}

export function headerParts(rows: readonly AgentRow[]): { text: string; color?: ThemeKey }[] {
  const unlisted = rows.filter((row) => row.look === 'unlisted').length
  const listed = rows.filter((row) => row.look !== 'unlisted')
  const active = listed.filter((row) => !row.isEnded).length
  const ended = listed.length - active
  const failed = rows.filter((row) => row.look === 'failed').length
  const count = active === 0 && ended > 0 ? `all ${String(ended)} done` : String(active)
  const parts = [
    active === 0 && ended === 0 ? null : { text: count },
    failed > 0 ? { text: `${String(failed)} failed`, color: SIGNALS.blocked.color } : null,
    unlisted > 0 ? { text: countPart(unlisted, 'not listed') ?? '' } : null,
  ]
  return parts.filter((part) => part !== null)
}

function drawHeader(elements: PaneElements, rows: readonly AgentRow[]): RenderElement {
  const { Box, Text } = elements
  const title = 'Agents'
  const parts = headerParts(rows)
  const plain = parts.map((part) => part.text).join(' · ')
  const room = elements.bodyColumns - displayWidth(title)
  const isWhole = displayWidth(`  ${plain}`) <= room
  const tail = isWhole
    ? parts.flatMap((part, index) => [
        Text({ dimColor: true, children: index === 0 ? '  ' : ' · ' }),
        part.color === undefined
          ? Text({ dimColor: true, children: part.text })
          : Text({ color: part.color, children: part.text }),
      ])
    : [Text({ dimColor: true, children: fitted(`  ${plain}`, room) })]
  return Box({
    key: 'agents',
    flexDirection: 'row',
    children: [Text({ bold: true, children: title }), ...(plain === '' ? [] : tail)],
  })
}

function foldLabel(isShown: boolean, count: number, words: string): string {
  return isShown ? `hide ${String(count)} ${words}` : `+${String(count)} ${words}`
}

function drawFolds(elements: PaneElements, labels: readonly FoldButton[]): RenderElement | null {
  const { Box, Button } = elements
  if (labels.length === 0) return null
  const width =
    labels.reduce((sum, fold) => sum + displayWidth(fold.label) + BUTTON_CHROME, 0) +
    (labels.length - 1) * FOLD_GAP
  const isOneRow = width <= elements.bodyColumns
  return Box({
    key: 'agent-folds',
    flexDirection: isOneRow ? 'row' : 'column',
    children: labels.map((fold, index) =>
      Box({
        flexShrink: 0,
        marginLeft: isOneRow && index > 0 ? FOLD_GAP : 0,
        children: [Button({ key: fold.key, label: fold.label, onPress: fold.onPress })],
      }),
    ),
  })
}

type FoldButton = { key: string; label: string; onPress: () => void }

function foldButton(key: string, label: string, layout: RowLayout): FoldButton {
  return {
    key,
    label,
    onPress: () => {
      layout.toggle(key)
    },
  }
}

export function drawAgents(
  elements: PaneElements,
  rows: readonly AgentRow[],
  layout: RowLayout,
  now: number,
  openAgents: () => void,
): RenderElement[] {
  const { Box, Text } = elements
  if (rows.length === 0) return []
  const names = shownNames(rows)
  const draw = (row: AgentRow) => drawAgent(elements, row, names, layout, now, openAgents)
  const active = rows.filter((row) => !row.isEnded)
  const ended = rows.filter((row) => row.isEnded)
  const hidden = active.length - AGENT_ROWS_AT_MOST
  const isMoreShown = layout.expanded.has(MORE_AGENTS)
  const isEndedShown = layout.expanded.has(ENDED_AGENTS)
  const shown = hidden > 0 && !isMoreShown ? active.slice(0, AGENT_ROWS_AT_MOST) : active
  const folds = [
    hidden > 0
      ? foldButton(MORE_AGENTS, foldLabel(isMoreShown, hidden, 'more agents'), layout)
      : null,
    ended.length > 0
      ? foldButton(ENDED_AGENTS, foldLabel(isEndedShown, ended.length, 'ended'), layout)
      : null,
  ].filter((fold) => fold !== null)
  return [
    elements.isInline
      ? null
      : Box({
          key: 'agents-rule',
          children: [Text({ dimColor: true, children: '─'.repeat(elements.bodyColumns) })],
        }),
    drawHeader(elements, rows),
    ...shown.map(draw),
    drawFolds(elements, folds),
    ...(isEndedShown ? ended.map(draw) : []),
  ].filter((element) => element !== null)
}
