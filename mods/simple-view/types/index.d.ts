export type SimpleViewMode = 'on' | 'off'

export type SimpleViewTiming = {
  startedAt: number
  elapsedMs: number
  isRunning: boolean
}

export type SimpleViewDiffGap = 'unreported' | 'untracked'

export type SimpleViewCall = {
  generation: number
  seq: number
  tool_use_id: string
  tool: string
  input: string
  output: string
  diff: string
  diffGap: SimpleViewDiffGap | null
  isErrored: boolean
  elapsedMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'simple-view': {
      mode: SimpleViewMode
      generation: number
      timing: StateFamily<SimpleViewTiming>
      count: number
      calls: StateFamily<SimpleViewCall>
      ready: { root: string }
    }
  }
}
