import type { Color, ConfigRow, ThemeKey } from 'claude-code'

export type PaletteSetting = 'theme' | 'catppuccin-mocha'

export type ThemeShade = 'dark' | 'light' | 'unknown'

export type PaletteRole =
  | 'sessionFrame'
  | 'tasksFrame'
  | 'agentsFrame'
  | 'logFrame'
  | 'tableHeader'
  | 'rules'
  | 'number'
  | 'inlineCode'
  | 'path'
  | 'link'
  | 'diagramLine'
  | 'diagramHead'
  | 'diagramCycle1'
  | 'diagramCycle2'
  | 'diagramCycle3'
  | 'plainFolder'
  | 'codeIcon'
  | 'docsIcon'
  | 'otherIcon'

export type PaletteLook = { label: string; key: ThemeKey; mocha: string }

export const PALETTE_LOOKS: Readonly<Record<PaletteRole, PaletteLook>> = {
  sessionFrame: { label: 'session frame', key: 'claude', mocha: '#cba6f7' },
  tasksFrame: { label: 'tasks frame', key: 'planMode', mocha: '#89b4fa' },
  agentsFrame: { label: 'agents frame', key: 'merged', mocha: '#f5c2e7' },
  logFrame: { label: 'log frame', key: 'inactive', mocha: '#9399b2' },
  tableHeader: { label: 'table header', key: 'claude', mocha: '#f9e2af' },
  rules: { label: 'rules', key: 'subtle', mocha: '#585b70' },
  number: { label: 'number', key: 'planMode', mocha: '#a6e3a1' },
  inlineCode: { label: 'inline code', key: 'permission', mocha: '#89dceb' },
  path: { label: 'path', key: 'merged', mocha: '#cba6f7' },
  link: { label: 'link', key: 'suggestion', mocha: '#89b4fa' },
  diagramLine: { label: 'diagram line', key: 'inactive', mocha: '#9399b2' },
  diagramHead: { label: 'diagram head', key: 'claude', mocha: '#cba6f7' },
  diagramCycle1: { label: 'diagram cycle 1', key: 'suggestion', mocha: '#89b4fa' },
  diagramCycle2: { label: 'diagram cycle 2', key: 'planMode', mocha: '#a6e3a1' },
  diagramCycle3: { label: 'diagram cycle 3', key: 'merged', mocha: '#f5c2e7' },
  plainFolder: { label: 'plain folder', key: 'planMode', mocha: '#89b4fa' },
  codeIcon: { label: 'code icon', key: 'suggestion', mocha: '#89dceb' },
  docsIcon: { label: 'docs icon', key: 'merged', mocha: '#f5c2e7' },
  otherIcon: { label: 'other icon', key: 'inactive', mocha: '#9399b2' },
}

export const PALETTE_ROLES = Object.keys(PALETTE_LOOKS) as readonly PaletteRole[]

export const PALETTE_SETTINGS: readonly PaletteSetting[] = ['theme', 'catppuccin-mocha']

export const DEFAULT_PALETTE: PaletteSetting = 'theme'

const SETTING_PLUGIN = 'handily'

const SETTING_KEY_SUFFIX = '.palette'

const THEME_KEY = 'theme'

const DARK_THEME = /^dark(?:-|$)/

const LIGHT_THEME = /^light(?:-|$)/

function pluginNameOf(pluginId: string): string {
  return pluginId.replace(/@.*$/, '')
}

export function isPaletteSetting(value: unknown): value is PaletteSetting {
  return value === 'theme' || value === 'catppuccin-mocha'
}

export function isPaletteRow(row: Pick<ConfigRow, 'key' | 'provider'>): boolean {
  return (
    pluginNameOf(row.provider.plugin) === SETTING_PLUGIN && row.key.endsWith(SETTING_KEY_SUFFIX)
  )
}

export function isThemeKey(key: string): boolean {
  return key === THEME_KEY
}

export function paletteRowOf(rows: readonly ConfigRow[]): ConfigRow | undefined {
  return rows.find(isPaletteRow)
}

export function paletteSettingOf(rows: readonly ConfigRow[]): PaletteSetting {
  const row = paletteRowOf(rows)
  if (row === undefined) return DEFAULT_PALETTE
  if (isPaletteSetting(row.value)) return row.value
  throw new Error(
    `handily: userConfig palette is ${JSON.stringify(row.value)}; set it to theme or catppuccin-mocha in /config. Drawing theme.`,
  )
}

export function themeNameOf(rows: readonly ConfigRow[]): string | undefined {
  const value = rows.find((row) => isThemeKey(row.key))?.value
  return typeof value === 'string' ? value : undefined
}

export function themeShadeOf(name: string | undefined): ThemeShade {
  if (name === undefined) return 'unknown'
  if (DARK_THEME.test(name)) return 'dark'
  return LIGHT_THEME.test(name) ? 'light' : 'unknown'
}

export function drawnPalette(setting: PaletteSetting, shade: ThemeShade): PaletteSetting {
  return setting === 'catppuccin-mocha' && shade === 'dark' ? setting : DEFAULT_PALETTE
}

export function paletteColor(role: PaletteRole, drawn: PaletteSetting): Color {
  const look = PALETTE_LOOKS[role]
  return drawn === 'catppuccin-mocha' ? look.mocha : look.key
}
