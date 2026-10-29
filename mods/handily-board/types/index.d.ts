export type BoardStatus = 'pending' | 'in_progress' | 'completed'

export type BoardAuthor = 'model' | 'person' | 'tracker'

export type BoardSource =
  { by: Exclude<BoardAuthor, 'tracker'>; item: null } | { by: 'tracker'; item: string }

export type BoardTaskKind = 'do' | 'answer' | 'decide'

export type BoardResultVerb = 'done' | 'answered' | 'chose' | 'rejected'

export type BoardResult = {
  verb: BoardResultVerb
  text: string | null
  at: number
  isSent: boolean
}

export type BoardTask = {
  id: number
  title: string
  status: BoardStatus
  for?: 'person'
  kind?: BoardTaskKind
  options?: readonly string[]
  why?: string
  askedAt?: number
  result?: BoardResult
  isWithdrawn?: boolean
} & BoardSource

export type BoardList = {
  tasks: readonly BoardTask[]
  nextId: number
}

export type BoardPersonChange = { text: string; tasks: readonly BoardTask[] }

export type BoardPlan = {
  id: string
  steps: readonly string[]
  cut: readonly number[]
  nextId: number
  added: readonly number[] | null
  isDismissed: boolean
  refusal: readonly string[] | null
  lockedAt?: number
}

export type BoardToolSight = { tool: string; target: string | null }

export type BoardAgentPlan = { version: number; tasks: readonly BoardTask[] }

export type BoardAgentPlans = Readonly<Partial<Record<string, BoardAgentPlan>>>

export type BoardToolCount = { tool: string; calls: number }

export type BoardTaskClock = {
  startedAt: number
  startCalls: number
  endedAt: number | null
  endCalls: number | null
  runAt?: number
}

export type BoardActivity = {
  calls: number
  firstAt: number | null
  last: BoardToolSight | null
  perTool: readonly BoardToolCount[]
  sincePlan: number
  noteAt: number | null
  clocks: Readonly<Partial<Record<string, BoardTaskClock>>>
  doneAt?: number | null
}

export type BoardAgentStatus =
  'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

export type BoardCallAsk = { at: number; target: string | null }

export type BoardAgentCall = {
  id: string
  tool: string
  target: string | null
  asked?: BoardCallAsk
}

export type BoardCheckDecision = 'allow' | 'ask' | 'deny'

export type BoardCheck = {
  decision: BoardCheckDecision
  tool: string
  target: string | null
  agentId: string | null
}

export type BoardChecks = {
  allowed: number
  asked: number
  denied: number
  last: readonly BoardCheck[]
}

export type BoardAgent = {
  id: string
  startedAt: number
  isSpawnSeen: boolean
  seenAt: number
  endedAt: number | null
  tools: number
  running: readonly BoardAgentCall[]
  last: BoardToolSight | null
  description: string | null
  type: string | null
  name: string | null
  parentId: string | null
  listedStatus: BoardAgentStatus | null
  isListed: boolean
  hasLoopEvents: boolean
  label?: string
}

export type BoardTrend = { tokens: readonly number[]; isReadingStale: boolean }

export type BoardCallRow =
  | { kind: 'added'; id: number; title: string }
  | { kind: 'status'; id: number; status: BoardStatus; title: string }
  | { kind: 'removed'; id: number; title: string }
  | { kind: 'moved'; id: number; before: number; title: string }
  | { kind: 'list'; done: number; total: number }

declare module 'claude-code' {
  interface PluginState {
    'handily-board': {
      list: BoardList
      personChanges: readonly BoardPersonChange[]
      agentList: StateFamily<BoardList>
      agentIds: readonly string[]
      agentPlans: BoardAgentPlans
      expanded: readonly string[]
      activity: BoardActivity
      agents: readonly BoardAgent[]
      rows: StateFamily<BoardCallRow>
      plans: StateFamily<BoardPlan>
      planId: string | null
      paneChanges: number
      trend: BoardTrend
      ready: { root: string }
    }
  }
}
