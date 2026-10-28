import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { environmentWithoutGit } from './git-env.mjs'

const gatePath = join(import.meta.dirname, 'changelog-gate.mjs')
const mergeSubject = "Merge branch 'main' into lane"

const fixtureDate = '2026-01-01T00:00:00Z'

function fixtureConfig(cwd) {
  return [
    ['user.name', 'Fixture Author'],
    ['user.email', 'author@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', join(cwd, '.no-hooks')],
  ].flatMap(([name, value]) => ['-c', `${name}=${value}`])
}

function git(cwd, args) {
  const result = spawnSync('git', [...fixtureConfig(cwd), ...args], {
    cwd,
    encoding: 'utf8',
    env: environmentWithoutGit,
  })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
}

function gate(repo, subject) {
  const messagePath = join(repo, 'COMMIT_EDITMSG')
  writeFileSync(messagePath, `${subject}\n\nbody\n`)
  return spawnSync(process.execPath, [gatePath, messagePath], {
    cwd: repo,
    encoding: 'utf8',
    env: environmentWithoutGit,
  })
}

function withRepo(build) {
  const repo = mkdtempSync(join(tmpdir(), 'handily-changelog-gate-test-'))
  try {
    git(repo, ['init', '--quiet', '--initial-branch=main'])
    return build(repo)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}

function runGate(stagedFile, subject) {
  return withRepo((repo) => {
    mkdirSync(join(repo, 'changelog.d'))
    writeFileSync(join(repo, stagedFile), '- an entry\n')
    git(repo, ['add', stagedFile])
    return gate(repo, subject)
  })
}

function commitFile(repo, file, content, subject) {
  writeFileSync(join(repo, file), content)
  git(repo, ['add', file])
  git(repo, ['commit', '--quiet', `--date=${fixtureDate}`, '-m', subject])
}

function stageChangelog(repo, content) {
  writeFileSync(join(repo, 'CHANGELOG.md'), content)
  git(repo, ['add', 'CHANGELOG.md'])
}

function laneBehindARelease(repo) {
  commitFile(repo, 'CHANGELOG.md', '# Changelog\n\n## 0.1.0\n', 'chore(release): first')
  git(repo, ['checkout', '--quiet', '-b', 'lane'])
  commitFile(repo, 'work.txt', 'lane work\n', 'feat: lane work')
  git(repo, ['checkout', '--quiet', 'main'])
  commitFile(
    repo,
    'CHANGELOG.md',
    '# Changelog\n\n## 0.2.0\n\n## 0.1.0\n',
    'chore(release): second',
  )
  git(repo, ['checkout', '--quiet', 'lane'])
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

test('a merge commit that brings the CHANGELOG.md of main into a lane passes', () => {
  const result = withRepo((repo) => {
    laneBehindARelease(repo)
    git(repo, ['merge', '--quiet', '--no-ff', '--no-commit', 'main'])
    return gate(repo, mergeSubject)
  })
  assert.equal(result.status, 0, result.stderr)
})

test('a merge commit with a hand edit of CHANGELOG.md is refused and names the fix', () => {
  const result = withRepo((repo) => {
    laneBehindARelease(repo)
    git(repo, ['merge', '--quiet', '--no-ff', '--no-commit', 'main'])
    stageChangelog(repo, '# Changelog\n\n## 0.2.0\n\n- a hand edit\n\n## 0.1.0\n')
    return gate(repo, mergeSubject)
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /merge commit/)
  assert.match(result.stderr, /git checkout MERGE_HEAD -- CHANGELOG\.md/)
  assert.match(result.stderr, /changelog\.d\/README\.md/)
})

test('a plain commit that copies the CHANGELOG.md of main without a merge is refused', () => {
  const result = withRepo((repo) => {
    laneBehindARelease(repo)
    git(repo, ['checkout', 'main', '--', 'CHANGELOG.md'])
    return gate(repo, 'feat: copy the changelog (handily-fwkt.28)')
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /git restore --staged CHANGELOG\.md/)
})
