export type SessionBoardReady = { root: string }

declare module 'claude-code' {
  interface PluginState {
    'session-board': { ready: SessionBoardReady }
  }
}
