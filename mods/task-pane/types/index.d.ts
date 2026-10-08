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

declare module 'claude-code' {
  interface PluginState {
    'task-pane': { list: TaskPaneList }
  }
}
