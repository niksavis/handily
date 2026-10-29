export type FiletreePaths = readonly string[]

export type FiletreeView = 'work' | 'all'

export type FiletreeGlyphs = 'plain' | 'nerd'

declare module 'claude-code' {
  interface PluginState {
    'handily-filetree': {
      open: FiletreePaths
      whole: FiletreePaths
      shut: FiletreePaths
      workWhole: FiletreePaths
      view: FiletreeView
      ready: { root: string }
      glyphs: FiletreeGlyphs
    }
  }
}
