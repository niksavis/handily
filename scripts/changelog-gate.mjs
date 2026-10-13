import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const changelogPath = 'CHANGELOG.md'
const releaseSubjectPrefix = 'chore(release)'

function stagedPaths() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
  if (result.error) throw new Error(`cannot run git diff --cached (${result.error.message})`)
  if (result.status !== 0) {
    throw new Error(`git diff --cached exited ${result.status}: ${result.stderr}`)
  }
  return result.stdout.split('\n').filter((line) => line !== '')
}

const messagePath = process.argv[2]
if (messagePath === undefined) {
  console.error('changelog-gate: no commit message file; run it as a commit-msg hook')
  process.exit(2)
}

const subject = readFileSync(messagePath, 'utf8').split('\n')[0]
if (stagedPaths().includes(changelogPath) && !subject.startsWith(releaseSubjectPrefix)) {
  console.error(
    [
      `changelog-gate: this commit edits ${changelogPath}, and its subject does not start with ${releaseSubjectPrefix}.`,
      `Put the entry in a changelog.d/<id>.<category>.md file instead; changelog.d/README.md gives the format.`,
      `Only a release commit edits ${changelogPath}, and its subject starts with ${releaseSubjectPrefix}.`,
      `Unstage it with: git restore --staged ${changelogPath}`,
    ].join('\n'),
  )
  process.exit(1)
}
