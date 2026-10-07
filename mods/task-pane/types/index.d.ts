export type TaskPaneStatus = 'pending' | 'in_progress' | 'completed'

export type TaskPaneAuthor = 'model' | 'person'

export type TaskPaneTask = {
  id: number
  title: string
  status: TaskPaneStatus
  by: TaskPaneAuthor
  item: string | null
}

export type TaskPaneList = {
  tasks: readonly TaskPaneTask[]
  nextId: number
}

declare module 'claude-code' {
  interface PluginState {
    'task-pane': { list: TaskPaneList }
  }
}
