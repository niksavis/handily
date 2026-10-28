export const SHOWN_LINES = 2000
export const SHOWN_CHARACTERS = 100_000
export const READ_LIMIT_BYTES = 4 * 1024 * 1024

const BINARY_PROBE = 8000
const KIB = 1024
const MIB = KIB * KIB
const NUL = '\0'
const CARRIAGE_RETURNS = /\r(?=\n|$)/g
const UNDRAWABLE = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu
const DRAWN_CONTROLS: ReadonlySet<string> = new Set(['\t', '\n'])
const MARKDOWN = /\.(?:md|markdown)$/i

export type Budget = { lines: number; characters: number }

export type SourceLines = { lines: readonly string[]; total: number }

export type ShownSource = { source: string; shownLines: number }

export function newBudget(characters: number): Budget {
  return { lines: SHOWN_LINES, characters: Math.min(characters, SHOWN_CHARACTERS) }
}

export function isBinary(text: string): boolean {
  return text.slice(0, BINARY_PROBE).includes(NUL)
}

export function isMarkdown(path: string): boolean {
  return MARKDOWN.test(path)
}

function escapedUnit(unit: string): string {
  if (DRAWN_CONTROLS.has(unit)) return unit
  return `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`
}

export function drawable(text: string): string {
  return text.replace(CARRIAGE_RETURNS, '').replace(UNDRAWABLE, escapedUnit)
}

export function linesOf(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

export function sizeText(bytes: number): string {
  if (bytes < KIB) return `${String(bytes)}B`
  if (bytes < MIB) return `${String(Math.round(bytes / KIB))}K`
  return `${String(Math.round(bytes / MIB))}M`
}

export function countText(count: number): string {
  return count.toLocaleString('en-US')
}

export function takenLines(lines: readonly string[], budget: Budget, prefix = ''): string[] {
  const taken: string[] = []
  for (const line of lines) {
    const characters = prefix.length + line.length + 1
    if (budget.lines <= 0 || characters > budget.characters) break
    taken.push(`${prefix}${line}`)
    budget.lines -= 1
    budget.characters -= characters
  }
  return taken
}

export function sourceLines(text: string): SourceLines {
  const lines = linesOf(drawable(text))
  return { lines: lines.slice(0, SHOWN_LINES), total: lines.length }
}

export function shownSource(source: SourceLines, budget: Budget): ShownSource {
  const taken = takenLines(source.lines, budget)
  const first = source.lines[0]
  if (taken.length === 0 && first !== undefined) {
    return { source: first.slice(0, Math.max(budget.characters, 0)), shownLines: 0 }
  }
  return { source: taken.join('\n'), shownLines: taken.length }
}

export function addedHunk(source: SourceLines, budget: Budget): ShownSource {
  const header = `@@ -0,0 +1,${String(source.total)} @@`
  budget.characters -= header.length + 1
  budget.lines -= 1
  const taken = takenLines(source.lines, budget, '+')
  const shownHeader = `@@ -0,0 +1,${String(taken.length)} @@`
  return {
    source: taken.length === 0 ? '' : [shownHeader, ...taken].join('\n'),
    shownLines: taken.length,
  }
}
