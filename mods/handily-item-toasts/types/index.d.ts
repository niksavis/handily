export type ItemToastsHealth = 'ok' | 'failed'

export type ItemToastsMode = 'on' | 'off'

export type ItemToastsGlyphs = 'plain' | 'nerd'

declare module 'claude-code' {
  interface PluginState {
    'handily-item-toasts': {
      mode: ItemToastsMode
      announced: ItemToastsHealth
      lastToastAt: number
      glyphs: ItemToastsGlyphs
      ready: { root: string }
    }
  }
}
