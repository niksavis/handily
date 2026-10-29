import type { ThemeKey } from 'claude-code'
import type { GlyphSet } from './glyphs'

export type Signal = 'doing' | 'done' | 'toDo' | 'blocked' | 'waitsForYou'

export type SignalLook = { mark: string; color: ThemeKey }

export type SignalLooks = Readonly<Record<Signal, SignalLook>>

export const SIGNALS: Readonly<Record<Signal, { color: ThemeKey }>> = {
  doing: { color: 'claude' },
  done: { color: 'success' },
  toDo: { color: 'subtle' },
  blocked: { color: 'error' },
  waitsForYou: { color: 'warning' },
}

function lookOf(signal: Signal, glyphs: GlyphSet): SignalLook {
  return { mark: glyphs[signal], color: SIGNALS[signal].color }
}

export function signalLooks(glyphs: GlyphSet): SignalLooks {
  return {
    doing: lookOf('doing', glyphs),
    done: lookOf('done', glyphs),
    toDo: lookOf('toDo', glyphs),
    blocked: lookOf('blocked', glyphs),
    waitsForYou: lookOf('waitsForYou', glyphs),
  }
}

export function needsYouText(count: number): string {
  return count === 1 ? '1 needs you' : `${String(count)} need you`
}
