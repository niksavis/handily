import type { FsEntry } from 'claude-code'

export type GitLetter = 'M' | 'A' | '?' | 'D' | 'R' | 'U'

const COUNT_ORDER: readonly GitLetter[] = ['U', 'M', 'A', 'R', 'D', '?']

export type GitEntry = {
  path: string
  letter: GitLetter
  isFolder: boolean
  isStaged: boolean
  renamedFrom: string | undefined
}

export type GitStatus = {
  isInitial: boolean
  ahead: number
  behind: number
  entries: GitEntry[]
  isCut: boolean
}

export function statusArgv(isUntrackedSkipped: boolean): readonly string[] {
  return [
    'git',
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    `--untracked-files=${isUntrackedSkipped ? 'no' : 'normal'}`,
    '--',
    '.',
  ]
}

const FIELDS_BEFORE_PATH = { ordinary: 8, renamed: 9, unmerged: 10, untracked: 1 } as const
const AHEAD_BEHIND = /^# branch\.ab \+(\d+) -(\d+)$/
const UNCHANGED = '.'

function pathAfter(record: string, fields: number): string | undefined {
  let at = 0
  for (let field = 0; field < fields; field += 1) {
    const space = record.indexOf(' ', at)
    if (space < 0) return undefined
    at = space + 1
  }
  return record.slice(at)
}

function ordinaryLetter(xy: string): GitLetter {
  if (xy.includes('D')) return 'D'
  if (xy.startsWith('A')) return 'A'
  return 'M'
}

function readHeader(status: GitStatus, record: string): void {
  if (record === '# branch.oid (initial)') status.isInitial = true
  const counts = AHEAD_BEHIND.exec(record)
  if (counts !== null) {
    status.ahead = Number(counts[1])
    status.behind = Number(counts[2])
  }
}

function tracked(path: string, letter: GitLetter, xy: string, renamedFrom?: string): GitEntry {
  return { path, letter, isFolder: false, isStaged: !xy.startsWith(UNCHANGED), renamedFrom }
}

export function parseStatus(stdout: string, isTruncated: boolean): GitStatus {
  const records = stdout.split('\0')
  records.pop()
  const status: GitStatus = {
    isInitial: false,
    ahead: 0,
    behind: 0,
    entries: [],
    isCut: isTruncated,
  }
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? ''
    const xy = record.slice(2, 4)
    switch (record[0]) {
      case '#':
        readHeader(status, record)
        break
      case '1': {
        const path = pathAfter(record, FIELDS_BEFORE_PATH.ordinary)
        if (path !== undefined) status.entries.push(tracked(path, ordinaryLetter(xy), xy))
        break
      }
      case '2': {
        const path = pathAfter(record, FIELDS_BEFORE_PATH.renamed)
        const origin = records[index + 1]
        index += 1
        if (path === undefined || origin === undefined) break
        const letter = xy.includes('R') ? 'R' : 'A'
        status.entries.push(tracked(path, letter, xy, origin))
        break
      }
      case 'u': {
        const path = pathAfter(record, FIELDS_BEFORE_PATH.unmerged)
        if (path !== undefined) status.entries.push(tracked(path, 'U', xy))
        break
      }
      case '?': {
        const path = pathAfter(record, FIELDS_BEFORE_PATH.untracked) ?? ''
        const isFolder = path.endsWith('/')
        status.entries.push({
          path: isFolder ? path.slice(0, -1) : path,
          letter: '?',
          isFolder,
          isStaged: false,
          renamedFrom: undefined,
        })
        break
      }
    }
  }
  return status
}

export type GitCount = { letter: GitLetter; count: number | null }

export type ChangedEntry = { path: string; letter: GitLetter; isFolder: boolean }

export type GitMarks = {
  isInitial: boolean
  letterOf: (path: string) => GitLetter | undefined
  isStagedOf: (path: string) => boolean
  changedIn: (folder: string) => readonly ChangedEntry[]
  countsOf: (folder: string) => readonly GitCount[]
  renamedFromOf: (path: string) => { from: string; isStaged: boolean } | undefined
  deletedIn: (folder: string) => readonly FsEntry[]
  isDeletedFolder: (folder: string) => boolean
}

const ROOT = '.'

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? ROOT : path.slice(0, cut)
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function foldersAbove(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}

function underPrefix(path: string, prefix: string): string | undefined {
  if (prefix === '') return path
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : undefined
}

function ghost(name: string, isFolder: boolean): FsEntry {
  return { name, kind: isFolder ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false }
}

function countsIn(counts: ReadonlyMap<GitLetter, number> | undefined): GitCount[] {
  if (counts === undefined) return []
  return COUNT_ORDER.filter((letter) => counts.has(letter)).map((letter) => ({
    letter,
    count: counts.get(letter) ?? 0,
  }))
}

function shownOrigin(path: string, origin: string, prefix: string): string {
  const inCwd = underPrefix(origin, prefix)
  if (inCwd === undefined) return origin
  return parentOf(inCwd) === parentOf(path) ? nameOf(inCwd) : inCwd
}

function isUnder(path: string, folder: string): boolean {
  return folder === ROOT || path === folder || path.startsWith(`${folder}/`)
}

function changedUnder(byPath: ReadonlyMap<string, GitEntry>, folder: string): ChangedEntry[] {
  return [...byPath]
    .filter(([path]) => isUnder(path, folder))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, entry]) => ({ path, letter: entry.letter, isFolder: entry.isFolder }))
}

function holdsPrefix(entry: GitEntry, prefix: string): boolean {
  if (prefix === '' || entry.letter !== '?' || !entry.isFolder) return false
  return prefix === entry.path || prefix.startsWith(`${entry.path}/`)
}

export function gitMarks(status: GitStatus, prefix: string): GitMarks {
  const isAllUntracked = status.entries.some((entry) => holdsPrefix(entry, prefix))
  const byPath = new Map<string, GitEntry>()
  const untrackedFolders: string[] = []
  const counts = new Map<string, Map<GitLetter, number>>()
  const deleted = new Map<string, Map<string, FsEntry>>()
  const deletedFolders = new Set<string>()
  for (const entry of status.entries) {
    const path = underPrefix(entry.path, prefix)
    if (path === undefined || path === '') continue
    byPath.set(path, entry)
    if (entry.letter === '?' && entry.isFolder) untrackedFolders.push(path)
    for (const folder of foldersAbove(path)) {
      const folderCounts = counts.get(folder) ?? new Map<GitLetter, number>()
      folderCounts.set(entry.letter, (folderCounts.get(entry.letter) ?? 0) + 1)
      counts.set(folder, folderCounts)
    }
    if (entry.letter === 'D') {
      for (const folder of foldersAbove(path)) deletedFolders.add(folder)
      for (const at of [...foldersAbove(path), path]) {
        const inFolder = deleted.get(parentOf(at)) ?? new Map<string, FsEntry>()
        inFolder.set(nameOf(at), ghost(nameOf(at), at !== path))
        deleted.set(parentOf(at), inFolder)
      }
    }
  }
  const isUntracked = (path: string) =>
    isAllUntracked ||
    untrackedFolders.some((folder) => path === folder || path.startsWith(`${folder}/`))
  return {
    isInitial: status.isInitial,
    letterOf: (path) => byPath.get(path)?.letter ?? (isUntracked(path) ? '?' : undefined),
    isStagedOf: (path) => byPath.get(path)?.isStaged === true,
    changedIn: (folder) => changedUnder(byPath, folder),
    countsOf: (folder) =>
      isUntracked(folder) ? [{ letter: '?', count: null }] : countsIn(counts.get(folder)),
    renamedFromOf: (path) => {
      const entry = byPath.get(path)
      if (entry?.renamedFrom === undefined) return undefined
      return { from: shownOrigin(path, entry.renamedFrom, prefix), isStaged: entry.isStaged }
    },
    deletedIn: (folder) => [...(deleted.get(folder)?.values() ?? [])],
    isDeletedFolder: (folder) => deletedFolders.has(folder),
  }
}
