import type { ToolCallResult } from 'claude-code'
import type { TestsFailure, TestsOutcome } from '../types'
import { JEST } from './jest'
import { NODE_TEST } from './nodetest'
import { PYTEST } from './pytest'
import type { Reading, RunnerReader } from './reading'
import { VITEST } from './vitest'

export type BashOutput = {
  text: string
  isCut: boolean
  isInterrupted: boolean
  isBackground: boolean
}

export const READERS: readonly RunnerReader[] = [VITEST, JEST, NODE_TEST, PYTEST]

const INTERRUPTED_MARK = '[Request interrupted by user for tool use]'
const CUT_MARK = /\n\.\.\. \[\d+ lines truncated\] \.\.\.\s*$/
const ESCAPE_SEQUENCE = new RegExp(String.raw`\u001B\[[0-9;?]*[ -/]*[@-~]`, 'g')
const RUNNER_WORD = /(?:^|[\s;&|(/])(?:vitest|jest|pytest|py\.test)(?=$|\s)/
const NODE_TEST_WORD = /(?:^|[\s;&|(])node\s+(?:\S+\s+)*?--test(?=$|[\s=])/
const PACKAGE_TEST = /(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?=$|[\s:])/

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function withoutEscapes(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '')
}

export function isTestCommand(command: string): boolean {
  return RUNNER_WORD.test(command) || NODE_TEST_WORD.test(command) || PACKAGE_TEST.test(command)
}

export function bashOutputOf(
  answer: ToolCallResult,
  isAskedBackground: boolean,
): BashOutput | undefined {
  if (answer.deny !== undefined) return undefined
  if (answer.isError === true) {
    const text = withoutEscapes(textOf(answer.result) || (answer.text ?? ''))
    return {
      text,
      isCut: CUT_MARK.test(text),
      isInterrupted: text.includes(INTERRUPTED_MARK),
      isBackground: false,
    }
  }
  const { result } = answer
  if (!isRecord(result)) return undefined
  const text = withoutEscapes([textOf(result.stdout), textOf(result.stderr)].join('\n'))
  return {
    text,
    isCut: result.persistedOutputPath !== undefined || CUT_MARK.test(text),
    isInterrupted: result.interrupted === true,
    isBackground: isAskedBackground || typeof result.backgroundTaskId === 'string',
  }
}

export function readerOf(
  text: string,
  readers: readonly RunnerReader[] = READERS,
): RunnerReader | undefined {
  return readers.find((reader) => reader.matches(text))
}

function relativeFailure(failure: TestsFailure, cwd: string): TestsFailure {
  const { file } = failure
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
  if (file === null || !file.startsWith(prefix)) return failure
  return { ...failure, file: file.slice(prefix.length) }
}

export function testsOutcome(
  reader: RunnerReader,
  reading: Reading,
  site: { isCut: boolean; cwd: string },
): TestsOutcome {
  const { runner } = reader
  if (reading.kind === 'broken') return { kind: 'broken', runner, reason: reading.reason }
  return {
    kind: 'tests',
    runner,
    passed: reading.passed,
    failed: reading.failed,
    total: reading.total,
    failures: reading.failures.map((failure) => relativeFailure(failure, site.cwd)),
    isCut: site.isCut || !reading.isWhole,
  }
}

export type OutcomeSite = { command: string; cwd: string; log: (detail: string) => void }

export function outcomeOf(
  output: BashOutput,
  site: OutcomeSite,
  readers: readonly RunnerReader[] = READERS,
): TestsOutcome | undefined {
  const reader = readerOf(output.text, readers)
  const isTests = reader !== undefined || isTestCommand(site.command)
  if (output.isBackground) return isTests ? { kind: 'background', runner: null } : undefined
  if (output.isInterrupted) {
    return isTests ? { kind: 'interrupted', runner: reader?.runner ?? null } : undefined
  }
  if (reader === undefined) return undefined
  try {
    return testsOutcome(reader, reader.read(output.text), { isCut: output.isCut, cwd: site.cwd })
  } catch (error) {
    site.log(`handily-tests: the ${reader.runner} output was not read: ${String(error)}`)
    return { kind: 'unreadable', runner: reader.runner }
  }
}
