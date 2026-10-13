import type { AgentInfo, ProcessRunResult, RenderSurface, Timer } from 'claude-code'
import type { BoardList } from '../types'
import {
  AGENTS_CACHE_KEY,
  isFresh,
  POLL_INTERVAL_MS,
  pollAgents,
  readCache,
  type AgentsCache,
  type AgentsHost,
} from './agents-json'
import type { OpenPane } from './board'
import { desktopView, machineView, type MachineView } from './cards'
import {
  emptyProgress,
  isExpired,
  progressKey,
  PROGRESS_PREFIX,
  readProgress,
  type Progress,
} from './progress'

export type ProgressChange = (progress: Progress, now: number, list: BoardList) => Progress

export type SessionsHost = {
  now: () => Promise<number>
  sessionId: () => Promise<string>
  cwd: () => Promise<string>
  surfaces: () => Promise<readonly RenderSurface[]>
  list: () => Promise<BoardList>
  agents: () => Promise<readonly AgentInfo[]>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  storeDelete: (key: string) => Promise<void>
  storeKeys: () => Promise<readonly string[]>
  run: (argv: readonly string[]) => Promise<ProcessRunResult>
  panes: () => Promise<readonly OpenPane[]>
  redraw: () => void
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  debug: (line: string) => void
}

export type Machine = {
  paneId: string
  poll: Timer | undefined
  inFlight: Promise<void> | undefined
  writes: Promise<void>
}

export function newMachine(paneId: string): Machine {
  return { paneId, poll: undefined, inFlight: undefined, writes: Promise.resolve() }
}

async function canListSessions(host: SessionsHost): Promise<boolean> {
  return (await host.surfaces()).includes('terminal')
}

async function readAllProgress(host: SessionsHost): Promise<Progress[]> {
  const keys = (await host.storeKeys()).filter((key) => key.startsWith(PROGRESS_PREFIX))
  const entries = await Promise.all(keys.map(async (key) => readProgress(await host.storeGet(key))))
  return entries.filter((entry): entry is Progress => entry !== null)
}

async function deleteExpired(host: SessionsHost, live: ReadonlySet<string>): Promise<void> {
  const now = await host.now()
  for (const entry of await readAllProgress(host)) {
    if (isExpired(entry, live, now)) await host.storeDelete(progressKey(entry.sessionId))
  }
}

async function pruneExpired(host: SessionsHost, cache: AgentsCache): Promise<void> {
  if (cache.failure !== null || cache.listed === null) return
  await deleteExpired(host, new Set(cache.listed.rows.flatMap((row) => row.sessionId ?? [])))
}

function agentsHost(host: SessionsHost): AgentsHost {
  return {
    now: host.now,
    run: host.run,
    load: () => host.storeGet(AGENTS_CACHE_KEY),
    save: async (cache) => {
      await pruneExpired(host, cache)
      await host.storeSet(AGENTS_CACHE_KEY, cache)
    },
    log: host.debug,
  }
}

function stopPolling(machine: Machine): void {
  machine.poll?.cancel()
  machine.poll = undefined
}

async function pollShownPane(host: SessionsHost, machine: Machine): Promise<void> {
  const pane = (await host.panes()).find((open) => open.id === machine.paneId)
  if (!pane) {
    stopPolling(machine)
    return
  }
  if (!pane.isShown) return
  await pollAgents(agentsHost(host))
  host.redraw()
}

function pollOnce(host: SessionsHost, machine: Machine): Promise<void> {
  if (machine.inFlight) return machine.inFlight
  const running = pollShownPane(host, machine).finally(() => {
    machine.inFlight = undefined
  })
  machine.inFlight = running
  return running
}

function pollTick(host: SessionsHost, machine: Machine): () => void {
  return () => {
    pollOnce(host, machine).catch((error: unknown) => {
      host.debug(`handily-board: the poll of claude agents failed: ${String(error)}`)
    })
  }
}

function startPolling(host: SessionsHost, machine: Machine): void {
  if (machine.poll) return
  machine.poll = host.every(POLL_INTERVAL_MS, pollTick(host, machine))
}

async function writeProgress(host: SessionsHost, change: ProgressChange, list?: BoardList) {
  const sessionId = await host.sessionId()
  const now = await host.now()
  const key = progressKey(sessionId)
  const current =
    readProgress(await host.storeGet(key)) ?? emptyProgress(sessionId, await host.cwd(), now)
  await host.storeSet(key, change(current, now, list ?? (await host.list())))
}

export function updateProgress(
  host: SessionsHost,
  machine: Machine,
  change: ProgressChange,
  list?: BoardList,
): Promise<void> {
  const run = () =>
    writeProgress(host, change, list).catch((error: unknown) => {
      host.debug(`handily-board: the progress of this session was not kept: ${String(error)}`)
    })
  machine.writes = machine.writes.then(run, run)
  return machine.writes
}

export async function removeExpiredKeys(host: SessionsHost): Promise<void> {
  try {
    await deleteExpired(host, new Set([await host.sessionId()]))
  } catch (error) {
    host.debug(`handily-board: old session keys were not removed: ${String(error)}`)
  }
}

export type MachineRead = { view: MachineView; now: number }

export async function readMachine(host: SessionsHost, machine: Machine): Promise<MachineRead> {
  const now = await host.now()
  const sessionId = await host.sessionId()
  const own = {
    sessionId,
    cwd: await host.cwd(),
    list: await host.list(),
    progress: readProgress(await host.storeGet(progressKey(sessionId))),
    agents: await host.agents(),
  }
  if (!(await canListSessions(host))) {
    return { view: desktopView({ now, own, cache: undefined, progress: [] }), now }
  }
  startPolling(host, machine)
  const cache = readCache(await host.storeGet(AGENTS_CACHE_KEY))
  if (!isFresh(cache, now)) host.after(0, pollTick(host, machine))
  return { view: machineView({ now, own, cache, progress: await readAllProgress(host) }), now }
}
