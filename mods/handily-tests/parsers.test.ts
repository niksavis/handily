import { describe, expect, test } from 'claude-code/testing'
import { JEST_BROKEN, JEST_DEEP_FAILED, JEST_ONE_FAILED } from './fixtures/jest'
import { NODE_REPO_PASS, NODE_SPEC_FAIL, NODE_TAP_FAIL } from './fixtures/node'
import {
  PYTEST_BROKEN,
  PYTEST_CLASS_FAILED,
  PYTEST_ONE_FAILED,
  PYTEST_PASSED,
} from './fixtures/pytest'
import { CARGO_FAILED, LISTING } from './fixtures/unknown'
import {
  VITEST_BROKEN,
  VITEST_ONE_FAILED,
  VITEST_PASSED,
  VITEST_TWO_FAILED,
} from './fixtures/vitest'
import { bashOutputOf, isTestCommand, outcomeOf, readerOf } from './hooks/output'

const SITE = { command: 'npm test', cwd: '/work/app', log: () => undefined }
const PRIMITIVE = ['- Expected  4', '+ Received  5']

function outcome(text: string, command = 'npm test') {
  const output = { text, isCut: false, isInterrupted: false, isBackground: false }
  return outcomeOf(output, { ...SITE, command })
}

describe('the runner is found from the output format', () => {
  test('vitest output under npm test reads as vitest, and each other runner as itself', () => {
    expect(readerOf(VITEST_ONE_FAILED)?.runner).toBe('vitest')
    expect(readerOf(VITEST_BROKEN)?.runner).toBe('vitest')
    expect(readerOf(JEST_ONE_FAILED)?.runner).toBe('jest')
    expect(readerOf(JEST_BROKEN)?.runner).toBe('jest')
    expect(readerOf(NODE_REPO_PASS)?.runner).toBe('node')
    expect(readerOf(NODE_SPEC_FAIL)?.runner).toBe('node')
    expect(readerOf(NODE_TAP_FAIL)?.runner).toBe('node')
    expect(readerOf(PYTEST_ONE_FAILED)?.runner).toBe('pytest')
    expect(readerOf(PYTEST_BROKEN)?.runner).toBe('pytest')
  })

  test('cargo output and a folder listing match no runner', () => {
    expect(readerOf(CARGO_FAILED)).toBeUndefined()
    expect(readerOf(LISTING)).toBeUndefined()
    expect(outcome(CARGO_FAILED, 'cargo test')).toBeUndefined()
    expect(outcome(LISTING, 'ls -la')).toBeUndefined()
  })

  test('the command words that name a test run, and words that do not', () => {
    for (const command of [
      'npm test',
      'npm run test',
      'pnpm test -- --run',
      'npx vitest run',
      'jest src',
      'node --test scripts/*.test.mjs',
      'cd app && python -m pytest -k login',
    ]) {
      expect(isTestCommand(command), command).toBe(true)
    }
    for (const command of [
      'ls -la',
      'git commit -m "add a test"',
      'npm run check',
      'cat test.txt',
    ]) {
      expect(isTestCommand(command), command).toBe(false)
    }
  })
})

describe('vitest', () => {
  test('reads one failed test by name with its file, line, message and diff', () => {
    expect(outcome(VITEST_ONE_FAILED)).toEqual({
      kind: 'tests',
      runner: 'vitest',
      passed: 3,
      failed: 1,
      total: 4,
      isCut: false,
      failures: [
        {
          name: 'adds two numbers',
          file: 'src/math.test.ts',
          line: 12,
          message: 'expected 5 to be 4',
          diff: PRIMITIVE,
        },
      ],
    })
  })

  test('keeps the whole diff block of a deep equality', () => {
    const read = outcome(VITEST_TWO_FAILED)
    expect(read).toMatchObject({ passed: 3, failed: 2, total: 5 })
    expect(read?.kind === 'tests' ? read.failures[1] : undefined).toEqual({
      name: 'parses an empty table with a header',
      file: 'src/table.test.ts',
      line: 8,
      message: "expected [] to deeply equal [ '' ]",
      diff: ['- Expected', '+ Received', '- [', '-   "",', '- ]', '+ []'],
    })
  })

  test('reads a pass and a file that could not load', () => {
    expect(outcome(VITEST_PASSED)).toMatchObject({ passed: 4, failed: 0, total: 4, failures: [] })
    expect(outcome(VITEST_BROKEN)).toEqual({
      kind: 'broken',
      runner: 'vitest',
      reason: "Error: Cannot find module './math' imported from '/work/app/src/math.test.ts'",
    })
  })
})

describe('jest', () => {
  test('reads one failed test with the file of its FAIL line and the line of its stack', () => {
    expect(outcome(JEST_ONE_FAILED)).toEqual({
      kind: 'tests',
      runner: 'jest',
      passed: 3,
      failed: 1,
      total: 4,
      isCut: false,
      failures: [
        {
          name: 'adds two numbers',
          file: 'src/math.test.js',
          line: 12,
          message: 'expect(received).toBe(expected)',
          diff: PRIMITIVE,
        },
      ],
    })
  })

  test('keeps the diff lines of a deep equality and leaves out the code frame', () => {
    const read = outcome(JEST_DEEP_FAILED)
    expect(read?.kind === 'tests' ? read.failures : undefined).toEqual([
      {
        name: 'parses an empty table',
        file: 'src/table.test.js',
        line: 7,
        message: 'expect(received).toEqual(expected)',
        diff: ['- Expected  - 3', '+ Received  + 1', '- Array [', '-   "",', '- ]', '+ Array []'],
      },
    ])
  })

  test('reads a suite that failed to run as a run that could not run the tests', () => {
    expect(outcome(JEST_BROKEN)).toEqual({
      kind: 'broken',
      runner: 'jest',
      reason: "Cannot find module './math' from 'src/math.test.js'",
    })
  })
})

describe('node --test', () => {
  test('reads the real output of this repo as a pass of 5 tests', () => {
    expect(outcome(NODE_REPO_PASS, 'node --test scripts/git-env.test.mjs')).toEqual({
      kind: 'tests',
      runner: 'node',
      passed: 5,
      failed: 0,
      total: 5,
      isCut: false,
      failures: [],
    })
  })

  test('reads the failing tests of the spec reporter with the line of the assertion', () => {
    const expected = [
      {
        name: 'adds two numbers',
        file: 'test/math.test.mjs',
        line: 5,
        message: 'Expected values to be strictly equal: 5 !== 4',
        diff: ['- Expected  4', '+ Received  5'],
      },
      {
        name: 'parses a table',
        file: 'test/math.test.mjs',
        line: 12,
        message: 'Expected values to be strictly deep-equal:',
        diff: ['+ []', '- [', "-   ''", '- ]'],
      },
    ]
    expect(outcome(NODE_SPEC_FAIL)).toEqual({
      kind: 'tests',
      runner: 'node',
      passed: 2,
      failed: 2,
      total: 4,
      isCut: false,
      failures: expected,
    })
  })

  test('reads the TAP reporter the same way and skips the failed suite', () => {
    const read = outcome(NODE_TAP_FAIL)
    expect(read).toMatchObject({ passed: 2, failed: 2, total: 4 })
    expect(read?.kind === 'tests' ? read.failures : undefined).toEqual([
      {
        name: 'adds two numbers',
        file: 'test/math.test.mjs',
        line: 5,
        message: 'Expected values to be strictly equal: 5 !== 4',
        diff: ['- Expected  4', '+ Received  5'],
      },
      {
        name: 'parses a table',
        file: 'test/math.test.mjs',
        line: 12,
        message: 'Expected values to be strictly deep-equal:',
        diff: ['+ []', '- [', "-   ''", '- ]'],
      },
    ])
  })
})

describe('pytest', () => {
  test('reads one failed test with its file from the summary and its E lines', () => {
    expect(outcome(PYTEST_ONE_FAILED, 'pytest')).toEqual({
      kind: 'tests',
      runner: 'pytest',
      passed: 3,
      failed: 1,
      total: 4,
      isCut: false,
      failures: [
        {
          name: 'test_adds_two_numbers',
          file: 'tests/test_math.py',
          line: 12,
          message: 'assert 5 == 4',
          diff: ['  +  where 5 = add(2, 3)'],
        },
      ],
    })
  })

  test('reads a class test with its full diff and counts the skipped test in the total', () => {
    const read = outcome(PYTEST_CLASS_FAILED, 'pytest')
    expect(read).toMatchObject({ passed: 1, failed: 1, total: 3 })
    expect(read?.kind === 'tests' ? read.failures : undefined).toEqual([
      {
        name: 'TestTable.test_parses_empty',
        file: 'tests/test_table.py',
        line: 8,
        message: "assert [] == ['']",
        diff: ["   Right contains one more item: ''", "- ['']", '+ []'],
      },
    ])
  })

  test('reads a pass and a collection error', () => {
    expect(outcome(PYTEST_PASSED, 'pytest')).toMatchObject({ passed: 9, failed: 0, total: 9 })
    expect(outcome(PYTEST_BROKEN, 'pytest')).toEqual({
      kind: 'broken',
      runner: 'pytest',
      reason: "ModuleNotFoundError: No module named 'math_utils'",
    })
  })
})

describe('the Bash result', () => {
  test('an errored call reads its error text, and the interrupt mark makes it interrupted', () => {
    const errored = bashOutputOf(
      { isError: true, result: `Exit code 1\n${VITEST_ONE_FAILED}` },
      false,
    )
    expect(errored).toMatchObject({ isCut: false, isInterrupted: false, isBackground: false })
    expect(outcome(errored?.text ?? '')).toMatchObject({ kind: 'tests', failed: 1 })
    const stopped = bashOutputOf(
      { isError: true, result: 'Exit code 130\n[Request interrupted by user for tool use]' },
      false,
    )
    expect(stopped?.isInterrupted).toBe(true)
  })

  test('a persisted output or the truncation line marks the output as cut', () => {
    const persisted = bashOutputOf(
      {
        result: {
          stdout: VITEST_ONE_FAILED,
          stderr: '',
          interrupted: false,
          persistedOutputPath: 'x',
        },
      },
      false,
    )
    expect(persisted?.isCut).toBe(true)
    const truncated = bashOutputOf(
      {
        result: {
          stdout: `${VITEST_ONE_FAILED}\n\n... [120 lines truncated] ...`,
          stderr: '',
          interrupted: false,
        },
      },
      false,
    )
    expect(truncated?.isCut).toBe(true)
    const whole = bashOutputOf(
      { result: { stdout: VITEST_ONE_FAILED, stderr: '', interrupted: false } },
      false,
    )
    expect(whole?.isCut).toBe(false)
  })

  test('a parser that throws gives a run that could not be read, and logs why', () => {
    const logs: string[] = []
    const throwing = {
      runner: 'vitest' as const,
      matches: () => true,
      read: () => {
        throw new Error('line 4 has no name')
      },
    }
    const read = outcomeOf(
      { text: VITEST_ONE_FAILED, isCut: false, isInterrupted: false, isBackground: false },
      {
        ...SITE,
        log: (detail) => {
          logs.push(detail)
        },
      },
      [throwing],
    )
    expect(read).toEqual({ kind: 'unreadable', runner: 'vitest' })
    expect(logs).toEqual([
      'handily-tests: the vitest output was not read: Error: line 4 has no name',
    ])
  })
})
