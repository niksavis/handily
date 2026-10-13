import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

const scriptsDir = import.meta.dirname
const fixturesDir = join(scriptsDir, 'fixtures', 'git-env')
const gitSpawnPattern =
  /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\(\s*(['"`])git(?:\1|\s)/g
const isolatedEnvPattern = /\benv:\s*environmentWithoutGit\b/
const sharedEnvImportPattern =
  /import\s*\{[^}]*\benvironmentWithoutGit\b[^}]*\}\s*from\s*'(?:\.\.?\/)+git-env\.mjs'/

function callText(source, start) {
  let depth = 0
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    if (source[index] === '(') depth += 1
    if (source[index] === ')') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  return source.slice(start)
}

function findLeakingGitSpawns(path) {
  const source = readFileSync(path, 'utf8')
  const importsSharedEnv = sharedEnvImportPattern.test(source)
  const leaks = []
  for (const match of source.matchAll(gitSpawnPattern)) {
    if (importsSharedEnv && isolatedEnvPattern.test(callText(source, match.index))) continue
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
