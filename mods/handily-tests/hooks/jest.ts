import {
  type Crash,
  type ReadFailure,
  type Reading,
  type RunnerReader,
  blocksOf,
  countBefore,
  dedented,
  isSamePath,
  NO_TEST_RAN,
  linesOf,
  printedLines,
  withCrashes,
  withoutErrorName,
  withoutTrailingNote,
} from './reading'

const SUITES_LINE = /^Test Suites:\s(.+)$/m
const FILE_LINE = /^ ?(?:PASS|FAIL)\s+(\S+)/
const TESTS_LINE = /^Tests:\s+(.+\d+ total)$/m
const BLOCK_HEAD = /^\s{2}\u{25CF} (.+)$/u
const SUMMARY_HEAD = /^Summary of all failing tests$/
const SUITE_FAILED = 'Test suite failed to run'
const NAME_PARTS = ' \u{203A} '
const FRAME_LINE = /^\s*>?\s*\d+ \|/
const STACK_LINE = /^\s*at /
const STACK_FRAME = /\(([^()]+?):(\d+):\d+\)/
const MARKED_FRAME_LINE = /^\s*>\s*(\d+) \|/

type Block = { head: string; body: string[]; file: string | null }

function isBlockEnd(line: string): boolean {
  return (
    FILE_LINE.test(line) ||
    SUITES_LINE.test(line) ||
    TESTS_LINE.test(line) ||
    SUMMARY_HEAD.test(line)
  )
}

function lineIn(body: readonly string[], file: string | null): number | null {
  for (const line of body) {
    const found = STACK_FRAME.exec(line)
    if (found?.[1] !== undefined && (file === null || isSamePath(found[1], file))) {
      return Number(found[2])
    }
  }
  const marked = body.map((line) => MARKED_FRAME_LINE.exec(line)?.[1]).find((n) => n !== undefined)
  return marked === undefined ? null : Number(marked)
}

function fileBefore(lines: readonly string[], index: number): string | null {
  for (let at = index; at >= 0; at -= 1) {
    const file = FILE_LINE.exec(lines[at] ?? '')?.[1]
    if (file !== undefined) return file
  }
  return null
}

function blocksWithFiles(lines: readonly string[]): Block[] {
  const starts = lines.flatMap((line, index) => (BLOCK_HEAD.test(line) ? [index] : []))
  const blocks = blocksOf(lines, (line) => BLOCK_HEAD.test(line), isBlockEnd)
  const seen = new Set<string>()
  return blocks
    .map(([head = '', ...rest], index) => ({
      head: BLOCK_HEAD.exec(head)?.[1]?.trim() ?? '',
      body: dedented(rest),
      file: fileBefore(lines, starts[index] ?? 0),
    }))
    .filter((block) => {
      const key = JSON.stringify([block.file, block.head])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function messageAt(body: readonly string[]): number {
  return body.findIndex((line) => line.trim() !== '')
}

function failureOf(block: Block): ReadFailure {
  const { body } = block
  const at = messageAt(body)
  const rest = body.slice(at + 1)
  const end = rest.findIndex((line) => FRAME_LINE.test(line) || STACK_LINE.test(line))
  const parts = block.head.split(NAME_PARTS)
  return {
    name: parts.at(-1) ?? block.head,
    file: block.file,
    line: lineIn(body, block.file),
    message: withoutTrailingNote(withoutErrorName((body[at] ?? '').trim())),
    diff: printedLines(end < 0 ? rest : rest.slice(0, end)),
  }
}

function crashOf(block: Block): Crash {
  return {
    file: block.file ?? 'a test suite',
    line: null,
    reason: (block.body[messageAt(block.body)] ?? SUITE_FAILED).trim(),
  }
}

function withFailedSuites(reading: Reading, text: string): Reading {
  if (reading.kind !== 'tests' || reading.failed > 0) return reading
  const suitesFailed = countBefore(SUITES_LINE.exec(text)?.[1] ?? '', 'failed')
  if (suitesFailed === 0) return reading
  return { ...reading, failed: suitesFailed, total: reading.total + suitesFailed }
}

function read(text: string): Reading {
  const blocks = blocksWithFiles(linesOf(text))
  const crashes = blocks.filter((block) => block.head === SUITE_FAILED).map(crashOf)
  const failures = blocks.filter((block) => block.head !== SUITE_FAILED).map(failureOf)
  const summary = TESTS_LINE.exec(text)?.[1]
  if (summary === undefined) {
    const partial = { kind: 'tests' as const, passed: 0, failed: failures.length, total: 0 }
    return withCrashes({ ...partial, failures, isWhole: false }, crashes)
  }
  const total = countBefore(summary, 'total')
  const [crash] = crashes
  if (total === 0) {
    return crash === undefined
      ? { kind: 'empty', reason: NO_TEST_RAN }
      : { kind: 'broken', reason: crash.reason }
  }
  const failed = countBefore(summary, 'failed')
  const passed = countBefore(summary, 'passed')
  const reading = { kind: 'tests' as const, passed, failed, total, failures, isWhole: true }
  return withFailedSuites(withCrashes(reading, crashes), text)
}

function hasFileAndBlock(text: string): boolean {
  const lines = linesOf(text)
  return lines.some((line) => FILE_LINE.test(line)) && lines.some((line) => BLOCK_HEAD.test(line))
}

export const JEST: RunnerReader = {
  runner: 'jest',
  matches: (text) => SUITES_LINE.test(text) || TESTS_LINE.test(text) || hasFileAndBlock(text),
  read,
}
