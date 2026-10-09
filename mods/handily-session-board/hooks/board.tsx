import type { AgentInfo, Elements, RenderElement, RenderSurface, TextProps } from 'claude-code'
import {
  POLL_INTERVAL_MS,
  type AgentKind,
  type AgentRow,
  type AgentsCache,
  type AgentsOutcome,
} from './agents'
import { estimateLeftMs, isOlderThanStart, workedMs, type Progress } from './progress'
import { SIGNALS, type Signal } from './signals'

export const HIDE_BACKGROUND_AFTER_MS = 24 * 60 * 60_000

type BoardElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

export type StateGroup = 'working' | 'waiting' | 'idle' | 'ended' | 'failed'

export type TaskCell =
  | { kind: 'task'; current: string | null; done: number; total: number }
  | { kind: 'no-tasks' }
  | { kind: 'no-data' }

export type BoardRow = {
  key: string
  name: string
  kind: AgentKind | null
  state: string
  group: StateGroup
  task: TaskCell
  isOwn: boolean
  isStale: boolean
  isListed: boolean
  place: string
  time: string
  est: string | null
}

export type BoardView = { rows: BoardRow[]; hidden: number }

export type BoardData = {
  now: number
  ownSessionId: string
  cache: AgentsCache | undefined
  progress: readonly Progress[]
}

export type DesktopData = {
  now: number
  own: Progress | undefined
  subagents: readonly AgentInfo[]
}

const WARNING_WORDS = new Set(['waiting', 'blocked'])
const SUCCESS_WORDS = new Set(['busy', 'working'])
const AGENT_WORDS: Partial<Record<AgentInfo['status'], string>> = { completed: 'done' }
const RETRY_TEXT = `retry in ${String(POLL_INTERVAL_MS / 1000)} s`
const GROUP_ORDER: Record<StateGroup, number> = {
  working: 0,
  waiting: 1,
  idle: 2,
  ended: 3,
  failed: 3,
}
const DETAIL_INDENT = 2
const CARD_RULE = '─'

type TextStyle = Omit<TextProps, 'children'>
type BoxStyle = Omit<Parameters<BoardElements['Box']>[0], 'children'>
type Child = RenderElement | null

const GROUP_SIGNALS: Record<StateGroup, Signal> = {
  working: 'doing',
  waiting: 'waitsForYou',
  idle: 'toDo',
  ended: 'done',
  failed: 'blocked',
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(Math.floor(ms / 60_000), 0)
  if (minutes < 60) return `${String(minutes)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${String(Math.floor(hours / 24))}d ${String(hours % 24).padStart(2, '0')}h`
}

export function formatAge(ms: number): string {
  const seconds = Math.max(Math.floor(ms / 1000), 0)
  if (seconds < 60) return `${String(seconds)} s`
  return `${String(Math.floor(seconds / 60))} min`
}

export function progressText(done: number, total: number): string {
  return `${String(done)} of ${String(total)}`
}

function lastSegment(path: string): string {
  return (
    path
      .split(/[\\/]+/)
      .filter((part) => part !== '')
      .at(-1) ?? path
  )
}

export function stateText(row: AgentRow): string {
  return row.waitingFor === null ? row.word : `${row.word}: ${row.waitingFor}`
}

export function stateGroup(row: AgentRow): StateGroup {
  if (row.isEnded) return row.word === 'failed' ? 'failed' : 'ended'
  if (row.waitingFor !== null || WARNING_WORDS.has(row.word)) return 'waiting'
  if (SUCCESS_WORDS.has(row.word)) return 'working'
  return 'idle'
}

function taskCell(progress: Progress | undefined): TaskCell {
  if (progress === undefined) return { kind: 'no-data' }
  if (!progress.hasTasks || progress.total === 0) return { kind: 'no-tasks' }
  return { kind: 'task', current: progress.task, done: progress.done, total: progress.total }
}

function estText(progress: Progress, now: number): string | null {
  const left = estimateLeftMs(progress, now)
  return left === null ? null : `est. ${formatDuration(left)} left`
}

function agentRow(
  row: AgentRow,
  progress: Progress | undefined,
  data: BoardData,
  cache: AgentsCache,
): BoardRow {
  const { now } = data
  const known = cache.places[row.key]
  const place = known
    ? `${known.place.worktree} · ${known.place.branch ?? 'no branch'}`
    : lastSegment(row.cwd)
  const isStale = progress !== undefined && isOlderThanStart(progress, row.startedAt)
  let time = `${formatDuration(now - row.startedAt)} elapsed`
  if (row.isEnded) time = 'ended'
  else if (progress) time = `${formatDuration(workedMs(progress, now, row.startedAt))} worked`
  return {
    key: row.key,
    name: row.name,
    kind: row.kind,
    state: stateText(row),
    group: stateGroup(row),
    task: taskCell(progress),
    isOwn: row.sessionId === data.ownSessionId,
    isStale,
    isListed: true,
    place,
    time,
    est: progress && !row.isEnded && !isStale ? estText(progress, now) : null,
  }
}

function staleRow(progress: Progress): BoardRow {
  return {
    key: `stale:${progress.sessionId}`,
    name: progress.sessionId.slice(0, 8),
    kind: null,
    state: 'not listed',
    group: 'idle',
    task: taskCell(progress),
    isOwn: true,
    isStale: true,
    isListed: false,
    place: lastSegment(progress.cwd),
    time: `${formatDuration(progress.workedMs)} worked`,
    est: null,
  }
}

export function isOldBackground(row: AgentRow, ownSessionId: string, now: number): boolean {
  return (
    row.kind === 'background' &&
    row.sessionId !== ownSessionId &&
    now - row.stateSince > HIDE_BACKGROUND_AFTER_MS
  )
}

function boardOrder(a: BoardRow, b: BoardRow): number {
  return Number(b.isOwn) - Number(a.isOwn) || GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
}

export function boardView(data: BoardData): BoardView {
  const { cache, now } = data
  if (cache?.outcome.kind !== 'ok') return { rows: [], hidden: 0 }
  const bySession = new Map(data.progress.map((entry) => [entry.sessionId, entry]))
  const all = cache.outcome.rows
  const listed = new Set(all.flatMap((row) => (row.sessionId === null ? [] : [row.sessionId])))
  const shown = all.filter((row) => !isOldBackground(row, data.ownSessionId, now))
  const rows = [
    ...shown.map((row) =>
      agentRow(row, row.sessionId === null ? undefined : bySession.get(row.sessionId), data, cache),
    ),
    ...data.progress
      .filter((entry) => entry.sessionId === data.ownSessionId && !listed.has(entry.sessionId))
      .map(staleRow),
  ]
  return { rows: rows.sort(boardOrder), hidden: all.length - shown.length }
}

function text(elements: BoardElements, children: string, style: TextStyle = {}): RenderElement {
  return elements.Text({ ...style, children })
}

function box(elements: BoardElements, style: BoxStyle, children: readonly Child[]): RenderElement {
  return elements.Box({ ...style, children: children.filter((child) => child !== null) })
}

function kept(elements: BoardElements, child: RenderElement): RenderElement {
  return box(elements, { flexShrink: 0 }, [child])
}

function taskLine(elements: BoardElements, row: BoardRow): Child {
  const { task } = row
  if (task.kind === 'no-data') return null
  const stale = row.isStale ? kept(elements, text(elements, ' (stale)', { dimColor: true })) : null
  if (task.kind === 'no-tasks') {
    return box(elements, { flexDirection: 'row', paddingLeft: DETAIL_INDENT }, [
      kept(elements, text(elements, 'no tasks', { dimColor: true })),
      stale,
    ])
  }
  const title = task.current ?? `all ${String(task.total)} done`
  return box(elements, { flexDirection: 'row', paddingLeft: DETAIL_INDENT }, [
    box(elements, { flexShrink: 1 }, [text(elements, title, { wrap: 'truncate-end' })]),
    box(elements, { flexShrink: 0, marginLeft: 1 }, [
      text(elements, progressText(task.done, task.total)),
    ]),
    stale,
  ])
}

function cardHeader(elements: BoardElements, row: BoardRow): RenderElement {
  const { mark, color } = SIGNALS[GROUP_SIGNALS[row.group]]
  return box(elements, { flexDirection: 'row' }, [
    box(elements, { flexShrink: 0 }, [text(elements, `${mark} `, { color })]),
    box(elements, { flexShrink: 1 }, [
      text(elements, row.name, { bold: true, wrap: 'truncate-end' }),
    ]),
    row.kind === null
      ? null
      : box(elements, { flexShrink: 0, marginLeft: 2 }, [
          text(elements, row.kind, { dimColor: true }),
        ]),
    row.isOwn
      ? box(elements, { flexShrink: 0, marginLeft: 2 }, [
          text(elements, 'this', { color: 'suggestion' }),
        ])
      : null,
    box(elements, { flexShrink: 1, marginLeft: 2 }, [
      text(elements, row.state, { color, wrap: 'truncate-end' }),
    ]),
  ])
}

function placeLine(row: BoardRow): string {
  return [row.place, row.time, ...(row.est === null ? [] : [row.est])]
    .filter((part) => part !== '')
    .join(' · ')
}

function card(elements: BoardElements, row: BoardRow): RenderElement {
  return box(elements, { key: `card:${row.key}`, flexDirection: 'column' }, [
    cardHeader(elements, row),
    taskLine(elements, row),
    box(elements, { paddingLeft: DETAIL_INDENT }, [
      text(elements, placeLine(row), { dimColor: true, wrap: 'truncate-end' }),
    ]),
  ])
}

function cards(elements: BoardElements, rows: readonly BoardRow[], columns: number): Child[] {
  const rule = () => text(elements, CARD_RULE.repeat(columns), { dimColor: true })
  return rows.flatMap((row, index) => [index === 0 ? null : rule(), card(elements, row)])
}

export function errorLines(outcome: AgentsOutcome): string[] {
  if (outcome.kind === 'not-on-path') {
    return ['claude is not on PATH, so other sessions cannot be listed.']
  }
  if (outcome.kind === 'exit') {
    return [`claude agents --json failed: exit ${String(outcome.exitCode)}.`]
  }
  if (outcome.kind === 'not-a-list') {
    return ['claude agents --json failed: the output is not a JSON list.']
  }
  if (outcome.kind === 'did-not-run') return ['claude agents --json could not run.']
  if (outcome.kind === 'cut') {
    return ['claude agents --json failed: the output is over 4 MiB and was cut.']
  }
  return []
}

function errorView(elements: BoardElements, outcome: AgentsOutcome): RenderElement {
  const retry =
    outcome.kind === 'not-on-path'
      ? null
      : box(elements, { flexDirection: 'row' }, [
          text(elements, 'Run it in a shell to see why.', { color: 'error' }),
          text(elements, `  ${RETRY_TEXT}`, { dimColor: true }),
        ])
  return box(elements, { flexDirection: 'column' }, [
    text(elements, 'Sessions', { bold: true }),
    ...errorLines(outcome).map((line) => text(elements, line, { color: 'error' })),
    retry,
  ])
}

function isOnlyThisSession(view: BoardView): boolean {
  return view.hidden === 0 && view.rows.length === 1 && view.rows[0]?.isOwn === true
}

export function headerText(data: BoardData, view: BoardView): string {
  const age = data.cache === undefined ? '' : `polled ${formatAge(data.now - data.cache.at)} ago`
  if (isOnlyThisSession(view)) return age
  return `${String(view.rows.length)} local · ${age}`
}

export function hiddenText(hidden: number): string {
  const jobs = hidden === 1 ? 'job' : 'jobs'
  return `${String(hidden)} older background ${jobs} hidden`
}

export function renderBoard(
  elements: BoardElements,
  data: BoardData,
  bodyColumns: number,
): RenderElement {
  const { cache } = data
  if (cache === undefined) {
    return box(elements, { flexDirection: 'column' }, [
      text(elements, 'Sessions', { bold: true }),
      text(elements, 'Listing the local sessions…', { dimColor: true }),
    ])
  }
  if (cache.outcome.kind !== 'ok') return errorView(elements, cache.outcome)
  const view = boardView(data)
  const note = (line: string) => text(elements, line, { dimColor: true })
  return box(elements, { flexDirection: 'column' }, [
    box(elements, { flexDirection: 'row' }, [
      text(elements, 'Sessions', { bold: true }),
      note(`  ${headerText(data, view)}`),
    ]),
    isOnlyThisSession(view) ? note('Only this session is running.') : null,
    view.rows.every((row) => !row.isListed) ? note('No local sessions are listed.') : null,
    ...cards(elements, view.rows, bodyColumns),
    view.hidden > 0 ? note(hiddenText(view.hidden)) : null,
  ])
}

function ownRow(data: DesktopData): BoardRow {
  const { own, now } = data
  const isWorking = own?.isWorking ?? false
  return {
    key: 'this-session',
    name: 'this session',
    kind: null,
    state: isWorking ? 'working' : 'idle',
    group: isWorking ? 'working' : 'idle',
    task: taskCell(own),
    isOwn: false,
    isStale: false,
    isListed: false,
    place: '',
    time: `${formatDuration(own ? workedMs(own, now) : 0)} worked`,
    est: own ? estText(own, now) : null,
  }
}

function subagentLines(elements: BoardElements, subagents: readonly AgentInfo[]): Child {
  if (subagents.length === 0) return null
  return box(elements, { flexDirection: 'column' }, [
    text(elements, 'subagents', { dimColor: true }),
    ...subagents.map((agent) =>
      box(elements, { key: `agent:${agent.id}`, flexDirection: 'row', paddingLeft: 2 }, [
        text(elements, agent.type),
        text(elements, `  ${AGENT_WORDS[agent.status] ?? agent.status}`, { dimColor: true }),
        agent.description === ''
          ? null
          : text(elements, `  ${agent.description}`, { dimColor: true, wrap: 'truncate-end' }),
      ]),
    ),
  ])
}

export function renderDesktop(elements: BoardElements, data: DesktopData): RenderElement {
  return box(elements, { flexDirection: 'column' }, [
    text(elements, 'Sessions', { bold: true }),
    text(
      elements,
      'Other sessions are listed only in a terminal session (claude agents needs a CLI).',
      { dimColor: true },
    ),
    box(elements, { marginTop: 1, flexDirection: 'column' }, [
      card(elements, ownRow(data)),
      subagentLines(elements, data.subagents),
    ]),
  ])
}
