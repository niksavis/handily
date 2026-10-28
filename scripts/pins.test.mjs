import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const root = join(import.meta.dirname, '..')
const workflows = join(root, '.github', 'workflows')
const PIN = /@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)/g
const LAID = /^\/\/ Written by Claude Code (\d+\.\d+\.\d+)\./

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

describe('every Claude Code pin names one version', () => {
  test('the workflows pin Claude Code at least once', () => {
    assert.ok(workflowPins().length > 0, 'no workflow installs @anthropic-ai/claude-code')
  })

  test('every workflow pins the same Claude Code version', () => {
    const pins = workflowPins()
    const versions = new Set(pins.map((pin) => pin.version))
    assert.equal(
      versions.size,
      1,
      `the workflows pin different Claude Code versions: ${pins.map((pin) => `${pin.file} ${pin.version}`).join(', ')}; set every pin to one version`,
    )
  })

  test('the workflow pin equals the version that wrote the engine types of every mod', () => {
    const [pin] = workflowPins()
    for (const laid of laidVersions()) {
      assert.equal(
        laid.version,
        pin.version,
        `mods/${laid.mod} has engine types of Claude Code ${String(laid.version)}, but ${pin.file} pins ${pin.version}; run npm run types or move the pin`,
      )
    }
  })
})
