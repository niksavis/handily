import {
  DEFAULT_PALETTE,
  PALETTE_LOOKS,
  PALETTE_ROLES,
  drawnPalette,
  isPaletteSetting,
  themeShadeOf,
  type PaletteSetting,
} from './palette'

export const PALETTE_ARGUMENT = 'palette'

export type PaletteReport = {
  setting: PaletteSetting
  stored: unknown
  theme: string | undefined
}

const ROLE_COLUMNS = 17
const KEY_COLUMNS = 13
const SETTING_PLACE = '/config › handily'
const MOCHA: PaletteSetting = 'catppuccin-mocha'
const UNREAD_THEME = 'not read'
const STATES_LINE = 'States (done, failed, waits, git letters) keep the theme keys.'
const CREDIT_LINE = 'Palette colours from Catppuccin Mocha (MIT).'

function settingText(report: PaletteReport): string {
  const { setting, stored } = report
  if (stored !== undefined && !isPaletteSetting(stored)) {
    return `Palette: ${setting}. The stored value ${JSON.stringify(stored)} is not theme or ${MOCHA}, so ${setting} draws. Set Palette in ${SETTING_PLACE}.`
  }
  const how = stored === undefined && setting === DEFAULT_PALETTE ? 'the default' : 'stored'
  return `Palette: ${setting} (${how}).`
}

function themeText(report: PaletteReport): string {
  const name = report.theme ?? UNREAD_THEME
  if (report.setting !== MOCHA) return `Theme: ${name}.`
  const shade = themeShadeOf(report.theme)
  if (drawnPalette(report.setting, shade) === MOCHA) return `Theme: ${name}, so it draws.`
  return `Theme: ${name}, so the theme colours draw; ${MOCHA} is for dark themes.`
}

function roleLines(): string[] {
  const header = `${'Role'.padEnd(ROLE_COLUMNS)}${'Theme key'.padEnd(KEY_COLUMNS)}${MOCHA}`
  return [
    header,
    ...PALETTE_ROLES.map((role) => {
      const look = PALETTE_LOOKS[role]
      return `${look.label.padEnd(ROLE_COLUMNS)}${look.key.padEnd(KEY_COLUMNS)}${look.mocha}`
    }),
  ]
}

export function paletteReplyText(report: PaletteReport): string {
  return [
    `${settingText(report)} ${themeText(report)}`,
    ...roleLines(),
    STATES_LINE,
    CREDIT_LINE,
  ].join('\n')
}
