export type ItemToastsHealth = 'ok' | 'failed'

declare module 'claude-code' {
  interface PluginState {
    'handily-item-toasts': {
      announced: ItemToastsHealth
      lastToastAt: number
      ready: { root: string }
    }
  }
}
