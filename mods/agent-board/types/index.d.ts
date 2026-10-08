export type AgentBoardReady = { root: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-board': { ready: AgentBoardReady }
  }
}
