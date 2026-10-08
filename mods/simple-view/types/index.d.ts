export type SimpleViewMode = 'on' | 'off'

export type SimpleViewTiming = {
  startedAt: number
  elapsedMs: number
  isRunning: boolean
}

export type SimpleViewCall = {
  seq: number
  tool_use_id: string
  tool: string
  input: string
  output: string
  diff: string
  isErrored: boolean
  elapsedMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'simple-view': {
      mode: SimpleViewMode
      timing: StateFamily<SimpleViewTiming>
      count: number
      calls: StateFamily<SimpleViewCall>
    }
  }
}
