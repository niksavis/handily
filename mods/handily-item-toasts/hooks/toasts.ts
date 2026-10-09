import type { EngineInterface, PluginState } from 'claude-code'
import type { ItemToastsHealth as Health } from '../types'

type Snapshot = PluginState['handily-workitems']['snapshot']
type Refreshed = Awaited<ReturnType<EngineInterface['workitems']['refresh']>>
type Item = Refreshed['created'][number]
type Line = Awaited<ReturnType<EngineInterface['workitems']['lines']>>[number]
type ChangeKind = 'created' | 'updated' | 'closed'

export const TITLE_LENGTH = 40
export const QUIET_WINDOW_MS = 30_000

const NAMED_IDS = 2
const KINDS_IN_DIFF_ORDER: readonly ChangeKind[] = ['created', 'updated', 'closed']
const KINDS_BY_STRENGTH: readonly ChangeKind[] = ['updated', 'closed', 'created']
const HEADER_AGE_PART = ' \u00b7 read '

export type Change = {
  kind: ChangeKind
  id: string
  title: string
  from: string | null
  to: string
}

export type ToastHost = {
  snapshot: () => Promise<Snapshot | undefined>
  refresh: (since: number) => Promise<Refreshed>
  lines: (snapshot: Snapshot) => Promise<readonly Line[]>
  now: () => Promise<number>
  toast: (text: string) => void
  log: (text: string) => void
  announced: () => Promise<Health | undefined>
  announce: (health: Health) => Promise<void>
  lastToastAt: () => Promise<number | undefined>
  noteToast: (at: number) => Promise<void>
}

export type Toaster = {
  tick: () => Promise<void>
  enterCall: () => Promise<void>
  leaveCall: () => Promise<void>
}

export function cutTitle(title: string, length: number): string {
  const graphemes = Array.from(new Intl.Segmenter().segment(title), (part) => part.segment)
  if (graphemes.length <= length) return title
  return `${graphemes.slice(0, length).join('').trimEnd()}\u2026`
}

function statusMove(change: Change): string {
  if (change.kind !== 'updated' || change.from === null || change.from === change.to) return ''
  return ` (${change.from} -> ${change.to})`
}

export function changeText(change: Change): string {
  return `${change.id} ${change.kind}: ${cutTitle(change.title, TITLE_LENGTH)}${statusMove(change)}`
}

function countsText(changes: readonly Change[]): string {
  const counts = KINDS_IN_DIFF_ORDER.map((kind) => ({
    kind,
    count: changes.filter((change) => change.kind === kind).length,
  }))
  return counts
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ kind, count }) => `${String(count)} ${kind}`)
    .join(', ')
}

function idsText(changes: readonly Change[]): string {
  const named = changes.slice(0, NAMED_IDS).map((change) => change.id)
  const rest = changes.length - named.length
  return rest > 0 ? [...named, `+${String(rest)}`].join(', ') : named.join(', ')
}

export function changesText(changes: readonly Change[]): string {
  const [only] = changes
  if (changes.length === 1 && only !== undefined) return changeText(only)
  return `${String(changes.length)} work items changed: ${countsText(changes)} (${idsText(changes)})`
}

function healthOf(snapshot: Snapshot): Health | null {
  if (snapshot.state === 'ok') return 'ok'
  if (snapshot.state === 'failed') return 'failed'
  return null
}

function firstSentence(text: string): string {
  const [first = text] = text.split('. ')
  return `${first.replace(/\.$/, '')}.`
}

export function healthText(lines: readonly Line[], health: Health): string {
  if (health === 'failed') {
    const failed = lines.find((line) => line.kind === 'failed')
    if (!failed) throw new Error('item-toasts: workitems drew no failed line for a failed snapshot')
    return firstSentence(failed.text)
  }
  const header = lines.find((line) => line.kind === 'header')
  if (!header) throw new Error('item-toasts: workitems drew no header line for an ok snapshot')
  const [label = header.text] = header.text.split(HEADER_AGE_PART)
  return `Work items are back: ${label}.`
}

function strongerKind(held: ChangeKind, next: ChangeKind): ChangeKind {
  return KINDS_BY_STRENGTH.indexOf(held) > KINDS_BY_STRENGTH.indexOf(next) ? held : next
}

export function createToaster(host: ToastHost): Toaster {
  let seen: number | undefined
  let runningCalls = 0
  let isFailed = false
  let hasOwnCallDuringFailure = false
  const knownStatus = new Map<string, string>()
  const pending = new Map<string, Change>()
  let queue: Promise<void> = Promise.resolve()

  function inTurn(step: () => Promise<void>): Promise<void> {
    const run = queue.then(step).catch((error: unknown) => {
      host.log(`item-toasts: ${String(error)}`)
    })
    queue = run
    return run
  }

  function remember(items: readonly Item[]): void {
    for (const item of items) knownStatus.set(item.key, item.rawStatus)
  }

  function hold(refreshed: Refreshed): void {
    for (const kind of KINDS_IN_DIFF_ORDER) {
      for (const item of refreshed[kind]) {
        const change: Change = {
          kind,
          id: item.id,
          title: item.title,
          from: knownStatus.get(item.key) ?? null,
          to: item.rawStatus,
        }
        const held = pending.get(item.key)
        pending.set(
          item.key,
          held ? { ...change, kind: strongerKind(held.kind, kind), from: held.from } : change,
        )
      }
    }
  }

  async function catchUp(isElsewhere: boolean, mustRead: boolean): Promise<void> {
    const snapshot = await host.snapshot()
    if (snapshot === undefined) return
    if (seen === undefined) {
      seen = snapshot.version
      isFailed = snapshot.state === 'failed'
      remember(snapshot.items)
    }
    if (!mustRead && snapshot.version === seen) return
    let refreshed: Refreshed
    try {
      refreshed = await host.refresh(seen)
    } catch (error) {
      seen = undefined
      throw error
    }
    seen = refreshed.version
    const wasFailed = isFailed
    isFailed = (await host.snapshot())?.state === 'failed'
    const hasRecovered = wasFailed && !isFailed
    const isOwnRecovery = hasRecovered && hasOwnCallDuringFailure
    if (hasRecovered) hasOwnCallDuringFailure = false
    if (isElsewhere && !isOwnRecovery) hold(refreshed)
    remember([...refreshed.created, ...refreshed.updated, ...refreshed.closed])
  }

  function noteOwnCall(): void {
    if (isFailed) hasOwnCallDuringFailure = true
  }

  async function nextText(snapshot: Snapshot, health: Health): Promise<string | null> {
    if (health !== ((await host.announced()) ?? 'ok')) {
      const text = healthText(await host.lines(snapshot), health)
      await host.announce(health)
      return text
    }
    if (pending.size === 0) return null
    const text = changesText([...pending.values()])
    pending.clear()
    return text
  }

  async function flush(): Promise<void> {
    const snapshot = await host.snapshot()
    if (snapshot === undefined) return
    const health = healthOf(snapshot)
    if (health === null) {
      pending.clear()
      return
    }
    const now = await host.now()
    const lastToastAt = await host.lastToastAt()
    if (lastToastAt !== undefined && now - lastToastAt < QUIET_WINDOW_MS) return
    const text = await nextText(snapshot, health)
    if (text === null) return
    host.toast(text)
    await host.noteToast(now)
  }

  return {
    tick: () =>
      inTurn(async () => {
        if (runningCalls === 0) await catchUp(true, false)
        await flush()
      }),
    enterCall: () =>
      inTurn(async () => {
        runningCalls += 1
        if (runningCalls > 1) return
        await catchUp(true, true)
        await flush()
      }),
    leaveCall: () =>
      inTurn(async () => {
        runningCalls -= 1
        if (runningCalls > 0) return
        await catchUp(false, true)
        noteOwnCall()
      }),
  }
}
