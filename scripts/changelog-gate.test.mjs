import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { environmentWithoutGit } from './git-env.mjs'

const gatePath = join(import.meta.dirname, 'changelog-gate.mjs')

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: environmentWithoutGit })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
}

function runGate(stagedFile, subject) {
  const repo = mkdtempSync(join(tmpdir(), 'handily-changelog-gate-test-'))
  try {
    git(repo, ['init', '--quiet'])
    mkdirSync(join(repo, 'changelog.d'))
    writeFileSync(join(repo, stagedFile), '- an entry\n')
    git(repo, ['add', stagedFile])
    const messagePath = join(repo, 'COMMIT_EDITMSG')
    writeFileSync(messagePath, `${subject}\n\nbody\n`)
    return spawnSync(process.execPath, [gatePath, messagePath], {
      cwd: repo,
      encoding: 'utf8',
      env: environmentWithoutGit,
    })
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

test('a staged CHANGELOG.md edit with a feat subject is refused and names changelog.d', () => {
  const result = runGate('CHANGELOG.md', 'feat: x (handily-fwkt.14)')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /changelog\.d\//)
  assert.match(result.stderr, /changelog\.d\/README\.md/)
  assert.match(result.stderr, /chore\(release\)/)
})

test('a staged CHANGELOG.md edit with a chore(release) subject passes', () => {
  const result = runGate('CHANGELOG.md', 'chore(release): release the mods (handily-fwkt.14)')
  assert.equal(result.status, 0, result.stderr)
})

test('a staged changelog.d fragment with a feat subject passes', () => {
  const result = runGate(
    join('changelog.d', 'handily-fwkt.14.added.md'),
    'feat: x (handily-fwkt.14)',
  )
  assert.equal(result.status, 0, result.stderr)
})
