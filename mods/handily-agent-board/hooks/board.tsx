import type { Elements, RenderElement, RenderSurface, TextProps } from 'claude-code'
import {
  currentCall,
  elapsedMs,
  isEnded,
  isUnlisted,
  rowStatus,
  type AgentTrack,
  type RowStatus,
  type ToolSight,
  type Tracks,
} from './agents'
import { planView, type PlanStatus, type PlanTask, type PlanView } from './plan'

export const EMPTY_TEXT = 'No subagents in this session yet.'
export const NOT_LISTED_BADGE = 'not listed'

type BoardElements = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>
type TextStyle = Omit<TextProps, 'children'>
type BoxStyle = Omit<Parameters<BoardElements['Box']>[0], 'children'>
type Child = RenderElement | null

type Group = 'active' | 'unknown' | 'done' | 'unlisted'

const DETAIL_INDENT = 2
const CARD_RULE = '─'
const SHORT_ID_CHARS = 8

const STATUS_WORDS: Partial<Record<RowStatus, string>> = { completed: 'done' }

const MARKS: Record<RowStatus, { glyph: string; style: TextStyle }> = {
  running: { glyph: '●', style: { color: 'success' } },
  pending: { glyph: '○', style: { dimColor: true } },
  waiting: { glyph: '◐', style: { color: 'warning' } },
  idle: { glyph: '○', style: { dimColor: true } },
  completed: { glyph: '○', style: { dimColor: true } },
  failed: { glyph: '✕', style: { color: 'error' } },
  killed: { glyph: '○', style: { dimColor: true } },
  unknown: { glyph: '?', style: { dimColor: true } },
}

const TASK_MARKS: Record<PlanStatus, { glyph: string; style: TextStyle; title: TextStyle }> = {
  completed: { glyph: '✓', style: { color: 'success' }, title: { dimColor: true } },
  in_progress: { glyph: '▶', style: {}, title: { bold: true } },
  pending: { glyph: '○', style: { dimColor: true }, title: {} },
}

const GROUP_ORDER: Record<Group, number> = { active: 0, unknown: 1, done: 2, unlisted: 3 }

export type CardPlans = {
  lists: ReadonlyMap<string, readonly PlanTask[]>
  unfolded: ReadonlySet<string>
  toggle: (agentId: string) => void
}

export type BoardRow = {
  id: string
  title: string
  badge: string | null
  status: RowStatus
  group: Group
  time: string
  description: string | null
  parent: string | null
  call: ToolSight | null
  isCallRunning: boolean
  tools: number
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(Math.floor(ms / 1000), 0)
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, '0')}m`
}

function groupOf(track: AgentTrack, status: RowStatus): Group {
  if (isUnlisted(track)) return 'unlisted'
  if (isEnded(status)) return 'done'
  return status === 'unknown' ? 'unknown' : 'active'
}

function shortId(id: string): string {
  return id.slice(0, SHORT_ID_CHARS)
}

function labelOf(track: AgentTrack): string {
  return track.name ?? track.description ?? shortId(track.id)
}

function parentLabel(tracks: Tracks, parentId: string | null): string | null {
  if (parentId === null) return null
  const parent = tracks.get(parentId)
  return parent ? labelOf(parent) : shortId(parentId)
}

function badgeOf(track: AgentTrack): string | null {
  if (isUnlisted(track)) return NOT_LISTED_BADGE
  return track.name === null ? null : track.type
}

function boardRow(tracks: Tracks, track: AgentTrack, now: number): BoardRow {
  const running = currentCall(track)
  const status = rowStatus(track)
  return {
    id: track.id,
    title: track.name ?? track.type ?? shortId(track.id),
    badge: badgeOf(track),
    status,
    group: groupOf(track, status),
    time: formatElapsed(elapsedMs(track, now)),
    description: track.description === '' ? null : track.description,
    parent: parentLabel(tracks, track.parentId),
    call: running ?? track.last,
    isCallRunning: running !== null,
    tools: track.tools,
  }
}

export function boardRows(tracks: Tracks, now: number): BoardRow[] {
  return [...tracks.values()]
    .map((track) => ({ track, row: boardRow(tracks, track, now) }))
    .sort(
      (a, b) =>
        GROUP_ORDER[a.row.group] - GROUP_ORDER[b.row.group] ||
        a.track.startedAt - b.track.startedAt,
    )
    .map(({ row }) => row)
}

function countPart(count: number, words: string): string | null {
  return count > 0 ? `${String(count)} ${words}` : null
}

export function headerText(rows: readonly BoardRow[]): string {
  const count = (group: Group) => rows.filter((row) => row.group === group).length
  const done = count('done')
  const listed = rows.length - count('unlisted')
  const parts =
    listed > 0 && done === listed
      ? [`all ${String(done)} done`]
      : [countPart(count('active'), 'active'), countPart(done, 'done')]
  return [
    ...parts,
    countPart(count('unknown'), 'unknown'),
    countPart(count('unlisted'), 'not listed'),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

export function countText(tools: number): string {
  return tools === 1 ? '1 tool' : `${String(tools)} tools`
}

export function callText(call: ToolSight): string {
  return call.target === null ? call.tool : `${call.tool} ${call.target}`
}

function text(elements: BoardElements, children: string, style: TextStyle = {}): RenderElement {
  return elements.Text({ ...style, children })
}

function box(elements: BoardElements, style: BoxStyle, children: readonly Child[]): RenderElement {
  return elements.Box({ ...style, children: children.filter((child) => child !== null) })
}

function kept(elements: BoardElements, child: RenderElement, style: BoxStyle = {}): RenderElement {
  return box(elements, { ...style, flexShrink: 0 }, [child])
}

function cut(elements: BoardElements, line: string, style: TextStyle = {}): RenderElement {
  return box(elements, { flexShrink: 1 }, [
    text(elements, line, { ...style, wrap: 'truncate-end' }),
  ])
}

function cardHeader(elements: BoardElements, row: BoardRow): RenderElement {
  const mark = MARKS[row.status]
  return box(elements, { flexDirection: 'row' }, [
    kept(elements, text(elements, `${mark.glyph} `, mark.style)),
    cut(elements, row.title, { bold: true }),
    row.badge === null
      ? null
      : kept(elements, text(elements, row.badge, { dimColor: true }), { marginLeft: 2 }),
    kept(elements, text(elements, STATUS_WORDS[row.status] ?? row.status, mark.style), {
      marginLeft: 2,
    }),
    kept(elements, text(elements, row.time, { dimColor: true }), { marginLeft: 2 }),
  ])
}

function aboutLine(elements: BoardElements, row: BoardRow): Child {
  if (row.description === null && row.parent === null) return null
  return box(elements, { flexDirection: 'row', paddingLeft: DETAIL_INDENT }, [
    row.description === null ? null : cut(elements, row.description),
    row.parent === null
      ? null
      : box(elements, { flexShrink: 1, marginLeft: row.description === null ? 0 : 2 }, [
          text(elements, `under ${row.parent}`, { dimColor: true, wrap: 'truncate-end' }),
        ]),
  ])
}

function toolLine(elements: BoardElements, row: BoardRow): RenderElement {
  if (row.call === null) {
    return box(elements, { flexDirection: 'row', paddingLeft: DETAIL_INDENT }, [
      kept(elements, text(elements, 'no tool calls yet', { dimColor: true })),
    ])
  }
  const lead = row.isCallRunning ? '▸ ' : 'last '
  return box(elements, { flexDirection: 'row', paddingLeft: DETAIL_INDENT }, [
    kept(elements, text(elements, lead, { dimColor: true })),
    cut(elements, callText(row.call), row.isCallRunning ? {} : { dimColor: true }),
    kept(elements, text(elements, ` · ${countText(row.tools)}`, { dimColor: true })),
  ])
}

export function planKey(agentId: string): string {
  return `plan:${agentId}`
}

function shownText(view: PlanView): string {
  return view.shown.length < view.total
    ? ` · ${String(view.shown.length)} of ${String(view.total)} shown`
    : ` · all ${String(view.total)} shown`
}

function planHead(
  elements: BoardElements,
  row: BoardRow,
  view: PlanView,
  plans: CardPlans,
): RenderElement {
  const count = `plan ${String(view.done)}/${String(view.total)} done`
  if (!view.isFoldable) {
    return box(elements, { flexDirection: 'row', paddingLeft: DETAIL_INDENT }, [
      kept(elements, text(elements, count, { dimColor: true })),
    ])
  }
  const fold = elements.Button({
    key: planKey(row.id),
    label: count,
    plain: true,
    dimColor: true,
    onPress: () => {
      plans.toggle(row.id)
    },
  })
  return box(elements, { flexDirection: 'row', paddingLeft: DETAIL_INDENT }, [
    kept(elements, fold),
    cut(elements, shownText(view), { dimColor: true }),
  ])
}

function taskLine(elements: BoardElements, task: PlanTask): RenderElement {
  const mark = TASK_MARKS[task.status]
  return box(elements, { flexDirection: 'row', paddingLeft: DETAIL_INDENT }, [
    kept(elements, text(elements, `${mark.glyph} `, mark.style)),
    cut(elements, task.title, mark.title),
  ])
}

function planLines(elements: BoardElements, row: BoardRow, plans: CardPlans): RenderElement[] {
  const tasks = plans.lists.get(row.id)
  if (tasks === undefined) return []
  const view = planView(tasks, plans.unfolded.has(row.id))
  return [
    planHead(elements, row, view, plans),
    ...view.shown.map((task) => taskLine(elements, task)),
  ]
}

function card(elements: BoardElements, row: BoardRow, plans: CardPlans): RenderElement {
  return box(elements, { key: `agent:${row.id}`, flexDirection: 'column' }, [
    cardHeader(elements, row),
    aboutLine(elements, row),
    toolLine(elements, row),
    ...planLines(elements, row, plans),
  ])
}

export function renderBoard(
  elements: BoardElements,
  rows: readonly BoardRow[],
  bodyColumns: number,
  plans: CardPlans,
): RenderElement {
  const rule = () => text(elements, CARD_RULE.repeat(bodyColumns), { dimColor: true })
  const header = headerText(rows)
  return box(elements, { flexDirection: 'column' }, [
    box(elements, { flexDirection: 'row' }, [
      kept(elements, text(elements, 'Subagents', { bold: true })),
      header === '' ? null : cut(elements, `  ${header}`, { dimColor: true }),
    ]),
    rows.length === 0 ? text(elements, EMPTY_TEXT, { dimColor: true }) : null,
    ...rows.flatMap((row, index) => [index === 0 ? null : rule(), card(elements, row, plans)]),
  ])
}
