import type { ConfigSetInput, EngineInterface, RenderSurface } from 'claude-code'
import { DEFAULT_GLYPHS, GLYPH_SETS, type GlyphSetting } from './glyphs'
import { type SignalLooks, signalLooks } from './signals'
import { changedGlyphSetting, glyphSettingNow, showToast, type ToastParts } from './toast'

const GLYPHS = { plugin: 'handily-board', key: 'glyphs' } as const
const PLAIN_GLYPHS: GlyphSetting = 'plain'

export const PLAIN_SIGNALS: SignalLooks = signalLooks(GLYPH_SETS[PLAIN_GLYPHS])

async function glyphsOf($: EngineInterface): Promise<GlyphSetting> {
  return (await $.state.get(GLYPHS)).value ?? DEFAULT_GLYPHS
}

async function keptGlyphs($: EngineInterface): Promise<GlyphSetting> {
  try {
    return await glyphsOf($)
  } catch (error) {
    $.ui.log(`handily-board: the glyph setting was not read: ${String(error)}`)
    return DEFAULT_GLYPHS
  }
}

export async function keepGlyphSetting($: EngineInterface): Promise<void> {
  await $.state.set(GLYPHS, await glyphSettingNow($))
}

export async function keepChangedGlyphSetting(
  $: EngineInterface,
  e: ConfigSetInput,
): Promise<boolean> {
  const glyphs = await changedGlyphSetting($, e)
  if (glyphs === undefined) return false
  await $.state.set(GLYPHS, glyphs)
  return true
}

export function showGlyphToast($: EngineInterface, parts: ToastParts): void {
  void keptGlyphs($).then((glyphs) => {
    showToast($, parts, glyphs)
  })
}

async function signalsWhere($: EngineInterface, hasTerminal: boolean): Promise<SignalLooks> {
  if (!hasTerminal) return PLAIN_SIGNALS
  return signalLooks(GLYPH_SETS[await keptGlyphs($)])
}

export async function drawnSignals(
  $: EngineInterface,
  surface: RenderSurface,
): Promise<SignalLooks> {
  return signalsWhere($, surface === 'terminal')
}

export async function sessionSignals($: EngineInterface): Promise<SignalLooks> {
  return signalsWhere($, (await $.session.surfaces()).includes('terminal'))
}
