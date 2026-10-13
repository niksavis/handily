export type BoardStatus = 'pending' | 'in_progress' | 'completed'

export type BoardAuthor = 'model' | 'person' | 'tracker'

export type BoardSource =
  { by: Exclude<BoardAuthor, 'tracker'>; item: null } | { by: 'tracker'; item: string }

export type BoardTask = {
  id: number
  title: string
  status: BoardStatus
} & BoardSource

export type BoardList = {
  tasks: readonly BoardTask[]
  nextId: number
}

export type BoardToolSight = { tool: string; target: string | null }

export type BoardToolCount = { tool: string; calls: number }

export type BoardTaskClock = {
  startedAt: number
  startCalls: number
  endedAt: number | null
  endCalls: number | null
}

export type BoardActivity = {
  calls: number
  firstAt: number | null
  last: BoardToolSight | null
  perTool: readonly BoardToolCount[]
  sincePlan: number
  noteAt: number | null
  clocks: Readonly<Partial<Record<string, BoardTaskClock>>>
}

export type BoardAgentActivity = { id: string; calls: number; last: BoardToolSight }

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
      agentList: StateFamily<BoardList>
      agentIds: readonly string[]
      expanded: readonly string[]
      activity: BoardActivity
      agentActivity: readonly BoardAgentActivity[]
      rows: StateFamily<BoardCallRow>
      ready: { root: string }
    }
  }
}
