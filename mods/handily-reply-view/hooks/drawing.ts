import { displayWidth } from './width'

const PLAIN_TAGS: ReadonlySet<string> = new Set(['', 'text', 'txt', 'plaintext', 'ascii', 'none'])
const DRAWING_MARKS: readonly RegExp[] = [
  /[─-╿]/,
  /\+[-=]+\+/,
  /^[\s|]*[|`\\][-=]{2,}\s/,
  /-{2,}>|<-{2,}/,
  /^\s*\|.*\|\s*$/,
]
const LEAST_DRAWING_LINES = 2

function languageOf(tag: string): string {
  return (tag.trim().split(/\s+/)[0] ?? '').toLowerCase()
}

export function isDrawingLine(line: string): boolean {
  return DRAWING_MARKS.some((mark) => mark.test(line))
}

export function isCutDrawing(tag: string, lines: readonly string[], width: number): boolean {
  if (!PLAIN_TAGS.has(languageOf(tag))) return false
  const drawn = lines.map(isDrawingLine)
  if (drawn.filter(Boolean).length < LEAST_DRAWING_LINES) return false
  const wide = lines.flatMap((line, at) => (displayWidth(line) > width ? [at] : []))
  return (
    wide.length > 0 &&
    wide.every((at) => drawn[at] === true || (drawn[at - 1] === true && drawn[at + 1] === true))
  )
}
