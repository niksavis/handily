import type { ConfigSetInput, EngineInterface, RenderSurface } from 'claude-code'
import { DEFAULT_GLYPHS, GLYPH_SETS, type GlyphSet, type GlyphSetting } from './glyphs'
import { changedGlyphSetting, glyphSettingNow, showToast, type ToastParts } from './toast'

const GLYPHS = { plugin: 'handily-reply-view', key: 'glyphs' } as const

const SETTING_SURFACE: RenderSurface = 'terminal'

async function glyphsOf($: EngineInterface): Promise<GlyphSetting> {
  return (await $.state.get(GLYPHS)).value ?? DEFAULT_GLYPHS
}

export async function paneGlyphs($: EngineInterface, surface: RenderSurface): Promise<GlyphSet> {
  if (surface !== SETTING_SURFACE) return GLYPH_SETS.plain
  return GLYPH_SETS[await glyphsOf($)]
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
      $.ui.log(`handily-reply-view: the glyph setting was not read: ${String(error)}`)
      showToast($, parts, DEFAULT_GLYPHS)
    },
  )
}
