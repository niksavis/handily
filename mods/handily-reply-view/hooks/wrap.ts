import { displayWidth, graphemesOf } from './width'

function brokenWord(word: string, columns: number): string[] {
  const graphemes = graphemesOf(word)
  const pieces: string[] = []
  let piece = ''
  let used = 0
  for (const [index, grapheme] of graphemes.entries()) {
    const width = displayWidth(grapheme)
    if (used + width > columns) {
      if (piece === '') return [...pieces, graphemes.slice(index).join('')]
      pieces.push(piece)
      piece = ''
      used = 0
    }
    piece += grapheme
    used += width
  }
  return [...pieces, piece]
}

export function wrappedAtWords(line: string, columns: number): string[] {
  const lines: string[] = []
  let current = ''
  let used = 0
  for (const word of line.split(' ')) {
    const width = displayWidth(word)
    const joined = current === '' ? width : used + 1 + width
    if (joined <= columns) {
      current = current === '' ? word : `${current} ${word}`
      used = joined
      continue
    }
    if (current !== '') lines.push(current)
    const pieces = width > columns ? brokenWord(word, columns) : [word]
    lines.push(...pieces.slice(0, -1))
    current = pieces.at(-1) ?? ''
    used = displayWidth(current)
  }
  return [...lines, current]
}
