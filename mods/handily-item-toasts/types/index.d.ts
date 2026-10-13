export type ItemToastsHealth = 'ok' | 'failed'

export type ItemToastsMode = 'on' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'handily-item-toasts': {
      mode: ItemToastsMode
      announced: ItemToastsHealth
      lastToastAt: number
      ready: { root: string }
    }
  }
}
