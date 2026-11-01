export type FiletreePaths = readonly string[]

export type FiletreeView = 'work' | 'all'

export type FiletreeGlyphs = 'plain' | 'nerd'

export type FiletreeColumn = 'changes' | 'date' | 'size' | 'lines'

declare module 'claude-code' {
  interface PluginState {
    'handily-filetree': {
      open: FiletreePaths
      whole: FiletreePaths
      shut: FiletreePaths
      workWhole: FiletreePaths
      view: FiletreeView
      column: FiletreeColumn
      ready: { root: string }
      glyphs: FiletreeGlyphs
    }
  }
}
