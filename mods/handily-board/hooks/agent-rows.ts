import type { Color, RenderElement, TextProps, ThemeKey } from 'claude-code'
import type { BoardTask, BoardToolSight } from '../types'
import { elapsedText } from './activity'
import { type CardFacts, cardSlots, drawCards } from './agent-cards'
import type { AgentCallLine, AgentLook, AgentRow, AgentStall, AgentStep } from './agents'
import {
  AGENTS_LOOK,
  FRAME_TITLE_CHROME,
  type StyledPart,
  drawFrame,
  drawStyledParts,
  framedElements,
  isFramed,
  titlePart,
} from './frame'
import { LANE_CELLS, type LaneAxis, hasLanes, laneAxis, laneOf } from './lanes'
import { cutName } from './names'
import { type PaletteSetting, paletteColor } from './palette'
import type { PaneElements, RowLayout } from './pane'
import { type Part, drawPartLines } from './parts'
import { type AgentRetry, RETRY_TOOL } from './retry'
import { SIGNALS, type Signal, type SignalLooks, needsYouText } from './signals'
import { escaped, paneTaskText, statusLook } from './tasks'
import { tokensText } from './tokens'
import { displayWidth, fitted } from './width'

export const AGENT_ROWS_AT_MOST = 6
export const NO_AGENTS = 'No agents yet.'
export const NAME_CUT_ABOVE = 9

const MORE_AGENTS = 'group:more-agents'
const ENDED_AGENTS = 'group:ended-agents'
const NAME_GAP = 1
const NAME_AT_LEAST = 5
const HOTKEY_COLUMNS = 3
const DIGITS_AT_MOST = 5
const MARK_COLUMNS = 2
const OPENED_INDENT = 2
const TIME_COLUMNS = 3
const DOCKED_COLUMNS = 9
const INLINE_COLUMNS = 10
const TOOL_COLUMN_FROM = 39
const FRAMED_TOOL_COLUMN_FROM = 41
const DETAIL_INDENT = 4
const PLAN_FOLD_ABOVE = 5
const PLAN_SIDE = 2
const FOLD_GAP = 2
const BUTTON_CHROME = 4
const OPEN_LABEL = 'open'
const MAIN_LOOP = 'main'
export const WAITS_LEAD = 'waits for: '
const STOPPED_AT_LIMIT = 'max_tokens'
const STALL_COLOR: ThemeKey = 'warning'
const RETRY_COLOR: ThemeKey = 'warning'
const RUNNING_LEAD = '▸ '
const PART_LEAD = ' · '
const LOOKS_BEFORE_RETRY: ReadonlySet<AgentLook> = new Set<AgentLook>(['needsYou', 'failed'])
const OPENABLE_LOOKS: ReadonlySet<AgentLook> = new Set<AgentLook>(['running', 'asked', 'needsYou'])
const AGENTS_TITLE = AGENTS_LOOK.title
const CALL_INDENT = 2
const CALL_GAP = 1
const LAST_CALLS_TITLE = 'last calls'
const ANSWER_LEAD = 'answer: '
const NO_ANSWER_YET = 'none yet'
const NO_ANSWER = 'none'
const FAILED_ANSWER = 'none, the run failed'
const RUNNING_CALL_LOOK: TextStyle & { mark: string } = { mark: '▸', dimColor: true }
const CALL_SIGNALS: Record<Exclude<AgentCallLine['outcome'], 'running'>, Signal> = {
  ok: 'done',
  failed: 'blocked',
  denied: 'blocked',
}
const NO_CONTEXT = 'ctx —'
const NO_TOKENS = 'ctx —  out —'
const THOUSAND = 1_000
const CONTEXT_COLUMNS = 7
const UNLISTED_LOOK = { mark: '?', color: 'subtle' } as const satisfies {
  mark: string
  color: ThemeKey
}

type TextStyle = Omit<TextProps, 'children'>

type Look = { mark: string; color: ThemeKey }

const LOOK_SIGNALS: Record<Exclude<AgentLook, 'unlisted'>, Signal> = {
  needsYou: 'waitsForYou',
  asked: 'doing',
  failed: 'blocked',
  running: 'doing',
  held: 'doing',
  pending: 'toDo',
  idle: 'toDo',
  done: 'done',
  killed: 'done',
}

function lookColor(look: AgentLook): ThemeKey {
  return look === 'unlisted' ? UNLISTED_LOOK.color : SIGNALS[LOOK_SIGNALS[look]].color
}

export function agentLook(look: AgentLook, signals: SignalLooks): Look {
  return look === 'unlisted' ? UNLISTED_LOOK : signals[LOOK_SIGNALS[look]]
}

function callLookOf(
  outcome: AgentCallLine['outcome'],
  signals: SignalLooks,
): TextStyle & { mark: string } {
  return outcome === 'running' ? RUNNING_CALL_LOOK : signals[CALL_SIGNALS[outcome]]
}

const STATE_WORDS: Record<AgentLook, string> = {
  needsYou: 'needs you',
  asked: 'asked',
  failed: 'failed',
  running: 'running',
  held: 'on hold',
  pending: 'pending',
  idle: 'idle',
  done: 'done',
  killed: 'killed',
  unlisted: 'not listed',
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
  return new Map(rows.map((row) => [row.id, row.shownName]))
}

export function callText(sight: BoardToolSight): string {
  const tool = escaped(sight.tool)
  return sight.target === null ? tool : `${tool} ${escaped(sight.target)}`
}

export function failedDetail(row: AgentRow): string {
  return row.call === null ? 'before its first tool call' : `after ${callText(row.call)}`
}

function failureText(row: AgentRow): string {
  return `failed ${failedDetail(row)}`
}

export function waitsText(row: AgentRow): string {
  return row.call === null ? 'permission' : `permission · ${callText(row.call)}`
}

function stallText(stall: AgentStall): string {
  return `${stall.kind} ${elapsedText(stall.ms)}`
}

type ShownState =
  | { kind: 'look'; look: AgentLook }
  | { kind: 'retry'; retry: AgentRetry }
  | { kind: 'stall'; stall: AgentStall }

function shownState(row: AgentRow): ShownState {
  if (row.retry !== null && !LOOKS_BEFORE_RETRY.has(row.look)) {
    return { kind: 'retry', retry: row.retry }
  }
  if (row.stall !== null) return { kind: 'stall', stall: row.stall }
  return { kind: 'look', look: row.look }
}

export function retryShown(row: AgentRow): AgentRetry | null {
  const state = shownState(row)
  return state.kind === 'retry' ? state.retry : null
}

function failsText(retry: AgentRetry): string {
  return `${String(retry.fails)} fails`
}

function retryCommandText(retry: AgentRetry): string {
  return callText({ tool: RETRY_TOOL, target: retry.shown })
}

export function retryCallText(retry: AgentRetry): string {
  const command = retryCommandText(retry)
  return retry.isRunning ? `${RUNNING_LEAD}${command}` : command
}

function retryDetail(retry: AgentRetry): string {
  return `${retryCallText(retry)}${PART_LEAD}${failsText(retry)}`
}

function retryLine(retry: AgentRetry): string {
  return `${failsText(retry)}: ${retryCommandText(retry)}`
}

function retryCountText(count: number): string {
  return count === 1 ? '1 retry' : `${String(count)} retries`
}

export function stateWord(row: AgentRow): { text: string; style: TextStyle } {
  const state = shownState(row)
  switch (state.kind) {
    case 'retry':
      return { text: `retry ${String(state.retry.fails)}`, style: { color: RETRY_COLOR } }
    case 'stall':
      return { text: stallText(state.stall), style: { color: STALL_COLOR } }
    case 'look':
      return { text: STATE_WORDS[state.look], style: { color: lookColor(state.look) } }
  }
}

function stateText(row: AgentRow): { text: string; style: TextStyle } {
  if (shownState(row).kind === 'look' && row.look === 'running' && row.plan !== null) {
    const done = row.plan.filter((task) => task.status === 'completed').length
    return { text: `plan ${String(done)}/${String(row.plan.length)}`, style: { dimColor: true } }
  }
  return stateWord(row)
}

export function toolText(row: AgentRow): string {
  if (row.call === null) return ''
  return row.isCallRunning ? `${RUNNING_LEAD}${callText(row.call)}` : callText(row.call)
}

function detailText(row: AgentRow, isInline: boolean): string {
  if (row.look === 'failed') return isInline ? failureText(row) : ''
  if (row.look === 'needsYou') return isInline ? `${WAITS_LEAD}${waitsText(row)}` : ''
  const retry = retryShown(row)
  if (retry !== null) return isInline ? retryDetail(retry) : ''
  return toolText(row)
}

function fixedBox(elements: PaneElements, width: number, child: RenderElement): RenderElement {
  return elements.Box({ width, flexShrink: 0, children: [child] })
}

export function contextText(row: AgentRow): string {
  return row.step === null ? NO_CONTEXT : contextPart(row.step).text
}

function contextWidth(context: string): number {
  return NAME_GAP + Math.max(CONTEXT_COLUMNS, displayWidth(context)) + NAME_GAP
}

function laneColumns(
  elements: PaneElements,
  row: AgentRow,
  axis: LaneAxis,
  context: string,
): RenderElement[] {
  const { Box, Text } = elements
  const color = lookColor(row.look)
  const lane = laneOf(row, axis, elements.signals)
  return [
    fixedBox(elements, contextWidth(context), Text({ dimColor: true, children: ` ${context}` })),
    Box({
      key: `lane:agent:${row.id}`,
      flexDirection: 'row',
      flexShrink: 0,
      children: [
        Text({ dimColor: true, children: lane.before }),
        Text({ color, children: `${lane.run}${lane.mark}` }),
        Text({ dimColor: true, children: lane.after }),
      ],
    }),
  ]
}

function nameColumns(
  elements: PaneElements,
  columns: number,
  lanesWidth: number,
  hasToolColumn: boolean,
): number {
  const openWidth = displayWidth(OPEN_LABEL) + (hasToolColumn ? NAME_GAP : 0)
  const rowWidth = HOTKEY_COLUMNS + MARK_COLUMNS + columns + NAME_GAP + lanesWidth + openWidth
  const room = elements.bodyColumns - rowWidth - NAME_GAP - TIME_COLUMNS - NAME_GAP
  return Math.max(room, NAME_AT_LEAST)
}

function nameButton(
  elements: PaneElements,
  row: AgentRow,
  name: string,
  digit: string | undefined,
  layout: RowLayout,
): RenderElement {
  const { Box, Text, Button } = elements
  const look = agentLook(row.look, elements.signals)
  const button = Button({
    key: `open:agent:${row.id}`,
    plain: true,
    ...(digit === undefined ? {} : { hotkey: digit }),
    onPress: () => {
      layout.toggle(`agent:${row.id}`)
    },
    children: [
      Text({ color: look.color, children: `${look.mark} ` }),
      Text({ bold: true, children: name }),
    ],
  })
  if (digit !== undefined) return button
  return Box({
    flexDirection: 'row',
    children: [Text({ children: ' '.repeat(HOTKEY_COLUMNS) }), button],
  })
}

function agentLine(
  elements: PaneElements,
  row: AgentRow,
  name: string,
  digit: string | undefined,
  layout: RowLayout,
  openAgents: () => void,
  axis: LaneAxis | null,
  hasToolColumn: boolean,
): RenderElement {
  const { Box, Text, Button } = elements
  const columns = elements.isInline ? INLINE_COLUMNS : DOCKED_COLUMNS
  const state = stateText(row)
  const stateWidth = Math.max(columns, displayWidth(state.text)) + NAME_GAP
  const time = elapsedText(row.ageMs)
  const timeWidth = NAME_GAP + Math.max(TIME_COLUMNS, displayWidth(time))
  const isOpenable = OPENABLE_LOOKS.has(row.look)
  const hasOpenColumn = isOpenable || axis !== null
  const openWidth = hasOpenColumn ? displayWidth(OPEN_LABEL) + (hasToolColumn ? NAME_GAP : 0) : 0
  const context = contextText(row)
  const lanes = axis === null ? [] : laneColumns(elements, row, axis, context)
  const lanesWidth = axis === null ? 0 : contextWidth(context) + LANE_CELLS
  const fixed = HOTKEY_COLUMNS + MARK_COLUMNS + stateWidth + lanesWidth + openWidth + timeWidth
  const nameRoom = nameColumns(elements, columns, lanesWidth, hasToolColumn)
  const shownName = cutName(name, nameRoom)
  const nameWidth = Math.min(Math.max(columns, displayWidth(shownName)), nameRoom) + NAME_GAP
  const detailWidth = Math.max(elements.bodyColumns - fixed - nameWidth, 0)
  const isDetailWhole = elements.isInline || axis !== null
  const detail = hasToolColumn ? fitted(detailText(row, isDetailWhole), detailWidth) : ''
  return Box({
    key: `row:agent:${row.id}`,
    flexDirection: 'row',
    children: [
      fixedBox(
        elements,
        HOTKEY_COLUMNS + MARK_COLUMNS + nameWidth,
        nameButton(elements, row, shownName, digit, layout),
      ),
      fixedBox(elements, stateWidth, Text({ ...state.style, children: state.text })),
      Box({
        flexGrow: 1,
        flexShrink: 1,
        children: [Text({ dimColor: true, children: detail })],
      }),
      ...lanes,
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
        : hasOpenColumn
          ? fixedBox(elements, openWidth, Text({ children: '' }))
          : null,
      fixedBox(elements, timeWidth, Text({ dimColor: true, children: time.padStart(timeWidth) })),
    ],
  })
}

function waitsLine(elements: PaneElements, row: AgentRow): RenderElement {
  const { Box, Text } = elements
  const room = elements.bodyColumns - DETAIL_INDENT - displayWidth(WAITS_LEAD)
  return Box({
    key: `waits:agent:${row.id}`,
    flexDirection: 'row',
    children: [
      Text({ dimColor: true, children: WAITS_LEAD }),
      Text({ children: fitted(waitsText(row), room) }),
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
    const { mark, color } = statusLook(task.status, elements.signals)
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

function contextPart(step: AgentStep): Part {
  return { text: `ctx ${tokensText(step.context)}` }
}

export function agentStatsText(row: AgentRow): string {
  const context = row.step === null ? NO_CONTEXT : contextPart(row.step).text
  return `${row.shownName}: ${stateText(row).text} · ${context}`
}

function stepGroups(toolCalls: number, step: AgentStep | null): Part[][] {
  const tools = { text: toolCountText(toolCalls) }
  if (step === null) return [[tools]]
  if (step.stopReason !== STOPPED_AT_LIMIT) {
    return [[tools, contextPart(step), { text: `out ${tokensText(step.output)}` }]]
  }
  return [
    [tools],
    [{ text: `stopped at ${STOPPED_AT_LIMIT}`, color: 'warning' }, contextPart(step)],
  ]
}

export function stepText(step: AgentStep | null): string {
  return stepGroups(0, step)
    .map((parts) => parts.map((part) => part.text).join(' '))
    .join('\n')
}

function stepLines(elements: PaneElements, row: AgentRow): RenderElement[] {
  const room = elements.bodyColumns - DETAIL_INDENT
  return stepGroups(row.tools, row.step).flatMap((parts, index) =>
    drawPartLines(elements, `step:${String(index)}:agent:${row.id}`, parts, room),
  )
}

function callAge(call: AgentCallLine, now: number): string {
  return call.at === null ? '' : elapsedText(now - call.at)
}

function callLine(
  elements: PaneElements,
  row: AgentRow,
  call: AgentCallLine,
  index: number,
  now: number,
): RenderElement {
  const { Box, Text } = elements
  const { mark, ...look } = callLookOf(call.outcome, elements.signals)
  const age = callAge(call, now)
  const room = elements.bodyColumns - DETAIL_INDENT - CALL_INDENT - MARK_COLUMNS
  const callRoom = room - (age === '' ? 0 : CALL_GAP + Math.max(TIME_COLUMNS, displayWidth(age)))
  const tool = fitted(escaped(call.tool), callRoom)
  const target =
    call.target === null ? '' : fitted(` ${escaped(call.target)}`, callRoom - displayWidth(tool))
  return Box({
    key: `call:${String(index)}:agent:${row.id}`,
    flexDirection: 'row',
    paddingLeft: CALL_INDENT,
    children: [
      fixedBox(elements, MARK_COLUMNS, Text({ ...look, children: `${mark} ` })),
      fixedBox(
        elements,
        callRoom,
        Text({ children: [tool, Text({ dimColor: true, children: target })] }),
      ),
      age === '' ? null : Text({ dimColor: true, children: age.padStart(room - callRoom) }),
    ],
  })
}

function answerLine(elements: PaneElements, row: AgentRow): RenderElement {
  const { Box, Text } = elements
  const room = elements.bodyColumns - DETAIL_INDENT - displayWidth(ANSWER_LEAD)
  const isFailed = row.look === 'failed'
  const text = isFailed
    ? FAILED_ANSWER
    : !row.isEnded || row.answer === null
      ? NO_ANSWER_YET
      : row.answer === ''
        ? NO_ANSWER
        : escaped(row.answer)
  return Box({
    key: `answer:agent:${row.id}`,
    flexDirection: 'row',
    children: [
      Text({ dimColor: true, children: ANSWER_LEAD }),
      isFailed
        ? Text({ color: SIGNALS.blocked.color, children: fitted(text, room) })
        : Text({ children: fitted(text, room) }),
    ],
  })
}

function callLines(elements: PaneElements, row: AgentRow, now: number): RenderElement[] {
  const calls = row.lastCalls.map((call, index) => callLine(elements, row, call, index, now))
  return [
    ...(calls.length === 0 ? [] : [line(elements, LAST_CALLS_TITLE, { dimColor: true }), ...calls]),
    answerLine(elements, row),
  ]
}

function parentText(row: AgentRow, names: ReadonlyMap<string, string>): string | null {
  if (!row.isParentKnown) return null
  if (row.parentId === null) return MAIN_LOOP
  return names.get(row.parentId) ?? row.parentId.slice(0, 8)
}

export function openedLines(
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
    ...stepLines(elements, row),
    ...callLines(elements, row, now),
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
  axis: LaneAxis | null,
  hasToolColumn: boolean,
  digit: string | undefined,
): RenderElement {
  const name = names.get(row.id) ?? escaped(row.label)
  const head = agentLine(elements, row, name, digit, layout, openAgents, axis, hasToolColumn)
  const hasSecondLine = !elements.isInline && axis === null
  const failure =
    row.look === 'failed' && hasSecondLine
      ? line(elements, failureText(row), { dimColor: true })
      : null
  const waits = row.look === 'needsYou' && hasSecondLine ? waitsLine(elements, row) : null
  const retry = hasSecondLine ? retryShown(row) : null
  const retrying = retry === null ? null : line(elements, retryLine(retry), { dimColor: true })
  const isOpen = layout.expanded.has(`agent:${row.id}`)
  const under = [
    failure,
    waits,
    retrying,
    ...(isOpen ? openedLines(elements, row, names, layout, now) : []),
  ]
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
  const waiting = rows.filter((row) => row.look === 'needsYou').length
  const retrying = rows.filter((row) => retryShown(row) !== null).length
  const count = active === 0 && ended > 0 ? `all ${String(ended)} done` : String(active)
  const parts = [
    active === 0 && ended === 0 ? null : { text: count },
    waiting > 0 ? { text: needsYouText(waiting), color: SIGNALS.waitsForYou.color } : null,
    failed > 0 ? { text: `${String(failed)} failed`, color: SIGNALS.blocked.color } : null,
    retrying > 0 ? { text: retryCountText(retrying), color: RETRY_COLOR } : null,
    unlisted > 0 ? { text: countPart(unlisted, 'not listed') ?? '' } : null,
  ]
  return parts.filter((part) => part !== null)
}

function headerText(rows: readonly AgentRow[]): string {
  return headerParts(rows)
    .map((part) => part.text)
    .join(' · ')
}

export function agentsTitleText(rows: readonly AgentRow[]): string {
  const plain = headerText(rows)
  return plain === '' ? AGENTS_TITLE : `${AGENTS_TITLE}  ${plain}`
}

function lanesPart(axis: LaneAxis): Part {
  return { text: `lanes from ${elapsedText(axis.to - axis.from)} ago to now` }
}

function titleParts(
  rows: readonly AgentRow[],
  axis: LaneAxis | null,
  columns: number,
  palette: PaletteSetting,
): StyledPart[] {
  const title = titlePart(AGENTS_LOOK, palette)
  const parts = [...headerParts(rows), ...(axis === null ? [] : [lanesPart(axis)])]
  const plain = parts.map((part) => part.text).join(' · ')
  if (plain === '') return [title]
  const room = columns - displayWidth(title.text)
  const isWhole = displayWidth(`  ${plain}`) <= room
  const tail: StyledPart[] = isWhole
    ? parts.flatMap((part, index) => [
        { text: index === 0 ? '  ' : ' · ', dimColor: true },
        part.color === undefined
          ? { text: part.text, dimColor: true }
          : { text: part.text, color: part.color },
      ])
    : [{ text: fitted(`  ${plain}`, room), dimColor: true }]
  return [title, ...tail]
}

function drawHeader(
  elements: PaneElements,
  rows: readonly AgentRow[],
  axis: LaneAxis | null,
): RenderElement {
  return elements.Box({
    key: 'agents',
    flexDirection: 'row',
    children: drawStyledParts(
      elements,
      titleParts(rows, axis, elements.bodyColumns, elements.palette),
    ),
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

export function openedKeys(row: AgentRow): string[] {
  const key = `agent:${row.id}`
  return row.isEnded ? [key, ENDED_AGENTS] : [key]
}

export function digitOf(index: number): string | undefined {
  return index < DIGITS_AT_MOST ? String(index + 1) : undefined
}

export type AgentsShown = { drawn: readonly AgentRow[]; isCards: boolean; slots: number }

export function agentsShown(
  outer: PaneElements,
  rows: readonly AgentRow[],
  expanded: ReadonlySet<string>,
): AgentsShown {
  const isFramedHere = isFramed(outer)
  const active = rows.filter((row) => !row.isEnded)
  const ended = rows.filter((row) => row.isEnded)
  const hidden = active.length - AGENT_ROWS_AT_MOST
  const shown =
    hidden > 0 && !expanded.has(MORE_AGENTS) ? active.slice(0, AGENT_ROWS_AT_MOST) : active
  const drawn = expanded.has(ENDED_AGENTS) ? [...shown, ...ended] : shown
  const slots = isFramedHere ? cardSlots(framedElements(outer).bodyColumns) : 0
  return { drawn, isCards: drawn.length > 0 && drawn.length <= slots, slots }
}

function tokenForms(step: AgentStep | null): string[] {
  if (step === null) return [NO_TOKENS]
  const whole = (count: number) =>
    count < THOUSAND ? String(Math.round(count)) : `${String(Math.round(count / THOUSAND))}k`
  return [
    `ctx ${tokensText(step.context)} out ${tokensText(step.output)}`,
    `ctx ${whole(step.context)} out ${whole(step.output)}`,
  ]
}

function cardWait(row: AgentRow): string | null {
  if (row.look === 'needsYou') return row.call === null ? 'permission' : callText(row.call)
  const retry = retryShown(row)
  if (retry !== null) return retryLine(retry)
  if (row.look !== 'failed') return null
  return row.call === null ? 'before its first call' : callText(row.call)
}

function cardBorder(row: AgentRow, elements: PaneElements): Color {
  if (row.look === 'needsYou') return SIGNALS.waitsForYou.color
  if (row.look === 'failed') return SIGNALS.blocked.color
  return paletteColor('rules', elements.palette)
}

function cardOf(
  elements: PaneElements,
  row: AgentRow,
  name: string,
  digit: string | undefined,
  layout: RowLayout,
): CardFacts {
  return {
    id: row.id,
    digit,
    name,
    mark: agentLook(row.look, elements.signals),
    state: stateText(row),
    wait: cardWait(row),
    task: row.description === null ? '' : escaped(row.description),
    type: row.type === null ? '' : escaped(row.type),
    tokens: tokenForms(row.step),
    steps: row.steps,
    clockMs: row.ageMs,
    border: cardBorder(row, elements),
    onPress: () => {
      layout.toggle(`agent:${row.id}`)
    },
  }
}

type CardsView = {
  names: ReadonlyMap<string, string>
  layout: RowLayout
  now: number
  openAgents: () => void
}

function openedHead(
  elements: PaneElements,
  row: AgentRow,
  lead: string,
  openAgents: () => void,
): RenderElement {
  const { Box, Button, Text } = elements
  const isOpenable = OPENABLE_LOOKS.has(row.look)
  const room = elements.bodyColumns - (isOpenable ? FOLD_GAP + displayWidth(OPEN_LABEL) : 0)
  return Box({
    flexDirection: 'row',
    children: [
      Text({ children: fitted(`${lead}, opened:`, room) }),
      isOpenable
        ? Box({
            flexShrink: 0,
            marginLeft: FOLD_GAP,
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
    ],
  })
}

function openedCard(
  elements: PaneElements,
  row: AgentRow,
  view: CardsView,
  digit: string | undefined,
): RenderElement {
  const { names, layout, now } = view
  const name = names.get(row.id) ?? escaped(row.label)
  const lead = digit === undefined ? name : `${digit} ${name}`
  const detailElements = {
    ...elements,
    bodyColumns: elements.bodyColumns - OPENED_INDENT + DETAIL_INDENT,
  }
  return elements.Box({
    key: `opened:agent:${row.id}`,
    flexDirection: 'column',
    children: [
      openedHead(elements, row, lead, view.openAgents),
      elements.Box({
        key: `under:agent:${row.id}`,
        flexDirection: 'column',
        paddingLeft: OPENED_INDENT,
        children: openedLines(detailElements, row, names, layout, now),
      }),
    ],
  })
}

function cardsBody(
  elements: PaneElements,
  drawn: readonly AgentRow[],
  slots: number,
  view: CardsView,
): RenderElement[] {
  const { names, layout } = view
  const cards = drawn.map((row, index) =>
    cardOf(elements, row, names.get(row.id) ?? escaped(row.label), digitOf(index), layout),
  )
  return [
    ...drawCards(elements, cards, slots),
    ...drawn.flatMap((row, index) =>
      layout.expanded.has(`agent:${row.id}`)
        ? [openedCard(elements, row, view, digitOf(index))]
        : [],
    ),
  ]
}

export function drawAgents(
  outer: PaneElements,
  rows: readonly AgentRow[],
  layout: RowLayout,
  now: number,
  openAgents: () => void,
): RenderElement[] {
  if (rows.length === 0) return []
  const isFramedHere = isFramed(outer)
  const elements = isFramedHere ? framedElements(outer) : outer
  const { Box, Text } = elements
  const names = shownNames(rows)
  const active = rows.filter((row) => !row.isEnded)
  const ended = rows.filter((row) => row.isEnded)
  const hidden = active.length - AGENT_ROWS_AT_MOST
  const isMoreShown = layout.expanded.has(MORE_AGENTS)
  const isEndedShown = layout.expanded.has(ENDED_AGENTS)
  const shown = hidden > 0 && !isMoreShown ? active.slice(0, AGENT_ROWS_AT_MOST) : active
  const { drawn, isCards, slots } = agentsShown(outer, rows, layout.expanded)
  const hasLaneRows = !isCards && isFramedHere && hasLanes(outer.bodyColumns)
  const axis = hasLaneRows ? laneAxis(drawn, now) : null
  const toolColumnFrom = isFramedHere ? FRAMED_TOOL_COLUMN_FROM : TOOL_COLUMN_FROM
  const hasToolColumn = elements.isInline || elements.bodyColumns >= toolColumnFrom
  const draw = (row: AgentRow) =>
    drawAgent(
      elements,
      row,
      names,
      layout,
      now,
      openAgents,
      axis,
      hasToolColumn,
      digitOf(drawn.indexOf(row)),
    )
  const folds = [
    hidden > 0
      ? foldButton(MORE_AGENTS, foldLabel(isMoreShown, hidden, 'more agents'), layout)
      : null,
    ended.length > 0
      ? foldButton(ENDED_AGENTS, foldLabel(isEndedShown, ended.length, 'ended'), layout)
      : null,
  ].filter((fold) => fold !== null)
  const body = isCards
    ? [
        ...cardsBody(elements, drawn, slots, { names, layout, now, openAgents }),
        drawFolds(elements, folds),
      ]
    : [...shown.map(draw), drawFolds(elements, folds), ...(isEndedShown ? ended.map(draw) : [])]
  if (isFramedHere) {
    const title = titleParts(rows, axis, outer.bodyColumns - FRAME_TITLE_CHROME, outer.palette)
    return [drawFrame(outer, 'agents', AGENTS_LOOK, title, body)]
  }
  return [
    elements.isInline
      ? null
      : Box({
          key: 'agents-rule',
          children: [
            Text({
              color: paletteColor('rules', elements.palette),
              children: '─'.repeat(elements.bodyColumns),
            }),
          ],
        }),
    drawHeader(elements, rows, axis),
    ...body,
  ].filter((element) => element !== null)
}
