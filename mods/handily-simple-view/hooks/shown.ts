import { displayWidth, graphemesOf, isEmoji } from './width'

const TAB_STOP = 8
// eslint-disable-next-line no-control-regex -- an ANSI colour code starts with the escape character
const COLOR_CODE = /\u001b\[[0-9;:]*m/g
const HIDDEN_CHARACTER = /(?!\t)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const EMOJI_JOINER = /^[\u200D\u{E0020}-\u{E007F}]$/u

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

function shownGrapheme(grapheme: string): string {
  const keepsJoiners = isEmoji(grapheme)
  return grapheme.replace(HIDDEN_CHARACTER, (found) =>
    keepsJoiners && EMOJI_JOINER.test(found) ? found : escapedUnits(found),
  )
}

export function shownText(text: string): string {
  return graphemesOf(text)
    .map(({ grapheme }) => shownGrapheme(grapheme))
    .join('')
}

function shownWithTabs(line: string): string {
  let shown = ''
  let column = 0
  for (const { grapheme, cells } of graphemesOf(line)) {
    if (grapheme === '\t') {
      const tabCells = TAB_STOP - (column % TAB_STOP)
      shown += ' '.repeat(tabCells)
      column += tabCells
      continue
    }
    const drawn = shownGrapheme(grapheme)
    shown += drawn
    column += drawn === grapheme ? cells : displayWidth(drawn)
  }
  return shown
}

export function shownLine(line: string): string {
  const overwritten = line.replace(COLOR_CODE, '').split('\r').at(-1) ?? ''
  return shownWithTabs(overwritten)
}
