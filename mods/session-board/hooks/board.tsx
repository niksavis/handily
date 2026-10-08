import type { AgentInfo, Elements, RenderElement, RenderSurface, TextProps } from 'claude-code'
import { POLL_INTERVAL_MS, type AgentRow, type AgentsCache, type AgentsOutcome } from './agents'
import { estimateLeftMs, isOlderThanStart, workedMs, type Progress } from './progress'

export const WIDE_FROM_COLUMNS = 100

type BoardElements = Pick<Elements[RenderSurface], 'Box' | 'Text'>

type Tone = 'success' | 'warning' | 'plain' | 'dim'

export type TaskCell =
  | { kind: 'task'; current: string | null; done: number; total: number }
  | { kind: 'no-tasks' }
  | { kind: 'no-data' }

export type BoardRow = {
  key: string
  name: string
  kind: 'inter' | 'bg' | '—'
  state: string
  tone: Tone
  task: TaskCell
  isStale: boolean
  isListed: boolean
  isEnded: boolean
  place: string
  time: string
  est: string | null
}

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
const WIDE = { name: 13, kind: 7, state: 22, task: 30, place: 31 }
const NARROW = { name: 15, kind: 9 }

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

export function stateTone(row: AgentRow): Tone {
  if (row.isEnded) return 'dim'
  if (row.waitingFor !== null || WARNING_WORDS.has(row.word)) return 'warning'
  if (SUCCESS_WORDS.has(row.word)) return 'success'
  return 'plain'
}

function taskCell(progress: Progress | undefined): TaskCell {
  if (progress === undefined || !progress.hasTasks) return { kind: 'no-data' }
  if (progress.total === 0) return { kind: 'no-tasks' }
  return { kind: 'task', current: progress.task, done: progress.done, total: progress.total }
}

function estText(progress: Progress, now: number): string | null {
  const left = estimateLeftMs(progress, now)
  return left === null ? null : `est. ${formatDuration(left)} left`
}

function agentRow(
  row: AgentRow,
  progress: Progress | undefined,
  cache: AgentsCache,
  now: number,
): BoardRow {
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
    kind: row.kind === 'interactive' ? 'inter' : 'bg',
    state: stateText(row),
    tone: stateTone(row),
    task: taskCell(progress),
    isStale,
    isListed: true,
    isEnded: row.isEnded,
    place,
    time,
    est: progress && !row.isEnded && !isStale ? estText(progress, now) : null,
  }
}

function staleRow(progress: Progress): BoardRow {
  return {
    key: `stale:${progress.sessionId}`,
    name: progress.sessionId.slice(0, 8),
    kind: '—',
    state: 'not listed',
    tone: 'dim',
    task: taskCell(progress),
    isStale: true,
    isListed: false,
    isEnded: false,
    place: lastSegment(progress.cwd),
    time: `${formatDuration(progress.workedMs)} worked`,
    est: null,
  }
}

export function boardRows(data: BoardData): BoardRow[] {
  const { cache, now } = data
  if (cache?.outcome.kind !== 'ok') return []
  const bySession = new Map(data.progress.map((entry) => [entry.sessionId, entry]))
  const rows = cache.outcome.rows
  const listed = new Set(rows.flatMap((row) => (row.sessionId === null ? [] : [row.sessionId])))
  const ordered = [...rows.filter((row) => !row.isEnded), ...rows.filter((row) => row.isEnded)]
  return [
    ...ordered.map((row) =>
      agentRow(row, row.sessionId === null ? undefined : bySession.get(row.sessionId), cache, now),
    ),
    ...data.progress
      .filter((entry) => entry.sessionId === data.ownSessionId && !listed.has(entry.sessionId))
      .map(staleRow),
  ]
}

type TextStyle = Omit<TextProps, 'children'>
type BoxStyle = Omit<Parameters<BoardElements['Box']>[0], 'children'>
type Child = RenderElement | null

function text(elements: BoardElements, children: string, style: TextStyle = {}): RenderElement {
  return elements.Text({ ...style, children })
}

function box(elements: BoardElements, style: BoxStyle, children: readonly Child[]): RenderElement {
  return elements.Box({ ...style, children: children.filter((child) => child !== null) })
}

function toneStyle(tone: Tone): TextStyle {
  if (tone === 'success') return { color: 'success' }
  if (tone === 'warning') return { color: 'warning' }
  if (tone === 'dim') return { dimColor: true }
  return {}
}

function taskParts(elements: BoardElements, row: BoardRow, isWide: boolean): RenderElement {
  const { task } = row
  const stale = row.isStale ? text(elements, ' (stale)', { dimColor: true }) : null
  if (task.kind === 'no-data') {
    const label = isWide || row.isEnded || row.isStale ? '—' : 'no handily task data'
    return box(elements, { flexDirection: 'row' }, [
      text(elements, label, { dimColor: true }),
      stale,
    ])
  }
  if (task.kind === 'no-tasks') {
    return box(elements, { flexDirection: 'row' }, [
      text(elements, 'no tasks yet', { dimColor: true }),
      stale,
    ])
  }
  const title = task.current ?? `all ${String(task.total)} done`
  const count = ` ${String(task.done)}/${String(task.total)}`
  return box(elements, { flexDirection: 'row' }, [
    isWide ? null : text(elements, '▶ ', { dimColor: true }),
    box(elements, { flexShrink: 1 }, [text(elements, title, { wrap: 'truncate-end' })]),
    box(elements, { flexShrink: 0 }, [text(elements, count, { dimColor: !isWide })]),
    stale,
  ])
}

function fixedCell(elements: BoardElements, width: number, child: RenderElement): RenderElement {
  return box(elements, { width, flexShrink: 0, paddingRight: 1 }, [child])
}

function wideRow(elements: BoardElements, row: BoardRow): RenderElement {
  const dim = row.isEnded || !row.isListed
  return box(elements, { key: `row:${row.key}`, flexDirection: 'row' }, [
    fixedCell(elements, WIDE.name, text(elements, row.name, { bold: true, wrap: 'truncate-end' })),
    fixedCell(elements, WIDE.kind, text(elements, row.kind, { dimColor: dim })),
    fixedCell(
      elements,
      WIDE.state,
      text(elements, row.state, { ...toneStyle(row.tone), wrap: 'truncate-end' }),
    ),
    fixedCell(elements, WIDE.task, taskParts(elements, row, true)),
    fixedCell(
      elements,
      WIDE.place,
      text(elements, row.place, { dimColor: dim, wrap: 'truncate-end' }),
    ),
    box(elements, { flexGrow: 1, flexDirection: 'row' }, [
      text(elements, row.time, { dimColor: dim }),
      row.est === null ? null : text(elements, `  ${row.est}`, { dimColor: true }),
    ]),
  ])
}

function narrowRow(elements: BoardElements, row: BoardRow): RenderElement {
  const placeLine = [row.place, row.time, ...(row.est === null ? [] : [row.est])].join(' · ')
  return box(elements, { key: `row:${row.key}`, flexDirection: 'column' }, [
    box(elements, { flexDirection: 'row' }, [
      fixedCell(
        elements,
        NARROW.name,
        text(elements, row.name, { bold: true, wrap: 'truncate-end' }),
      ),
      fixedCell(elements, NARROW.kind, text(elements, row.kind, { dimColor: true })),
      text(elements, row.state, { ...toneStyle(row.tone), wrap: 'truncate-end' }),
    ]),
    box(elements, { paddingLeft: 2 }, [taskParts(elements, row, false)]),
    box(elements, { paddingLeft: 2 }, [
      text(elements, placeLine, { dimColor: true, wrap: 'truncate-end' }),
    ]),
  ])
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

function listedRows(rows: readonly BoardRow[]): BoardRow[] {
  return rows.filter((row) => row.isListed)
}

export function headerText(data: BoardData, rows: readonly BoardRow[]): string {
  const age = data.cache === undefined ? '' : `polled ${formatAge(data.now - data.cache.at)} ago`
  if (isOnlyThisSession(data, rows)) return age
  return `${String(listedRows(rows).length)} local · ${age}`
}

function isOnlyThisSession(data: BoardData, rows: readonly BoardRow[]): boolean {
  const listed = listedRows(rows)
  return listed.length === 1 && listed[0]?.key === data.ownSessionId
}

function columnTitles(): string {
  return [
    'name'.padEnd(WIDE.name),
    'kind'.padEnd(WIDE.kind),
    'state'.padEnd(WIDE.state),
    'task'.padEnd(WIDE.task),
    'worktree · branch'.padEnd(WIDE.place),
    'time',
  ].join('')
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
  const rows = boardRows(data)
  const isWide = bodyColumns >= WIDE_FROM_COLUMNS
  const note = (line: string) => text(elements, line, { dimColor: true })
  return box(elements, { flexDirection: 'column' }, [
    box(elements, { flexDirection: 'row' }, [
      text(elements, 'Sessions', { bold: true }),
      note(`  ${headerText(data, rows)}`),
    ]),
    isOnlyThisSession(data, rows) ? note('Only this session is running.') : null,
    listedRows(rows).length === 0 ? note('No local sessions are listed.') : null,
    isWide && rows.length > 0 ? note(columnTitles()) : null,
    ...rows.map((row) => (isWide ? wideRow(elements, row) : narrowRow(elements, row))),
  ])
}

function ownRow(elements: BoardElements, data: DesktopData): RenderElement {
  const { own, now } = data
  const isWorking = own?.isWorking ?? false
  const row: BoardRow = {
    key: 'this-session',
    name: 'this session',
    kind: '—',
    state: isWorking ? 'working' : 'idle',
    tone: isWorking ? 'success' : 'plain',
    task: taskCell(own),
    isStale: false,
    isListed: false,
    isEnded: false,
    place: '',
    time: `${formatDuration(own ? workedMs(own, now) : 0)} worked`,
    est: own ? estText(own, now) : null,
  }
  return box(elements, { key: 'row:this-session', flexDirection: 'column' }, [
    box(elements, { flexDirection: 'row' }, [
      text(elements, 'this session', { bold: true }),
      text(elements, `  ${row.state}`, toneStyle(row.tone)),
    ]),
    box(elements, { paddingLeft: 2 }, [taskParts(elements, row, false)]),
    box(elements, { paddingLeft: 2 }, [
      text(elements, [row.time, ...(row.est === null ? [] : [row.est])].join(' · '), {
        dimColor: true,
      }),
    ]),
  ])
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
      ownRow(elements, data),
      subagentLines(elements, data.subagents),
    ]),
  ])
}
