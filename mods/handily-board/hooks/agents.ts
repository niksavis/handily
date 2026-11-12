import type { AgentInfo, AgentStatus, TurnStepResult } from 'claude-code'
import type {
  BoardAgent,
  BoardAgentCall,
  BoardAgentCallDone,
  BoardAgentPlans,
  BoardCallOutcome,
  BoardCallAsk,
  BoardTask,
  BoardToolSight,
} from '../types'
import { NAME_CUT_ABOVE, numberedNames } from './agent-rows'
import { maskedCredentials } from './credentials'
import { type AgentRetry, commandOutcome, retriesAfter, retryOf, withRetries } from './retry'
import { escaped } from './tasks'

export const UNLISTED_KEPT_AT_MOST = 20
export const NEEDS_YOU_AFTER_MS = 3_000
export const SLOW_CALL_MS = 30_000
export const QUIET_MS = 120_000
export const RUN_SETTLE_MS = 3_000
const LAST_CALLS = 3

const ANSWER_CHARS_AT_MOST = 200

const HANDBACK_TOOL = 'SubagentHandback'
const ENDED_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  'completed',
  'failed',
  'killed',
])

export type AgentLook =
  | 'needsYou'
  | 'asked'
  | 'failed'
  | 'running'
  | 'held'
  | 'pending'
  | 'idle'
  | 'done'
  | 'killed'
  | 'unlisted'

export type AgentStep = {
  context: number
  output: number
  stopReason: TurnStepResult['stopReason']
}

export type AgentSteps = ReadonlyMap<string, AgentStep>

export type AgentStall = { kind: 'slow' | 'quiet'; ms: number }

export type AgentPulses = { heardAt: Map<string, number>; callsFrom: Map<string, number> }

export type AgentCallLine = BoardToolSight & {
  outcome: BoardCallOutcome | 'running'
  at: number | null
}

export type CallAnswer = { isError?: boolean; deny?: string; result?: unknown }

export type AgentRow = {
  id: string
  label: string
  shownName: string
  look: AgentLook
  listedStatus: AgentStatus | null
  isListed: boolean
  isEnded: boolean
  isAnswerSeen: boolean
  isFailureSeen: boolean
  isAging: boolean
  call: BoardToolSight | null
  callId: string | null
  isCallRunning: boolean
  tools: number
  lastCalls: readonly AgentCallLine[]
  answer: string | null
  plan: readonly BoardTask[] | null
  description: string | null
  type: string | null
  parentId: string | null
  isParentKnown: boolean
  isSpawnSeen: boolean
  startedAt: number
  ageMs: number
  step: AgentStep | null
  steps: number
  stall: AgentStall | null
  retry: AgentRetry | null
}

export type SpawnFacts = {
  description: string
  type: string
  name: string | undefined
  parentId: string | undefined
}

export type Agents = readonly BoardAgent[]

export type AgentHost = {
  now: () => Promise<number>
  listed: () => Promise<readonly AgentInfo[]>
  stored: () => Promise<Agents>
  change: (step: (agents: Agents) => Agents) => Promise<void>
  plans: () => Promise<BoardAgentPlans>
  plan: (agentId: string) => Promise<FoundPlan>
  keepPlans: (found: readonly FoundPlan[]) => void
}

export type FoundPlan = { agentId: string; tasks: readonly BoardTask[]; version: number }

function created(id: string, now: number): BoardAgent {
  return {
    id,
    startedAt: now,
    isSpawnSeen: false,
    seenAt: now,
    endedAt: null,
    tools: 0,
    running: [],
    last: null,
    description: null,
    type: null,
    name: null,
    parentId: null,
    listedStatus: null,
    isListed: false,
    hasLoopEvents: false,
  }
}

function withAgent(
  agents: Agents,
  id: string,
  now: number,
  change: (agent: BoardAgent) => BoardAgent,
): BoardAgent[] {
  const known = agents.find((agent) => agent.id === id)
  if (!known) return [...agents, change(created(id, now))]
  return agents.map((agent) => (agent === known ? change(agent) : agent))
}

function unseen(agent: BoardAgent): BoardAgent {
  if (agent.isAnswerSeen !== true && agent.isFailureSeen !== true) return agent
  return { ...agent, isAnswerSeen: false, isFailureSeen: false }
}

function reopened(agent: BoardAgent, now: number): BoardAgent {
  return { ...unseen(agent), seenAt: now, endedAt: null, runStartedAt: now }
}

function isNeverListed(agent: BoardAgent): boolean {
  return agent.listedStatus === null && (agent.type === null || !agent.hasLoopEvents)
}

function isUnknownLoop(agent: BoardAgent): boolean {
  return agent.listedStatus === null && !agent.isSpawnSeen
}

function pruned(agents: Agents): BoardAgent[] {
  const idle = agents
    .filter((agent) => isUnknownLoop(agent) && agent.running.length === 0)
    .sort((a, b) => a.seenAt - b.seenAt)
  const dropped = new Set(
    idle.slice(0, Math.max(idle.length - UNLISTED_KEPT_AT_MOST, 0)).map((agent) => agent.id),
  )
  return agents.filter((agent) => !dropped.has(agent.id))
}

export function withSpawn(agents: Agents, id: string, facts: SpawnFacts, at: number): BoardAgent[] {
  return pruned(
    withAgent(agents, id, at, (agent) => ({
      ...reopened(agent, at),
      startedAt: agent.isSpawnSeen ? agent.startedAt : at,
      isSpawnSeen: true,
      description: agent.description ?? facts.description,
      type: agent.type ?? facts.type,
      name: agent.name ?? facts.name ?? null,
      parentId: agent.parentId ?? facts.parentId ?? null,
    })),
  )
}

export function withRunStart(agents: Agents, agentId: string, now: number): BoardAgent[] {
  return withAgent(agents, agentId, now, (agent) => ({
    ...reopened(agent, now),
    hasLoopEvents: true,
  }))
}

export function withCallStart(
  agents: Agents,
  agentId: string,
  call: BoardAgentCall,
  now: number,
): BoardAgent[] {
  return withAgent(agents, agentId, now, (agent) => ({
    ...reopened(agent, now),
    hasLoopEvents: true,
    running: [...agent.running.filter((one) => one.id !== call.id), call],
  }))
}

export type CallEnd = {
  callId: string
  outcome: BoardCallOutcome
  commandOutcome: BoardCallOutcome
  at: number
}

export function withCallEnd(agents: Agents, agentId: string, end: CallEnd): BoardAgent[] {
  const agent = agents.find((one) => one.id === agentId)
  const call = agent?.running.find((one) => one.id === end.callId)
  if (!agent || !call) return [...agents]
  const sight = { tool: call.tool, target: call.target }
  const done: BoardAgentCallDone = { ...sight, outcome: end.outcome, at: end.at }
  const retries = retriesAfter(agent.retries ?? [], {
    tool: call.tool,
    command: call.command,
    outcome: end.commandOutcome,
  })
  const finished = withRetries(
    {
      ...agent,
      running: agent.running.filter((one) => one.id !== end.callId),
      tools: agent.tools + 1,
      last: call.tool !== HANDBACK_TOOL || agent.last === null ? sight : agent.last,
      calls: [...(agent.calls ?? []), done].slice(-LAST_CALLS),
    },
    retries,
  )
  return pruned(agents.map((one) => (one === agent ? finished : one)))
}

export function withCallDropped(agents: Agents, agentId: string, callId: string): BoardAgent[] {
  return pruned(
    agents.map((agent) =>
      agent.id === agentId
        ? { ...agent, running: agent.running.filter((one) => one.id !== callId) }
        : agent,
    ),
  )
}

export function withCallAsked(
  agents: Agents,
  agentId: string,
  callId: string,
  asked: BoardCallAsk,
): BoardAgent[] {
  return agents.map((agent) =>
    agent.id === agentId
      ? {
          ...agent,
          running: agent.running.map((call) => (call.id === callId ? { ...call, asked } : call)),
        }
      : agent,
  )
}

function withoutAsk(call: BoardAgentCall): BoardAgentCall {
  const { asked, ...settled } = call
  return asked === undefined ? call : settled
}

export function withCallSettled(agents: Agents, agentId: string, callId: string): BoardAgent[] {
  return agents.map((agent) =>
    agent.id === agentId
      ? {
          ...agent,
          running: agent.running.map((call) => (call.id === callId ? withoutAsk(call) : call)),
        }
      : agent,
  )
}

function firstAnswerLine(answer: string): string {
  const line = answer.split('\n').find((one) => one.trim() !== '') ?? ''
  return maskedCredentials(line.trim()).slice(0, ANSWER_CHARS_AT_MOST)
}

export function withTurnEnd(
  agents: Agents,
  agentId: string,
  now: number,
  answer: string,
): BoardAgent[] {
  return pruned(
    withAgent(agents, agentId, now, (agent) => ({
      ...withRetries(unseen(agent), []),
      seenAt: now,
      endedAt: now,
      hasLoopEvents: true,
      running: [],
      answer: firstAnswerLine(answer),
    })),
  )
}

function isSettledRun(agent: BoardAgent, now: number): boolean {
  const runStartedAt = agent.runStartedAt ?? agent.startedAt
  return agent.endedAt === null && agent.running.length === 0 && now - runStartedAt >= RUN_SETTLE_MS
}

function isListedEnd(agent: BoardAgent, status: AgentStatus, now: number): boolean {
  if (!ENDED_STATUSES.has(status)) return false
  return agent.listedStatus !== status || isSettledRun(agent, now)
}

function listedAgent(agent: BoardAgent, info: AgentInfo, now: number): BoardAgent {
  const isEnd = isListedEnd(agent, info.status, now)
  return {
    ...(isEnd ? withRetries(agent, []) : agent),
    isListed: true,
    seenAt: now,
    listedStatus: info.status,
    description: info.description === '' ? agent.description : info.description,
    type: info.type,
    name: info.name ?? agent.name,
    parentId: info.parentId ?? agent.parentId,
    endedAt: isEnd ? (agent.endedAt ?? now) : agent.endedAt,
  }
}

export function withList(agents: Agents, listed: readonly AgentInfo[], now: number): BoardAgent[] {
  let merged: BoardAgent[] = agents.map((agent) =>
    listed.some((info) => info.id === agent.id) ? agent : { ...agent, isListed: false },
  )
  for (const info of listed) {
    merged = withAgent(merged, info.id, now, (agent) => listedAgent(agent, info, now))
  }
  return pruned(merged)
}

type RowStatus = AgentStatus | 'unknown'

function statusOf(agent: BoardAgent): RowStatus {
  if (agent.listedStatus !== null) {
    const isListedEnded = ENDED_STATUSES.has(agent.listedStatus)
    if (agent.endedAt !== null) return isListedEnded ? agent.listedStatus : 'completed'
    if (isListedEnded) return 'running'
    return agent.isListed ? agent.listedStatus : 'unknown'
  }
  if (agent.running.length > 0 && agent.endedAt === null) return 'running'
  return agent.endedAt === null ? 'unknown' : 'completed'
}

export type SeenEnd = 'isAnswerSeen' | 'isFailureSeen'

const SEEN_STATUSES: Record<SeenEnd, ReadonlySet<RowStatus>> = {
  isAnswerSeen: new Set<RowStatus>(['completed', 'killed']),
  isFailureSeen: new Set<RowStatus>(['failed']),
}

function isUnseenEnd(agent: BoardAgent, seen: SeenEnd): boolean {
  return agent[seen] !== true && SEEN_STATUSES[seen].has(statusOf(agent))
}

export function withEndsSeen(agents: Agents, viewed: Agents, seen: SeenEnd): BoardAgent[] {
  const ends = viewed.filter((agent) => isUnseenEnd(agent, seen))
  const unstored = ends.filter((end) => !agents.some((agent) => agent.id === end.id))
  const ids = new Set(ends.map((agent) => agent.id))
  return [...agents, ...unstored].map((agent) =>
    ids.has(agent.id) ? { ...agent, [seen]: true } : agent,
  )
}

const STATUS_LOOKS: Record<AgentStatus, AgentLook> = {
  failed: 'failed',
  running: 'running',
  waiting: 'held',
  pending: 'pending',
  idle: 'idle',
  completed: 'done',
  killed: 'killed',
}

const LOOK_RANKS: Record<AgentLook, number> = {
  needsYou: -1,
  asked: 1,
  failed: 0,
  running: 1,
  unlisted: 1,
  held: 2,
  pending: 3,
  idle: 3,
  done: 4,
  killed: 4,
}

const UNLISTED_ENDED_RANK = 5

function lookOf(agent: BoardAgent, status: RowStatus): AgentLook {
  if (isNeverListed(agent) || status === 'unknown') return 'unlisted'
  return STATUS_LOOKS[status]
}

function isEndedRow(agent: BoardAgent, look: AgentLook): boolean {
  if (look === 'unlisted') return agent.running.length === 0
  return look === 'done' || look === 'killed'
}

function isAgingNow(agent: BoardAgent, status: RowStatus): boolean {
  if (status !== 'unknown' && ENDED_STATUSES.has(status)) return false
  return agent.running.length > 0 || status !== 'unknown'
}

function endOf(agent: BoardAgent, status: RowStatus, now: number): number {
  if (isAgingNow(agent, status)) return now
  if (status === 'unknown') return agent.seenAt
  return agent.endedAt ?? now
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function baseLabel(agent: BoardAgent): string {
  return agent.name ?? agent.type ?? shortId(agent.id)
}

export function labelledAgents(agents: readonly BoardAgent[]): BoardAgent[] {
  const sorted = [...agents].sort((a, b) => a.startedAt - b.startedAt)
  const labels = numberedNames(
    sorted.map((agent) => escaped(baseLabel(agent))),
    NAME_CUT_ABOVE,
  )
  const byId = new Map(sorted.map((agent, index) => [agent.id, labels[index] ?? '']))
  return agents.map((agent) => ({ ...agent, label: byId.get(agent.id) ?? '' }))
}

type WaitingAsk = { call: BoardAgentCall; asked: BoardCallAsk }

function waitingAsk(agent: BoardAgent): WaitingAsk | undefined {
  for (const call of agent.running) {
    if (call.asked !== undefined) return { call, asked: call.asked }
  }
  return undefined
}

function askLook(asked: BoardCallAsk, now: number): AgentLook {
  return now - asked.at >= NEEDS_YOU_AFTER_MS ? 'needsYou' : 'asked'
}

function sightOf(agent: BoardAgent, waiting: WaitingAsk | undefined): BoardToolSight | null {
  if (waiting) return { tool: waiting.call.tool, target: waiting.asked.target }
  const running = agent.running.at(-1)
  return running ? { tool: running.tool, target: running.target } : agent.last
}

function runningLine(call: BoardAgentCall): AgentCallLine {
  return { tool: call.tool, target: call.target, outcome: 'running', at: call.startedAt ?? null }
}

function lastCallsOf(agent: BoardAgent): AgentCallLine[] {
  return [...(agent.calls ?? []), ...agent.running.map(runningLine)].slice(-LAST_CALLS)
}

function rowOf(
  agent: BoardAgent,
  plan: readonly BoardTask[] | undefined,
  now: number,
): { row: AgentRow; rank: number } {
  const status = statusOf(agent)
  const listedLook = lookOf(agent, status)
  const isEnded = isEndedRow(agent, listedLook)
  const waiting = isEnded || listedLook === 'failed' ? undefined : waitingAsk(agent)
  const look = waiting === undefined ? listedLook : askLook(waiting.asked, now)
  const running = agent.running.at(-1)
  const hasEnded = isEnded || (status !== 'unknown' && ENDED_STATUSES.has(status))
  const row: AgentRow = {
    id: agent.id,
    label: baseLabel(agent),
    shownName: agent.label ?? escaped(baseLabel(agent)),
    look,
    listedStatus: agent.listedStatus,
    isListed: agent.isListed,
    isEnded,
    isAnswerSeen: agent.isAnswerSeen === true,
    isFailureSeen: agent.isFailureSeen === true,
    isAging: isAgingNow(agent, status),
    call: sightOf(agent, waiting),
    callId: running?.id ?? null,
    isCallRunning: running !== undefined,
    tools: agent.tools,
    lastCalls: lastCallsOf(agent),
    answer: agent.answer ?? null,
    plan: plan ?? null,
    description: agent.description === '' ? null : agent.description,
    type: agent.type,
    parentId: agent.parentId,
    isParentKnown: agent.type !== null,
    isSpawnSeen: agent.isSpawnSeen,
    startedAt: agent.startedAt,
    ageMs: Math.max(endOf(agent, status, now) - agent.startedAt, 0),
    step: null,
    steps: 0,
    stall: null,
    retry: hasEnded ? null : retryOf(agent),
  }
  return { row, rank: look === 'unlisted' && isEnded ? UNLISTED_ENDED_RANK : LOOK_RANKS[look] }
}

export function agentRows(
  agents: Agents,
  plans: ReadonlyMap<string, readonly BoardTask[]>,
  now: number,
): AgentRow[] {
  return agents
    .map((agent) => rowOf(agent, plans.get(agent.id), now))
    .sort((a, b) => a.rank - b.rank || a.row.startedAt - b.row.startedAt)
    .map(({ row }) => row)
}

export function stepOf(
  stepped: Pick<TurnStepResult, 'usage' | 'stopReason'>,
): AgentStep | undefined {
  const { usage } = stepped
  if (usage === null) return undefined
  const context =
    usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
  return { context, output: usage.output_tokens, stopReason: stepped.stopReason }
}

export function withSteps(
  rows: readonly AgentRow[],
  steps: AgentSteps,
  counts: ReadonlyMap<string, number>,
): AgentRow[] {
  return rows.map((row) => ({
    ...row,
    step: steps.get(row.id) ?? null,
    steps: counts.get(row.id) ?? 0,
  }))
}

export function newPulses(): AgentPulses {
  return { heardAt: new Map(), callsFrom: new Map() }
}

export function heard(pulses: AgentPulses, agentId: string, at: number): void {
  pulses.heardAt.set(agentId, Math.max(pulses.heardAt.get(agentId) ?? at, at))
}

function stallOf(row: AgentRow, pulses: AgentPulses, now: number): AgentStall | null {
  if (row.look !== 'running') return null
  const callFrom = row.callId === null ? undefined : pulses.callsFrom.get(row.callId)
  if (callFrom !== undefined && now - callFrom > SLOW_CALL_MS) {
    return { kind: 'slow', ms: now - callFrom }
  }
  const heardAt = pulses.heardAt.get(row.id)
  if (heardAt !== undefined && now - heardAt >= QUIET_MS)
    return { kind: 'quiet', ms: now - heardAt }
  return null
}

export function withStalls(
  rows: readonly AgentRow[],
  pulses: AgentPulses,
  now: number,
): AgentRow[] {
  return rows.map((row) => ({ ...row, stall: stallOf(row, pulses, now) }))
}

export function waitingRows(rows: readonly AgentRow[]): AgentRow[] {
  return rows.filter((row) => row.look === 'needsYou')
}

export function waitingCount(rows: readonly AgentRow[]): number {
  return waitingRows(rows).length
}

function outcomeOf(answer: CallAnswer, isRefused: boolean): BoardCallOutcome {
  if (isRefused || answer.deny !== undefined) return 'denied'
  return answer.isError === true ? 'failed' : 'ok'
}

export async function trackAgentCall<R extends CallAnswer>(
  host: AgentHost,
  agentId: string,
  call: BoardAgentCall,
  run: () => Promise<R>,
  isRefused: () => boolean = () => false,
): Promise<R> {
  const now = await host.now()
  const started = { ...call, startedAt: now }
  await host.change((agents) => withCallStart(agents, agentId, started, now))
  let result: R
  try {
    result = await run()
  } catch (error) {
    await host.change((agents) => withCallDropped(agents, agentId, call.id))
    throw error
  }
  const outcome = outcomeOf(result, isRefused())
  const end = {
    callId: call.id,
    outcome,
    commandOutcome: commandOutcome(outcome, result.result),
    at: await host.now(),
  }
  await host.change((agents) => withCallEnd(agents, agentId, end))
  return result
}

export async function noteSpawn(
  host: AgentHost,
  agentId: string,
  facts: SpawnFacts,
  at: number,
): Promise<void> {
  await host.change((agents) => withSpawn(agents, agentId, facts, at))
}

export async function noteAsk(
  host: AgentHost,
  agentId: string,
  callId: string,
  target: string | null,
): Promise<void> {
  const at = await host.now()
  await host.change((agents) => withCallAsked(agents, agentId, callId, { at, target }))
}

export async function noteSettled(host: AgentHost, agentId: string, callId: string): Promise<void> {
  await host.change((agents) => withCallSettled(agents, agentId, callId))
}

export async function noteRunStart(host: AgentHost, agentId: string): Promise<void> {
  const now = await host.now()
  await host.change((agents) => withRunStart(agents, agentId, now))
}

export async function noteTurnEnd(host: AgentHost, agentId: string, answer: string): Promise<void> {
  const now = await host.now()
  const listed = await host.listed()
  await host.change((agents) => withList(withTurnEnd(agents, agentId, now, answer), listed, now))
}

export async function noteEndsSeen(host: AgentHost, seen: SeenEnd): Promise<void> {
  const listed = await host.listed()
  const now = await host.now()
  const viewed = withList(await host.stored(), listed, now)
  if (!viewed.some((agent) => isUnseenEnd(agent, seen))) return
  await host.change((current) => withEndsSeen(current, withList(current, listed, now), seen))
}

export async function noteAgentList(host: AgentHost): Promise<void> {
  const listed = await host.listed()
  const now = await host.now()
  await host.change((agents) => withList(agents, listed, now))
}

export function withAgentPlan(
  plans: BoardAgentPlans,
  agentId: string,
  tasks: readonly BoardTask[],
  version: number,
): BoardAgentPlans {
  const kept = plans[agentId]
  if (kept !== undefined && kept.version >= version) return plans
  return { ...plans, [agentId]: { version, tasks } }
}

export function withFoundPlans(
  plans: BoardAgentPlans,
  found: readonly FoundPlan[],
): BoardAgentPlans {
  return found.reduce(
    (kept, one) => withAgentPlan(kept, one.agentId, one.tasks, one.version),
    plans,
  )
}

async function plansOf(host: AgentHost, agents: Agents): Promise<BoardAgentPlans> {
  const kept = await host.plans()
  const found: FoundPlan[] = []
  for (const agent of agents) {
    if (kept[agent.id] === undefined) found.push(await host.plan(agent.id))
  }
  if (found.length === 0) return kept
  host.keepPlans(found)
  return withFoundPlans(kept, found)
}

export async function agentView(host: AgentHost, now: number): Promise<AgentRow[]> {
  const agents = labelledAgents(withList(await host.stored(), await host.listed(), now))
  const kept = await plansOf(host, agents)
  const plans = new Map<string, readonly BoardTask[]>()
  for (const agent of agents) {
    const plan = kept[agent.id]
    if (plan !== undefined && plan.tasks.length > 0) plans.set(agent.id, plan.tasks)
  }
  return agentRows(agents, plans, now)
}
