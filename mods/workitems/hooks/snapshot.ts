import type { FsEntry, ProcessRunResult } from 'claude-code'
import type {
  WorkitemsDiff,
  WorkitemsItem,
  WorkitemsRefreshArgs,
  WorkitemsRefreshResult,
  WorkitemsSnapshot,
} from '../types'
import {
  resolveProgram,
  sha256Hex,
  type Approvals,
  type FileDigest,
  type SearchPath,
} from './approval'
import { FileProblem, isInside } from './config'
import { detect } from './detect'
import type { ReadOutcome, Reader, TrackerFiles } from './readers/index'

export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const POLL_INTERVAL_MS = 2000
export const DIFF_HISTORY_LIMIT = 50

export type FileStat = {
  size: number
  mtimeMs: number
  realPath?: string
  kind?: 'file' | 'dir' | 'other'
}

export type CommandHost = {
  canRun: () => Promise<boolean>
  run: (
    argv: readonly string[],
    cwd: string,
    env?: Readonly<Record<string, string>>,
  ) => Promise<ProcessRunResult>
  searchPath: () => Promise<SearchPath>
  approvals: Approvals
}

export type ProviderHost = {
  root: () => Promise<string>
  now: () => Promise<number>
  exists: (path: string) => Promise<boolean>
  stat: (path: string, options?: { resolve: boolean }) => Promise<FileStat>
  list: (path: string) => Promise<FsEntry[]>
  read: (path: string) => Promise<string>
  readBytes: (path: string) => Promise<Uint8Array>
  commands: CommandHost
  publish: (snapshot: WorkitemsSnapshot) => Promise<void>
}

export type Provider = {
  refresh: (args?: WorkitemsRefreshArgs) => Promise<WorkitemsRefreshResult>
}

function emptyDiff(): WorkitemsDiff {
  return { created: [], updated: [], closed: [] }
}

export function pathAtRoot(root: string, relativePath: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${relativePath}`
}

function filesAtRoot(host: ProviderHost, root: string): TrackerFiles {
  async function statAt(relativePath: string): Promise<FileStat> {
    try {
      const { size, mtimeMs, kind } = await host.stat(pathAtRoot(root, relativePath))
      return kind === undefined ? { size, mtimeMs } : { size, mtimeMs, kind }
    } catch {
      throw new FileProblem(`${relativePath} could not be read.`)
    }
  }
  async function realPathOf(path: string): Promise<string | undefined> {
    try {
      return (await host.stat(path, { resolve: true })).realPath ?? path
    } catch {
      return undefined
    }
  }
  let rootReal: Promise<string | undefined> | undefined
  async function confinedPath(relativePath: string): Promise<string> {
    const path = pathAtRoot(root, relativePath)
    rootReal ??= realPathOf(root)
    const base = await rootReal
    if (base === undefined) throw new FileProblem('the repo root could not be read.')
    const real = await realPathOf(path)
    if (real === undefined) throw new FileProblem(`${relativePath} could not be read.`)
    if (!isInside(base, real)) {
      throw new FileProblem(
        `${relativePath} resolves outside the repo root, so it could not be read.`,
      )
    }
    return path
  }
  async function hashAt(relativePath: string): Promise<FileDigest | undefined> {
    const path = pathAtRoot(root, relativePath)
    let stat: FileStat
    try {
      stat = await host.stat(path)
    } catch {
      return undefined
    }
    if (stat.kind === 'dir') return undefined
    if (stat.size > MAX_FILE_BYTES) return { size: stat.size, mtimeMs: stat.mtimeMs }
    try {
      return { sha256: await sha256Hex(await host.readBytes(path)) }
    } catch {
      throw new FileProblem(`${relativePath} could not be read.`)
    }
  }
  return {
    root,
    stat: statAt,
    hash: hashAt,
    commands: {
      canRun: () => host.commands.canRun(),
      run: (argv, env) => host.commands.run(argv, root, env),
      which: (program) =>
        resolveProgram(program, {
          searchPath: () => host.commands.searchPath(),
          exists: (path) => host.exists(path),
          realPath: realPathOf,
          realPathAtRoot: (relativePath) => realPathOf(pathAtRoot(root, relativePath)),
        }),
      approvals: host.commands.approvals,
    },
    exists: (relativePath) => host.exists(pathAtRoot(root, relativePath)),
    list: async (relativeDirectory) => {
      try {
        return await host.list(pathAtRoot(root, relativeDirectory))
      } catch {
        throw new FileProblem(`${relativeDirectory} could not be read.`)
      }
    },
    realPath: async (relativePath) => {
      try {
        return (await host.stat(pathAtRoot(root, relativePath), { resolve: true })).realPath
      } catch {
        return undefined
      }
    },
    read: async (relativePath) => {
      const path = await confinedPath(relativePath)
      const stat = await statAt(relativePath)
      if (stat.size > MAX_FILE_BYTES) throw new FileProblem(`${relativePath} is over 4 MiB.`)
      try {
        return await host.read(path)
      } catch {
        throw new FileProblem(`${relativePath} could not be read.`)
      }
    },
  }
}

export function diffItems(
  before: readonly WorkitemsItem[],
  after: readonly WorkitemsItem[],
  isMissingClosed = false,
): WorkitemsDiff {
  const previous = new Map(before.map((item) => [item.key, item]))
  const diff = {
    created: [] as WorkitemsItem[],
    updated: [] as WorkitemsItem[],
    closed: [] as WorkitemsItem[],
  }
  for (const item of after) {
    const old = previous.get(item.key)
    if (!old) diff.created.push(item)
    else if (old.status !== 'closed' && item.status === 'closed') diff.closed.push(item)
    else if (JSON.stringify(old) !== JSON.stringify(item)) diff.updated.push(item)
  }
  if (!isMissingClosed) return diff
  const current = new Set(after.map((item) => item.key))
  for (const old of before) {
    if (!current.has(old.key) && old.status !== 'closed')
      diff.closed.push({ ...old, status: 'closed' })
  }
  return diff
}

async function readSafely(reader: Reader, files: TrackerFiles): Promise<ReadOutcome> {
  try {
    return await reader.read(files)
  } catch (error) {
    if (error instanceof FileProblem) return { ok: false, reason: error.reason }
    throw error
  }
}

async function signatureOf(
  host: ProviderHost,
  files: TrackerFiles,
  root: string,
  reader: Reader,
): Promise<string> {
  try {
    if (reader.signature) return [root, reader.name, await reader.signature(files)].join('\n')
    const stat = await host.stat(pathAtRoot(root, reader.marker))
    return [root, reader.name, String(stat.mtimeMs), String(stat.size)].join('\n')
  } catch {
    return [root, reader.name, 'unreadable'].join('\n')
  }
}

type DiffKind = keyof WorkitemsDiff

const KINDS_BY_STRENGTH: readonly DiffKind[] = ['updated', 'closed', 'created']

export function mergeDiffs(diffs: readonly WorkitemsDiff[]): WorkitemsDiff {
  const merged = new Map<string, { kind: DiffKind; item: WorkitemsItem }>()
  for (const diff of diffs) {
    for (const kind of KINDS_BY_STRENGTH) {
      for (const item of diff[kind]) {
        const seen = merged.get(item.key)
        const isSeenStronger =
          seen !== undefined &&
          KINDS_BY_STRENGTH.indexOf(seen.kind) > KINDS_BY_STRENGTH.indexOf(kind)
        merged.set(item.key, { kind: isSeenStronger ? seen.kind : kind, item })
      }
    }
  }
  const result = {
    created: [] as WorkitemsItem[],
    updated: [] as WorkitemsItem[],
    closed: [] as WorkitemsItem[],
  }
  for (const { kind, item } of merged.values()) result[kind].push(item)
  return result
}

type Stamps = 'version' | 'at' | 'checkedAt'
type SnapshotData = WorkitemsSnapshot extends infer S
  ? S extends unknown
    ? Omit<S, Stamps>
    : never
  : never

type ReadResult = { data: SnapshotData; baselineItems: readonly WorkitemsItem[] | undefined }

async function readSource(
  reader: Reader,
  ignored: readonly string[],
  files: TrackerFiles,
  root: string,
): Promise<ReadResult> {
  const outcome = await readSafely(reader, files)
  const sourced = { root, source: reader.name, caveat: null, items: [], ignored }
  if (!outcome.ok && 'state' in outcome && outcome.state === 'terminal-only') {
    return {
      baselineItems: undefined,
      data: { ...sourced, state: outcome.state, reason: null, sourceLabel: outcome.sourceLabel },
    }
  }
  if (!outcome.ok && 'state' in outcome) {
    return {
      baselineItems: undefined,
      data: {
        ...sourced,
        state: outcome.state,
        reason: outcome.command,
        sourceLabel: outcome.sourceLabel,
      },
    }
  }
  if (!outcome.ok) {
    return {
      baselineItems: undefined,
      data: {
        state: 'failed',
        reason: outcome.reason,
        root,
        source: reader.name,
        sourceLabel: reader.name,
        caveat: null,
        items: [],
        ignored,
      },
    }
  }
  return {
    baselineItems: outcome.items,
    data: {
      state: 'ok',
      reason: null,
      root,
      source: reader.name,
      sourceLabel: outcome.sourceLabel,
      caveat: outcome.caveat,
      items: outcome.items,
      ignored,
      ...(outcome.adapterWrites === undefined ? {} : { adapterWrites: outcome.adapterWrites }),
    },
  }
}

function noTracker(root: string, lookedFor: `looked for ${string}`): ReadResult {
  return {
    baselineItems: [],
    data: {
      state: 'no-tracker',
      reason: lookedFor,
      root,
      source: null,
      sourceLabel: null,
      caveat: null,
      items: [],
      ignored: [],
    },
  }
}

function deliveredToItsOwnCallers(): undefined {
  return undefined
}

export function createProvider(host: ProviderHost, readers: readonly Reader[]): Provider {
  let current: WorkitemsSnapshot | undefined
  let baseline: { root: string; source: string | null; items: readonly WorkitemsItem[] } | undefined
  let lastSignature: string | undefined
  let version = 0
  const history: { version: number; diff: WorkitemsDiff }[] = []
  let tail: Promise<void> = Promise.resolve()
  let queued: Promise<void> | undefined

  function sinceOf(args: WorkitemsRefreshArgs | undefined): number {
    const since = args?.since ?? version
    if (!Number.isInteger(since) || since < 0) {
      throw new RangeError(
        `workitems refresh: since must be a whole number of 0 or more, not ${String(since)}`,
      )
    }
    if (since > version) {
      throw new RangeError(
        `workitems refresh: since ${String(since)} is newer than the current version ${String(version)}`,
      )
    }
    return since
  }

  function diffSince(since: number): WorkitemsDiff {
    if (since === version) return emptyDiff()
    const oldestKept = history[0]?.version ?? version + 1
    if (since + 1 < oldestKept) {
      throw new RangeError(
        `workitems refresh: since ${String(since)} is older than the oldest kept diff (version ${String(oldestKept)}); call refresh() without since`,
      )
    }
    return mergeDiffs(history.filter((entry) => entry.version > since).map((entry) => entry.diff))
  }

  async function readOnce(): Promise<void> {
    const root = await host.root()
    const files = filesAtRoot(host, root)
    const detection = await detect(readers, files)
    const signature = detection.found
      ? [
          await signatureOf(host, files, root, detection.reader),
          `ignored ${detection.ignored.join(' ')}`,
        ].join('\n')
      : [root, 'no-tracker'].join('\n')
    const checkedAt = await host.now()
    if (current && signature === lastSignature) {
      const checked: WorkitemsSnapshot = { ...current, checkedAt }
      await host.publish(checked)
      current = checked
      return
    }
    const result = detection.found
      ? await readSource(detection.reader, detection.ignored, files, root)
      : noTracker(root, detection.lookedFor)
    const nextVersion = version + 1
    const snapshot: WorkitemsSnapshot = {
      ...result.data,
      version: nextVersion,
      at: checkedAt,
      checkedAt,
    }
    await host.publish(snapshot)
    const source = detection.found ? detection.reader.name : null
    const isMissingClosed =
      detection.found && detection.reader.listsOpenOnly === true && baseline?.source === source
    const diff =
      result.baselineItems !== undefined && baseline?.root === root
        ? diffItems(baseline.items, result.baselineItems, isMissingClosed)
        : emptyDiff()
    if (result.baselineItems !== undefined) {
      baseline = { root, source, items: result.baselineItems }
    }
    version = nextVersion
    history.push({ version, diff })
    if (history.length > DIFF_HISTORY_LIMIT) history.shift()
    lastSignature = signature
    current = snapshot
  }

  function requestRead(): Promise<void> {
    if (queued) return queued
    const read = tail.catch(deliveredToItsOwnCallers).then(() => {
      queued = undefined
      return readOnce()
    })
    queued = read
    tail = read
    return read
  }

  return {
    refresh: async (args) => {
      const since = sinceOf(args)
      await requestRead()
      return { ...diffSince(since), version }
    },
  }
}
