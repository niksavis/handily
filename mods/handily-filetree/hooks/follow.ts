import { insidePath, normalPath } from './paths'
import { type RepoFs, repoTopOf } from './repo'

export type Follow = { cwd: string | undefined; top: string | undefined; asked: number }

export function newFollow(): Follow {
  return { cwd: undefined, top: undefined, asked: 0 }
}

export function clearFollow(follow: Follow): void {
  follow.cwd = undefined
  follow.top = undefined
  follow.asked += 1
}

function holds(folder: string, path: string): boolean {
  return (
    normalPath(folder) === normalPath(path) || insidePath(folder, normalPath(path)) !== undefined
  )
}

export function treeRootOf(follow: Follow, cwd: string): string {
  return follow.top !== undefined && follow.cwd === cwd ? follow.top : cwd
}

export async function followEdit(
  fs: RepoFs,
  follow: Follow,
  edit: { cwd: string; path: string },
): Promise<boolean> {
  const before = treeRootOf(follow, edit.cwd)
  follow.asked += 1
  const asked = follow.asked
  const top = holds(edit.cwd, edit.path) ? edit.cwd : await repoTopOf(fs, edit.path)
  if (asked !== follow.asked || top === undefined) return false
  follow.cwd = edit.cwd
  follow.top = holds(top, edit.cwd) ? undefined : normalPath(top)
  return treeRootOf(follow, edit.cwd) !== before
}
