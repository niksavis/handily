export type HandilyModState = 'loaded' | 'disabled' | 'not installed' | 'not loaded'

export type HandilyModStatus = {
  name: string
  version: string | null
  state: HandilyModState
  detail: string
}

export type HandilyOldIdScope = 'user' | 'project' | 'local'

export type HandilyOldId = {
  id: string
  scope: HandilyOldIdScope
  detail: string
}

export type HandilyReport = {
  mods: readonly HandilyModStatus[]
  oldIds: readonly HandilyOldId[]
}

declare module 'claude-code' {
  interface PluginState {
    handily: { reports: StateFamily<HandilyReport> }
  }
}
