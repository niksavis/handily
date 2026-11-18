import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const root = join(import.meta.dirname, '..')
const gatesPath = '.github/workflows/basicly-gates.yml'
const releasePath = '.github/workflows/release.yml'
const shardedTest = 'node scripts/mods.mjs test --shard'
const scriptTests = 'node scripts/mods.mjs test-scripts'
const wholeTest = 'node scripts/mods.mjs test'

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function runLines(text) {
  return [...text.matchAll(/^\s+run: (.+)$/gm)].map((found) => found[1].trim())
}

function fullModeCommands() {
  return read('basicly.toml')
    .split('[[verify.checks]]')
    .slice(1)
    .map((block) => ({
      name: /^name = "(.+)"$/m.exec(block)?.[1],
      command: JSON.parse(/^command = (\[.*\])$/m.exec(block)?.[1] ?? '[]').join(' '),
      modes: JSON.parse(/^modes = (\[.*\])$/m.exec(block)?.[1] ?? '[]'),
    }))
    .filter((check) => check.modes.includes('full'))
}

function matrixItems(text, key) {
  const section = new RegExp(`^( +)${key}:\\n((?:\\1 +.*\\n)+)`, 'm').exec(text)
  if (section === null) return []
  return section[2]
    .split(/^ +- /m)
    .slice(1)
    .map((item) =>
      Object.fromEntries(
        [...item.matchAll(/(\w+): (.+)/g)].map((found) => [found[1], found[2].trim()]),
      ),
    )
}

function shardRows(text, count) {
  const list = /^\s+shard: \[([\d, ]+)\]$/m.exec(text)
  if (list === null) return undefined
  const shards = list[1].split(',').map((value) => Number(value.trim()))
  if (count !== '${{ matrix.shards }}') return [{ name: '', count: Number(count), shards }]
  const engines = /^\s+engine: \[([\w, -]+)\]$/m.exec(text)?.[1].split(',') ?? []
  const included = matrixItems(text, 'include')
  const excluded = matrixItems(text, 'exclude')
  return engines.map((value) => {
    const engine = value.trim()
    return {
      name: ` on the ${engine} row`,
      count: Number(included.find((item) => item.engine === engine)?.shards),
      shards: shards.filter(
        (shard) => !excluded.some((item) => item.engine === engine && Number(item.shard) === shard),
      ),
    }
  })
}

function shardProblems(path, text = read(path)) {
  const steps = [
    ...text.matchAll(/--shard \$\{\{ matrix\.shard \}\}\/(\d+|\$\{\{ matrix\.shards \}\})/g),
  ]
  const lists = [...text.matchAll(/^\s+shard: \[/gm)]
  if (steps.length === 0) return [`${path} runs no ${shardedTest} step`]
  if (steps.length !== 1 || lists.length !== 1) {
    return [`${path} has ${steps.length} sharded test step(s) and ${lists.length} shard list(s)`]
  }
  const rows = shardRows(text, steps[0][1])
  if (rows === undefined || rows.length === 0)
    return [`${path} gives its sharded test step no rows`]
  return rows.flatMap(({ name, count, shards }) => {
    const expected = Array.from({ length: count }, (_, shard) => shard + 1)
    return Number.isInteger(count) && JSON.stringify(shards) === JSON.stringify(expected)
      ? []
      : [
          `${path} runs --shard of ${String(count)}${name} with the shard list [${shards.join(', ')}]; list every shard from 1 to ${String(count)} once`,
        ]
  })
}

function missingRuns(path, commands) {
  const runs = runLines(read(path))
  return commands
    .filter((command) => !runs.some((line) => line === command || line.startsWith(`${command} `)))
    .map((command) => `${path} does not run ${command}`)
}

describe('CI runs every configured check, and the sharded mod tests cover every shard', () => {
  test('basicly-gates runs each full-mode verify check of basicly.toml', () => {
    const checks = fullModeCommands()
    assert.ok(checks.length >= 5, JSON.stringify(checks))
    const commands = checks.flatMap(({ command }) =>
      command === wholeTest ? [shardedTest, scriptTests] : [command],
    )
    assert.deepEqual(missingRuns(gatesPath, commands), [])
  })

  test('the release runs every task of npm run check', () => {
    const commands = ['validate', 'typecheck', 'lint'].map(
      (task) => `node scripts/mods.mjs ${task}`,
    )
    assert.deepEqual(missingRuns(releasePath, [...commands, shardedTest, scriptTests]), [])
  })

  test('each sharded test step lists every shard of its count once', () => {
    assert.deepEqual(
      [gatesPath, releasePath].flatMap((path) => shardProblems(path)),
      [],
    )
  })

  test('basicly-gates runs the sharded mod tests on the pinned and the newest Claude Code', () => {
    const text = read(gatesPath)
    assert.match(text, /^\s+engine: \[pinned, newest\]$/m)
    assert.match(text, /^\s+package: "@anthropic-ai\/claude-code@\d+\.\d+\.\d+"$/m)
    assert.match(text, /^\s+package: "@anthropic-ai\/claude-code@latest"$/m)
  })

  test('a shard list that leaves out a shard is named', () => {
    const text =
      '        shard: [1, 2, 4]\n        run: node scripts/mods.mjs test --shard ${{ matrix.shard }}/3\n'
    assert.deepEqual(shardProblems('w.yml', text), [
      'w.yml runs --shard of 3 with the shard list [1, 2, 4]; list every shard from 1 to 3 once',
    ])
    const rows = [
      '        engine: [pinned, newest]',
      '        shard: [1, 2, 3, 4, 5]',
      '        exclude:',
      '          - engine: pinned',
      '            shard: 5',
      '        include:',
      '          - engine: pinned',
      '            shards: 4',
      '          - engine: newest',
      '            shards: 6',
      '    steps:',
      '        run: node scripts/mods.mjs test --shard ${{ matrix.shard }}/${{ matrix.shards }}',
      '',
    ].join('\n')
    assert.deepEqual(shardProblems('w.yml', rows), [
      'w.yml runs --shard of 6 on the newest row with the shard list [1, 2, 3, 4, 5]; list every shard from 1 to 6 once',
    ])
  })
})
