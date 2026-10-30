import { describe, expect, test } from 'claude-code/testing'
import {
  JEST_BROKEN,
  JEST_COLOURED,
  JEST_DEEP_FAILED,
  JEST_ONE_FAILED,
  JEST_SUITE_FAILED,
  JEST_SUMMARY_REPEAT,
} from './fixtures/jest'
import {
  NODE_CALC_FAIL,
  NODE_REPO_PASS,
  NODE_SPEC_FAIL,
  NODE_SPEC_WINDOWS,
  NODE_TAP_FAIL,
  NODE_TAP_TODO,
} from './fixtures/node'
import {
  PYTEST_BROKEN,
  PYTEST_CLASS_FAILED,
  PYTEST_ONE_FAILED,
  PYTEST_PASSED,
  PYTEST_QUIET_FAILED,
  PYTEST_QUIET_PASSED,
} from './fixtures/pytest'
import { CARGO_FAILED, LISTING, MOCHA_PASSED, PASS_LINES } from './fixtures/unknown'
import {
  VITEST_BROKEN,
  VITEST_NO_FILES,
  VITEST_ONE_FAILED,
  VITEST_PASSED,
  VITEST_SUITE_FAILED,
  VITEST_TWO_FAILED,
} from './fixtures/vitest'
import { isTestCommand } from './hooks/command'
import { bashOutputOf, outcomeOf, readerOf } from './hooks/output'

const SITE = { command: 'npm test', cwd: '/work/app', log: () => undefined }
const VITEST_PRIMITIVE = ['- Expected', '+ Received', '- 4', '+ 5']
const JEST_PRIMITIVE = ['Expected: 4', 'Received: 5']

function outcome(text: string, command = 'npm test', cwd = SITE.cwd) {
  const output = { text, isCut: false, isInterrupted: false, isBackground: false }
  return outcomeOf(output, { ...SITE, command, cwd })
}

function failuresOf(text: string, command = 'npm test', cwd = SITE.cwd) {
  const read = outcome(text, command, cwd)
  return read?.kind === 'tests' ? read.failures : undefined
}

function failure(fields: {
  name: string
  file: string | null
  line: number | null
  message: string
  diff: readonly string[]
}) {
  return { ...fields, cutLines: 0 }
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
    expect(readerOf(PYTEST_QUIET_FAILED)?.runner).toBe('pytest')
    expect(readerOf(PYTEST_QUIET_PASSED)?.runner).toBe('pytest')
  })

  test('cargo, mocha, PASS lines of another tool and a folder listing match no runner', () => {
    for (const text of [CARGO_FAILED, LISTING, MOCHA_PASSED, PASS_LINES]) {
      expect(readerOf(text), text).toBeUndefined()
      expect(outcome(text), text).toBeUndefined()
    }
  })

  test('only a command that runs tests counts as a test command', () => {
    for (const command of [
      'npm test',
      'npm run test',
      'npm run test:unit',
      'npm t',
      'pnpm test -- --run',
      'yarn vitest run',
      'bun test',
      'npx vitest run',
      'npx --yes jest src',
      'jest src',
      './node_modules/.bin/vitest run',
      'CI=1 vitest run',
      'node --test scripts/*.test.mjs',
      'node --test-reporter=tap --test',
      'cd app && python -m pytest -k login',
      'uv run pytest -q',
      'npm test 2>&1 | tail -40',
    ]) {
      expect(isTestCommand(command), command).toBe(true)
    }
    for (const command of [
      'ls -la',
      'git commit -m "add a test"',
      'npm run check',
      'cat test.txt',
      'npm install -D vitest',
      'pnpm add -D jest',
      'pip install pytest',
      'grep -rn jest src',
      'rg pytest',
      'echo vitest',
      'node scripts/build.mjs',
    ]) {
      expect(isTestCommand(command), command).toBe(false)
    }
  })
})

describe('vitest', () => {
  test('reads one failed test with its file, line, message and the diff lines it printed', () => {
    expect(outcome(VITEST_ONE_FAILED)).toEqual({
      kind: 'tests',
      runner: 'vitest',
      passed: 3,
      failed: 1,
      total: 4,
      isCut: false,
      cutFailures: 0,
      failures: [
        failure({
          name: 'adds two numbers',
          file: 'src/math.test.ts',
          line: 12,
          message: 'expected 5 to be 4',
          diff: VITEST_PRIMITIVE,
        }),
      ],
    })
  })

  test('keeps the whole diff block of a deep equality as printed', () => {
    expect(failuresOf(VITEST_TWO_FAILED)?.[1]).toEqual(
      failure({
        name: 'parses an empty table with a header',
        file: 'src/table.test.ts',
        line: 8,
        message: "expected [] to deeply equal [ '' ]",
        diff: ['- Expected', '+ Received', '- [', '-   "",', '- ]', '+ []'],
      }),
    )
  })

  test('reads a pass and a file that could not load', () => {
    expect(outcome(VITEST_PASSED)).toMatchObject({ passed: 4, failed: 0, total: 4, failures: [] })
    expect(outcome(VITEST_BROKEN)).toEqual({
      kind: 'broken',
      runner: 'vitest',
      reason: "Error: Cannot find module './math' imported from '/work/app/src/math.test.ts'",
    })
  })

  test('a file that fails to load beside passing files counts as a failure, never as a pass', () => {
    expect(outcome(VITEST_SUITE_FAILED)).toEqual({
      kind: 'tests',
      runner: 'vitest',
      passed: 3,
      failed: 1,
      total: 4,
      isCut: false,
      cutFailures: 0,
      failures: [
        failure({
          name: 'src/b.test.ts',
          file: 'src/b.test.ts',
          line: 2,
          message: "Error: Cannot find module './b' imported from '/work/app/src/b.test.ts'",
          diff: [],
        }),
      ],
    })
  })

  test('No test files found reads as a run that found no tests', () => {
    expect(outcome(VITEST_NO_FILES)).toEqual({
      kind: 'empty',
      runner: 'vitest',
      reason: 'No test files found, exiting with code 1',
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
      cutFailures: 0,
      failures: [
        failure({
          name: 'adds two numbers',
          file: 'src/math.test.js',
          line: 12,
          message: 'expect(received).toBe(expected)',
          diff: JEST_PRIMITIVE,
        }),
      ],
    })
  })

  test('keeps the diff lines of a deep equality and leaves out the code frame', () => {
    expect(failuresOf(JEST_DEEP_FAILED)).toEqual([
      failure({
        name: 'parses an empty table',
        file: 'src/table.test.js',
        line: 7,
        message: 'expect(received).toEqual(expected)',
        diff: ['- Expected  - 3', '+ Received  + 1', '- Array [', '-   "",', '- ]', '+ Array []'],
      }),
    ])
  })

  test('reads a suite that failed to run as a run that could not run the tests', () => {
    expect(outcome(JEST_BROKEN)).toEqual({
      kind: 'broken',
      runner: 'jest',
      reason: "Cannot find module './math' from 'src/math.test.js'",
    })
  })

  test('a suite that failed to run beside a passing suite counts as a failure', () => {
    expect(outcome(JEST_SUITE_FAILED)).toEqual({
      kind: 'tests',
      runner: 'jest',
      passed: 2,
      failed: 1,
      total: 3,
      isCut: false,
      cutFailures: 0,
      failures: [
        failure({
          name: 'src/broken.test.js',
          file: 'src/broken.test.js',
          line: null,
          message: "Cannot find module './gone' from 'src/broken.test.js'",
          diff: [],
        }),
      ],
    })
  })

  test('lists a failure once when the summary of all failing tests repeats it', () => {
    expect(failuresOf(JEST_SUMMARY_REPEAT)?.map((each) => each.name)).toEqual(['adds two numbers'])
  })

  test('reads coloured output, whose FAIL badge starts with a space', () => {
    const output = bashOutputOf(
      { result: { stdout: '', stderr: JEST_COLOURED, interrupted: false } },
      false,
    )
    expect(failuresOf(output?.text ?? '')).toEqual([
      failure({
        name: 'adds two numbers',
        file: 'src/math.test.js',
        line: 12,
        message: 'expect(received).toBe(expected)',
        diff: JEST_PRIMITIVE,
      }),
    ])
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
      cutFailures: 0,
      failures: [],
    })
  })

  test('keeps only the lines that node printed for a strict equal, and makes up no diff', () => {
    expect(failuresOf(NODE_CALC_FAIL, 'node --test calc.test.mjs')).toEqual([
      failure({
        name: 'multiplies two numbers',
        file: 'calc.test.mjs',
        line: 4,
        message: 'Expected values to be strictly equal:',
        diff: ['6 !== 7'],
      }),
    ])
  })

  test('reads the failing tests of the spec reporter with the line of the assertion', () => {
    expect(failuresOf(NODE_SPEC_FAIL)).toEqual([
      failure({
        name: 'adds two numbers',
        file: 'test/math.test.mjs',
        line: 5,
        message: 'Expected values to be strictly equal:',
        diff: ['5 !== 4'],
      }),
      failure({
        name: 'parses a table',
        file: 'test/math.test.mjs',
        line: 12,
        message: 'Expected values to be strictly deep-equal:',
        diff: ['+ actual - expected', '+ []', '- [', "-   ''", '- ]'],
      }),
    ])
    expect(outcome(NODE_SPEC_FAIL)).toMatchObject({ passed: 2, failed: 2, total: 4 })
  })

  test('reads the TAP reporter the same way and skips the failed suite', () => {
    expect(outcome(NODE_TAP_FAIL)).toMatchObject({ passed: 2, failed: 2, total: 4 })
    expect(failuresOf(NODE_TAP_FAIL)).toEqual(failuresOf(NODE_SPEC_FAIL))
  })

  test('a TODO test is no failure, and a ... line inside the error keeps the block whole', () => {
    expect(failuresOf(NODE_TAP_TODO)).toEqual([
      failure({
        name: 'prints dots',
        file: 'test/todo.test.mjs',
        line: 6,
        message: 'Expected values to be strictly equal:',
        diff: ['+ actual - expected', "+ 'a...'", "- 'a'", '...'],
      }),
    ])
  })

  test('reads Windows paths relative to a Windows folder, with the line of the assertion', () => {
    expect(failuresOf(NODE_SPEC_WINDOWS, 'node --test', 'C:\\work\\app')).toEqual([
      failure({
        name: 'adds two numbers',
        file: 'test/math.test.mjs',
        line: 5,
        message: 'Expected values to be strictly equal:',
        diff: ['5 !== 4'],
      }),
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
      cutFailures: 0,
      failures: [
        failure({
          name: 'test_adds_two_numbers',
          file: 'tests/test_math.py',
          line: 12,
          message: 'assert 5 == 4',
          diff: ['+  where 5 = add(2, 3)'],
        }),
      ],
    })
  })

  test('reads a class test with its full diff and counts the skipped test in the total', () => {
    expect(outcome(PYTEST_CLASS_FAILED, 'pytest')).toMatchObject({
      passed: 1,
      failed: 1,
      total: 3,
    })
    expect(failuresOf(PYTEST_CLASS_FAILED, 'pytest')).toEqual([
      failure({
        name: 'TestTable.test_parses_empty',
        file: 'tests/test_table.py',
        line: 8,
        message: "assert [] == ['']",
        diff: ["Right contains one more item: ''", 'Full diff:', "- ['']", '+ []'],
      }),
    ])
  })

  test('reads the quiet output of pytest -q, with its bare summary line', () => {
    expect(outcome(PYTEST_QUIET_FAILED, 'pytest -q')).toEqual(outcome(PYTEST_ONE_FAILED, 'pytest'))
    expect(outcome(PYTEST_QUIET_PASSED, 'pytest -q')).toMatchObject({
      kind: 'tests',
      passed: 4,
      failed: 0,
      total: 4,
      isCut: false,
    })
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

describe('the kept run', () => {
  test('keeps 12 diff lines of a failure and counts the lines it cut', () => {
    const diff = Array.from({ length: 20 }, (_, index) => `- line ${String(index + 1)}`)
    const text = [
      ' RUN  v3.2.4 /work/app',
      ' FAIL  src/a.test.ts > a > long',
      'AssertionError: expected long to equal short',
      '',
      ...diff,
      '',
      ' \u{276F} src/a.test.ts:3:1',
      ' Test Files  1 failed (1)',
      '      Tests  1 failed (1)',
    ].join('\n')
    const [first] = failuresOf(text) ?? []
    expect(first?.diff).toEqual(diff.slice(0, 12))
    expect(first?.cutLines).toBe(8)
  })

  test('keeps 50 failures of a run and counts the failures it cut', () => {
    const blocks = Array.from({ length: 60 }, (_, index) =>
      [` FAIL  src/a.test.ts > a > case ${String(index + 1)}`, 'AssertionError: no'].join('\n'),
    )
    const text = [
      ' RUN  v3.2.4 /work/app',
      ...blocks,
      ' Test Files  1 failed (1)',
      '      Tests  60 failed (60)',
    ].join('\n')
    const read = outcome(text)
    expect(read?.kind === 'tests' ? read.failures.length : undefined).toBe(50)
    expect(read).toMatchObject({ failed: 60, cutFailures: 10 })
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
