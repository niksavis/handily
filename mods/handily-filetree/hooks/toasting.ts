import type { ConfigSetInput, EngineInterface } from 'claude-code'
import { DEFAULT_GLYPHS, type GlyphSetting } from './glyphs'
import { changedGlyphSetting, glyphSettingNow, showToast, type ToastParts } from './toast'

const GLYPHS = { plugin: 'handily-filetree', key: 'glyphs' } as const

async function glyphsOf($: EngineInterface): Promise<GlyphSetting> {
  return (await $.state.get(GLYPHS)).value ?? DEFAULT_GLYPHS
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
