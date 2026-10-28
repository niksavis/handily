import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const changelogPath = 'CHANGELOG.md'
const releaseSubjectPrefix = 'chore(release)'

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.error) throw new Error(`cannot run git ${args[0]} (${result.error.message})`)
  return result
}

function gitOutput(args) {
  const result = runGit(args)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`)
  }
  return result.stdout
}

function stagedPaths() {
  return gitOutput(['diff', '--cached', '--name-only'])
    .split('\n')
    .filter((line) => line !== '')
}

function mergeHeads() {
  const mergeHeadPath = gitOutput(['rev-parse', '--git-path', 'MERGE_HEAD']).trim()
  if (!existsSync(mergeHeadPath)) return []
  return readFileSync(mergeHeadPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function changelogBlob(revision) {
  const args = ['rev-parse', '--verify', '--quiet', `${revision}:${changelogPath}`]
  const result = runGit(args)
  if (result.status === 0) return result.stdout.trim()
  if (result.status === 1) return null
  throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`)
}

function stagedChangelogMatchesASide(heads) {
  const staged = changelogBlob('')
  return ['HEAD', ...heads].some((revision) => changelogBlob(revision) === staged)
}

function refuse(lines) {
  console.error(lines.join('\n'))
  process.exit(1)
}

const messagePath = process.argv[2]
if (messagePath === undefined) {
  console.error('changelog-gate: no commit message file; run it as a commit-msg hook')
  process.exit(2)
}

const subject = readFileSync(messagePath, 'utf8').split('\n')[0]
if (stagedPaths().includes(changelogPath) && !subject.startsWith(releaseSubjectPrefix)) {
  const heads = mergeHeads()
  if (heads.length === 0) {
    refuse([
      `changelog-gate: this commit edits ${changelogPath}, and its subject does not start with ${releaseSubjectPrefix}.`,
      `Put the entry in a changelog.d/<id>.<category>.md file instead; changelog.d/README.md gives the format.`,
      `Only a release commit edits ${changelogPath}, and its subject starts with ${releaseSubjectPrefix}.`,
      `Unstage it with: git restore --staged ${changelogPath}`,
    ])
  } else if (!stagedChangelogMatchesASide(heads)) {
    refuse([
      `changelog-gate: this merge commit stages a ${changelogPath} that differs from ${changelogPath} in HEAD and in MERGE_HEAD.`,
      `A merge may only carry the ${changelogPath} of one side; a hand edit during the merge is refused.`,
      `Take the merged side with: git checkout MERGE_HEAD -- ${changelogPath}`,
      `Put a new entry in a changelog.d/<id>.<category>.md file; changelog.d/README.md gives the format.`,
      `A merge that combines two release edits needs a subject that starts with ${releaseSubjectPrefix}.`,
    ])
  }
}
