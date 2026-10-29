import type { EngineInterface, PluginState } from 'claude-code'
import type { ItemToastsHealth as Health } from '../types'
import { marked, type ToastLine, type ToastParts, type ToastRole } from './toast'

type Snapshot = PluginState['handily-workitems']['snapshot']
type Refreshed = Awaited<ReturnType<EngineInterface['workitems']['refresh']>>
type Item = Refreshed['created'][number]
type Line = Awaited<ReturnType<EngineInterface['workitems']['lines']>>[number]
type ChangeKind = 'created' | 'updated' | 'closed'
type Status = Item['status']

export const QUIET_WINDOW_MS = 30_000

const NAMED_IDS = 2
const KINDS_IN_DIFF_ORDER: readonly ChangeKind[] = ['created', 'updated', 'closed']
const KINDS_BY_STRENGTH: readonly ChangeKind[] = ['updated', 'closed', 'created']
const HEADER_AGE_PART = ' \u00b7 read '
const SENTENCE_END = '. '
const QUOTE = '"'
const ESCAPE = '\\'
const COUNT_SEPARATOR = '  '

const STATUS_ROLES: Readonly<Record<Status, ToastRole>> = {
  open: 'toDo',
  in_progress: 'doing',
  blocked: 'blocked',
  deferred: 'toDo',
  closed: 'done',
  other: 'toDo',
}

export type Change = {
  kind: ChangeKind
  id: string
  title: string
  status: Status
  from: string | null
  to: string
}

export type ToastHost = {
  snapshot: () => Promise<Snapshot | undefined>
  refresh: (since: number) => Promise<Refreshed>
  lines: (snapshot: Snapshot) => Promise<readonly Line[]>
  now: () => Promise<number>
  show: (parts: ToastParts) => void
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

function eventText(change: Change): string {
  if (change.kind !== 'updated') return change.kind
  if (change.from === null || change.from === change.to) return change.kind
  return `${change.from} \u2192 ${change.to}`
}

function changeParts(change: Change): ToastParts {
  return [
    marked(STATUS_ROLES[change.status], `${change.id} ${eventText(change)}`),
    { quoted: change.title },
  ]
}

function countsLine(changes: readonly Change[]): ToastLine {
  const groups = new Map<string, { role: ToastRole; kind: ChangeKind; count: number }>()
  for (const kind of KINDS_IN_DIFF_ORDER) {
    for (const change of changes.filter((each) => each.kind === kind)) {
      const role = STATUS_ROLES[change.status]
      const key = `${role} ${kind}`
      const held = groups.get(key)
      groups.set(key, { role, kind, count: (held?.count ?? 0) + 1 })
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .flatMap(({ role, kind, count }, index) => [
      ...(index === 0 ? [] : [COUNT_SEPARATOR]),
      ...marked(role, `${String(count)} ${kind}`),
    ])
}

function idsText(changes: readonly Change[]): string {
  const named = changes.slice(0, NAMED_IDS).map((change) => change.id)
  const rest = changes.length - named.length
  return (rest > 0 ? [...named, `+${String(rest)}`] : named).join(' ')
}

export function changesParts(changes: readonly Change[]): ToastParts {
  const [only] = changes
  if (changes.length === 1 && only !== undefined) return changeParts(only)
  return [`${String(changes.length)} items changed`, countsLine(changes), idsText(changes)]
}

function healthOf(snapshot: Snapshot): Health | null {
  if (snapshot.state === 'ok') return 'ok'
  if (snapshot.state === 'failed') return 'failed'
  return null
}

function sentenceEndOutsideQuotes(text: string): number {
  let isQuoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (isQuoted && character === ESCAPE) index += 1
    else if (character === QUOTE) isQuoted = !isQuoted
    else if (!isQuoted && text.startsWith(SENTENCE_END, index)) return index
  }
  return -1
}

export function failedParts(reason: string): ToastParts {
  const head = marked('blocked', 'Work items unavailable')
  const sentenceEnd = sentenceEndOutsideQuotes(reason)
  if (sentenceEnd < 0) return [head, reason]
  return [head, reason.slice(0, sentenceEnd + 1), reason.slice(sentenceEnd + SENTENCE_END.length)]
}

function backParts(lines: readonly Line[]): ToastParts {
  const header = lines.find((line) => line.kind === 'header')
  if (!header) throw new Error('item-toasts: workitems drew no header line for an ok snapshot')
  const [label = header.text] = header.text.split(HEADER_AGE_PART)
  return [marked('done', 'Work items are back'), label]
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
          status: item.status,
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

  function takeBaseline(snapshot: Snapshot): number {
    isFailed = snapshot.state === 'failed'
    remember(snapshot.items)
    return snapshot.version
  }

  async function catchUp(isElsewhere: boolean, mustRead: boolean): Promise<void> {
    const snapshot = await host.snapshot()
    if (snapshot === undefined) return
    const hasProviderRestarted = seen !== undefined && snapshot.version < seen
    if (hasProviderRestarted) {
      seen = takeBaseline(snapshot)
      return
    }
    seen ??= takeBaseline(snapshot)
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

  async function healthParts(snapshot: Snapshot): Promise<ToastParts> {
    if (snapshot.state === 'failed') return failedParts(snapshot.reason)
    return backParts(await host.lines(snapshot))
  }

  async function nextParts(snapshot: Snapshot, health: Health): Promise<ToastParts | null> {
    if (health !== ((await host.announced()) ?? 'ok')) {
      const parts = await healthParts(snapshot)
      await host.announce(health)
      return parts
    }
    if (pending.size === 0) return null
    const parts = changesParts([...pending.values()])
    pending.clear()
    return parts
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
    const parts = await nextParts(snapshot, health)
    if (parts === null) return
    host.show(parts)
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
