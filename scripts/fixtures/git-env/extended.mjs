import { spawnSync } from 'node:child_process'
import { environmentWithoutGit } from '../../git-env.mjs'

export function commitAt(cwd, date) {
  return spawnSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'fixture'], {
    cwd,
    encoding: 'utf8',
    env: { ...environmentWithoutGit, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
}
