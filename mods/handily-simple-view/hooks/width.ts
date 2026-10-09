const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]/u

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u

const EMOJI_BY_SELECTOR = /^\p{Emoji}.*\uFE0F/u

const EAST_ASIAN_WIDE =
  /^[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦\u{16FE0}-\u{18CFF}\u{1B000}-\u{1B2FF}\u{1F200}-\u{1F2FF}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]/u

export function isEmoji(grapheme: string): boolean {
  return EMOJI_PRESENTATION.test(grapheme) || EMOJI_BY_SELECTOR.test(grapheme)
}

function cellsOf(grapheme: string): number {
  if (isEmoji(grapheme)) return 2
  if (ZERO_WIDTH.test(grapheme)) return 0
  return EAST_ASIAN_WIDE.test(grapheme) ? 2 : 1
}

export function graphemesOf(text: string): { grapheme: string; cells: number }[] {
  return Array.from(GRAPHEMES.segment(text), ({ segment }) => ({
    grapheme: segment,
    cells: cellsOf(segment),
  }))
}
