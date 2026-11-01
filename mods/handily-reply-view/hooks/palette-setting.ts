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

const PALETTE = { plugin: 'handily-reply-view', key: 'palette' } as const

const PALETTE_SURFACE: RenderSurface = 'terminal'

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
    $.ui.log(`handily-reply-view: the palette was not read: ${String(error)}`, { to: 'debug' })
    return DEFAULT_PALETTE
  }
}

export async function keepPaletteSetting($: EngineInterface): Promise<void> {
  await $.state.set(PALETTE, await paletteNow($))
}

export async function keepChangedPaletteSetting(
  $: EngineInterface,
  e: ConfigSetInput,
): Promise<void> {
  if (isThemeKey(e.key) || isPaletteRow(e)) await keepPaletteSetting($)
}

export async function shownPalette(
  $: EngineInterface,
  surface: RenderSurface,
): Promise<PaletteSetting> {
  if (surface !== PALETTE_SURFACE) return DEFAULT_PALETTE
  try {
    return (await $.state.get(PALETTE)).value ?? DEFAULT_PALETTE
  } catch (error) {
    $.ui.log(`handily-reply-view: the palette was not read: ${String(error)}`, { to: 'debug' })
    return DEFAULT_PALETTE
  }
}
