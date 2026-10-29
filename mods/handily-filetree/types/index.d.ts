export type FiletreePaths = readonly string[]

export type FiletreeView = 'work' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'handily-filetree': {
      open: FiletreePaths
      whole: FiletreePaths
      shut: FiletreePaths
      view: FiletreeView
      ready: { root: string }
    }
  }
}
