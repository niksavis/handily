import type { ConfigRow, ConfigSetInput, EngineInterface, RenderSurface } from 'claude-code'
import {
  DEFAULT_PALETTE,
  type PaletteSetting,
  drawnPalette,
  isPaletteRow,
  isThemeKey,
  paletteSettingOf,
  themeNameOf,
  themeShadeOf,
} from './palette'

const PALETTE = { plugin: 'handily-board', key: 'palette' } as const

function settingIn($: EngineInterface, rows: readonly ConfigRow[]): PaletteSetting {
  try {
    return paletteSettingOf(rows)
  } catch (error) {
    $.ui.log(error instanceof Error ? error.message : String(error), { to: 'debug' })
    return DEFAULT_PALETTE
  }
}

async function paletteNow($: EngineInterface): Promise<PaletteSetting> {
  try {
    const rows = await $.config.list()
    return drawnPalette(settingIn($, rows), themeShadeOf(themeNameOf(rows)))
  } catch (error) {
    $.ui.log(`handily-board: the palette was not read: ${String(error)}`, { to: 'debug' })
    return DEFAULT_PALETTE
  }
}

export async function keepPaletteSetting($: EngineInterface): Promise<void> {
  await $.state.set(PALETTE, await paletteNow($))
}

export async function keepChangedPaletteSetting(
  $: EngineInterface,
  e: ConfigSetInput,
): Promise<boolean> {
  if (!isThemeKey(e.key) && !isPaletteRow(e)) return false
  await keepPaletteSetting($)
  return true
}

export async function shownPalette(
  $: EngineInterface,
  surface: RenderSurface,
): Promise<PaletteSetting> {
  if (surface !== 'terminal') return DEFAULT_PALETTE
  try {
    return (await $.state.get(PALETTE)).value ?? DEFAULT_PALETTE
  } catch (error) {
    $.ui.log(`handily-board: the palette was not read: ${String(error)}`, { to: 'debug' })
    return DEFAULT_PALETTE
  }
}
