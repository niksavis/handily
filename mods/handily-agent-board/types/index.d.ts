export type AgentBoardReady = { root: string }

declare module 'claude-code' {
  interface PluginState {
    'handily-agent-board': { ready: AgentBoardReady }
  }
}
