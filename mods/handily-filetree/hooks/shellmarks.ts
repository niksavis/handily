import type { EngineInterface, FsEntry, Timer } from 'claude-code'
import { resolvedPath } from './paths'
import { joinPath } from './repo'
import { type GitStatus, underPrefix } from './status'
import type { Listing } from './tree'
import { type Touches, type Window, editedPaths, editorsOf, markShell } from './touches'
import type { ShownRun } from './watch'

const STAMPED_PATHS = 1000

const NO_FILE = 'none'

type PathState = { state: string; stamp: string | undefined }

type PathStates = ReadonlyMap<string, PathState>

type ShellRun = {
  agent: string
  startedAt: number
  endedAt: number | undefined
  stamps: ReadonlyMap<string, string>
}

type Baseline = {
  from: number
  states: PathStates
  isComparable: boolean
  isUntrackedSkipped: boolean
}

type Change = { path: string; stamp: string | undefined }

export type Shell = {
  touches: Touches
  runs: Map<string, ShellRun>
  baseline: Baseline | undefined
  poll: Timer | undefined
  since: number | undefined
  pass: Promise<void>
  generation: number
}

export type ShellSite = { cwd: string | undefined; prefix: string; status: GitStatus | undefined }

export type Listings = Map<string, Listing>

export function newShell(touches: Touches): Shell {
  return {
    touches,
    runs: new Map(),
    baseline: undefined,
    poll: undefined,
    since: undefined,
    pass: Promise.resolve(),
    generation: 0,
  }
}

export function forgetListings(shell: Shell): void {
  shell.since = undefined
}

export function clearShell(shell: Shell): void {
  shell.runs.clear()
  shell.baseline = undefined
  shell.poll = undefined
  shell.since = undefined
  shell.generation += 1
}

export async function stampOf($: EngineInterface, path: string): Promise<string> {
  try {
    const { size, mtimeMs } = await $.fs.stat(path)
    return `${String(mtimeMs)} ${String(size)}`
  } catch {
    return NO_FILE
  }
}

function stateKey(entry: { letter: string; isStaged: boolean }): string {
  return `${entry.letter}${entry.isStaged ? '+' : ''}`
}

function statusPaths(site: ShellSite): { path: string; state: string }[] {
  const { cwd, status } = site
  if (cwd === undefined || status === undefined) return []
  return status.entries.flatMap((entry) => {
    const inCwd = underPrefix(entry.path, site.prefix)
    if (inCwd === undefined || inCwd === '') return []
    return [{ path: resolvedPath(cwd, inCwd), state: stateKey(entry) }]
  })
}

async function stampsOf(
  $: EngineInterface,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const shown = [...new Set(paths)].slice(0, STAMPED_PATHS)
  const stamps = await Promise.all(shown.map((path) => stampOf($, path)))
  return new Map(shown.map((path, index) => [path, stamps[index] ?? '']))
}

export async function beginShellRun(
  $: EngineInterface,
  shell: Shell,
  run: { id: string; agent: string; site: ShellSite },
): Promise<void> {
  const startedAt = await $.clock.now()
  const paths = [...editedPaths(shell.touches), ...statusPaths(run.site).map(({ path }) => path)]
  const stamps = await stampsOf($, paths)
  shell.runs.set(run.id, { agent: run.agent, startedAt, endedAt: undefined, stamps })
}

export async function endShellRun(
  $: EngineInterface,
  shell: Shell,
  run: { id: string; hasRun: boolean },
): Promise<void> {
  const found = shell.runs.get(run.id)
  if (found === undefined) return
  if (!run.hasRun) {
    shell.runs.delete(run.id)
    return
  }
  found.endedAt = await $.clock.now()
}

function changedPaths(before: PathStates, after: PathStates, hasGone: boolean): string[] {
  const paths = hasGone ? new Set([...before.keys(), ...after.keys()]) : new Set(after.keys())
  return [...paths].filter((path) => {
    const old = before.get(path)
    const now = after.get(path)
    if (old?.state !== now?.state) return true
    if (old?.stamp === undefined || now?.stamp === undefined) return false
    return old.stamp !== now.stamp
  })
}

function overlaps(run: ShellRun, window: Window): boolean {
  return run.startedAt <= window.to && (run.endedAt === undefined || run.endedAt >= window.from)
}

function writersOf(shell: Shell, change: Change, window: Window): ShellRun[] {
  return [...shell.runs.values()].filter(
    (run) =>
      overlaps(run, window) &&
      (change.stamp === undefined || run.stamps.get(change.path) !== change.stamp),
  )
}

function attribute(shell: Shell, window: Window, changes: readonly Change[]): void {
  const { touches } = shell
  const groups = new Map<string, { agents: string[]; paths: string[]; at: number }>()
  for (const change of changes) {
    const writers = writersOf(shell, change, window)
    if (writers.length === 0) continue
    const agents = [
      ...new Set([...writers.map((run) => run.agent), ...editorsOf(touches, change.path, window)]),
    ].sort()
    const at = Math.max(...writers.map((run) => Math.min(run.endedAt ?? window.to, window.to)))
    const key = agents.join('\n')
    const group = groups.get(key) ?? { agents, paths: [], at }
    group.paths.push(change.path)
    group.at = Math.max(group.at, at)
    groups.set(key, group)
  }
  for (const group of groups.values()) markShell(touches, group)
}

function pruneRuns(shell: Shell, before: number): void {
  for (const [id, run] of shell.runs) {
    if (run.endedAt !== undefined && run.endedAt < before) shell.runs.delete(id)
  }
}

async function withStamps(
  $: EngineInterface,
  paths: readonly string[],
  states: PathStates,
): Promise<Change[]> {
  const missing = paths.filter((path) => states.get(path)?.stamp === undefined)
  const stamped = await stampsOf($, missing)
  return paths.map((path) => ({ path, stamp: states.get(path)?.stamp ?? stamped.get(path) }))
}

export async function shellStatus($: EngineInterface, shell: Shell, run: ShownRun): Promise<void> {
  const { generation } = shell
  const entries = statusPaths({ cwd: run.cwd, prefix: run.prefix, status: run.status })
  const stamps = await stampsOf(
    $,
    entries.map(({ path }) => path),
  )
  const states: PathStates = new Map(
    entries.map(({ path, state }) => [path, { state, stamp: stamps.get(path) }]),
  )
  const before = shell.poll === run.poll ? shell.baseline : undefined
  const isComparable = !run.status.isCut
  const { isUntrackedSkipped } = run
  const changed =
    before?.isComparable === true &&
    isComparable &&
    before.isUntrackedSkipped === isUntrackedSkipped
      ? await withStamps($, changedPaths(before.states, states, true), states)
      : []
  const to = await $.clock.now()
  if (!run.isCurrent() || shell.generation !== generation) return
  shell.poll = run.poll
  shell.baseline = { from: run.startedAt, states, isComparable, isUntrackedSkipped }
  if (before !== undefined) attribute(shell, { from: before.from, to }, changed)
  pruneRuns(shell, run.startedAt)
}

function listingStates(at: string, cwd: string, entries: readonly FsEntry[]): PathStates {
  return new Map(
    entries.map((entry) => [
      resolvedPath(cwd, joinPath(at, entry.name)),
      { state: entry.kind, stamp: `${String(entry.mtimeMs)} ${String(entry.size)}` },
    ]),
  )
}

export function startListings(shell: Shell, now: number): void {
  shell.since ??= now
}

async function relistOpen(
  $: EngineInterface,
  shell: Shell,
  site: { cwd: string; listings: Listings; relist: (at: string) => Promise<Listing> },
): Promise<void> {
  const { generation, since } = shell
  const passAt = await $.clock.now()
  if (since === undefined) return
  const changes: Change[] = []
  for (const [at, old] of [...site.listings]) {
    const fresh = await site.relist(at)
    if (site.listings.get(at) !== old || shell.generation !== generation) continue
    site.listings.set(at, fresh)
    if (old.kind !== 'listed' || fresh.kind !== 'listed') continue
    const after = listingStates(at, site.cwd, fresh.sorted)
    const paths = changedPaths(listingStates(at, site.cwd, old.sorted), after, false)
    changes.push(...paths.map((path) => ({ path, stamp: after.get(path)?.stamp })))
  }
  const to = await $.clock.now()
  if (shell.generation !== generation || shell.since !== since) return
  shell.since = passAt
  attribute(shell, { from: since, to }, changes)
  pruneRuns(shell, passAt)
}

export function relistAfterShell(
  $: EngineInterface,
  shell: Shell,
  site: { cwd: string; listings: Listings; relist: (at: string) => Promise<Listing> },
): void {
  shell.pass = shell.pass
    .then(async () => {
      await relistOpen($, shell, site)
      $.ui.invalidate('ui.render')
    })
    .catch((error: unknown) => {
      $.ui.log(`handily-filetree: the open folders were not listed again: ${String(error)}`)
    })
}
