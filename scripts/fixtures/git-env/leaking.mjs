import { spawnSync } from 'node:child_process'

export function initRepository(cwd) {
  return spawnSync('git', ['init', '--quiet'], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
}
