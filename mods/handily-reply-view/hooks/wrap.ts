import { displayWidth, graphemesOf } from './width'

export type Measure = {
  widthOf: (text: string) => number
  piecesOf: (word: string, columns: number) => string[]
}

export type Wrapped = { rows: string[]; count: number }

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

function slicedWord(word: string, columns: number): string[] {
  if (columns < 1) return [word]
  const pieces: string[] = []
  for (let start = 0; start < word.length; start += columns) {
    pieces.push(word.slice(start, start + columns))
  }
  return pieces
}

export const CELLS: Measure = { widthOf: displayWidth, piecesOf: brokenWord }

export const ASCII_CELLS: Measure = { widthOf: (text) => text.length, piecesOf: slicedWord }

export function wrappedRows(
  line: string,
  columns: number,
  measure: Measure,
  kept: number,
): Wrapped {
  const rows: string[] = []
  let count = 0
  const close = (row: string) => {
    if (rows.length < kept) rows.push(row)
    count += 1
  }
  let current = ''
  let isEmpty = true
  let used = 0
  for (const word of line.split(' ')) {
    const width = measure.widthOf(word)
    const joined = isEmpty ? width : used + 1 + width
    if (joined <= columns) {
      if (rows.length < kept) current = isEmpty ? word : `${current} ${word}`
      isEmpty = isEmpty && word === ''
      used = joined
      continue
    }
    if (!isEmpty) close(current)
    const pieces = width > columns ? measure.piecesOf(word, columns) : [word]
    for (const piece of pieces.slice(0, -1)) close(piece)
    current = pieces.at(-1) ?? ''
    isEmpty = current === ''
    used = measure.widthOf(current)
  }
  close(current)
  return { rows, count }
}

export function wrappedAtWords(line: string, columns: number): string[] {
  return wrappedRows(line, columns, CELLS, Number.POSITIVE_INFINITY).rows
}
