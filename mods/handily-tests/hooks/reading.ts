import type { TestsRunner } from '../types'

export type ReadFailure = {
  name: string
  file: string | null
  line: number | null
  message: string
  diff: readonly string[]
}

export type Reading =
  | {
      kind: 'tests'
      passed: number
      failed: number
      total: number
      failures: readonly ReadFailure[]
      isWhole: boolean
    }
  | { kind: 'broken'; reason: string }
  | { kind: 'empty'; reason: string }

export type RunnerReader = {
  runner: TestsRunner
  matches: (text: string) => boolean
  read: (text: string) => Reading
}

export type Location = { file: string; line: number }

export type Crash = { file: string; line: number | null; reason: string }

export const NO_TEST_RAN = 'no test ran'
const DRIVE_PATH = /^\/(?=[A-Za-z]:\/)/

export function linesOf(text: string): string[] {
  return text.split(/\r?\n/)
}

export function countBefore(text: string, word: string): number {
  const found = new RegExp(`(\\d+) ${word}\\b`).exec(text)
  return found === null ? 0 : Number(found[1])
}

export function normalPath(path: string): string {
  return path
    .replace(/^file:\/\//, '')
    .replaceAll('\\', '/')
    .replace(DRIVE_PATH, '')
}

export function isSamePath(longer: string, file: string): boolean {
  const whole = normalPath(longer)
  const tail = normalPath(file)
  return whole === tail || whole.endsWith(`/${tail}`)
}

export function printedLines(lines: readonly string[]): string[] {
  return dedented(lines)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
}

export function dedented(lines: readonly string[]): string[] {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length)
  const cut = indents.length === 0 ? 0 : Math.min(...indents)
  return lines.map((line) => line.slice(Math.min(cut, line.length - line.trimStart().length)))
}

export function withoutTrailingNote(message: string): string {
  return message.replace(/\s+\/\/ [\w. ]*equality$/, '').trim()
}

export function withoutErrorName(message: string): string {
  return message.replace(/^AssertionError(?: \[[A-Z_]+\])?: /, '').trim()
}

export function locationIn(text: string, pattern: RegExp): Location | undefined {
  const found = pattern.exec(text)
  if (found?.[1] === undefined || found[2] === undefined) return undefined
  return { file: found[1], line: Number(found[2]) }
}

export function firstLineOf(lines: readonly string[], pattern: RegExp): string | undefined {
  return lines.map((line) => line.trim()).find((line) => pattern.test(line))
}

export function emptyOrBroken(lines: readonly string[]): Reading {
  const reason = firstLineOf(lines, /^\w*Error\b/)
  return reason === undefined ? { kind: 'empty', reason: NO_TEST_RAN } : { kind: 'broken', reason }
}

export function crashFailure(crash: Crash): ReadFailure {
  return { name: crash.file, file: crash.file, line: crash.line, message: crash.reason, diff: [] }
}

export function withCrashes(
  reading: Extract<Reading, { kind: 'tests' }>,
  crashes: readonly Crash[],
): Reading {
  if (crashes.length === 0) return reading
  return {
    ...reading,
    failed: reading.failed + crashes.length,
    total: reading.total + crashes.length,
    failures: [...crashes.map(crashFailure), ...reading.failures],
  }
}

export function blocksOf(
  lines: readonly string[],
  isStart: (line: string) => boolean,
  isEnd: (line: string) => boolean,
): string[][] {
  const blocks: string[][] = []
  let current: string[] | undefined
  for (const line of lines) {
    if (isStart(line)) {
      current = [line]
      blocks.push(current)
    } else if (current !== undefined && isEnd(line)) {
      current = undefined
    } else {
      current?.push(line)
    }
  }
  return blocks
}
