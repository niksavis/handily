export type TaskPaneStatus = 'pending' | 'in_progress' | 'completed'

export type TaskPaneAuthor = 'model' | 'person' | 'tracker'

export type TaskPaneSource =
  { by: Exclude<TaskPaneAuthor, 'tracker'>; item: null } | { by: 'tracker'; item: string }

export type TaskPaneTask = {
  id: number
  title: string
  status: TaskPaneStatus
} & TaskPaneSource

export type TaskPaneList = {
  tasks: readonly TaskPaneTask[]
  nextId: number
}

export type TaskPaneToolSight = { tool: string; target: string | null }

export type TaskPaneToolCount = { tool: string; calls: number }

export type TaskPaneTaskClock = {
  startedAt: number
  startCalls: number
  endedAt: number | null
  endCalls: number | null
}

export type TaskPaneActivity = {
  calls: number
  firstAt: number | null
  last: TaskPaneToolSight | null
  perTool: readonly TaskPaneToolCount[]
  sincePlan: number
  noteAt: number | null
  clocks: Readonly<Partial<Record<string, TaskPaneTaskClock>>>
}

export type TaskPaneAgentActivity = { id: string; calls: number; last: TaskPaneToolSight }

declare module 'claude-code' {
  interface PluginState {
    'task-pane': {
      list: TaskPaneList
      agentList: StateFamily<TaskPaneList>
      agentIds: readonly string[]
      expanded: readonly string[]
      activity: TaskPaneActivity
      agentActivity: readonly TaskPaneAgentActivity[]
      ready: { root: string }
    }
  }
}
