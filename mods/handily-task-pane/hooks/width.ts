const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u

const DOUBLE_WIDTH =
  /^[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]$/u

function cellsOf(character: string): number {
  if (ZERO_WIDTH.test(character)) return 0
  return DOUBLE_WIDTH.test(character) ? 2 : 1
}

export function displayWidth(text: string): number {
  let width = 0
  for (const character of text) width += cellsOf(character)
  return width
}

export function cutToWidth(text: string, width: number): string {
  let kept = ''
  let used = 0
  for (const character of text) {
    const cells = cellsOf(character)
    if (used + cells > width) break
    kept += character
    used += cells
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
