import type { Mark, Run } from './markdown'

export type Token = 'number' | 'path'

export type TokenSpan = { start: number; end: number; token: Token }

const WORD = /\S+/g
const OPENERS = /^[(["']+/
const CLOSERS = /[,;:.)\]"'!?]+$/
const DIGITS = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`
const UNIT = '(?:ms|min|s|m|h|d)'
const PRE_RELEASE = String.raw`(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?`
const NUMBER = new RegExp(`^[+-]?${DIGITS}[%x]?$`)
const DURATION = new RegExp(`^(?:${DIGITS}${UNIT})+$`)
const CLOCK = /^\d{1,2}:\d{2}(?::\d{2})?$/
const VERSION = new RegExp(String.raw`^(?:v\d+(?:\.\d+)+|\d+(?:\.\d+){2,})${PRE_RELEASE}$`)
const RANGE = /^\d+(?:[-–]\d+)+$/
const NUMBER_SHAPES: readonly RegExp[] = [NUMBER, DURATION, CLOCK, VERSION, RANGE]
const URL_MARK = '://'
const LETTER = /\p{L}/u
const PATH_STARTS = ['/', './', '../', '~/'] as const
const EXTENSION = /\.[A-Za-z0-9]{1,6}$/

function isPath(core: string): boolean {
  if (!core.includes('/') || core.includes(URL_MARK) || !LETTER.test(core)) return false
  if (PATH_STARTS.some((start) => core.startsWith(start)) || core.endsWith('/')) return true
  return EXTENSION.test(core.slice(core.lastIndexOf('/') + 1))
}

export function tokenOf(core: string): Token | null {
  if (NUMBER_SHAPES.some((shape) => shape.test(core))) return 'number'
  return isPath(core) ? 'path' : null
}

export function tokensOf(text: string): TokenSpan[] {
  return Array.from(text.matchAll(WORD), (found): TokenSpan | null => {
    const word = found[0]
    const lead = OPENERS.exec(word)?.[0].length ?? 0
    const core = word.slice(lead).replace(CLOSERS, '')
    const token = tokenOf(core)
    const start = found.index + lead
    return token === null ? null : { start, end: start + core.length, token }
  }).filter((span) => span !== null)
}

function tokenAt(spans: readonly TokenSpan[], at: number): Token | null {
  return spans.find((span) => at >= span.start && at < span.end)?.token ?? null
}

function takesToken(mark: Mark): boolean {
  return !mark.isCode && !mark.isLink
}

export function highlightedRuns(runs: readonly Run[]): Run[] {
  const spans = tokensOf(runs.map((run) => run.text).join(''))
  const highlighted: Run[] = []
  let at = 0
  for (const run of runs) {
    const first = highlighted.length
    for (const character of run.text) {
      const token = takesToken(run.mark) ? tokenAt(spans, at) : null
      const last = highlighted.length > first ? highlighted.at(-1) : undefined
      if (last?.mark.token === token) last.text += character
      else highlighted.push({ text: character, mark: { ...run.mark, token } })
      at += character.length
    }
  }
  return highlighted
}
