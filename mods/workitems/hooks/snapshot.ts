import type {
  WorkitemsDiff,
  WorkitemsFailedReason,
  WorkitemsItem,
  WorkitemsRefreshArgs,
  WorkitemsSnapshot,
} from '../types'
import { detect } from './detect'
import type { ReadOutcome, Reader, TrackerFiles } from './readers/index'

export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const POLL_INTERVAL_MS = 2000
export const DIFF_HISTORY_LIMIT = 50

export type FileStat = { size: number; mtimeMs: number }

export type ProviderHost = {
  root: () => Promise<string>
  now: () => Promise<number>
  exists: (path: string) => Promise<boolean>
  stat: (path: string) => Promise<FileStat>
  read: (path: string) => Promise<string>
  publish: (snapshot: WorkitemsSnapshot) => Promise<void>
}

export type Provider = {
  refresh: (args?: WorkitemsRefreshArgs) => Promise<WorkitemsDiff>
}

class FileProblem extends Error {
  constructor(readonly reason: WorkitemsFailedReason) {
    super(reason)
  }
}

function emptyDiff(): WorkitemsDiff {
  return { created: [], updated: [], closed: [] }
}

export function pathAtRoot(root: string, relativePath: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${relativePath}`
}

function filesAtRoot(host: ProviderHost, root: string): TrackerFiles {
  return {
    exists: (relativePath) => host.exists(pathAtRoot(root, relativePath)),
    read: async (relativePath) => {
      const path = pathAtRoot(root, relativePath)
      let stat: FileStat
      try {
        stat = await host.stat(path)
      } catch {
        throw new FileProblem(`${relativePath} could not be read.`)
      }
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

async function signatureOf(host: ProviderHost, root: string, reader: Reader): Promise<string> {
  try {
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
  let baseline: { root: string; items: readonly WorkitemsItem[] } | undefined
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
    const detection = await detect(readers, files.exists)
    const signature = detection.found
      ? await signatureOf(host, root, detection.reader)
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
    const diff =
      result.baselineItems !== undefined && baseline?.root === root
        ? diffItems(baseline.items, result.baselineItems)
        : emptyDiff()
    if (result.baselineItems !== undefined) baseline = { root, items: result.baselineItems }
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
      return diffSince(since)
    },
  }
}
