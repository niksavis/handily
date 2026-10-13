import type { AgentInfo, AgentStatus } from 'claude-code'
import type { BoardAgent, BoardAgentCall, BoardList, BoardTask, BoardToolSight } from '../types'

export const UNLISTED_KEPT_AT_MOST = 20

const HANDBACK_TOOL = 'SubagentHandback'
const ENDED_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  'completed',
  'failed',
  'killed',
])

export type AgentLook =
  'failed' | 'running' | 'held' | 'pending' | 'idle' | 'done' | 'killed' | 'unlisted'

export type AgentRow = {
  id: string
  label: string
  look: AgentLook
  isEnded: boolean
  call: BoardToolSight | null
  isCallRunning: boolean
  tools: number
  plan: readonly BoardTask[] | null
  description: string | null
  parentId: string | null
  isParentKnown: boolean
  isSpawnSeen: boolean
  startedAt: number
  ageMs: number
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
  plan: (agentId: string) => Promise<BoardList | undefined>
}

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
      ...agent,
      startedAt: agent.isSpawnSeen ? agent.startedAt : at,
      isSpawnSeen: true,
      description: agent.description ?? facts.description,
      type: agent.type ?? facts.type,
      name: agent.name ?? facts.name ?? null,
      parentId: agent.parentId ?? facts.parentId ?? null,
    })),
  )
}

export function withCallStart(
  agents: Agents,
  agentId: string,
  call: BoardAgentCall,
  now: number,
): BoardAgent[] {
  return withAgent(agents, agentId, now, (agent) => ({
    ...agent,
    seenAt: now,
    endedAt: null,
    hasLoopEvents: true,
    running: [...agent.running.filter((one) => one.id !== call.id), call],
  }))
}

export function withCallEnd(agents: Agents, agentId: string, callId: string): BoardAgent[] {
  const agent = agents.find((one) => one.id === agentId)
  const call = agent?.running.find((one) => one.id === callId)
  if (!agent || !call) return [...agents]
  const sight = { tool: call.tool, target: call.target }
  const finished: BoardAgent = {
    ...agent,
    running: agent.running.filter((one) => one.id !== callId),
    tools: agent.tools + 1,
    last: call.tool !== HANDBACK_TOOL || agent.last === null ? sight : agent.last,
  }
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

export function withTurnEnd(agents: Agents, agentId: string, now: number): BoardAgent[] {
  return pruned(
    withAgent(agents, agentId, now, (agent) => ({
      ...agent,
      seenAt: now,
      endedAt: now,
      hasLoopEvents: true,
    })),
  )
}

function listedAgent(agent: BoardAgent, info: AgentInfo, now: number): BoardAgent {
  return {
    ...agent,
    isListed: true,
    seenAt: now,
    listedStatus: info.status,
    description: info.description === '' ? agent.description : info.description,
    type: info.type,
    name: info.name ?? agent.name,
    parentId: info.parentId ?? agent.parentId,
    endedAt: ENDED_STATUSES.has(info.status) ? (agent.endedAt ?? now) : agent.endedAt,
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
    if (agent.isListed || ENDED_STATUSES.has(agent.listedStatus)) return agent.listedStatus
    return agent.endedAt === null ? 'unknown' : 'completed'
  }
  if (agent.running.length > 0) return 'running'
  return agent.endedAt === null ? 'unknown' : 'completed'
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

function endOf(agent: BoardAgent, status: RowStatus, now: number): number {
  if (agent.running.length > 0) return now
  if (status === 'unknown') return agent.seenAt
  if (ENDED_STATUSES.has(status)) return agent.endedAt ?? now
  return now
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function rowOf(
  agent: BoardAgent,
  plan: readonly BoardTask[] | undefined,
  now: number,
): { row: AgentRow; rank: number } {
  const status = statusOf(agent)
  const look = lookOf(agent, status)
  const isEnded = isEndedRow(agent, look)
  const running = agent.running.at(-1)
  const row: AgentRow = {
    id: agent.id,
    label: agent.name ?? agent.type ?? shortId(agent.id),
    look,
    isEnded,
    call: running ? { tool: running.tool, target: running.target } : agent.last,
    isCallRunning: running !== undefined,
    tools: agent.tools,
    plan: plan ?? null,
    description: agent.description === '' ? null : agent.description,
    parentId: agent.parentId,
    isParentKnown: agent.type !== null,
    isSpawnSeen: agent.isSpawnSeen,
    startedAt: agent.startedAt,
    ageMs: Math.max(endOf(agent, status, now) - agent.startedAt, 0),
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

export async function trackAgentCall<R>(
  host: AgentHost,
  agentId: string,
  call: BoardAgentCall,
  run: () => Promise<R>,
): Promise<R> {
  const now = await host.now()
  await host.change((agents) => withCallStart(agents, agentId, call, now))
  let result: R
  try {
    result = await run()
  } catch (error) {
    await host.change((agents) => withCallDropped(agents, agentId, call.id))
    throw error
  }
  await host.change((agents) => withCallEnd(agents, agentId, call.id))
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

export async function noteTurnEnd(host: AgentHost, agentId: string): Promise<void> {
  const now = await host.now()
  const listed = await host.listed()
  await host.change((agents) => withList(withTurnEnd(agents, agentId, now), listed, now))
}

export async function noteAgentList(host: AgentHost): Promise<void> {
  const listed = await host.listed()
  const now = await host.now()
  await host.change((agents) => withList(agents, listed, now))
}

export async function agentView(host: AgentHost, now: number): Promise<AgentRow[]> {
  const agents = withList(await host.stored(), await host.listed(), now)
  const plans = new Map<string, readonly BoardTask[]>()
  for (const agent of agents) {
    const plan = await host.plan(agent.id)
    if (plan !== undefined && plan.tasks.length > 0) plans.set(agent.id, plan.tasks)
  }
  return agentRows(agents, plans, now)
}
