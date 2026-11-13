import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const root = join(import.meta.dirname, '..')
const workflows = join(root, '.github', 'workflows')
const PIN = /@anthropic-ai\/claude-code@([\w.-]+)/g
const EXACT = /^\d+\.\d+\.\d+$/
const LAID = /^\/\/ Written by Claude Code (\d+\.\d+\.\d+)\./
const NEWEST = 'latest'

function workflowPins() {
  return readdirSync(workflows)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .flatMap((name) =>
      [...readFileSync(join(workflows, name), 'utf8').matchAll(PIN)].map((found) => ({
        file: `.github/workflows/${name}`,
        version: found[1],
      })),
    )
}

function laidVersions() {
  const mods = join(root, 'mods')
  return readdirSync(mods).map((mod) => {
    const header = readFileSync(
      join(mods, mod, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'),
      'utf8',
    ).split('\n', 1)[0]
    return { mod, version: LAID.exec(header)?.[1] }
  })
}

function pinText(pins) {
  return pins.map((pin) => `${pin.file} ${pin.version}`).join(', ')
}

function unknownValues(pins) {
  return pins
    .filter((pin) => !EXACT.test(pin.version) && pin.version !== NEWEST)
    .map(
      (pin) =>
        `${pin.file} installs Claude Code ${pin.version}; beside the pin, the only value is ${NEWEST}, the newest release`,
    )
}

function primaryProblems(exact, laid) {
  if (exact.length === 0) {
    return [`no workflow pins an exact Claude Code version; pin one beside ${NEWEST}`]
  }
  if (new Set(exact.map((pin) => pin.version)).size !== 1) {
    return [
      `the workflows pin different Claude Code versions: ${pinText(exact)}; set every pin to one version, and name the newest release by ${NEWEST}`,
    ]
  }
  const [pin] = exact
  return laid
    .filter((one) => one.version !== pin.version)
    .map(
      (one) =>
        `mods/${one.mod} has engine types of Claude Code ${String(one.version)}, but ${pin.file} pins ${pin.version}; run npm run types or move the pin`,
    )
}

function pinProblems(pins, laid) {
  if (pins.length === 0) return ['no workflow installs @anthropic-ai/claude-code']
  const exact = pins.filter((pin) => EXACT.test(pin.version))
  return [...unknownValues(pins), ...primaryProblems(exact, laid)]
}

function pinsOf(...versions) {
  return versions.map((version, index) => ({
    file: `.github/workflows/w${String(index)}.yml`,
    version,
  }))
}

function laidAt(version) {
  return [{ mod: 'handily-board', version }]
}

describe('every Claude Code pin names one version, and the one second value is the newest release', () => {
  test('the workflows and the engine types of every mod agree on the pin', () => {
    assert.deepEqual(pinProblems(workflowPins(), laidVersions()), [])
  })

  test('a workflow installs the newest release by the word latest', () => {
    assert.ok(
      workflowPins().some((pin) => pin.version === NEWEST),
      `no workflow installs @anthropic-ai/claude-code@${NEWEST}`,
    )
  })

  test('one pinned version and the word latest pass when the engine types match the pin', () => {
    assert.deepEqual(pinProblems(pinsOf('2.1.323', '2.1.323', NEWEST), laidAt('2.1.323')), [])
  })

  test('a fixed second version such as 2.1.322 is refused', () => {
    assert.match(
      pinProblems(pinsOf('2.1.323', '2.1.322'), laidAt('2.1.323')).join('\n'),
      /2\.1\.322/,
    )
  })

  test('a third value beside the pin and latest is refused', () => {
    assert.match(
      pinProblems(pinsOf('2.1.323', NEWEST, '2.1.322'), laidAt('2.1.323')).join('\n'),
      /2\.1\.322/,
    )
  })

  test('an unknown word such as next is refused', () => {
    assert.match(pinProblems(pinsOf('2.1.323', 'next'), laidAt('2.1.323')).join('\n'), /next/)
  })

  test('the word latest with no pinned version is refused', () => {
    assert.match(
      pinProblems(pinsOf(NEWEST), laidAt('2.1.323')).join('\n'),
      /no workflow pins an exact Claude Code version/,
    )
  })

  test('engine types that differ from the pin are refused, also when latest is named', () => {
    assert.match(
      pinProblems(pinsOf('2.1.323', NEWEST), laidAt('2.1.322')).join('\n'),
      /mods\/handily-board has engine types of Claude Code 2\.1\.322/,
    )
  })
})
