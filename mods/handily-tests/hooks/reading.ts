import type { TestsFailure, TestsRunner } from '../types'

export const DIFF_LINES = 12

export type Reading =
  | {
      kind: 'tests'
      passed: number
      failed: number
      total: number
      failures: readonly TestsFailure[]
      isWhole: boolean
    }
  | { kind: 'broken'; reason: string }

export type RunnerReader = {
  runner: TestsRunner
  matches: (text: string) => boolean
  read: (text: string) => Reading
}

export type Location = { file: string; line: number }

const NO_TEST_RAN = 'no test ran'

export function linesOf(text: string): string[] {
  return text.split(/\r?\n/)
}

export function countBefore(text: string, word: string): number {
  const found = new RegExp(`(\\d+) ${word}\\b`).exec(text)
  return found === null ? 0 : Number(found[1])
}

export function primitiveDiff(expected: string, received: string): string[] {
  return [`- Expected  ${expected}`, `+ Received  ${received}`]
}

export function diffLine(line: string): string {
  return line.startsWith('-') || line.startsWith('+') ? line : ` ${line}`
}

export function cappedDiff(lines: readonly string[]): string[] {
  return lines.slice(0, DIFF_LINES).map(diffLine)
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

export function brokenReason(lines: readonly string[]): string {
  return firstLineOf(lines, /^(?:\w*Error\b|No test files found|no tests ran)/i) ?? NO_TEST_RAN
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
