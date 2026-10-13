import type { ThemeKey } from 'claude-code'

export type Signal = 'doing' | 'done' | 'toDo' | 'blocked' | 'waitsForYou'

export type SignalLook = { mark: string; color: ThemeKey }

export const SIGNALS: Readonly<Record<Signal, SignalLook>> = {
  doing: { mark: '▶', color: 'claude' },
  done: { mark: '✓', color: 'success' },
  toDo: { mark: '○', color: 'subtle' },
  blocked: { mark: '■', color: 'error' },
  waitsForYou: { mark: '◆', color: 'warning' },
}
