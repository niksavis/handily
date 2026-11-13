import { lastSegment, type AgentsCache, type SessionRow } from './agents-json'
import { isOldBackground, STALE_DATA_AFTER_MS, waitsForOf } from './cards'
import { isOlderThanStart, type Progress } from './progress'
import {
  counted,
  countOf,
  WAIT_KINDS,
  type SharedWait,
  type WaitCounts,
  type WaitKind,
} from './waits'

export const INBOX_ROWS_AT_MOST = 5

export type InboxKind = WaitKind

export type InboxDetail =
  | { kind: 'call'; agent: string; tool: string; target: string | null }
  | { kind: 'text'; text: string }
  | { kind: 'forYou'; count: number }

export type InboxRow = {
  key: string
  session: string
  kind: InboxKind
  detail: InboxDetail
  ageMs: number | null
  count: number
}

export type InboxView =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | {
      kind: 'rows'
      rows: readonly InboxRow[]
      notKept: WaitCounts
      sessions: number
      waiting: number
      dataAt: number
      isStale: boolean
      isUnreadable: boolean
    }

export type InboxData = {
  now: number
  ownSessionId: string
  cache: AgentsCache | undefined
  progress: readonly Progress[] | null
}

function sessionName(row: SessionRow): string {
  return row.givenName ?? lastSegment(row.cwd)
}

function isOtherRunning(row: SessionRow, ownSessionId: string): boolean {
  return !row.isEnded && row.sessionId !== ownSessionId
}

function listedWaitText(row: SessionRow, ownSessionId: string, now: number): string | null {
  return isOldBackground(row, ownSessionId, now) ? row.waitingFor : waitsForOf(row)
}

function waitDetail(wait: SharedWait): InboxDetail {
  if (wait.kind === 'permission') {
    return { kind: 'call', agent: wait.agent, tool: wait.tool, target: wait.target }
  }
  return { kind: 'text', text: wait.title }
}

function ageOf(since: number | null, now: number): number | null {
  return since === null ? null : Math.max(now - since, 0)
}

function boardRows(row: SessionRow, progress: Progress, now: number): InboxRow[] {
  const session = sessionName(row)
  return progress.waits.map((wait, index) => ({
    key: `${row.key}:${String(index)}`,
    session,
    kind: wait.kind,
    detail: waitDetail(wait),
    ageMs: ageOf(wait.since, now),
    count: 1,
  }))
}

function forYouRow(row: SessionRow, count: number): InboxRow {
  return {
    key: `${row.key}:for-you`,
    session: sessionName(row),
    kind: 'waits',
    detail: { kind: 'forYou', count },
    ageMs: null,
    count,
  }
}

function listedWaitAge(row: SessionRow, now: number): number | null {
  return row.stateSince === row.startedAt ? null : Math.max(now - row.stateSince, 0)
}

function listedRow(row: SessionRow, waitingFor: string, now: number): InboxRow {
  return {
    key: `${row.key}:listed`,
    session: sessionName(row),
    kind: 'waits',
    detail: { kind: 'text', text: waitingFor },
    ageMs: listedWaitAge(row, now),
    count: 1,
  }
}

function hasBoardWaits(progress: Progress): boolean {
  return progress.waits.length > 0 || countOf(progress.waitsMore) > 0
}

type SessionWaits = { rows: InboxRow[]; notKept: WaitCounts }

type ReadAt = { now: number; ownSessionId: string }

function sessionWaits(
  row: SessionRow,
  progress: Progress | undefined,
  { now, ownSessionId }: ReadAt,
): SessionWaits {
  const usable =
    progress !== undefined && !isOlderThanStart(progress, row.startedAt) ? progress : undefined
  if (usable !== undefined && hasBoardWaits(usable)) {
    return { rows: boardRows(row, usable, now), notKept: usable.waitsMore }
  }
  const forYou = usable?.openForYou ?? 0
  const waitsFor = listedWaitText(row, ownSessionId, now)
  return {
    rows: [
      ...(waitsFor === null ? [] : [listedRow(row, waitsFor, now)]),
      ...(forYou > 0 ? [forYouRow(row, forYou)] : []),
    ],
    notKept: {},
  }
}

function kindRank(row: InboxRow): number {
  return WAIT_KINDS.indexOf(row.kind)
}

function byKindThenAge(a: InboxRow, b: InboxRow): number {
  return (
    kindRank(a) - kindRank(b) ||
    (b.ageMs ?? -1) - (a.ageMs ?? -1) ||
    a.session.localeCompare(b.session)
  )
}

function addedCounts(all: WaitCounts, more: WaitCounts): WaitCounts {
  return Object.entries(more).reduce(
    (sum, [kind, count]) => counted(sum, kind as WaitKind, count),
    all,
  )
}

export function inboxView(data: InboxData): InboxView {
  const { cache, now } = data
  if (cache === undefined) return { kind: 'loading' }
  const { listed, failure } = cache
  if (listed === null) return failure === null ? { kind: 'loading' } : { kind: 'failed' }
  const bySession = new Map((data.progress ?? []).map((entry) => [entry.sessionId, entry]))
  const running = listed.rows.filter((row) => isOtherRunning(row, data.ownSessionId))
  const each = running.map((row) =>
    sessionWaits(
      row,
      row.sessionId === null || data.progress === null ? undefined : bySession.get(row.sessionId),
      { now, ownSessionId: data.ownSessionId },
    ),
  )
  return {
    kind: 'rows',
    rows: each.flatMap((one) => one.rows).sort(byKindThenAge),
    notKept: each.reduce<WaitCounts>((all, one) => addedCounts(all, one.notKept), {}),
    sessions: running.length,
    waiting: each.filter((one) => one.rows.length > 0 || countOf(one.notKept) > 0).length,
    dataAt: listed.at,
    isStale: failure !== null && now - listed.at > STALE_DATA_AFTER_MS,
    isUnreadable: data.progress === null,
  }
}

export function waitCount(view: Extract<InboxView, { kind: 'rows' }>): number {
  return view.rows.reduce((sum, row) => sum + row.count, 0) + countOf(view.notKept)
}
