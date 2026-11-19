import type { RenderSurface, Timer } from 'claude-code'
import type { OpenPane } from './board'
import {
  ownSession,
  POLL_INTERVAL_MS,
  readStore,
  storeRows,
  storeSetting,
  type Snapshot,
  type StoreHost,
  type StoreOutcome,
  type StoreRow,
} from './store'

export type SessionsHost = {
  now: () => Promise<number>
  sessionId: () => Promise<string>
  surfaces: () => Promise<readonly RenderSurface[]>
  home: () => Promise<string | undefined>
  panes: () => Promise<readonly OpenPane[]>
  store: StoreHost
  redraw: () => void
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  debug: (line: string) => void
}

export type StoreOptions = { store: unknown; answerWindow: unknown }

export type FillShown = { text: string; refusal: string | null }

export type Machine = {
  paneId: string
  poll: Timer | undefined
  inFlight: Promise<void> | undefined
  path: string | undefined
  readAt: number | undefined
  outcome: StoreOutcome | undefined
  snapshot: Snapshot | undefined
  fills: Map<string, FillShown>
}

export function newMachine(paneId: string): Machine {
  return {
    paneId,
    poll: undefined,
    inFlight: undefined,
    path: undefined,
    readAt: undefined,
    outcome: undefined,
    snapshot: undefined,
    fills: new Map(),
  }
}

export type MachineView =
  | { kind: 'desktop' }
  | { kind: 'unset' }
  | { kind: 'refused'; reason: string }
  | { kind: 'loading' }
  | { kind: 'missing'; shown: string }
  | { kind: 'failed'; reason: string }
  | {
      kind: 'rows'
      snapshot: Snapshot
      rows: readonly StoreRow[]
      failure: string | null
      canAnswer: boolean
    }

export type MachineRead = { view: MachineView; now: number }

function stopPolling(machine: Machine): void {
  machine.poll?.cancel()
  machine.poll = undefined
}

async function readShownPane(host: SessionsHost, machine: Machine): Promise<void> {
  const pane = (await host.panes()).find((open) => open.id === machine.paneId)
  if (!pane) {
    stopPolling(machine)
    return
  }
  const { path } = machine
  if (!pane.isShown || path === undefined) return
  const now = await host.now()
  machine.readAt = now
  const outcome = await readStore(host.store, path, now)
  if (machine.path !== path) return
  machine.outcome = outcome
  if (outcome.kind === 'read') machine.snapshot = outcome.snapshot
  if (outcome.kind === 'missing') machine.snapshot = undefined
  host.redraw()
}

function readOnce(host: SessionsHost, machine: Machine): Promise<void> {
  if (machine.inFlight) return machine.inFlight
  const running = readShownPane(host, machine).finally(() => {
    machine.inFlight = undefined
  })
  machine.inFlight = running
  return running
}

function readTick(host: SessionsHost, machine: Machine): () => void {
  return () => {
    readOnce(host, machine).catch((error: unknown) => {
      host.debug(`handily-board: the read of the session store failed: ${String(error)}`)
    })
  }
}

function startPolling(host: SessionsHost, machine: Machine): void {
  if (machine.poll) return
  machine.poll = host.every(POLL_INTERVAL_MS, readTick(host, machine))
}

function keepPath(machine: Machine, path: string): void {
  if (machine.path === path) return
  machine.path = path
  machine.readAt = undefined
  machine.outcome = undefined
  machine.snapshot = undefined
  machine.fills.clear()
}

function isDue(machine: Machine, now: number): boolean {
  if (machine.readAt === undefined) return true
  const age = now - machine.readAt
  return age < 0 || age >= POLL_INTERVAL_MS
}

async function homeFor(host: SessionsHost, value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string' || !value.startsWith('~')) return undefined
  try {
    return await host.home()
  } catch (error) {
    host.debug(`handily-board: HOME was not read for the store option: ${String(error)}`)
    return undefined
  }
}

function answerWindowOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function rowsView(
  snapshot: Snapshot,
  failure: string | null,
  read: { now: number; ownId: string; answerWindow: string | null },
): MachineView {
  const own = ownSession(snapshot, read.ownId)
  return {
    kind: 'rows',
    snapshot,
    rows: storeRows(snapshot, read.now, read.ownId),
    failure,
    canAnswer: read.answerWindow !== null && own?.name === read.answerWindow,
  }
}

function shownView(
  machine: Machine,
  shown: string,
  read: { now: number; ownId: string; answerWindow: string | null },
): MachineView {
  const { outcome, snapshot } = machine
  if (outcome === undefined) return { kind: 'loading' }
  if (outcome.kind === 'missing') return { kind: 'missing', shown }
  if (outcome.kind === 'read') return rowsView(outcome.snapshot, null, read)
  if (snapshot === undefined) return { kind: 'failed', reason: outcome.reason }
  return rowsView(snapshot, outcome.reason, read)
}

export async function readMachine(
  host: SessionsHost,
  machine: Machine,
  options: StoreOptions,
): Promise<MachineRead> {
  const now = await host.now()
  if (!(await host.surfaces()).includes('terminal')) return { view: { kind: 'desktop' }, now }
  const setting = storeSetting(options.store, await homeFor(host, options.store))
  if (setting.kind === 'unset') return { view: { kind: 'unset' }, now }
  if (setting.kind === 'refused') return { view: { kind: 'refused', reason: setting.reason }, now }
  keepPath(machine, setting.path)
  startPolling(host, machine)
  if (isDue(machine, now)) host.after(0, readTick(host, machine))
  const read = {
    now,
    ownId: await host.sessionId(),
    answerWindow: answerWindowOf(options.answerWindow),
  }
  return { view: shownView(machine, setting.shown, read), now }
}
