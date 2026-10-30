import type { TestsFailure } from '../types'
import {
  type Reading,
  type RunnerReader,
  blocksOf,
  countBefore,
  dedented,
  linesOf,
  locationIn,
  withoutErrorName,
} from './reading'

const SESSION_HEAD = /^=+ test session starts =+$/m
const SUMMARY = /^=+ (.+?) in [\d.]+s(?: \([^)]*\))? =+$/
const SECTION = /^=+ (.+?) =+$/
const FAILURES_SECTION = 'FAILURES'
const ERRORS_SECTION = 'ERRORS'
const BLOCK_HEAD = /^_{2,} (.+?) _{2,}$/
const ERROR_LINE = /^E(?:\s|$)(.*)$/
const LOCATION = /^(\S+?\.py):(\d+): \S/
const FAILED_LINE = /^FAILED (\S+?)::(\S+?)(?: - .*)?$/
const INTERRUPTED = /^!+ (Interrupted: .+?) !+$/
const FULL_DIFF = 'Full diff:'

function sectionLines(lines: readonly string[], name: string): string[] {
  const start = lines.findIndex((line) => SECTION.exec(line)?.[1] === name)
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => SECTION.test(line))
  return end < 0 ? rest : rest.slice(0, end)
}

function filesByName(lines: readonly string[]): Map<string, string> {
  const files = new Map<string, string>()
  for (const line of lines) {
    const failed = FAILED_LINE.exec(line)
    if (failed?.[1] !== undefined && failed[2] !== undefined) {
      files.set(failed[2].replaceAll('::', '.'), failed[1])
    }
  }
  return files
}

function diffOf(errors: readonly string[]): string[] {
  const fullAt = errors.findIndex((line) => line.trim() === FULL_DIFF)
  const explained = (fullAt < 0 ? errors : errors.slice(0, fullAt)).filter((line) => line !== '')
  const full = fullAt < 0 ? [] : dedented(errors.slice(fullAt + 1))
  return [...explained.map((line) => ` ${line}`), ...full.filter((line) => line.trim() !== '')]
}

function failureOf(block: readonly string[], files: ReadonlyMap<string, string>): TestsFailure {
  const [head = '', ...body] = block
  const name = BLOCK_HEAD.exec(head)?.[1] ?? head
  const errors = dedented(
    body.flatMap((line) => {
      const error = ERROR_LINE.exec(line)
      return error === null ? [] : [error[1] ?? '']
    }),
  ).map((line) => line.trimEnd())
  const [message = '', ...rest] = errors
  const file = files.get(name) ?? null
  const locations = body
    .map((line) => locationIn(line, LOCATION))
    .filter((found) => found !== undefined)
  const location = locations.find((found) => found.file === file) ?? locations.at(-1)
  return {
    name,
    file: file ?? location?.file ?? null,
    line: location?.line ?? null,
    message: withoutErrorName(message.trim()),
    diff: diffOf(rest),
  }
}

function blocksIn(section: readonly string[]): string[][] {
  return blocksOf(
    section,
    (line) => BLOCK_HEAD.test(line),
    () => false,
  )
}

function brokenReason(lines: readonly string[]): string {
  const errors = blocksIn(sectionLines(lines, ERRORS_SECTION))
  const firstError = errors
    .flatMap((block) => block.map((line) => ERROR_LINE.exec(line)?.[1]?.trim()))
    .find((line) => line !== undefined && line !== '')
  if (firstError !== undefined) return firstError
  const interrupted = lines
    .map((line) => INTERRUPTED.exec(line)?.[1])
    .find((line) => line !== undefined)
  return interrupted ?? 'no tests ran'
}

function read(text: string): Reading {
  const lines = linesOf(text)
  const files = filesByName(lines)
  const failures = blocksIn(sectionLines(lines, FAILURES_SECTION)).map((block) =>
    failureOf(block, files),
  )
  const summary = lines
    .map((line) => SUMMARY.exec(line)?.[1])
    .findLast((line) => line !== undefined)
  if (summary === undefined) {
    return { kind: 'tests', passed: 0, failed: failures.length, total: 0, failures, isWhole: false }
  }
  const passed = countBefore(summary, 'passed')
  const errored = countBefore(summary, 'errors?')
  const failed = countBefore(summary, 'failed') + errored
  const skipped = ['skipped', 'xfailed', 'xpassed'].reduce(
    (sum, word) => sum + countBefore(summary, word),
    0,
  )
  const ran = passed + countBefore(summary, 'failed') + skipped
  if (ran === 0) return { kind: 'broken', reason: brokenReason(lines) }
  return {
    kind: 'tests',
    passed,
    failed,
    total: passed + failed + skipped,
    failures,
    isWhole: true,
  }
}

export const PYTEST: RunnerReader = {
  runner: 'pytest',
  matches: (text) =>
    SESSION_HEAD.test(text) ||
    linesOf(text).some((line) => /\b(?:passed|failed)\b/.test(line) && SUMMARY.test(line)),
  read,
}
