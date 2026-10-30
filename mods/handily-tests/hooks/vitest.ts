import {
  type Crash,
  type ReadFailure,
  type Reading,
  type RunnerReader,
  blocksOf,
  countBefore,
  isSamePath,
  NO_TEST_RAN,
  linesOf,
  locationIn,
  printedLines,
  withCrashes,
  withoutErrorName,
  withoutTrailingNote,
} from './reading'

const HEAD = /^\s*RUN\s+v\d+\.\d+\.\d+/m
const FILES_LINE = /^\s*Test Files\s{2,}(\S.*)$/m
const TESTS_LINE = /^\s*Tests\s{2,}(.+)$/m
const FAIL_LINE = /^\s*FAIL\s{2,}(.+)$/
const FILE_CRASH = /^(\S+) \[ \S+ \]$/
const NO_FILES = /^No test files found\b.*$/m
const SEPARATOR = /^\s*\u{23AF}{3,}/u
const LOCATION = /^\s*\u{276F}\s+(\S+?):(\d+):\d+/u
const NAME_PARTS = ' > '

type Block = { title: string; body: string[] }

function isBlockEnd(line: string): boolean {
  return SEPARATOR.test(line) || FILES_LINE.test(line)
}

function lineOf(body: readonly string[], file: string): number | null {
  const found = body
    .map((line) => locationIn(line, LOCATION))
    .find((location) => location !== undefined && isSamePath(location.file, file))
  return found?.line ?? null
}

function messageAt(body: readonly string[]): number {
  return body.findIndex((line) => line.trim() !== '')
}

function failureOf(block: Block): ReadFailure {
  const { title, body } = block
  const parts = title.split(NAME_PARTS)
  const file = parts[0] ?? title
  const at = messageAt(body)
  const rest = body.slice(at + 1)
  const end = rest.findIndex((line) => LOCATION.test(line))
  return {
    name: parts.length > 1 ? (parts.at(-1) ?? title) : title,
    file,
    line: lineOf(body, file),
    message: withoutTrailingNote(withoutErrorName((body[at] ?? '').trim())),
    diff: printedLines(end < 0 ? rest : rest.slice(0, end)),
  }
}

function crashOf(block: Block): Crash | undefined {
  const file = FILE_CRASH.exec(block.title)?.[1]
  if (file === undefined) return undefined
  const reason = (block.body[messageAt(block.body)] ?? '').trim()
  return { file, line: lineOf(block.body, file), reason }
}

function blocksIn(lines: readonly string[]): Block[] {
  const blocks = blocksOf(lines, (line) => FAIL_LINE.test(line), isBlockEnd)
  return blocks.map(([head = '', ...body]) => ({
    title: FAIL_LINE.exec(head)?.[1]?.trim() ?? '',
    body,
  }))
}

function withFailedFiles(reading: Reading, text: string): Reading {
  if (reading.kind !== 'tests' || reading.failed > 0) return reading
  const filesFailed = countBefore(FILES_LINE.exec(text)?.[1] ?? '', 'failed')
  if (filesFailed === 0) return reading
  return { ...reading, failed: filesFailed, total: reading.total + filesFailed }
}

function read(text: string): Reading {
  const noFiles = NO_FILES.exec(text)?.[0]
  if (noFiles !== undefined) return { kind: 'empty', reason: noFiles.trim() }
  const blocks = blocksIn(linesOf(text))
  const crashes = blocks.map(crashOf).filter((crash) => crash !== undefined)
  const failures = blocks.filter((block) => !FILE_CRASH.test(block.title)).map(failureOf)
  const summary = TESTS_LINE.exec(text)?.[1]
  if (summary === undefined) {
    const partial = { kind: 'tests' as const, passed: 0, failed: failures.length, total: 0 }
    return withCrashes({ ...partial, failures, isWhole: false }, crashes)
  }
  const total = Number(/\((\d+)\)/.exec(summary)?.[1] ?? '0')
  const [crash] = crashes
  if (total === 0) {
    return crash === undefined
      ? { kind: 'empty', reason: NO_TEST_RAN }
      : { kind: 'broken', reason: crash.reason }
  }
  const failed = countBefore(summary, 'failed')
  const passed = countBefore(summary, 'passed')
  const reading = { kind: 'tests' as const, passed, failed, total, failures, isWhole: true }
  return withFailedFiles(withCrashes(reading, crashes), text)
}

export const VITEST: RunnerReader = {
  runner: 'vitest',
  matches: (text) => HEAD.test(text) || FILES_LINE.test(text),
  read,
}
