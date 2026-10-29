import type { ConfigRow } from 'claude-code'

export type GlyphSetting = 'plain' | 'nerd'

export type GlyphRole =
  | 'doing'
  | 'done'
  | 'toDo'
  | 'blocked'
  | 'waitsForYou'
  | 'edited'
  | 'read'
  | 'folderClosed'
  | 'folderOpen'
  | 'branch'

export type GlyphSet = Readonly<Record<GlyphRole, string>>

export const GLYPH_SETS: Readonly<Record<GlyphSetting, GlyphSet>> = {
  plain: {
    doing: '▶',
    done: '✓',
    toDo: '○',
    blocked: '■',
    waitsForYou: '◆',
    edited: '✎',
    read: '◦',
    folderClosed: '▸',
    folderOpen: '▾',
    branch: '·',
  },
  nerd: {
    doing: '\u{EB2C}',
    done: '\u{EAB2}',
    toDo: '\u{EBB5}',
    blocked: '\u{EA87}',
    waitsForYou: '\u{EAA2}',
    edited: '\u{EA73}',
    read: '\u{EA70}',
    folderClosed: '\u{F07B}',
    folderOpen: '\u{F07C}',
    branch: '\u{F418}',
  },
}

export const NERD_NAMES: Readonly<Record<GlyphRole, string>> = {
  doing: 'nf-cod-play',
  done: 'nf-cod-check',
  toDo: 'nf-cod-circle_large',
  blocked: 'nf-cod-error',
  waitsForYou: 'nf-cod-bell',
  edited: 'nf-cod-edit',
  read: 'nf-cod-eye',
  folderClosed: 'nf-fa-folder',
  folderOpen: 'nf-fa-folder_open',
  branch: 'nf-oct-git_branch',
}

export const GLYPH_ROLES = Object.keys(NERD_NAMES) as readonly GlyphRole[]

export const DEFAULT_GLYPHS: GlyphSetting = 'plain'

const SETTING_PLUGIN = 'handily'

const SETTING_KEY_SUFFIX = '.glyphs'

export function withoutMarketplace(pluginId: string): string {
  return pluginId.replace(/@.*$/, '')
}

export function isGlyphSetting(value: unknown): value is GlyphSetting {
  return value === 'plain' || value === 'nerd'
}

export function isGlyphSettingOwner(pluginId: string): boolean {
  return withoutMarketplace(pluginId) === SETTING_PLUGIN
}

export function glyphRowOf(rows: readonly ConfigRow[]): ConfigRow | undefined {
  return rows.find(
    (row) => isGlyphSettingOwner(row.provider.plugin) && row.key.endsWith(SETTING_KEY_SUFFIX),
  )
}

export function glyphSettingOf(rows: readonly ConfigRow[]): GlyphSetting {
  const row = glyphRowOf(rows)
  if (row === undefined) return DEFAULT_GLYPHS
  if (isGlyphSetting(row.value)) return row.value
  throw new Error(
    `handily: userConfig glyphs is ${JSON.stringify(row.value)}; set it to plain or nerd in /config.`,
  )
}
