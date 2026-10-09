const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u

const DOUBLE_WIDTH =
  /^[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]$/u

const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function graphemesOf(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment)
}

export function isEmoji(grapheme: string): boolean {
  return EMOJI.test(grapheme)
}

function columnsOfCharacter(character: string): number {
  if (ZERO_WIDTH.test(character)) return 0
  return DOUBLE_WIDTH.test(character) ? 2 : 1
}

function columnsOf(grapheme: string): number {
  if (isEmoji(grapheme)) return 2
  return Math.max(0, ...Array.from(grapheme, columnsOfCharacter))
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

export function padToWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(width - displayWidth(text), 0))
}
