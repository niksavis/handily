export type ReplyViewMode = 'on' | 'off'

export type ReplyViewGlyphs = 'plain' | 'nerd'

export type ReplyViewFold = 'folded' | 'open'

export type ReplyViewPalette = 'theme' | 'catppuccin-mocha'

declare module 'claude-code' {
  interface PluginState {
    'handily-reply-view': {
      mode: ReplyViewMode
      railVersion: number
      hints: ReplyViewMode
      folds: StateFamily<ReplyViewFold>
      submittedAt: StateFamily<number>
      endedAt: StateFamily<number>
      showsTurnDuration: boolean
      ready: { root: string }
      glyphs: ReplyViewGlyphs
      palette: ReplyViewPalette
    }
  }
}
