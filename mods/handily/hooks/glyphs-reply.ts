import {
  GLYPH_ROLES,
  GLYPH_SETS,
  isGlyphSetting,
  NERD_NAMES,
  type GlyphRole,
  type GlyphSetting,
} from './glyphs'

export const GLYPHS_ARGUMENT = 'glyphs'

export type GlyphsReport = { setting: GlyphSetting; refused: unknown }

const ROLE_LABELS: Readonly<Record<GlyphRole, string>> = {
  doing: 'doing',
  done: 'done',
  toDo: 'to do',
  blocked: 'blocked',
  waitsForYou: 'needs you',
  edited: 'edited',
  read: 'read',
  folderClosed: 'folder',
  folderOpen: 'open',
  branch: 'branch',
}

const LABEL_COLUMNS = 10

const SETTING_PLACE = '/config › handily'

const PLAIN_TEST_LINES = [
  'The nerd column is a test: when each icon fills one cell between its bars, Glyphs nerd is safe in this terminal.',
]

const NERD_TEST_LINES = [
  'Each mark fills one cell between bars.',
  'A box, a ? or a moved bar: this terminal has no Nerd Font Mono. Set Glyphs to plain in /config.',
]

function fieldOf(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if (!Object.hasOwn(value, field)) return undefined
  return (value as Record<string, unknown>)[field]
}

export function storedGlyphsOf(pluginConfigs: unknown, rowPluginId: string): unknown {
  return fieldOf(fieldOf(fieldOf(pluginConfigs, rowPluginId), 'options'), 'glyphs')
}

export function refusedGlyphsOf(stored: unknown): unknown {
  return stored === undefined || isGlyphSetting(stored) ? undefined : stored
}

function headline({ setting, refused }: GlyphsReport): string {
  if (refused !== undefined) {
    return `Glyphs ${setting} · the stored value ${JSON.stringify(refused)} is not plain or nerd, so ${setting} draws. Set Glyphs in ${SETTING_PLACE}.`
  }
  const defaultNote = setting === 'plain' ? ' (the default)' : ''
  return `Glyphs ${setting}${defaultNote} · set in ${SETTING_PLACE}`
}

function roleLines(): string[] {
  const header = `${'role'.padEnd(LABEL_COLUMNS)}plain nerd`
  return [
    header,
    ...GLYPH_ROLES.map(
      (role) =>
        `${ROLE_LABELS[role].padEnd(LABEL_COLUMNS)}|${GLYPH_SETS.plain[role]}|   |${GLYPH_SETS.nerd[role]}| ${NERD_NAMES[role]}`,
    ),
  ]
}

export function glyphsReplyText(report: GlyphsReport): string {
  const testLines = report.setting === 'nerd' ? NERD_TEST_LINES : PLAIN_TEST_LINES
  return [headline(report), ...roleLines(), ...testLines].join('\n')
}

export function argumentRefusal(args: string): string {
  return `/handily takes no argument or ${GLYPHS_ARGUMENT}; ${JSON.stringify(args)} is neither.`
}
