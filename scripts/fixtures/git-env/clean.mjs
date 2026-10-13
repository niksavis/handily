import { spawnSync } from 'node:child_process'
import { environmentWithoutGit } from '../../git-env.mjs'

export function initRepository(cwd) {
  return spawnSync('git', ['init', '--quiet'], {
    cwd,
    encoding: 'utf8',
    env: environmentWithoutGit,
  })
}
