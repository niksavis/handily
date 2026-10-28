import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

const scriptsDir = import.meta.dirname
const fixturesDir = join(scriptsDir, 'fixtures', 'git-env')
const gitSpawnPattern =
  /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\(\s*(['"`])git(?:\1|\s)/g
const isolatedEnvPattern =
  /\benv:\s*(?:environmentWithoutGit\b|(\{)\s*\.\.\.environmentWithoutGit\b)/
const spreadPattern = /\.\.\./g
const sharedEnvImportPattern =
  /import\s*\{[^}]*\benvironmentWithoutGit\b[^}]*\}\s*from\s*'(?:\.\.?\/)+git-env\.mjs'/

function bracketedText(source, start, open, close) {
  let depth = 0
  for (let index = source.indexOf(open, start); index < source.length; index += 1) {
    if (source[index] === open) depth += 1
    if (source[index] === close) depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  return source.slice(start)
}

function passesEnvironmentWithoutGit(call) {
  const match = isolatedEnvPattern.exec(call)
  if (match === null) return false
  if (match[1] === undefined) return true
  const environment = bracketedText(call, match.index + match[0].indexOf('{'), '{', '}')
  return environment.match(spreadPattern).length === 1
}

function findLeakingGitSpawns(path) {
  const source = readFileSync(path, 'utf8')
  const importsSharedEnv = sharedEnvImportPattern.test(source)
  const leaks = []
  for (const match of source.matchAll(gitSpawnPattern)) {
    const call = bracketedText(source, match.index, '(', ')')
    if (importsSharedEnv && passesEnvironmentWithoutGit(call)) continue
    const line = source.slice(0, match.index).split('\n').length
    leaks.push(
      `${relative(scriptsDir, path)}:${line}: git runs with the inherited GIT_ variables; pass env: environmentWithoutGit imported from scripts/git-env.mjs`,
    )
  }
  return leaks
}

test('no script test spawns git with the inherited GIT_ variables', () => {
  const testFiles = readdirSync(scriptsDir)
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join(scriptsDir, name))
  assert.ok(testFiles.includes(join(scriptsDir, 'mods.test.mjs')))
  assert.deepEqual(testFiles.flatMap(findLeakingGitSpawns), [])
})

test('a git spawn that keeps the GIT_ variables is refused with its file and line', () => {
  assert.deepEqual(findLeakingGitSpawns(join(fixturesDir, 'leaking.mjs')), [
    'fixtures/git-env/leaking.mjs:4: git runs with the inherited GIT_ variables; pass env: environmentWithoutGit imported from scripts/git-env.mjs',
  ])
})

test('a git spawn with every GIT_ variable removed passes', () => {
  assert.deepEqual(findLeakingGitSpawns(join(fixturesDir, 'clean.mjs')), [])
})

test('a git spawn with an environment that spreads environmentWithoutGit and adds values passes', () => {
  assert.deepEqual(findLeakingGitSpawns(join(fixturesDir, 'extended.mjs')), [])
})

test('a git spawn that spreads process.env or passes no env is refused', () => {
  assert.deepEqual(
    findLeakingGitSpawns(join(fixturesDir, 'inherited.mjs')).map((leak) =>
      leak.split(':').slice(0, 2).join(':'),
    ),
    [
      'fixtures/git-env/inherited.mjs:5',
      'fixtures/git-env/inherited.mjs:13',
      'fixtures/git-env/inherited.mjs:17',
    ],
  )
})
