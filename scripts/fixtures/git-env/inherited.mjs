import { spawnSync } from 'node:child_process'
import { environmentWithoutGit } from '../../git-env.mjs'

export function commitAt(cwd, date) {
  return spawnSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'fixture'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date },
  })
}

export function initRepository(cwd) {
  return spawnSync('git', ['init', '--quiet'], { cwd, encoding: 'utf8' })
}

export function statusAt(cwd) {
  return spawnSync('git', ['status', '--short'], {
    cwd,
    encoding: 'utf8',
    env: { ...environmentWithoutGit, ...process.env },
  })
}
