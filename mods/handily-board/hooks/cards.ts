import type { AgentInfo, AgentStatus } from 'claude-code'
import type { BoardList, BoardStatus } from '../types'
import {
  lastSegment,
  type AgentsCache,
  type AgentsFailure,
  type SessionKind,
  type SessionRow,
} from './agents-json'
import {
  currentTask,
  estimateLeftMs,
  isOlderThanStart,
  workedMs,
  type AgentSummary,
  type Progress,
} from './progress'
import { doneCount, paneTaskText } from './tasks'

export const HIDE_BACKGROUND_AFTER_MS = 24 * 60 * 60_000
export const STALE_DATA_AFTER_MS = 30_000

export type Attention = 'needsYou' | 'failed' | 'working' | 'idle' | 'ended'

export const ATTENTION_ORDER: readonly Attention[] = [
  'needsYou',
  'failed',
  'working',
  'idle',
  'ended',
]

export type CardTask =
  | { kind: 'none' }
  | { kind: 'empty' }
  | {
      kind: 'task'
      title: string | null
      status: BoardStatus | null
      done: number
      total: number
      isStale: boolean
    }

export type CardTime = { kind: 'worked' | 'elapsed'; ms: number } | { kind: 'ended' } | null

export type AgentCounts = { count: number; failed: number; needYou: number }

export type SessionCard = {
  key: string
  name: string
  kind: SessionKind | null
  isOwn: boolean
  isUnlisted: boolean
  attention: Attention
  state: string
  waitsFor: string | null
  task: CardTask
  place: string
  time: CardTime
  estMs: number | null
  agents: AgentCounts | null
  agentRows: readonly AgentSummary[]
}

export type CardsView = {
  kind: 'cards'
  cards: SessionCard[]
  hidden: number
  dataAt: number
  isStale: boolean
  isEmpty: boolean
}

export type MachineView =
  | { kind: 'loading' }
  | { kind: 'failed'; failure: AgentsFailure }
  | { kind: 'desktop'; own: SessionCard }
  | CardsView

export type OwnWork = {
  sessionId: string
  cwd: string
  list: BoardList
  progress: Progress | null
  agents: readonly AgentInfo[]
}

export type MachineData = {
  now: number
  own: OwnWork
  cache: AgentsCache | undefined
  progress: readonly Progress[]
}

const NEEDS_YOU_WORDS = new Set(['waiting', 'blocked'])
const WORKING_WORDS = new Set(['busy', 'working'])
const ENDED_AGENTS: ReadonlySet<AgentStatus> = new Set<AgentStatus>(['completed', 'killed'])
const NEEDS_YOU_STATE = 'needs you'
const UNKNOWN_WAIT = 'an answer'
const OWN_NAME_LENGTH = 8

export function attentionOf(row: SessionRow): Attention {
  if (row.isEnded) return row.word === 'failed' ? 'failed' : 'ended'
  if (row.waitingFor !== null || NEEDS_YOU_WORDS.has(row.word)) return 'needsYou'
  if (WORKING_WORDS.has(row.word)) return 'working'
  return 'idle'
}

function rowState(row: SessionRow, attention: Attention) {
  if (attention !== 'needsYou') return { state: row.word, waitsFor: null }
  return { state: NEEDS_YOU_STATE, waitsFor: row.waitingFor ?? UNKNOWN_WAIT }
}

export function agentCounts(agents: readonly AgentInfo[]): AgentCounts | null {
  const active = agents.filter((agent) => !ENDED_AGENTS.has(agent.status))
  if (active.length === 0) return null
  return {
    count: active.length,
    failed: active.filter((agent) => agent.status === 'failed').length,
    needYou: 0,
  }
}

function byNeedsYou(agents: readonly AgentSummary[]): AgentSummary[] {
  return [...agents].sort((a, b) => Number(b.needsYou === true) - Number(a.needsYou === true))
}

function sharedAgents(progress: Progress | undefined, isShown: boolean) {
  if (progress === undefined || !isShown || progress.agentCount === 0) {
    return { agents: null, agentRows: [] }
  }
  const rows = byNeedsYou(progress.agents)
  return {
    agents: {
      count: progress.agentCount,
      failed: rows.filter((agent) => agent.isFailed).length,
      needYou: rows.filter((agent) => agent.needsYou === true).length,
    },
    agentRows: rows,
  }
}

function placeOf(row: SessionRow, cache: AgentsCache): string {
  const known = cache.places[row.key]
  if (!known) return lastSegment(row.cwd)
  return `${known.place.worktree} · ${known.place.branch ?? 'no branch'}`
}

function keyTask(progress: Progress | undefined, isStale: boolean): CardTask {
  if (progress === undefined) return { kind: 'none' }
  if (progress.total === 0) return { kind: 'empty' }
  return {
    kind: 'task',
    title: progress.task,
    status: progress.taskStatus,
    done: progress.done,
    total: progress.total,
    isStale,
  }
}

function listTask(list: BoardList): CardTask {
  const total = list.tasks.length
  if (total === 0) return { kind: 'empty' }
  const current = currentTask(list)
  return {
    kind: 'task',
    title: current ? paneTaskText(current) : null,
    status: current?.status ?? null,
    done: doneCount(list),
    total,
    isStale: false,
  }
}

function otherCard(
  row: SessionRow,
  progress: Progress | undefined,
  cache: AgentsCache,
  now: number,
): SessionCard {
  const attention = attentionOf(row)
  const isStale = progress !== undefined && isOlderThanStart(progress, row.startedAt)
  let time: CardTime = { kind: 'elapsed', ms: now - row.startedAt }
  if (row.isEnded) time = { kind: 'ended' }
  else if (progress && !isStale) {
    time = { kind: 'worked', ms: workedMs(progress, now, row.startedAt) }
  }
  return {
    key: row.key,
    name: row.name,
    kind: row.kind,
    isOwn: false,
    isUnlisted: false,
    attention,
    ...rowState(row, attention),
    task: keyTask(progress, isStale),
    place: placeOf(row, cache),
    time,
    estMs: progress && !row.isEnded && !isStale ? estimateLeftMs(progress, now) : null,
    ...sharedAgents(progress, !row.isEnded && !isStale),
  }
}

function ownTime(own: OwnWork, row: SessionRow | undefined, now: number): CardTime {
  if (own.progress) return { kind: 'worked', ms: workedMs(own.progress, now) }
  return row ? { kind: 'elapsed', ms: now - row.startedAt } : null
}

export function ownCard(
  data: MachineData,
  row: SessionRow | undefined,
  isUnlisted: boolean,
): SessionCard {
  const { own, now, cache } = data
  const isWorking = own.progress?.isWorking ?? false
  const attention = row ? attentionOf(row) : isWorking ? 'working' : 'idle'
  const state = row
    ? rowState(row, attention)
    : { state: isWorking ? 'busy' : 'idle', waitsFor: null }
  return {
    key: own.sessionId,
    name: row?.name ?? own.sessionId.slice(0, OWN_NAME_LENGTH),
    kind: row?.kind ?? null,
    isOwn: true,
    isUnlisted,
    attention,
    ...state,
    task: listTask(own.list),
    place: row && cache ? placeOf(row, cache) : lastSegment(own.cwd),
    time: ownTime(own, row, now),
    estMs: own.progress ? estimateLeftMs(own.progress, now) : null,
    agents: agentCounts(own.agents),
    agentRows: [],
  }
}

export function isOldBackground(row: SessionRow, ownSessionId: string, now: number): boolean {
  return (
    row.kind === 'background' &&
    row.sessionId !== ownSessionId &&
    now - row.stateSince > HIDE_BACKGROUND_AFTER_MS
  )
}

function attentionRank(card: SessionCard): number {
  return ATTENTION_ORDER.indexOf(card.attention)
}

export function byAttention(a: SessionCard, b: SessionCard): number {
  return attentionRank(a) - attentionRank(b) || Number(b.isOwn) - Number(a.isOwn)
}

export function machineView(data: MachineData): MachineView {
  const { cache, now, own } = data
  if (cache === undefined) return { kind: 'loading' }
  const { listed, failure } = cache
  if (listed === null) {
    return failure === null ? { kind: 'loading' } : { kind: 'failed', failure }
  }
  const bySession = new Map(data.progress.map((entry) => [entry.sessionId, entry]))
  const shown = listed.rows.filter((row) => !isOldBackground(row, own.sessionId, now))
  const listedCards = shown.map((row) =>
    row.sessionId === own.sessionId
      ? ownCard(data, row, false)
      : otherCard(
          row,
          row.sessionId === null ? undefined : bySession.get(row.sessionId),
          cache,
          now,
        ),
  )
  const isOwnListed = listedCards.some((card) => card.isOwn)
  const unlisted = isOwnListed ? [] : [ownCard(data, undefined, true)]
  const cards = [...listedCards, ...unlisted].sort(byAttention)
  return {
    kind: 'cards',
    cards,
    hidden: listed.rows.length - shown.length,
    dataAt: listed.at,
    isStale: failure !== null && now - listed.at > STALE_DATA_AFTER_MS,
    isEmpty: listed.rows.length === 0,
  }
}

export function desktopView(data: MachineData): MachineView {
  return { kind: 'desktop', own: ownCard(data, undefined, false) }
}
