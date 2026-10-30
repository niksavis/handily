import {
  type ReadFailure,
  type Reading,
  type RunnerReader,
  blocksOf,
  emptyOrBroken,
  dedented,
  isSamePath,
  linesOf,
  locationIn,
  printedLines,
  withoutErrorName,
} from './reading'

const SPEC_SUMMARY = /^\u{2139} tests (\d+)$/mu
const SPEC_FAILING = /^\u{2716} failing tests:$/u
const SPEC_TEST_AT = /^test at (.+)$/
const SPEC_NAME = /^\u{2716} (.+?) \(\d+(?:\.\d+)?m?s\)$/u
const TAP_HEAD = /^TAP version \d+$/m
const TAP_NOT_OK = /^(\s*)not ok \d+ - (.+)$/
const TAP_DIRECTIVE = / # (?:TODO|SKIP)\b/i
const LOCATION = /^(?:file:\/\/)?(.+):(\d+):\d+$/
const STACK_LINE = /^\s+at /
const SUBTESTS_FAILED = 'subtestsFailed'

type Where = { location: string; stack: readonly string[] }

const FRAME = /\((?:file:\/\/)?([^()]+?):(\d+):\d+\)/

function specCount(text: string, word: string): number {
  const found = new RegExp(`^\\u{2139} ${word} (\\d+)$`, 'mu').exec(text)
  return found === null ? 0 : Number(found[1])
}

function tapCount(text: string, word: string): number {
  const found = new RegExp(`^# ${word} (\\d+)$`, 'm').exec(text)
  return found === null ? 0 : Number(found[1])
}

function frameLine(stack: readonly string[], file: string): number | undefined {
  for (const line of stack) {
    const frame = FRAME.exec(line)
    if (frame?.[1] !== undefined && isSamePath(frame[1], file)) return Number(frame[2])
  }
  return undefined
}

function nodeFailure(name: string, where: Where, errorLines: readonly string[]): ReadFailure {
  const location = locationIn(where.location.trim(), LOCATION)
  const lines = dedented(errorLines)
  const headAt = lines.findIndex((line) => line.trim() !== '')
  const stackAt = lines.findIndex((line) => STACK_LINE.test(line))
  return {
    name,
    file: location?.file ?? null,
    line: location === undefined ? null : (frameLine(where.stack, location.file) ?? location.line),
    message: withoutErrorName((lines[headAt] ?? '').trim()),
    diff: printedLines(lines.slice(headAt + 1, stackAt < 0 ? undefined : stackAt)),
  }
}

function specFailures(lines: readonly string[]): ReadFailure[] {
  const section = lines.findIndex((line) => SPEC_FAILING.test(line))
  if (section < 0) return []
  const blocks = blocksOf(
    lines.slice(section + 1),
    (line) => SPEC_TEST_AT.test(line),
    () => false,
  )
  return blocks.map(([head = '', nameLine = '', ...rest]) => {
    const name = SPEC_NAME.exec(nameLine)?.[1] ?? nameLine
    const where = { location: SPEC_TEST_AT.exec(head)?.[1] ?? '', stack: rest }
    return nodeFailure(name, where, rest)
  })
}

function readSpec(text: string): Reading {
  const lines = linesOf(text)
  const failures = specFailures(lines)
  if (!SPEC_SUMMARY.test(text)) {
    return { kind: 'tests', passed: 0, failed: failures.length, total: 0, failures, isWhole: false }
  }
  const total = specCount(text, 'tests')
  if (total === 0) return emptyOrBroken(lines)
  const failed = specCount(text, 'fail') + specCount(text, 'cancelled')
  return { kind: 'tests', passed: specCount(text, 'pass'), failed, total, failures, isWhole: true }
}

function unquoted(value: string): string {
  const quoted = /^'(.*)'$/.exec(value)
  return quoted?.[1] === undefined ? value : quoted[1].replaceAll("''", "'")
}

type YamlBlock = Map<string, string[]>

function yamlOf(lines: readonly string[]): YamlBlock {
  const fields: YamlBlock = new Map()
  const start = lines.findIndex((line) => line.trim() === '---')
  const fence = (lines[start] ?? '').length - (lines[start] ?? '').trimStart().length
  const end = lines.findIndex((line, index) => index > start && line === `${' '.repeat(fence)}...`)
  if (start < 0 || end < start) return fields
  const keyIndent = (lines[start + 1] ?? '').length - (lines[start + 1] ?? '').trimStart().length
  let key: string | undefined
  for (const line of lines.slice(start + 1, end)) {
    const indent = line.length - line.trimStart().length
    const field = /^\s*([\w]+):\s?(.*)$/.exec(line)
    if (indent === keyIndent && field?.[1] !== undefined) {
      key = field[1]
      const value = field[2] ?? ''
      fields.set(key, value === '|-' || value === '' ? [] : [unquoted(value)])
    } else if (key !== undefined && indent > keyIndent) {
      fields.get(key)?.push(line)
    }
  }
  return fields
}

function scalarOf(fields: YamlBlock, key: string): string | undefined {
  const value = fields.get(key)
  return value?.length === 1 ? value[0] : undefined
}

function tapFailures(lines: readonly string[]): ReadFailure[] {
  const blocks = blocksOf(
    lines,
    (line) => TAP_NOT_OK.test(line),
    (line) => /^\s*(?:ok|not ok) \d+ /.test(line) || /^\s*# Subtest: /.test(line),
  )
  return blocks.flatMap(([head = '', ...rest]) => {
    const fields = yamlOf(rest)
    const type = scalarOf(fields, 'type')
    const isSuite = type === 'suite' || scalarOf(fields, 'failureType') === SUBTESTS_FAILED
    const name = TAP_NOT_OK.exec(head)?.[2] ?? head
    if (isSuite || TAP_DIRECTIVE.test(name)) return []
    const where = { location: scalarOf(fields, 'location') ?? '', stack: fields.get('stack') ?? [] }
    return [nodeFailure(name, where, fields.get('error') ?? [])]
  })
}

function readTap(text: string): Reading {
  const lines = linesOf(text)
  const failures = tapFailures(lines)
  if (!/^# tests \d+$/m.test(text)) {
    return { kind: 'tests', passed: 0, failed: failures.length, total: 0, failures, isWhole: false }
  }
  const total = tapCount(text, 'tests')
  if (total === 0) return emptyOrBroken(lines)
  const failed = tapCount(text, 'fail') + tapCount(text, 'cancelled')
  return { kind: 'tests', passed: tapCount(text, 'pass'), failed, total, failures, isWhole: true }
}

export const NODE_TEST: RunnerReader = {
  runner: 'node',
  matches: (text) => TAP_HEAD.test(text) || SPEC_SUMMARY.test(text),
  read: (text) => (TAP_HEAD.test(text) ? readTap(text) : readSpec(text)),
}
