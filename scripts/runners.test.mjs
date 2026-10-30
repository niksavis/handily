import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const root = join(import.meta.dirname, '..')
const RUNNERS = ['vitest', 'jest', 'pytest']
const FIXTURES = join(root, 'mods', 'handily-tests', 'fixtures')
const FIXTURE_FILES = ['jest.ts', 'node.ts', 'pytest.ts', 'unknown.ts', 'vitest.ts']
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

function runnerDependencies(manifest) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(manifest[field] ?? {})
      .filter((name) => RUNNERS.some((runner) => name === runner || name.startsWith(`@${runner}/`)))
      .map((name) => `${field}: ${name}`),
  )
}

describe('the handily-tests runners', () => {
  test('no test runner is a dependency of the repository', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.deepEqual(runnerDependencies(manifest), [])
  })

  test('names a runner that a manifest lists as a dependency', () => {
    assert.deepEqual(
      runnerDependencies({ devDependencies: { vitest: '3.2.4', '@jest/core': '30.0.0' } }),
      ['devDependencies: vitest', 'devDependencies: @jest/core'],
    )
  })

  test('keeps a hand-written output fixture of each runner in the repository', () => {
    assert.deepEqual(readdirSync(FIXTURES).sort(), FIXTURE_FILES)
  })
})
