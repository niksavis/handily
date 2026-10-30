import type { ToolCallResult } from 'claude-code'
import type { TestsFailure, TestsOutcome } from '../types'
import { isTestCommand } from './command'
import { JEST } from './jest'
import { NODE_TEST } from './nodetest'
import { PYTEST } from './pytest'
import { type ReadFailure, type Reading, type RunnerReader, normalPath } from './reading'
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

export const DIFF_LINES = 12

export const FAILURES_KEPT = 50

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function withoutEscapes(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, '')
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

export function relativeFile(file: string | null, cwd: string): string | null {
  if (file === null) return null
  const path = normalPath(file)
  const root = normalPath(cwd).replace(/\/$/, '')
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function keptFailure(failure: ReadFailure, cwd: string): TestsFailure {
  return {
    ...failure,
    file: relativeFile(failure.file, cwd),
    diff: failure.diff.slice(0, DIFF_LINES),
    cutLines: Math.max(failure.diff.length - DIFF_LINES, 0),
  }
}

export function testsOutcome(
  reader: RunnerReader,
  reading: Reading,
  site: { isCut: boolean; cwd: string },
): TestsOutcome {
  const { runner } = reader
  if (reading.kind === 'broken') return { kind: 'broken', runner, reason: reading.reason }
  if (reading.kind === 'empty') return { kind: 'empty', runner, reason: reading.reason }
  const kept = reading.failures.slice(0, FAILURES_KEPT)
  return {
    kind: 'tests',
    runner,
    passed: reading.passed,
    failed: reading.failed,
    total: reading.total,
    failures: kept.map((failure) => keptFailure(failure, site.cwd)),
    cutFailures: reading.failures.length - kept.length,
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
