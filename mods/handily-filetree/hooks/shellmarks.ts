import type { EngineInterface, FsEntry, FsStat } from 'claude-code'
import { resolvedPath } from './paths'
import { joinPath } from './repo'
import { underPrefix } from './status'
import type { Listing } from './tree'
import { type Touches, type Window, editorsOf, markShell } from './touches'
import type { ShownRun } from './watch'

const STAMPED_PATHS = 1000

const NO_FILE = 'none'

const FOLDER_STATE: FsEntry['kind'] = 'dir'

type PathState = { state: string; stamp: string | undefined; mtime: number | undefined }

type SnapshotKind = 'git' | 'listing'

export type Snapshot = {
  kind: SnapshotKind
  at: number
  states: ReadonlyMap<string, PathState>
  folders: ReadonlySet<string> | undefined
}

type ShellRun = {
  agent: string
  startedAt: number
  endedAt: number | undefined
  baseline: Snapshot | undefined
  isSeen: boolean
}

export type Shell = {
  touches: Touches
  runs: Map<string, ShellRun>
  latest: Snapshot | undefined
  generation: number
}

export type Listings = Map<string, Listing>

export type ListingSite = {
  cwd: string
  listings: Listings
  shown: ReadonlySet<string>
  relist: (at: string) => Promise<Listing>
}

export function newShell(touches: Touches): Shell {
  return { touches, runs: new Map(), latest: undefined, generation: 0 }
}

export function clearShell(shell: Shell): void {
  shell.runs.clear()
  shell.latest = undefined
  shell.generation += 1
}

export async function stampOf($: EngineInterface, path: string): Promise<string> {
  return stampText(await statOf($, path))
}

async function statOf($: EngineInterface, path: string): Promise<FsStat | undefined> {
  try {
    return await $.fs.stat(path)
  } catch {
    return undefined
  }
}

function stampText(stat: { mtimeMs: number; size: number } | undefined): string {
  return stat === undefined ? NO_FILE : `${String(stat.mtimeMs)} ${String(stat.size)}`
}

function stateKey(entry: { letter: string; isStaged: boolean }): string {
  return `${entry.letter}${entry.isStaged ? '+' : ''}`
}

async function statusSnapshot($: EngineInterface, run: ShownRun): Promise<Snapshot | undefined> {
  if (run.status.isCut) return undefined
  const entries = run.status.entries.flatMap((entry) => {
    const inCwd = underPrefix(entry.path, run.prefix)
    if (inCwd === undefined || inCwd === '') return []
    return [{ path: resolvedPath(run.cwd, inCwd), state: stateKey(entry) }]
  })
  const stamped = entries.slice(0, STAMPED_PATHS)
  const stats = await Promise.all(stamped.map(({ path }) => statOf($, path)))
  const byPath = new Map(stamped.map(({ path }, index) => [path, stats[index]]))
  const stateOf = (path: string, state: string): PathState => {
    if (!byPath.has(path)) return { state, stamp: undefined, mtime: undefined }
    const stat = byPath.get(path)
    return { state, stamp: stampText(stat), mtime: stat?.mtimeMs }
  }
  return {
    kind: 'git',
    at: run.startedAt,
    states: new Map(entries.map(({ path, state }) => [path, stateOf(path, state)])),
    folders: undefined,
  }
}

function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), 0))
}

function isCovered(snapshot: Snapshot, path: string): boolean {
  return snapshot.folders === undefined || snapshot.folders.has(folderOf(path))
}

function changedPaths(before: Snapshot, after: Snapshot): string[] {
  const paths = new Set([...before.states.keys(), ...after.states.keys()])
  return [...paths].filter((path) => {
    if (!isCovered(before, path) || !isCovered(after, path)) return false
    const old = before.states.get(path)
    const now = after.states.get(path)
    if (old?.state !== now?.state) return true
    if (old?.stamp === undefined || now?.stamp === undefined) return false
    return old.stamp !== now.stamp
  })
}

function overlaps(a: ShellRun, b: ShellRun): boolean {
  return a.startedAt <= (b.endedAt ?? Infinity) && b.startedAt <= (a.endedAt ?? Infinity)
}

function pruneRuns(shell: Shell): void {
  const pending = [...shell.runs.values()].filter(
    (run) => run.baseline !== undefined && !run.isSeen,
  )
  for (const [id, run] of shell.runs) {
    const isKept = run.endedAt === undefined || pending.some((other) => overlaps(run, other))
    if (!isKept) shell.runs.delete(id)
  }
}

type Judged = { run: ShellRun; baseline: Snapshot; changed: ReadonlySet<string> }

function judgedRuns(shell: Shell, snapshot: Snapshot): Judged[] {
  return [...shell.runs.values()].flatMap((run) => {
    const { baseline } = run
    if (baseline?.kind !== snapshot.kind || baseline.at > snapshot.at) return []
    return [{ run, baseline, changed: new Set(changedPaths(baseline, snapshot)) }]
  })
}

function isBlocked(shell: Shell, kind: SnapshotKind, window: Window): boolean {
  return [...shell.runs.values()].some(
    (run) =>
      run.baseline?.kind !== kind &&
      run.startedAt <= window.to &&
      (run.endedAt ?? Infinity) >= window.from,
  )
}

type Group = { agents: string[]; paths: string[]; at: number }

function credit(
  shell: Shell,
  snapshot: Snapshot,
  change: { path: string; changedAt: number; judged: readonly Judged[] },
): Group | undefined {
  const writers = change.judged.filter(
    ({ run, changed }) => changed.has(change.path) && change.changedAt <= (run.endedAt ?? Infinity),
  )
  if (writers.length === 0) return undefined
  const window = { from: Math.min(...writers.map(({ baseline }) => baseline.at)), to: snapshot.at }
  if (isBlocked(shell, snapshot.kind, window)) return undefined
  const agents = [
    ...new Set([
      ...writers.map(({ run }) => run.agent),
      ...editorsOf(shell.touches, change.path, window),
    ]),
  ].sort()
  const at = Math.max(
    ...writers.map(({ run }) => Math.min(run.endedAt ?? snapshot.at, snapshot.at)),
  )
  return { agents, paths: [change.path], at }
}

function isFolderIn(snapshot: Snapshot, path: string): boolean {
  return snapshot.states.get(path)?.state === FOLDER_STATE
}

async function judge($: EngineInterface, shell: Shell, snapshot: Snapshot): Promise<void> {
  const { generation } = shell
  const judged = judgedRuns(shell, snapshot)
  const paths = [...new Set(judged.flatMap(({ changed }) => [...changed]))]
  const times = await Promise.all(
    paths.map(async (path) => snapshot.states.get(path)?.mtime ?? (await statOf($, path))?.mtimeMs),
  )
  if (shell.generation !== generation) return
  const groups = new Map<string, Group>()
  paths.forEach((path, index) => {
    const changedAt = times[index]
    if (changedAt === undefined) return
    const group = credit(shell, snapshot, { path, changedAt, judged })
    if (group === undefined) return
    const key = group.agents.join('\n')
    const same = groups.get(key)
    if (same === undefined) groups.set(key, group)
    else groups.set(key, { ...same, paths: [...same.paths, path], at: Math.max(same.at, group.at) })
  })
  for (const group of groups.values()) {
    const folders = new Set(group.paths.filter((path) => isFolderIn(snapshot, path)))
    markShell(shell.touches, { ...group, folders })
  }
  for (const run of shell.runs.values()) {
    if (run.endedAt !== undefined && run.endedAt <= snapshot.at) run.isSeen = true
  }
  pruneRuns(shell)
}

export async function shellStatus($: EngineInterface, shell: Shell, run: ShownRun): Promise<void> {
  const { generation } = shell
  const snapshot = await statusSnapshot($, run)
  if (!run.isCurrent() || shell.generation !== generation) return
  shell.latest = snapshot
  if (snapshot !== undefined) await judge($, shell, snapshot)
}

export function gitBaseline(shell: Shell, startedAt: number | undefined): Snapshot | undefined {
  const { latest } = shell
  return latest !== undefined && latest.at === startedAt ? latest : undefined
}

function listingStates(
  at: string,
  cwd: string,
  entries: readonly FsEntry[],
): [string, PathState][] {
  return entries.map((entry) => [
    resolvedPath(cwd, joinPath(at, entry.name)),
    {
      state: entry.kind,
      stamp: stampText(entry),
      mtime: entry.kind === 'file' ? entry.mtimeMs : undefined,
    },
  ])
}

export async function listingSnapshot(
  $: EngineInterface,
  site: ListingSite,
): Promise<Snapshot | undefined> {
  const at = await $.clock.now()
  const folders = new Set<string>()
  const states: [string, PathState][] = []
  for (const [folder, old] of [...site.listings]) {
    if (!site.shown.has(folder)) continue
    const fresh = await site.relist(folder)
    if (site.listings.get(folder) !== old) continue
    site.listings.set(folder, fresh)
    if (fresh.kind !== 'listed') continue
    folders.add(resolvedPath(site.cwd, folder))
    states.push(...listingStates(folder, site.cwd, fresh.sorted))
  }
  if (folders.size === 0) return undefined
  return { kind: 'listing', at, states: new Map(states), folders }
}

export async function judgeListing(
  $: EngineInterface,
  shell: Shell,
  site: ListingSite,
): Promise<void> {
  const snapshot = await listingSnapshot($, site)
  if (snapshot !== undefined) await judge($, shell, snapshot)
}

export function beginShellRun(
  shell: Shell,
  run: { id: string; agent: string; baseline: Snapshot | undefined; startedAt: number },
): void {
  shell.runs.set(run.id, {
    agent: run.agent,
    startedAt: run.startedAt,
    endedAt: undefined,
    baseline: run.baseline,
    isSeen: false,
  })
}

export function endShellRun(
  shell: Shell,
  run: { id: string; hasRun: boolean; endedAt: number },
): void {
  const found = shell.runs.get(run.id)
  if (found === undefined) return
  if (run.hasRun) found.endedAt ??= run.endedAt
  else shell.runs.delete(run.id)
  pruneRuns(shell)
}

export function endTurn(shell: Shell, turn: { agent: string | undefined; at: number }): void {
  for (const run of shell.runs.values()) {
    if (run.endedAt === undefined && (turn.agent === undefined || run.agent === turn.agent)) {
      run.endedAt = turn.at
    }
  }
  pruneRuns(shell)
}
