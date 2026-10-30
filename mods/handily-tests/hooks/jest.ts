import type { TestsFailure } from '../types'
import {
  type Reading,
  type RunnerReader,
  blocksOf,
  brokenReason,
  countBefore,
  dedented,
  linesOf,
  primitiveDiff,
  withoutErrorName,
  withoutTrailingNote,
} from './reading'

const SUITES_LINE = /^Test Suites:\s/m
const FILE_LINE = /^(?:PASS|FAIL) (\S+)/
const TESTS_LINE = /^Tests:\s+(.+)$/m
const BLOCK_HEAD = /^\s{2}\u{25CF} (.+)$/u
const SUITE_FAILED = 'Test suite failed to run'
const NAME_PARTS = ' \u{203A} '
const EXPECTED = /^Expected:\s(.*)$/
const RECEIVED = /^Received:\s(.*)$/
const DIFF_PART = /^[-+] /
const FRAME_LINE = /^\s*>?\s*(\d+) \|/
const MARKED_FRAME_LINE = /^\s*>\s*(\d+) \|/

function isBlockEnd(line: string): boolean {
  return FILE_LINE.test(line) || SUITES_LINE.test(line) || TESTS_LINE.test(line)
}

function lineIn(body: readonly string[], file: string | null): number | null {
  const stack = new RegExp(`\\(([^()]+?):(\\d+):\\d+\\)`)
  for (const line of body) {
    const found = stack.exec(line)
    if (found?.[2] !== undefined && (file === null || found[1]?.endsWith(file) === true)) {
      return Number(found[2])
    }
  }
  const marked = body.map((line) => MARKED_FRAME_LINE.exec(line)?.[1]).find((n) => n !== undefined)
  return marked === undefined ? null : Number(marked)
}

function diffOf(body: readonly string[]): string[] {
  const expected = body.map((line) => EXPECTED.exec(line)?.[1]).find((part) => part !== undefined)
  const received = body.map((line) => RECEIVED.exec(line)?.[1]).find((part) => part !== undefined)
  if (expected !== undefined && received !== undefined) return primitiveDiff(expected, received)
  return body.filter((line) => DIFF_PART.test(line) && !FRAME_LINE.test(line))
}

function fileBefore(lines: readonly string[], index: number): string | null {
  for (let at = index; at >= 0; at -= 1) {
    const file = FILE_LINE.exec(lines[at] ?? '')?.[1]
    if (file !== undefined) return file
  }
  return null
}

type Block = { head: string; body: string[]; file: string | null }

function blocksWithFiles(lines: readonly string[]): Block[] {
  const starts = lines.flatMap((line, index) => (BLOCK_HEAD.test(line) ? [index] : []))
  const blocks = blocksOf(lines, (line) => BLOCK_HEAD.test(line), isBlockEnd)
  return blocks.map(([head = '', ...rest], index) => ({
    head: BLOCK_HEAD.exec(head)?.[1]?.trim() ?? '',
    body: dedented(rest),
    file: fileBefore(lines, starts[index] ?? 0),
  }))
}

function failureOf(block: Block): TestsFailure {
  const body = block.body.map((line) => line.trimEnd())
  const message = body.find((line) => line.trim() !== '') ?? ''
  const parts = block.head.split(NAME_PARTS)
  return {
    name: parts.at(-1) ?? block.head,
    file: block.file,
    line: lineIn(body, block.file),
    message: withoutTrailingNote(withoutErrorName(message.trim())),
    diff: diffOf(body.map((line) => line.trim())),
  }
}

function crashReason(block: Block | undefined, lines: readonly string[]): string {
  const first = block?.body.find((line) => line.trim() !== '')
  return first === undefined ? brokenReason(lines) : first.trim()
}

function read(text: string): Reading {
  const lines = linesOf(text)
  const blocks = blocksWithFiles(lines)
  const crash = blocks.find((block) => block.head === SUITE_FAILED)
  const tests = blocks.filter((block) => block.head !== SUITE_FAILED)
  const failures = tests.map(failureOf)
  const summary = TESTS_LINE.exec(text)?.[1]
  if (summary === undefined) {
    if (crash !== undefined) return { kind: 'broken', reason: crashReason(crash, lines) }
    return { kind: 'tests', passed: 0, failed: failures.length, total: 0, failures, isWhole: false }
  }
  const total = countBefore(summary, 'total')
  if (total === 0) return { kind: 'broken', reason: crashReason(crash, lines) }
  const failed = countBefore(summary, 'failed')
  const passed = countBefore(summary, 'passed')
  return { kind: 'tests', passed, failed, total, failures, isWhole: true }
}

export const JEST: RunnerReader = {
  runner: 'jest',
  matches: (text) => SUITES_LINE.test(text) || /^(?:PASS|FAIL) \S+/m.test(text),
  read,
}
