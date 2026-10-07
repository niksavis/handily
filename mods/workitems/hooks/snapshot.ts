import type {
  WorkitemsDiff,
  WorkitemsFailedReason,
  WorkitemsItem,
  WorkitemsSnapshot,
} from '../types'
import { detect } from './detect'
import type { ReadOutcome, Reader, TrackerFiles } from './readers/index'

export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const POLL_INTERVAL_MS = 2000

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
  refresh: () => Promise<WorkitemsDiff>
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

export function createProvider(host: ProviderHost, readers: readonly Reader[]): Provider {
  let baseline: { root: string; items: readonly WorkitemsItem[] } | undefined
  let lastSignature: string | undefined
  let inFlight: Promise<WorkitemsDiff> | undefined

  function diffAgainstBaseline(root: string, items: readonly WorkitemsItem[]): WorkitemsDiff {
    return baseline?.root === root ? diffItems(baseline.items, items) : emptyDiff()
  }

  async function readOnce(): Promise<WorkitemsDiff> {
    const root = await host.root()
    const files = filesAtRoot(host, root)
    const detection = await detect(readers, files.exists)
    if (!detection.found) {
      const signature = [root, 'no-tracker'].join('\n')
      if (signature === lastSignature) return emptyDiff()
      await host.publish({
        state: 'no-tracker',
        reason: detection.lookedFor,
        at: await host.now(),
        root,
        source: null,
        sourceLabel: null,
        caveat: null,
        items: [],
        ignored: [],
      })
      const diff = diffAgainstBaseline(root, [])
      baseline = { root, items: [] }
      lastSignature = signature
      return diff
    }
    const { reader, ignored } = detection
    const signature = await signatureOf(host, root, reader)
    if (signature === lastSignature) return emptyDiff()
    const at = await host.now()
    const outcome = await readSafely(reader, files)
    if (!outcome.ok) {
      await host.publish({
        state: 'failed',
        reason: outcome.reason,
        at,
        root,
        source: reader.name,
        sourceLabel: reader.name,
        caveat: null,
        items: [],
        ignored,
      })
      lastSignature = signature
      return emptyDiff()
    }
    await host.publish({
      state: 'ok',
      reason: null,
      at,
      root,
      source: reader.name,
      sourceLabel: outcome.sourceLabel,
      caveat: outcome.caveat,
      items: outcome.items,
      ignored,
    })
    const diff = diffAgainstBaseline(root, outcome.items)
    baseline = { root, items: outcome.items }
    lastSignature = signature
    return diff
  }

  return {
    refresh: () => {
      inFlight ??= readOnce().finally(() => {
        inFlight = undefined
      })
      return inFlight
    },
  }
}
