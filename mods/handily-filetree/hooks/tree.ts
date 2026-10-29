import type { FsEntry } from 'claude-code'

export const ROOT_PATH = '.'

export const ENTRIES_DRAWN = 200

export const PRUNED: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'target',
  '.venv',
  '__pycache__',
  'dist',
  '.next',
])

export type Listing =
  { kind: 'listed'; sorted: readonly FsEntry[] } | { kind: 'failed'; reason: string }

export type ListFolder = (path: string) => Promise<Listing>

export type Folders = {
  open: ReadonlySet<string>
  whole: ReadonlySet<string>
  work?: ReadonlySet<string>
}

export type EntryRow =
  | { kind: 'folder'; path: string; name: string; depth: number; isOpen: boolean }
  | { kind: 'pruned'; path: string; name: string; depth: number }
  | { kind: 'file'; path: string; name: string; depth: number; isDot: boolean }

export type TreeRow =
  | EntryRow
  | { kind: 'more'; path: string; name: string; depth: number; hidden: number }
  | { kind: 'workMore'; path: string; changed: number; folders: number }
  | { kind: 'failed'; name: string; depth: number; reason: string }
  | { kind: 'empty' }

const FOLDER_RANK = { pruned: 0, folder: 1, file: 2 } as const

function isPruned(entry: FsEntry): boolean {
  return entry.kind === 'dir' && PRUNED.has(entry.name)
}

function rankOf(entry: FsEntry): number {
  if (isPruned(entry)) return FOLDER_RANK.pruned
  return entry.kind === 'dir' ? FOLDER_RANK.folder : FOLDER_RANK.file
}

function byName(a: string, b: string): number {
  const folded = a.toLowerCase()
  const other = b.toLowerCase()
  if (folded !== other) return folded < other ? -1 : 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

export function listed(entries: readonly FsEntry[]): Listing {
  return {
    kind: 'listed',
    sorted: [...entries].sort((a, b) => rankOf(a) - rankOf(b) || byName(a.name, b.name)),
  }
}

export function withDeleted(
  listing: Listing,
  deleted: readonly FsEntry[],
  isDeletedFolder: boolean,
): Listing {
  if (deleted.length === 0) return listing
  if (listing.kind === 'failed') return isDeletedFolder ? listed(deleted) : listing
  const names = new Set(listing.sorted.map((entry) => entry.name))
  const missing = deleted.filter((entry) => !names.has(entry.name))
  return missing.length === 0 ? listing : listed([...listing.sorted, ...missing])
}

export function childPath(parent: string, name: string): string {
  return parent === ROOT_PATH ? name : `${parent}/${name}`
}

export function entryRow(entry: FsEntry, path: string, depth: number, folders: Folders): EntryRow {
  const { name } = entry
  if (isPruned(entry) && folders.work?.has(path) !== true)
    return { kind: 'pruned', path, name, depth }
  if (entry.kind === 'dir')
    return { kind: 'folder', path, name, depth, isOpen: folders.open.has(path) }
  return { kind: 'file', path, name, depth, isDot: name.startsWith('.') }
}

type Walk = { rows: TreeRow[]; list: ListFolder; folders: Folders }

async function addFolder(
  walk: Walk,
  folder: { path: string; name: string; depth: number },
  sorted: readonly FsEntry[],
): Promise<void> {
  const drawn = walk.folders.whole.has(folder.path) ? sorted : sorted.slice(0, ENTRIES_DRAWN)
  for (const entry of drawn) {
    const row = entryRow(entry, childPath(folder.path, entry.name), folder.depth, walk.folders)
    walk.rows.push(row)
    if (row.kind === 'folder' && row.isOpen) await addOpenFolder(walk, row)
  }
  const hidden = sorted.length - drawn.length
  if (hidden > 0) {
    walk.rows.push({
      kind: 'more',
      path: folder.path,
      name: folder.name,
      depth: folder.depth,
      hidden,
    })
  }
}

async function addOpenFolder(
  walk: Walk,
  row: { path: string; name: string; depth: number },
): Promise<void> {
  const listing = await walk.list(row.path)
  if (listing.kind === 'failed') {
    walk.rows.push({ kind: 'failed', name: row.name, depth: row.depth + 1, reason: listing.reason })
    return
  }
  await addFolder(walk, { path: row.path, name: row.name, depth: row.depth + 1 }, listing.sorted)
}

export async function treeRows(
  list: ListFolder,
  folders: Folders,
  rootName: string,
): Promise<TreeRow[]> {
  const root = await list(ROOT_PATH)
  if (root.kind === 'failed') {
    return [{ kind: 'failed', name: rootName, depth: 0, reason: root.reason }]
  }
  if (root.sorted.length === 0) return [{ kind: 'empty' }]
  const walk: Walk = { rows: [], list, folders }
  await addFolder(walk, { path: ROOT_PATH, name: rootName, depth: 0 }, root.sorted)
  return walk.rows
}
