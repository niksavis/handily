import type { TestsFailure } from '../types'
import {
  type Reading,
  type RunnerReader,
  blocksOf,
  brokenReason,
  countBefore,
  linesOf,
  locationIn,
  primitiveDiff,
  withoutErrorName,
  withoutTrailingNote,
} from './reading'

const HEAD = /^\s*RUN\s+v\d+\.\d+\.\d+/m
const FILES_LINE = /^\s*Test Files\s{2,}\S/m
const TESTS_LINE = /^\s*Tests\s{2,}(.+)$/m
const FAIL_LINE = /^\s*FAIL\s{2,}(.+)$/
const FILE_CRASH = /^(\S+) \[ \S+ \]$/
const SEPARATOR = /^\s*\u{23AF}{3,}/u
const LOCATION = /^\s*\u{276F}\s+(\S+?):(\d+):\d+/u
const DIFF_HEAD = ['- Expected', '+ Received']
const NAME_PARTS = ' > '

function isBlockEnd(line: string): boolean {
  return SEPARATOR.test(line) || FILES_LINE.test(line)
}

function diffOf(body: readonly string[]): string[] {
  const start = body.findIndex((line) => line.trim() === DIFF_HEAD[0])
  if (start < 0 || body[start + 1]?.trim() !== DIFF_HEAD[1]) return []
  const rest = body.slice(start + 2)
  const end = rest.findIndex((line) => LOCATION.test(line))
  const lines = (end < 0 ? rest : rest.slice(0, end)).filter((line) => line.trim() !== '')
  const [removed, added] = lines
  const isPrimitive =
    lines.length === 2 && removed?.startsWith('- ') === true && added?.startsWith('+ ') === true
  if (isPrimitive) return primitiveDiff(removed.slice(2), added.slice(2))
  return [...DIFF_HEAD, ...lines]
}

function failureOf(block: readonly string[]): TestsFailure | undefined {
  const [head = '', ...body] = block
  const title = FAIL_LINE.exec(head)?.[1]?.trim() ?? ''
  if (FILE_CRASH.test(title)) return undefined
  const parts = title.split(NAME_PARTS)
  const file = parts[0] ?? null
  const message = body.find((line) => line.trim() !== '') ?? ''
  const location = body
    .map((line) => locationIn(line, LOCATION))
    .find((found) => found !== undefined && (file === null || found.file === file))
  return {
    name: parts.length > 1 ? (parts.at(-1) ?? title) : title,
    file: location?.file ?? file,
    line: location?.line ?? null,
    message: withoutTrailingNote(withoutErrorName(message.trim())),
    diff: diffOf(body),
  }
}

function read(text: string): Reading {
  const lines = linesOf(text)
  const blocks = blocksOf(lines, (line) => FAIL_LINE.test(line), isBlockEnd)
  const failures = blocks.map(failureOf).filter((failure) => failure !== undefined)
  const summary = TESTS_LINE.exec(text)?.[1]
  if (summary === undefined) {
    return { kind: 'tests', passed: 0, failed: failures.length, total: 0, failures, isWhole: false }
  }
  const failed = countBefore(summary, 'failed')
  const passed = countBefore(summary, 'passed')
  const total = Number(/\((\d+)\)/.exec(summary)?.[1] ?? '0')
  if (total === 0) return { kind: 'broken', reason: brokenReason(lines) }
  return { kind: 'tests', passed, failed, total, failures, isWhole: true }
}

export const VITEST: RunnerReader = {
  runner: 'vitest',
  matches: (text) => HEAD.test(text) || FILES_LINE.test(text),
  read,
}
