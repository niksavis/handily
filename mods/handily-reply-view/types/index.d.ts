export type ReplyViewMode = 'on' | 'off'

export type ReplyViewGlyphs = 'plain' | 'nerd'

export type ReplyViewFold = 'folded' | 'open'

declare module 'claude-code' {
  interface PluginState {
    'handily-reply-view': {
      mode: ReplyViewMode
      hints: ReplyViewMode
      folds: StateFamily<ReplyViewFold>
      submittedAt: StateFamily<number>
      ready: { root: string }
      glyphs: ReplyViewGlyphs
    }
  }
}
