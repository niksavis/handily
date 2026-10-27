import type { FsStat } from 'claude-code'

export type GitRepo = { gitDir: string; prefix: string }

export type RepoFs = {
  stat: (path: string) => Promise<FsStat | undefined>
  read: (path: string) => Promise<string>
}

const GIT_FOLDER = '.git'
const GITFILE = /^gitdir: (.+?)\r?$/m
const HEAD_BRANCH = /^ref: refs\/heads\/(.+?)\s*$/
const HEAD_REF = /^ref: (.+?)\s*$/
const HEAD_COMMIT = /^([0-9a-f]{7})[0-9a-f]*\s*$/
const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:[\\/])/
const SEPARATORS = /[\\/]+/g

export function joinPath(folder: string, name: string): string {
  return /[\\/]$/.test(folder) ? `${folder}${name}` : `${folder}/${name}`
}

function parentFolder(folder: string): string | undefined {
  const trimmed = folder.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return undefined
  return trimmed.slice(0, cut + 1)
}

function prefixOf(cwd: string, top: string): string {
  return cwd
    .slice(top.length)
    .replace(SEPARATORS, '/')
    .replace(/^\/|\/$/g, '')
}

async function gitDirAt(fs: RepoFs, folder: string): Promise<string | undefined> {
  const dotGit = joinPath(folder, GIT_FOLDER)
  const found = await fs.stat(dotGit)
  if (found?.kind === 'dir') return dotGit
  if (found?.kind !== 'file') return undefined
  const named = GITFILE.exec(await fs.read(dotGit))?.[1]
  if (named === undefined) return undefined
  return ABSOLUTE.test(named) ? named : joinPath(folder, named)
}

export async function findRepo(fs: RepoFs, cwd: string): Promise<GitRepo | undefined> {
  for (let folder: string | undefined = cwd; folder !== undefined; folder = parentFolder(folder)) {
    const gitDir = await gitDirAt(fs, folder)
    if (gitDir !== undefined) return { gitDir, prefix: prefixOf(cwd, folder) }
  }
  return undefined
}

export function branchOf(head: string): string | undefined {
  return HEAD_BRANCH.exec(head)?.[1] ?? HEAD_REF.exec(head)?.[1] ?? HEAD_COMMIT.exec(head)?.[1]
}
