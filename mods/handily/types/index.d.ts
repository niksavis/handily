export type HandilyModState = 'loaded' | 'disabled' | 'not installed' | 'not loaded'

export type HandilyModMode = 'on' | 'off' | 'polling' | 'paused' | '-' | '?'

export type HandilyModStatus = {
  name: string
  version: string | null
  state: HandilyModState
  mode: HandilyModMode
  about: string | null
  action: string | null
}

export type HandilyOldIdScope = 'user' | 'project' | 'local'

export type HandilyOldId = {
  id: string
  scope: HandilyOldIdScope
  detail: string
  action: string
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
