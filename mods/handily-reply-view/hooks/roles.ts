import type { Color, ThemeKey } from 'claude-code'
import { PALETTE_LOOKS, type PaletteRole, type PaletteSetting } from './palette'

export type ReplyRole =
  | 'heading'
  | 'minorHeading'
  | 'marker'
  | 'taskOpen'
  | 'taskDone'
  | 'quoteText'
  | 'alertNote'
  | 'alertTip'
  | 'alertImportant'
  | 'alertWarning'
  | 'alertCaution'
  | 'replyFrame'

export type RoleLook = { key?: ThemeKey; mocha?: string }

export const ROLE_LOOKS: Readonly<Record<ReplyRole, RoleLook>> = {
  heading: { key: 'claude', mocha: '#f9e2af' },
  minorHeading: { key: 'merged', mocha: '#cba6f7' },
  marker: { key: 'inactive', mocha: '#cba6f7' },
  taskOpen: { key: 'inactive', mocha: '#9399b2' },
  taskDone: { key: 'success' },
  quoteText: { mocha: '#a6adc8' },
  alertNote: { key: 'suggestion', mocha: '#89b4fa' },
  alertTip: { key: 'success' },
  alertImportant: { key: 'merged', mocha: '#cba6f7' },
  alertWarning: { key: 'warning' },
  alertCaution: { key: 'error' },
  replyFrame: { key: 'claude', mocha: '#fab387' },
}

const THEME_CYCLE_ROLES: readonly PaletteRole[] = [
  'diagramCycle1',
  'diagramCycle2',
  'diagramCycle3',
]

const MOCHA_CYCLE_MORE: readonly string[] = ['#fab387', '#94e2d5', '#f9e2af']

export const DIAGRAM_CYCLES: Readonly<Record<PaletteSetting, readonly Color[]>> = {
  theme: THEME_CYCLE_ROLES.map((role) => PALETTE_LOOKS[role].key),
  'catppuccin-mocha': [
    ...THEME_CYCLE_ROLES.map((role) => PALETTE_LOOKS[role].mocha),
    ...MOCHA_CYCLE_MORE,
  ],
}
