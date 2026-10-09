export type SessionBoardReady = { root: string }

declare module 'claude-code' {
  interface PluginState {
    'handily-session-board': { ready: SessionBoardReady }
  }
}
