export type HandilyModState = 'loaded' | 'disabled' | 'not installed' | 'not loaded'

export type HandilyModStatus = {
  name: string
  version: string | null
  state: HandilyModState
  detail: string
}

declare module 'claude-code' {
  interface PluginState {
    handily: { reports: StateFamily<readonly HandilyModStatus[]> }
  }
}
