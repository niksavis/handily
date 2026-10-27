const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u

const EAST_ASIAN_WIDE =
  /^[\u{1100}-\u{115F}\u{2E80}-\u{303E}\u{3041}-\u{33FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{A000}-\u{A4CF}\u{A960}-\u{A97F}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE10}-\u{FE19}\u{FE30}-\u{FE6F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{16FE0}-\u{18CFF}\u{1B000}-\u{1B2FF}\u{1F200}-\u{1F2FF}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]$/u

const EMOJI = /\p{Emoji_Presentation}|\p{Emoji}\u{FE0F}/u

function graphemesOf(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment)
}

function isEmoji(grapheme: string): boolean {
  return EMOJI.test(grapheme)
}

function columnsOfCharacter(character: string): number {
  if (ZERO_WIDTH.test(character)) return 0
  return EAST_ASIAN_WIDE.test(character) ? 2 : 1
}

function columnsOf(grapheme: string): number {
  if (isEmoji(grapheme)) return 2
  return Array.from(grapheme).reduce(
    (widest, character) => Math.max(widest, columnsOfCharacter(character)),
    0,
  )
}

export function displayWidth(text: string): number {
  let width = 0
  for (const grapheme of graphemesOf(text)) width += columnsOf(grapheme)
  return width
}

export function cutToWidth(text: string, width: number): string {
  let kept = ''
  let used = 0
  for (const grapheme of graphemesOf(text)) {
    const columns = columnsOf(grapheme)
    if (used + columns > width) break
    kept += grapheme
    used += columns
  }
  return kept
}

export function lastToWidth(text: string, width: number): string {
  let kept = ''
  let used = 0
  for (const grapheme of graphemesOf(text).reverse()) {
    const columns = columnsOf(grapheme)
    if (used + columns > width) break
    kept = grapheme + kept
    used += columns
  }
  return kept
}

const CUT_MARK = '…'

export function fitted(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  return `${cutToWidth(text, Math.max(width - displayWidth(CUT_MARK), 0))}${CUT_MARK}`
}

export function padToWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(width - displayWidth(text), 0))
}
