export type FiletreePaths = readonly string[]

declare module 'claude-code' {
  interface PluginState {
    'handily-filetree': {
      open: FiletreePaths
      whole: FiletreePaths
    }
  }
}
