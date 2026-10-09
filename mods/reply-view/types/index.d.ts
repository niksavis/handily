export type ReplyViewMode = 'on' | 'off'

export type ReplyViewFold = 'folded' | 'open'

declare module 'claude-code' {
  interface PluginState {
    'reply-view': {
      mode: ReplyViewMode
      folds: StateFamily<ReplyViewFold>
      ready: { root: string }
    }
  }
}
