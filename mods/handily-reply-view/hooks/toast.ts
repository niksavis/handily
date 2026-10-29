import type { ConfigRow, ConfigSetInput, EngineInterface } from 'claude-code'
import {
  DEFAULT_GLYPHS,
  GLYPH_SETS,
  glyphRowOf,
  glyphSettingOf,
  isGlyphSettingOwner,
  type GlyphRole,
  type GlyphSetting,
} from './glyphs'
import { displayWidth, fitted, padToWidth } from './width'

export const TOAST_COLUMNS = 40

export type ToastRole = Extract<GlyphRole, 'doing' | 'done' | 'toDo' | 'blocked' | 'waitsForYou'>

export type ToastMark = { readonly mark: ToastRole }

export type ToastLine = readonly (string | ToastMark)[]

export type ToastPart = string | ToastLine | { readonly quoted: string }

export type ToastParts = readonly [ToastPart, ...ToastPart[]]

const MOST_LINES = 3
const LINE_BREAK_ROOM = 1
const QUOTE = '"'
const CUT_MARK = '…'
const BASE_MS = 2000
const MS_PER_CELL = 80
const SHORTEST_MS = 6000
const LONGEST_MS = 15000
const SHORTEST_MS_TO_ACT = 10000
const ROLES_TO_ACT: readonly ToastRole[] = ['blocked', 'waitsForYou']
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const UNSAFE_IN_QUOTES = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

export function marked(role: ToastRole, text: string): ToastLine {
  return [{ mark: role }, ` ${text}`]
}

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

function escaped(grapheme: string): string {
  return JSON.stringify(grapheme).slice(1, -1).replace(UNSAFE_IN_QUOTES, escapedUnits)
}

function quotedToWidth(text: string, columns: number): string {
  const pieces = Array.from(GRAPHEMES.segment(text), (part) => escaped(part.segment))
  const room = columns - 2 * displayWidth(QUOTE)
  const whole = pieces.join('')
  if (displayWidth(whole) <= room) return `${QUOTE}${whole}${QUOTE}`
  let kept = ''
  for (const piece of pieces) {
    if (displayWidth(kept + piece) > room - displayWidth(CUT_MARK)) break
    kept += piece
  }
  return `${QUOTE}${kept.trimEnd()}${CUT_MARK}${QUOTE}`
}

function lineText(line: ToastLine, glyphs: GlyphSetting): string {
  return line
    .map((piece) => (typeof piece === 'string' ? piece : GLYPH_SETS[glyphs][piece.mark]))
    .join('')
}

function shownPart(part: ToastPart, columns: number, glyphs: GlyphSetting): string {
  if (typeof part === 'string') return fitted(part, columns)
  if ('quoted' in part) return quotedToWidth(part.quoted, columns)
  return fitted(lineText(part, glyphs), columns)
}

function shownParts(parts: ToastParts, glyphs: GlyphSetting): string[] {
  if (parts.length > MOST_LINES) {
    throw new Error(
      `a toast shows at most ${String(MOST_LINES)} lines; it got ${String(parts.length)} parts`,
    )
  }
  const last = parts.length - 1
  return parts.map((part, index) =>
    shownPart(part, index === last ? TOAST_COLUMNS : TOAST_COLUMNS - LINE_BREAK_ROOM, glyphs),
  )
}

export function toastText(parts: ToastParts, glyphs: GlyphSetting): string {
  const shown = shownParts(parts, glyphs)
  const last = shown.length - 1
  return shown
    .map((part, index) => (index === last ? part : padToWidth(part, TOAST_COLUMNS)))
    .join('')
}

function isToAct(parts: ToastParts): boolean {
  return parts.some(
    (part) =>
      typeof part !== 'string' &&
      !('quoted' in part) &&
      part.some((piece) => typeof piece !== 'string' && ROLES_TO_ACT.includes(piece.mark)),
  )
}

export function toastMs(parts: ToastParts, glyphs: GlyphSetting): number {
  const cells = shownParts(parts, glyphs).reduce((sum, part) => sum + displayWidth(part), 0)
  const ms = Math.min(Math.max(BASE_MS + MS_PER_CELL * cells, SHORTEST_MS), LONGEST_MS)
  return isToAct(parts) ? Math.max(ms, SHORTEST_MS_TO_ACT) : ms
}

export function showToast($: EngineInterface, parts: ToastParts, glyphs: GlyphSetting): void {
  $.ui.toast(toastText(parts, glyphs), { timeoutMs: toastMs(parts, glyphs) })
}

function logError($: EngineInterface, error: unknown): void {
  $.ui.log(error instanceof Error ? error.message : String(error), { to: 'debug' })
}

function logged($: EngineInterface, error: unknown): GlyphSetting {
  logError($, error)
  return DEFAULT_GLYPHS
}

function glyphSettingIn($: EngineInterface, rows: readonly ConfigRow[]): GlyphSetting {
  try {
    return glyphSettingOf(rows)
  } catch (error) {
    return logged($, error)
  }
}

async function configRows($: EngineInterface): Promise<readonly ConfigRow[] | Error> {
  try {
    return await $.config.list()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

export async function glyphSettingNow($: EngineInterface): Promise<GlyphSetting> {
  const rows = await configRows($)
  return rows instanceof Error ? logged($, rows) : glyphSettingIn($, rows)
}

export async function changedGlyphSetting(
  $: EngineInterface,
  e: ConfigSetInput,
): Promise<GlyphSetting | undefined> {
  if (!isGlyphSettingOwner(e.provider.plugin)) return undefined
  const rows = await configRows($)
  if (rows instanceof Error) {
    logError($, rows)
    return undefined
  }
  if (glyphRowOf(rows)?.key !== e.key) return undefined
  return glyphSettingIn($, rows)
}
