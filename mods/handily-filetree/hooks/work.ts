import type { FsEntry } from 'claude-code'
import { type ChangedEntry, ghost } from './status'
import {
  type EntryRow,
  type ListFolder,
  type Listing,
  type TreeRow,
  ROOT_PATH,
  childPath,
  listed,
  treeRows,
} from './tree'

export type WorkPath = { path: string; isFolder: boolean }

export type WorkSource = {
  changed: readonly ChangedEntry[]
  touched: readonly string[]
  isFiltered: boolean
}

export type WorkTree = { folders: ReadonlySet<string>; listings: ReadonlyMap<string, Listing> }

export type WorkFolders = {
  open: ReadonlySet<string>
  whole: ReadonlySet<string>
  shut: ReadonlySet<string>
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? ROOT_PATH : path.slice(0, cut)
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function isInside(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`)
}

export function workPaths(source: WorkSource): WorkPath[] {
  const changed = new Map(source.changed.map((entry) => [entry.path, entry.isFolder]))
  const byPath = new Map<string, WorkPath>()
  if (!source.isFiltered) {
    for (const [path, isFolder] of changed) byPath.set(path, { path, isFolder })
  }
  for (const path of source.touched) {
    if (path !== '' && !byPath.has(path))
      byPath.set(path, { path, isFolder: changed.get(path) === true })
  }
  const whole = [...byPath.values()].filter((entry) => entry.isFolder).map((entry) => entry.path)
  return [...byPath.values()].filter(({ path }) => !whole.some((folder) => isInside(path, folder)))
}

export function workTree(paths: readonly WorkPath[]): WorkTree {
  const children = new Map<string, Map<string, FsEntry>>()
  const add = (path: string, isFolder: boolean): void => {
    const parent = parentOf(path)
    const inParent = children.get(parent) ?? new Map<string, FsEntry>()
    const name = nameOf(path)
    if (isFolder || !inParent.has(name)) inParent.set(name, ghost(name, isFolder))
    children.set(parent, inParent)
    if (parent !== ROOT_PATH) add(parent, true)
  }
  for (const { path, isFolder } of paths) add(path, isFolder)
  const listings = new Map(
    [...children].map(([folder, entries]) => [folder, listed([...entries.values()])]),
  )
  return { folders: new Set(listings.keys()), listings }
}

function workOpen(tree: WorkTree, folders: WorkFolders): Set<string> {
  return new Set([
    ...[...tree.folders].filter((folder) => !folders.shut.has(folder)),
    ...[...folders.open].filter((folder) => !tree.folders.has(folder)),
  ])
}

export async function workRows(
  list: ListFolder,
  site: { tree: WorkTree; folders: WorkFolders },
  rootName: string,
): Promise<TreeRow[]> {
  const { tree, folders } = site
  const root = await list(ROOT_PATH)
  if (root.kind === 'failed' || root.sorted.length === 0) {
    return treeRows(list, { open: new Set(), whole: new Set() }, rootName)
  }
  if (!tree.listings.has(ROOT_PATH)) return []
  const workList: ListFolder = (path) => {
    const kept = tree.listings.get(path)
    return kept === undefined ? list(path) : Promise.resolve(kept)
  }
  const open = workOpen(tree, folders)
  return treeRows(workList, { open, whole: folders.whole, work: tree.folders }, rootName)
}

function treeOrder(tree: WorkTree): WorkPath[] {
  const ordered: WorkPath[] = []
  const walk = (folder: string): void => {
    const listing = tree.listings.get(folder)
    if (listing?.kind !== 'listed') return
    for (const entry of listing.sorted) {
      const path = childPath(folder, entry.name)
      if (tree.listings.has(path)) walk(path)
      else ordered.push({ path, isFolder: entry.kind === 'dir' })
    }
  }
  walk(ROOT_PATH)
  return ordered
}

function holds(entry: WorkPath, path: string): boolean {
  return entry.path === path || (entry.isFolder && isInside(path, entry.path))
}

export function nowFirst(tree: WorkTree, nowPaths: readonly string[]): WorkPath[] {
  const ordered = treeOrder(tree)
  const first = new Set(nowPaths.flatMap((path) => ordered.filter((entry) => holds(entry, path))))
  return [...first, ...ordered.filter((entry) => !first.has(entry))]
}

export function flatEntryRow(entry: WorkPath): EntryRow {
  const { path, isFolder } = entry
  if (isFolder) return { kind: 'folder', path, name: path, depth: 0, isOpen: false }
  return { kind: 'file', path, name: path, depth: 0, isDot: nameOf(path).startsWith('.') }
}
