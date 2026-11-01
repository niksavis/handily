import type { ConfigSetInput, EngineInterface, RenderSurface } from 'claude-code'
import { DEFAULT_GLYPHS, type GlyphSetting } from './glyphs'
import { changedGlyphSetting, glyphSettingNow, showToast, type ToastParts } from './toast'

const GLYPHS = { plugin: 'handily-filetree', key: 'glyphs' } as const

const SETTING_SURFACE: RenderSurface = 'terminal'

const OTHER_SURFACE_GLYPHS: GlyphSetting = 'plain'

async function glyphsOf($: EngineInterface): Promise<GlyphSetting> {
  return (await $.state.get(GLYPHS)).value ?? DEFAULT_GLYPHS
}

export async function paneGlyphSetting(
  $: EngineInterface,
  surface: RenderSurface,
): Promise<GlyphSetting> {
  if (surface !== SETTING_SURFACE) return OTHER_SURFACE_GLYPHS
  return glyphsOf($)
}

export async function keepGlyphSetting($: EngineInterface): Promise<void> {
  await $.state.set(GLYPHS, await glyphSettingNow($))
}

export async function keepChangedGlyphSetting(
  $: EngineInterface,
  e: ConfigSetInput,
): Promise<void> {
  const glyphs = await changedGlyphSetting($, e)
  if (glyphs !== undefined) await $.state.set(GLYPHS, glyphs)
}

export function showGlyphToast($: EngineInterface, parts: ToastParts): void {
  glyphsOf($).then(
    (glyphs) => {
      showToast($, parts, glyphs)
    },
    (error: unknown) => {
      $.ui.log(`handily-filetree: the glyph setting was not read: ${String(error)}`)
      showToast($, parts, DEFAULT_GLYPHS)
    },
  )
}
