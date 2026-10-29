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

const WORK_ROWS = 40

export type WorkPath = { path: string; isFolder: boolean }

export type WorkSource = {
  changed: readonly ChangedEntry[]
  touched: readonly WorkPath[]
  isFiltered: boolean
}

export type WorkEntry = WorkPath & { isChanged: boolean }

export type WorkTree = {
  folders: ReadonlySet<string>
  listings: ReadonlyMap<string, Listing>
  changed: ReadonlySet<string>
}

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

export function workPaths(source: WorkSource): WorkEntry[] {
  const changed = new Map(source.changed.map((entry) => [entry.path, entry.isFolder]))
  const byPath = new Map<string, WorkPath>()
  if (!source.isFiltered) {
    for (const [path, isFolder] of changed) byPath.set(path, { path, isFolder })
  }
  for (const { path, isFolder } of source.touched) {
    if (path !== '' && !byPath.has(path))
      byPath.set(path, { path, isFolder: isFolder || changed.get(path) === true })
  }
  const untracked = [...byPath.keys()].filter((path) => changed.get(path) === true)
  const inUntracked = [...changed].flatMap(([path, isFolder]) => (isFolder ? [path] : []))
  const isChanged = (path: string) =>
    changed.has(path) || inUntracked.some((folder) => isInside(path, folder))
  return [...byPath.values()]
    .filter(({ path }) => !untracked.some((folder) => isInside(path, folder)))
    .map((entry) => ({ ...entry, isChanged: isChanged(entry.path) }))
}

export function workTree(paths: readonly WorkEntry[]): WorkTree {
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
  const changed = new Set(paths.flatMap(({ path, isChanged }) => (isChanged ? [path] : [])))
  return { folders: new Set(listings.keys()), listings, changed }
}

function workOpen(tree: WorkTree, folders: WorkFolders): Set<string> {
  return new Set([
    ...[...tree.folders].filter((folder) => !folders.shut.has(folder)),
    ...[...folders.open].filter((folder) => !tree.folders.has(folder)),
  ])
}

function joinedName(
  tree: WorkTree,
  chain: { folder: string; name: string },
  shut: ReadonlySet<string>,
): string {
  const { folder, name } = chain
  const path = childPath(folder, name)
  const listing = tree.listings.get(path)
  if (shut.has(path) || listing?.kind !== 'listed' || listing.sorted.length !== 1) return name
  const [only] = listing.sorted
  if (only?.kind !== 'dir' || !tree.listings.has(childPath(path, only.name))) return name
  return joinedName(tree, { folder, name: `${name}/${only.name}` }, shut)
}

function joinedListing(
  tree: WorkTree,
  shut: ReadonlySet<string>,
  site: { folder: string; listing: Listing },
): Listing {
  const { folder, listing } = site
  if (listing.kind === 'failed') return listing
  return {
    kind: 'listed',
    sorted: listing.sorted.map((entry) =>
      entry.kind === 'dir'
        ? { ...entry, name: joinedName(tree, { folder, name: entry.name }, shut) }
        : entry,
    ),
  }
}

export function chainTop(row: { path: string; name: string }): string {
  const joined = row.name.split('/').length - 1
  return joined === 0 ? row.path : row.path.split('/').slice(0, -joined).join('/')
}

type RowPlaces = { drawn: Map<string, number>; holders: Map<string, number> }

function rowPlaces(rows: readonly TreeRow[]): RowPlaces {
  const places: RowPlaces = { drawn: new Map(), holders: new Map() }
  rows.forEach((row, at) => {
    if (row.kind === 'more') places.holders.set(row.path, at)
    if (row.kind !== 'file' && row.kind !== 'folder' && row.kind !== 'pruned') return
    places.drawn.set(row.path, at)
    if (row.kind === 'folder' && !row.isOpen) places.holders.set(row.path, at)
  })
  return places
}

function placeOf(places: RowPlaces, path: string): number | undefined {
  const drawn = places.drawn.get(path)
  if (drawn !== undefined) return drawn
  for (let folder = parentOf(path); ; folder = parentOf(folder)) {
    const holder = places.holders.get(folder)
    if (holder !== undefined || folder === ROOT_PATH) return holder
  }
}

function workMore(tree: WorkTree, rows: readonly TreeRow[]): TreeRow {
  const places = rowPlaces(rows)
  const isHidden = (path: string) => {
    const at = placeOf(places, path)
    return at !== undefined && at >= WORK_ROWS
  }
  const hidden = [...tree.changed].filter(isHidden)
  return {
    kind: 'workMore',
    path: ROOT_PATH,
    changed: hidden.length,
    folders: new Set(hidden.map(parentOf)).size,
    rows: rows.length - WORK_ROWS,
  }
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
    const listing = tree.listings.get(path)
    if (listing === undefined) return list(path)
    return Promise.resolve(joinedListing(tree, folders.shut, { folder: path, listing }))
  }
  const open = workOpen(tree, folders)
  const rows = await treeRows(
    workList,
    { open, whole: folders.whole, work: tree.folders },
    rootName,
  )
  if (folders.whole.has(ROOT_PATH) || rows.length <= WORK_ROWS) return rows
  return [...rows.slice(0, WORK_ROWS), workMore(tree, rows)]
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
