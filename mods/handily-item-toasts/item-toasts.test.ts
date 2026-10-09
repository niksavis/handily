import type { EngineInterface, On, PluginState, ToolCallInput } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import { changesText, type Change } from './hooks/toasts'

type Snapshot = PluginState['handily-workitems']['snapshot']
type Item = Snapshot['items'][number]
type Diff = { created: Item[]; updated: Item[]; closed: Item[] }
type TrackerState = 'ok' | 'failed' | 'no-tracker' | 'approval-needed' | 'terminal-only'
type DiskEdit = { diff?: Diff; state?: TrackerState }
type Answer = { error: string } | { snapshot: Snapshot; result: Diff & { version: number } }
type Parsed = Awaited<ReturnType<EngineInterface['workitems']['classify']>>
type TrackerFileArgs = Parameters<EngineInterface['workitems']['trackerFile']>[0]

const ROOT = '/work/app'
const START = 1_000_000
const TICK_MS = 2000
const WINDOW_MS = 30_000
const SURFACES = ['terminal', 'desktop'] as const
const MALFORMED = '.beads/issues.jsonl line 4 is malformed.'
const FAILED_TOAST = 'Work items unavailable: .beads/issues.jsonl line 4 is malformed.'
const BEADS_FILE = `${ROOT}/.beads/issues.jsonl`
const POLL_COMMAND = 'workitems-poll'

const CLASSIFY_PATH = '/fake/workitems/classify/'
const TRACKER_FILE_PATH = '/fake/workitems/tracker-file/'
const BR_CLOSE = { tracker: 'br', verb: 'close' } as const

const CLASSIFIED: Readonly<Record<string, Parsed>> = {
  'br close handily-ab12': { kind: 'write', writes: [BR_CLOSE] },
  'br update handily-cd34 --status in_progress': {
    kind: 'write',
    writes: [{ tracker: 'br', verb: 'update' }],
  },
  'uv run .basicly/core/kit/tracker/cli.py close handily-ab12': {
    kind: 'opaque',
    reason: 'shape',
    writes: [{ tracker: '.basicly/core/kit/tracker/cli.py', verb: 'close' }],
  },
  'basicly tracker write close handily-ab12': {
    kind: 'write',
    writes: [{ tracker: '.basicly/core/kit/tracker/cli.py', verb: 'close' }],
  },
  'for id in handily-ab12; do br close $id; done': {
    kind: 'opaque',
    reason: 'expansion',
    writes: [BR_CLOSE],
  },
  'npm test': { kind: 'none' },
  'git push origin main': { kind: 'none' },
  'br close handily-ab12 --dry-run': { kind: 'none' },
  'br --help': { kind: 'none' },
  'bash close.sh': { kind: 'none' },
}

const TRACKER_FILES: Readonly<Record<string, string | null>> = {
  [`${ROOT}/.beads/issues.jsonl`]: '.beads/issues.jsonl',
  [`${ROOT}/.beans/app-ab12--x.md`]: '.beans/app-ab12--x.md',
  [`${ROOT}/.beans/README.md`]: null,
  [`${ROOT}/src/x.ts`]: null,
}

function item(id: string, title: string, status: Item['status']): Item {
  return {
    key: `beads:${id}`,
    id,
    title,
    status,
    rawStatus: status,
    priority: 2,
    type: 'task',
    assignee: null,
    updatedAt: null,
    source: 'beads',
  }
}

const AB12 = item('handily-ab12', 'Draw text mocks for the mods', 'open')
const CD34 = item('handily-cd34', 'Write the beads reader', 'open')
const EF56 = item('handily-ef56', 'Fix the parser', 'open')
const LONG = item(
  'handily-gh78',
  'Write the beads reader so the provider reads issues.jsonl',
  'open',
)

function emptyDiff(): Diff {
  return { created: [], updated: [], closed: [] }
}

const fakeWorkitems: Plugin = {
  name: 'handily-workitems',
  register(on) {
    on('engine.create', async (_$, e, next) => {
      const built = await next(e)
      return {
        ...built,
        workitems: {
          refresh: async (args) => {
            const path = `/fake/workitems/refresh/${String(args?.since ?? 'poll')}`
            const answer = JSON.parse(await built.fs.read(path)) as Answer
            if ('error' in answer) throw new Error(answer.error)
            await built.state.set({ plugin: 'handily-workitems', key: 'snapshot' }, answer.snapshot)
            return answer.result
          },
          writeVerbs: () => Promise.reject(new Error('item-toasts reads no write verbs')),
          classify: async (command) => {
            const path = `/fake/workitems/classify/${encodeURIComponent(command)}`
            return JSON.parse(await built.fs.read(path)) as Parsed
          },
          trackerFile: async (args) => {
            const path = `/fake/workitems/tracker-file/${encodeURIComponent(JSON.stringify(args))}`
            return JSON.parse(await built.fs.read(path)) as string | null
          },
          lines: ({ snapshot }) => {
            if (snapshot.state === 'failed') {
              return Promise.resolve([
                {
                  kind: 'failed' as const,
                  tone: 'error' as const,
                  text: `Work items unavailable: ${snapshot.reason}` as const,
                },
              ])
            }
            if (snapshot.state !== 'ok') return Promise.resolve([])
            const open = snapshot.items.filter((each) => each.status !== 'closed').length
            return Promise.resolve([
              {
                kind: 'header' as const,
                tone: 'dim' as const,
                text: `${snapshot.sourceLabel} \u00b7 ${String(open)} open \u00b7 read 0 s ago` as `${string} \u00b7 ${number} open \u00b7 read ${string} ago`,
              },
            ])
          },
        },
      }
    })
    on('session.start', async ($, e, next) => {
      await $.workitems.refresh()
      $.clock.every(1000, () => {
        $.fs
          .read('/fake/workitems/refresh/timer')
          .then(async (text) => {
            const answer = JSON.parse(text) as Answer
            if ('error' in answer) return
            await $.state.set({ plugin: 'handily-workitems', key: 'snapshot' }, answer.snapshot)
          })
          .catch(() => undefined)
      })
      return next(e)
    })
    on('command.run', { command: 'workitems-poll' }, async ($) => {
      await $.workitems.refresh()
      return { text: 'polled' }
    })
  },
}

type World = {
  state: TrackerState
  items: Item[]
  version: number
  history: { version: number; diff: Diff }[]
  disk: DiskEdit[]
  unreported: Diff
  sinces: number[]
  rejectSince: number | null
  toasts: string[]
  logs: string[]
  callEdit: DiskEdit | null
  callMs: number
  timerPolls: boolean
  timerReads: number
  plans: Record<string, CallPlan>
  callIds: string[]
  classifyError: boolean
  trackerFileError: boolean
  unanswered: string[]
}

type CallPlan = {
  edit?: DiskEdit
  beforeMs?: number
  afterMs?: number
  output?: Record<string, unknown>
}

function applyItems(items: readonly Item[], diff: Diff): Item[] {
  const byKey = new Map(items.map((each) => [each.key, each]))
  for (const each of [...diff.created, ...diff.updated, ...diff.closed]) byKey.set(each.key, each)
  return [...byKey.values()]
}

function addDiff(into: Diff, diff: Diff): Diff {
  return {
    created: [...into.created, ...diff.created],
    updated: [...into.updated, ...diff.updated],
    closed: [...into.closed, ...diff.closed],
  }
}

function snapshotOf(world: World): Snapshot {
  const base = { at: START, checkedAt: START, root: ROOT, ignored: [], version: world.version }
  const sourced = { source: 'beads', sourceLabel: 'beads', caveat: null }
  switch (world.state) {
    case 'ok':
      return { ...base, ...sourced, state: 'ok', reason: null, items: world.items }
    case 'failed':
      return { ...base, ...sourced, state: 'failed', reason: MALFORMED, items: [] }
    case 'approval-needed':
      return {
        ...base,
        ...sourced,
        state: 'approval-needed',
        reason: 'python3 .basicly/core/kit/tracker/cli.py',
        items: world.items,
      }
    case 'terminal-only':
      return {
        ...base,
        source: 'basicly',
        sourceLabel: 'basicly',
        caveat: null,
        state: 'terminal-only',
        reason: null,
        items: world.items,
      }
    case 'no-tracker':
      return {
        ...base,
        source: null,
        sourceLabel: null,
        caveat: null,
        state: 'no-tracker',
        reason: 'looked for beads',
        items: [],
      }
  }
}

function readDisk(world: World): void {
  if (world.disk.length === 0) return
  let diff = emptyDiff()
  for (const edit of world.disk.splice(0)) {
    if (edit.state !== undefined) world.state = edit.state
    if (edit.diff !== undefined) {
      world.items = applyItems(world.items, edit.diff)
      diff = addDiff(diff, edit.diff)
    }
  }
  world.version += 1
  if (world.state === 'failed') {
    world.unreported = addDiff(world.unreported, diff)
    world.history.push({ version: world.version, diff: emptyDiff() })
    return
  }
  world.history.push({ version: world.version, diff: addDiff(world.unreported, diff) })
  world.unreported = emptyDiff()
}

function answer(world: World, sinceText: string): Answer {
  const isRead = sinceText !== 'timer' || world.timerPolls
  const isSince = /^\d+$/.test(sinceText)
  const since = isSince ? Number(sinceText) : world.version
  if (isSince) world.sinces.push(since)
  if (isSince && world.rejectSince !== null && since <= world.rejectSince) {
    return { error: `since ${String(since)} is older than the oldest kept diff` }
  }
  if (isRead && sinceText === 'timer' && world.disk.length > 0) world.timerReads += 1
  if (isRead) readDisk(world)
  const diff = world.history
    .filter((entry) => entry.version > since)
    .reduce((sum, entry) => addDiff(sum, entry.diff), emptyDiff())
  return { snapshot: snapshotOf(world), result: { ...diff, version: world.version } }
}

function newWorld(): World {
  return {
    state: 'ok',
    items: [AB12, CD34, EF56],
    version: 7,
    history: [],
    disk: [],
    unreported: emptyDiff(),
    sinces: [],
    rejectSince: null,
    toasts: [],
    logs: [],
    callEdit: null,
    callMs: 0,
    timerPolls: false,
    timerReads: 0,
    plans: {},
    callIds: [],
    classifyError: false,
    trackerFileError: false,
    unanswered: [],
  }
}

function fakeRule(world: World, path: string): { value: string } | { deny: string } | null {
  let answer: Parsed | string | null | undefined
  if (path.startsWith(CLASSIFY_PATH)) {
    if (world.classifyError) return { deny: 'the fake command check is unavailable' }
    answer = CLASSIFIED[decodeURIComponent(path.slice(CLASSIFY_PATH.length))]
  } else if (path.startsWith(TRACKER_FILE_PATH)) {
    if (world.trackerFileError) return { deny: 'the fake tracker file check is unavailable' }
    const encoded = decodeURIComponent(path.slice(TRACKER_FILE_PATH.length))
    const args = JSON.parse(encoded) as TrackerFileArgs
    answer = args.root === ROOT ? TRACKER_FILES[args.path] : undefined
  } else {
    return null
  }
  if (answer !== undefined) return { value: JSON.stringify(answer) }
  world.unanswered.push(decodeURIComponent(path))
  return { deny: `the fake workitems has no answer for ${path}` }
}

function engineBeneath(on: On, world: World): MockClock {
  const clock = mock.clock(on, { now: START })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const rule = fakeRule(world, e.path)
    if (rule !== null) return rule
    const since = /^\/fake\/workitems\/refresh\/(\d+|poll|timer)$/.exec(e.path)?.[1]
    if (since === undefined) return { deny: `no fake file at ${e.path}` }
    return { value: JSON.stringify(answer(world, since)) }
  })
  on('tool.call', async (_$, e) => {
    world.callIds.push(e.tool_use_id)
    const plan = world.plans[planKey(e)] ?? {
      edit: world.callEdit ?? undefined,
      beforeMs: world.callMs,
      afterMs: world.callMs,
    }
    if ((plan.beforeMs ?? 0) > 0) await clock.sleep(plan.beforeMs ?? 0)
    if (plan.edit !== undefined) world.disk.push(plan.edit)
    if ((plan.afterMs ?? 0) > 0) await clock.sleep(plan.afterMs ?? 0)
    return {
      result: { stdout: `ran ${e.tool}`, stderr: '', interrupted: false, ...plan.output },
    }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}))
  return clock
}

function planKey(e: ToolCallInput): string {
  if (e.tool === 'Bash') return e.command
  if (e.tool === 'Write' || e.tool === 'Edit') return e.file_path
  return e.tool
}

type ToastBody = (world: World, $: Engine, clock: MockClock) => Promise<void>

function toastTest(name: string, body: ToastBody): void {
  test(name, { plugins: [fakeWorkitems] }, async ($, on) => {
    const world = newWorld()
    const clock = engineBeneath(on, world)
    await body(world, $, clock)
    expect(world.unanswered).toEqual([])
  })
}

async function startSession(
  $: Engine,
  surface: (typeof SURFACES)[number] = 'terminal',
): Promise<void> {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
}

function elsewhere(world: World, edit: DiskEdit): void {
  world.disk.push(edit)
}

async function poll($: Engine): Promise<void> {
  await $.command.run({
    command: POLL_COMMAND,
    args: '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 120 },
  })
}

async function pollAndTick($: Engine, clock: MockClock): Promise<void> {
  await poll($)
  await clock.advance(TICK_MS)
}

function updated(base: Item, status: Item['status'], title = base.title): Item {
  return { ...base, title, status, rawStatus: status }
}

const TOOLS = ['Bash', 'Write', 'Edit'] as const

async function runTool($: Engine, tool: (typeof TOOLS)[number]): Promise<void> {
  switch (tool) {
    case 'Bash':
      await $.tool.call({ tool: 'Bash', command: 'br close handily-ab12' })
      return
    case 'Write':
      await $.tool.call({ tool: 'Write', file_path: BEADS_FILE, content: '{}' })
      return
    case 'Edit':
      await $.tool.call({
        tool: 'Edit',
        file_path: BEADS_FILE,
        old_string: '"open"',
        new_string: '"closed"',
      })
      return
  }
}

function call($: Engine): Promise<void> {
  return runTool($, 'Bash')
}

async function bash($: Engine, command: string, isBackground = false): Promise<void> {
  await $.tool.call({ tool: 'Bash', command, run_in_background: isBackground })
}

async function notify($: Engine, text: string): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'task-notification' } })
}

describe('a change made elsewhere', () => {
  for (const surface of SURFACES) {
    toastTest(`toasts a closed item with the mock text on ${surface}`, async (world, $, clock) => {
      await startSession($, surface)
      elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } })
      await pollAndTick($, clock)
      expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
    })
  }

  toastTest('toasts a created item', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), created: [item('handily-ij90', 'New', 'open')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ij90 created: New'])
  })

  toastTest('shows the status move of an updated item', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), updated: [updated(CD34, 'in_progress')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual([
      'handily-cd34 updated: Write the beads reader (open -> in_progress)',
    ])
  })

  toastTest('shows no move when only the title changed', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), updated: [updated(CD34, 'open', 'Renamed')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-cd34 updated: Renamed'])
  })

  toastTest('cuts the title to 40 characters', async (world, $, clock) => {
    world.items.push(LONG)
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(LONG, 'closed')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual([
      'handily-gh78 closed: Write the beads reader so the provider r\u2026',
    ])
  })

  toastTest('toasts nothing when nothing changed', async (world, $, clock) => {
    await startSession($)
    await pollAndTick($, clock)
    await clock.advance(TICK_MS * 5)
    expect(world.toasts).toEqual([])
  })

  toastTest('reads a change that the poll has not read yet', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } })
    await clock.advance(TICK_MS)
    expect(world.toasts).toEqual([])
    await poll($)
    await clock.advance(TICK_MS)
    expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
  })
})

describe('a change that a tool call of this session caused', () => {
  for (const tool of TOOLS) {
    toastTest(`draws no toast for a call of the ${tool} tool`, async (world, $, clock) => {
      await startSession($)
      world.callEdit = { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } }
      await runTool($, tool)
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([])
      expect(world.items.find((each) => each.id === 'handily-ab12')?.status).toBe('closed')
    })
  }

  toastTest(
    'draws no toast when the poll reads the change while the call runs',
    async (world, $, clock) => {
      await startSession($)
      world.callEdit = { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } }
      world.callMs = TICK_MS * 3
      world.timerPolls = true
      const running = call($)
      await clock.advance(TICK_MS * 3)
      await clock.advance(TICK_MS * 3)
      await running
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([])
      expect(world.timerReads).toBe(1)
    },
  )

  toastTest('still toasts a change made elsewhere before the call', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), created: [item('handily-zz00', 'Other', 'open')] } })
    world.callEdit = { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } }
    await call($)
    await clock.advance(TICK_MS)
    expect(world.toasts).toEqual(['handily-zz00 created: Other'])
  })

  toastTest('still toasts a change made elsewhere after the call', async (world, $, clock) => {
    await startSession($)
    world.callEdit = { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } }
    await call($)
    elsewhere(world, { diff: { ...emptyDiff(), updated: [updated(CD34, 'blocked')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-cd34 updated: Write the beads reader (open -> blocked)'])
  })

  toastTest('draws no toast for overlapping calls', async (world, $, clock) => {
    await startSession($)
    world.callEdit = { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } }
    world.callMs = TICK_MS
    world.timerPolls = true
    const first = call($)
    const second = call($)
    await clock.advance(TICK_MS * 4)
    await Promise.all([first, second])
    await clock.advance(WINDOW_MS)
    expect(world.toasts).toEqual([])
  })

  toastTest('keeps toasting after a refresh rejects', async (world, $, clock) => {
    await startSession($)
    world.rejectSince = 7
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual([])
    expect(world.logs.some((line) => line.includes('older than the oldest kept diff'))).toBe(true)
    world.rejectSince = null
    await clock.advance(TICK_MS)
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(CD34, 'closed')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-cd34 closed: Write the beads reader'])
  })
})

describe('the rate limit', () => {
  toastTest('merges changes inside 30 s into the next toast', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(CD34, 'closed')] } })
    await pollAndTick($, clock)
    elsewhere(world, { diff: { ...emptyDiff(), created: [item('handily-ij90', 'New', 'open')] } })
    await pollAndTick($, clock)
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(EF56, 'closed')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toHaveLength(1)
    await clock.advance(WINDOW_MS - TICK_MS * 5)
    expect(world.toasts).toHaveLength(1)
    await clock.advance(TICK_MS * 2)
    expect(world.toasts).toEqual([
      'handily-ab12 closed: Draw text mocks for the mods',
      '3 work items changed: 2 closed, 1 created (handily-cd34, handily-ij90, +1)',
    ])
  })

  toastTest('names two items without a rest count', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, {
      diff: {
        ...emptyDiff(),
        created: [item('handily-ij90', 'New', 'open')],
        updated: [updated(CD34, 'in_progress')],
      },
    })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual([
      '2 work items changed: 1 created, 1 updated (handily-ij90, handily-cd34)',
    ])
  })

  toastTest('keeps the first status of an item that moved twice', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(EF56, 'closed')] } })
    await pollAndTick($, clock)
    elsewhere(world, { diff: { ...emptyDiff(), updated: [updated(CD34, 'in_progress')] } })
    await pollAndTick($, clock)
    elsewhere(world, { diff: { ...emptyDiff(), updated: [updated(CD34, 'blocked')] } })
    await pollAndTick($, clock)
    await clock.advance(WINDOW_MS)
    expect(world.toasts).toEqual([
      'handily-ef56 closed: Fix the parser',
      'handily-cd34 updated: Write the beads reader (open -> blocked)',
    ])
  })

  test('counts the larger group first in the merged text', () => {
    const change = (kind: Change['kind'], id: string): Change => ({
      kind,
      id,
      title: 'x',
      from: null,
      to: 'open',
    })
    expect(
      changesText([change('updated', 'a-1'), change('closed', 'a-2'), change('closed', 'a-3')]),
    ).toBe('3 work items changed: 2 closed, 1 updated (a-1, a-2, +1)')
  })
})

describe('the snapshot state', () => {
  toastTest(
    'toasts once when it turns failed and once when it recovers',
    async (world, $, clock) => {
      await startSession($)
      elsewhere(world, { state: 'failed' })
      await pollAndTick($, clock)
      expect(world.toasts).toEqual([FAILED_TOAST])
      for (let poll = 0; poll < 20; poll += 1) {
        elsewhere(world, { state: 'failed' })
        await pollAndTick($, clock)
      }
      expect(world.toasts).toEqual([FAILED_TOAST])
      elsewhere(world, { state: 'ok' })
      await pollAndTick($, clock)
      await clock.advance(TICK_MS * 5)
      expect(world.toasts).toEqual([FAILED_TOAST, 'Work items are back: beads \u00b7 3 open.'])
    },
  )

  toastTest('waits out the 30 s window before the failed toast', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } })
    await pollAndTick($, clock)
    elsewhere(world, { state: 'failed' })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
    await clock.advance(WINDOW_MS)
    expect(world.toasts).toEqual([
      'handily-ab12 closed: Draw text mocks for the mods',
      FAILED_TOAST,
    ])
  })

  toastTest(
    'shows nothing for a failure that recovered inside the window',
    async (world, $, clock) => {
      await startSession($)
      elsewhere(world, { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } })
      await pollAndTick($, clock)
      elsewhere(world, { state: 'failed' })
      await pollAndTick($, clock)
      elsewhere(world, { state: 'ok' })
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS * 2)
      expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
    },
  )

  const silent: readonly TrackerState[] = ['no-tracker', 'approval-needed', 'terminal-only']
  for (const state of silent) {
    toastTest(`stays silent while the state is ${state}`, async (world, $, clock) => {
      await startSession($)
      elsewhere(world, {
        state,
        diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] },
      })
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS * 2)
      expect(world.toasts).toEqual([])
      expect(world.sinces.length).toBeGreaterThan(0)
    })
  }

  toastTest('starts toasting again when the state is ok again', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, {
      state: 'terminal-only',
      diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] },
    })
    await pollAndTick($, clock)
    elsewhere(world, { state: 'ok', diff: { ...emptyDiff(), closed: [updated(CD34, 'closed')] } })
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-cd34 closed: Write the beads reader'])
  })
})

const CLOSE_AB12 = 'br close handily-ab12'
const UPDATE_CD34 = 'br update handily-cd34 --status in_progress'

function closeAb12(): DiskEdit {
  return { diff: { ...emptyDiff(), closed: [updated(AB12, 'closed')] } }
}

function closeEf56(): DiskEdit {
  return { diff: { ...emptyDiff(), closed: [updated(EF56, 'closed')] } }
}

function notificationText(taskId: string, toolUseId: string): string {
  return [
    '<task-notification>',
    `<task-id>${taskId}</task-id>`,
    `<tool-use-id>${toolUseId}</tool-use-id>`,
    '<status>completed</status>',
    '</task-notification>',
  ].join('\n')
}

describe('a call that runs on in the background', () => {
  toastTest('keeps a background call open until its task notification', async (world, $, clock) => {
    await startSession($)
    world.plans[CLOSE_AB12] = { output: { backgroundTaskId: 'b1' } }
    await bash($, CLOSE_AB12, true)
    elsewhere(world, closeAb12())
    await pollAndTick($, clock)
    await clock.advance(WINDOW_MS)
    expect(world.toasts).toEqual([])
    await notify($, notificationText('b1', world.callIds.at(-1) ?? ''))
    await clock.advance(WINDOW_MS)
    elsewhere(world, closeEf56())
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ef56 closed: Fix the parser'])
  })

  toastTest(
    'keeps a call moved to the background open until the stop hook lists it no more',
    async (world, $, clock) => {
      await startSession($)
      world.plans[CLOSE_AB12] = { output: { backgroundTaskId: 'b2', backgroundedByUser: true } }
      await bash($, CLOSE_AB12)
      await $.classic.Stop({
        stop_hook_active: false,
        background_tasks: [{ id: 'b2', type: 'shell', status: 'running', description: CLOSE_AB12 }],
      })
      elsewhere(world, closeAb12())
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([])
      await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
      await clock.advance(WINDOW_MS)
      elsewhere(world, closeEf56())
      await pollAndTick($, clock)
      expect(world.toasts).toEqual(['handily-ef56 closed: Fix the parser'])
    },
  )

  toastTest('ignores the notification of another task', async (world, $, clock) => {
    await startSession($)
    world.plans[CLOSE_AB12] = { output: { backgroundTaskId: 'b3' } }
    await bash($, CLOSE_AB12, true)
    await notify($, notificationText('b9', 'toolu_other'))
    elsewhere(world, closeAb12())
    await pollAndTick($, clock)
    await clock.advance(WINDOW_MS)
    expect(world.toasts).toEqual([])
  })
})

describe('a change of this session during a failure', () => {
  toastTest(
    'drops the recovery diff when a call ran during the failure',
    async (world, $, clock) => {
      await startSession($)
      elsewhere(world, { state: 'failed' })
      await pollAndTick($, clock)
      world.plans[CLOSE_AB12] = { edit: closeAb12() }
      await bash($, CLOSE_AB12)
      await clock.advance(WINDOW_MS)
      elsewhere(world, { state: 'ok' })
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS * 2)
      expect(world.toasts).toEqual([FAILED_TOAST, 'Work items are back: beads \u00b7 2 open.'])
    },
  )

  toastTest(
    'drops the recovery diff when a call was open as the state turned failed',
    async (world, $, clock) => {
      await startSession($)
      world.timerPolls = true
      world.plans[CLOSE_AB12] = { edit: closeAb12(), beforeMs: TICK_MS * 2, afterMs: TICK_MS * 2 }
      const running = bash($, CLOSE_AB12)
      await clock.settle()
      expect(world.sinces).toEqual([7])
      elsewhere(world, { state: 'failed' })
      await clock.advance(TICK_MS * 4)
      await running
      world.timerPolls = false
      await clock.advance(WINDOW_MS)
      elsewhere(world, { state: 'ok' })
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS * 2)
      expect(world.toasts).toEqual([FAILED_TOAST, 'Work items are back: beads \u00b7 2 open.'])
    },
  )

  toastTest(
    'toasts a change made elsewhere during a failure with no call',
    async (world, $, clock) => {
      await startSession($)
      elsewhere(world, { state: 'failed' })
      await pollAndTick($, clock)
      elsewhere(world, closeAb12())
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS)
      elsewhere(world, { state: 'ok' })
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS * 2)
      expect(world.toasts).toEqual([
        FAILED_TOAST,
        'Work items are back: beads \u00b7 2 open.',
        'handily-ab12 closed: Draw text mocks for the mods',
      ])
    },
  )
})

describe('overlapping calls', () => {
  toastTest(
    'counts the edit of the first call as own when a second call starts after it',
    async (world, $, clock) => {
      await startSession($)
      world.plans[CLOSE_AB12] = { edit: closeAb12(), afterMs: TICK_MS * 3 }
      world.plans[UPDATE_CD34] = { afterMs: TICK_MS }
      const first = bash($, CLOSE_AB12)
      await clock.settle()
      expect(world.disk).toHaveLength(1)
      const second = bash($, UPDATE_CD34)
      await clock.advance(TICK_MS * 4)
      await Promise.all([first, second])
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([])
    },
  )

  toastTest(
    'reads the diff only when the first call starts and the last call ends',
    async (world, $, clock) => {
      await startSession($)
      world.plans[CLOSE_AB12] = { edit: closeAb12(), afterMs: TICK_MS * 3 }
      world.plans[UPDATE_CD34] = {}
      const first = bash($, CLOSE_AB12)
      await clock.settle()
      await bash($, UPDATE_CD34)
      expect(world.sinces).toEqual([7])
      await clock.advance(TICK_MS * 3)
      await first
      expect(world.sinces).toEqual([7, 7])
    },
  )
})

describe('a second session start', () => {
  toastTest(
    'does not repeat the failed toast when a second session start comes during the failure',
    async (world, $, clock) => {
      await startSession($)
      elsewhere(world, { state: 'failed' })
      await pollAndTick($, clock)
      await startSession($)
      await clock.advance(WINDOW_MS * 2)
      expect(world.toasts).toEqual([FAILED_TOAST])
      elsewhere(world, { state: 'ok' })
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([FAILED_TOAST, 'Work items are back: beads \u00b7 3 open.'])
    },
  )
})

const BACKGROUND_LIMIT_MS = 30 * 60 * 1000
const OWN_COMMANDS = [
  'br close handily-ab12',
  'uv run .basicly/core/kit/tracker/cli.py close handily-ab12',
  'basicly tracker write close handily-ab12',
  'for id in handily-ab12; do br close $id; done',
] as const

async function edit($: Engine, filePath: string): Promise<void> {
  await $.tool.call({ tool: 'Edit', file_path: filePath, old_string: 'a', new_string: 'b' })
}

async function write($: Engine, filePath: string): Promise<void> {
  await $.tool.call({ tool: 'Write', file_path: filePath, content: 'x' })
}

async function changeElsewhereWhileRunning(
  world: World,
  $: Engine,
  clock: MockClock,
  running: Promise<void>,
): Promise<void> {
  await clock.settle()
  elsewhere(world, closeEf56())
  await poll($)
  await clock.advance(TICK_MS)
  expect(world.toasts).toEqual(['handily-ef56 closed: Fix the parser'])
  await clock.advance(TICK_MS * 10)
  await running
}

describe('a call that is not a tracker write', () => {
  toastTest('toasts a change made elsewhere while npm test runs', async (world, $, clock) => {
    await startSession($)
    world.plans['npm test'] = { afterMs: TICK_MS * 10 }
    await changeElsewhereWhileRunning(world, $, clock, bash($, 'npm test'))
  })

  toastTest(
    'toasts a change made elsewhere while a call waits before it runs',
    async (world, $, clock) => {
      await startSession($)
      world.plans['git push origin main'] = { beforeMs: TICK_MS * 10 }
      await changeElsewhereWhileRunning(world, $, clock, bash($, 'git push origin main'))
    },
  )

  toastTest(
    'toasts a change made elsewhere while a Write to src/x.ts runs',
    async (world, $, clock) => {
      await startSession($)
      world.plans[`${ROOT}/src/x.ts`] = { afterMs: TICK_MS * 10 }
      await changeElsewhereWhileRunning(world, $, clock, write($, `${ROOT}/src/x.ts`))
    },
  )

  for (const command of ['br close handily-ab12 --dry-run', 'br --help']) {
    toastTest(`does not count ${command} as own`, async (world, $, clock) => {
      await startSession($)
      world.plans[command] = { afterMs: TICK_MS * 10 }
      await changeElsewhereWhileRunning(world, $, clock, bash($, command))
    })
  }

  toastTest('toasts the change of bash close.sh, a known limit', async (world, $, clock) => {
    await startSession($)
    world.plans['bash close.sh'] = { edit: closeAb12() }
    await bash($, 'bash close.sh')
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
  })

  toastTest('toasts the Edit of .beans/README.md', async (world, $, clock) => {
    await startSession($)
    world.plans[`${ROOT}/.beans/README.md`] = { edit: closeAb12() }
    await edit($, `${ROOT}/.beans/README.md`)
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
  })
})

describe('a call that is a tracker write', () => {
  for (const command of OWN_COMMANDS) {
    toastTest(`counts ${command} as own`, async (world, $, clock) => {
      await startSession($)
      world.plans[command] = { edit: closeAb12() }
      await bash($, command)
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([])
      expect(world.items.find((each) => each.id === 'handily-ab12')?.status).toBe('closed')
    })
  }

  toastTest('counts the Edit of a beans item file as own', async (world, $, clock) => {
    await startSession($)
    world.plans[`${ROOT}/.beans/app-ab12--x.md`] = { edit: closeAb12() }
    await edit($, `${ROOT}/.beans/app-ab12--x.md`)
    await pollAndTick($, clock)
    await clock.advance(WINDOW_MS)
    expect(world.toasts).toEqual([])
  })

  toastTest(
    'drops a change made elsewhere while a tracker write runs, a known limit',
    async (world, $, clock) => {
      await startSession($)
      world.plans[CLOSE_AB12] = { afterMs: TICK_MS * 5 }
      const running = bash($, CLOSE_AB12)
      await clock.settle()
      elsewhere(world, closeEf56())
      await poll($)
      await clock.advance(TICK_MS * 6)
      await running
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([])
    },
  )

  toastTest(
    'keeps the count right when an unmatched call runs inside a tracker write',
    async (world, $, clock) => {
      await startSession($)
      world.plans[CLOSE_AB12] = { edit: closeAb12(), afterMs: TICK_MS * 5 }
      world.plans['npm test'] = { afterMs: TICK_MS }
      const outer = bash($, CLOSE_AB12)
      await clock.settle()
      const inner = bash($, 'npm test')
      await clock.advance(TICK_MS * 2)
      await inner
      await clock.advance(TICK_MS * 4)
      await outer
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([])
      elsewhere(world, closeEf56())
      await pollAndTick($, clock)
      expect(world.toasts).toEqual(['handily-ef56 closed: Fix the parser'])
    },
  )

  toastTest(
    'keeps the count right when a tracker write runs inside an unmatched call',
    async (world, $, clock) => {
      await startSession($)
      world.plans['npm test'] = { afterMs: TICK_MS * 10 }
      world.plans[CLOSE_AB12] = { edit: closeAb12() }
      const outer = bash($, 'npm test')
      await clock.settle()
      await bash($, CLOSE_AB12)
      await clock.advance(TICK_MS)
      elsewhere(world, closeEf56())
      await poll($)
      await clock.advance(TICK_MS)
      expect(world.toasts).toEqual(['handily-ef56 closed: Fix the parser'])
      await clock.advance(TICK_MS * 10)
      await outer
    },
  )
})

describe('a failed check of the workitems rules', () => {
  toastTest('does not count the Bash call as own and logs why', async (world, $, clock) => {
    await startSession($)
    world.classifyError = true
    world.plans[CLOSE_AB12] = { edit: closeAb12() }
    await bash($, CLOSE_AB12)
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
    expect(
      world.logs.some((line) =>
        line.startsWith('item-toasts: not counting the call as own; the command check failed:'),
      ),
    ).toBe(true)
  })

  toastTest('does not count the Write call as own and logs why', async (world, $, clock) => {
    await startSession($)
    world.trackerFileError = true
    world.plans[BEADS_FILE] = { edit: closeAb12() }
    await write($, BEADS_FILE)
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ab12 closed: Draw text mocks for the mods'])
    expect(
      world.logs.some((line) =>
        line.startsWith(
          'item-toasts: not counting the call as own; the tracker file check failed:',
        ),
      ),
    ).toBe(true)
  })
})

describe('an unknown workitems root', () => {
  toastTest('does not count a Write as own and logs why', async (world, $) => {
    await write($, BEADS_FILE)
    expect(world.callIds).toHaveLength(1)
    expect(world.logs).toContain(
      'item-toasts: not counting the call as own; workitems has no root yet',
    )
  })
})

describe('the time limit of a background call', () => {
  toastTest(
    'closes a background call after 30 minutes without a notification',
    async (world, $, clock) => {
      await startSession($)
      world.plans[CLOSE_AB12] = { output: { backgroundTaskId: 'b4' } }
      await bash($, CLOSE_AB12, true)
      elsewhere(world, closeAb12())
      await pollAndTick($, clock)
      await clock.advance(BACKGROUND_LIMIT_MS - TICK_MS * 2)
      expect(world.toasts).toEqual([])
      await clock.advance(TICK_MS * 2)
      elsewhere(world, closeEf56())
      await pollAndTick($, clock)
      expect(world.toasts).toEqual(['handily-ef56 closed: Fix the parser'])
    },
  )
})

describe('review repairs of the second round', () => {
  toastTest(
    'closes only the background call whose ids the notification names',
    async (world, $, clock) => {
      await startSession($)
      world.plans[CLOSE_AB12] = { output: { backgroundTaskId: 'b1' } }
      world.plans[UPDATE_CD34] = { output: { backgroundTaskId: 'b10' } }
      await bash($, CLOSE_AB12, true)
      const first = world.callIds.at(-1) ?? ''
      await bash($, UPDATE_CD34, true)
      const second = world.callIds.at(-1) ?? ''
      await notify($, notificationText('b10', second))
      elsewhere(world, closeAb12())
      await pollAndTick($, clock)
      await clock.advance(WINDOW_MS)
      expect(world.toasts).toEqual([])
      await notify($, notificationText('b1', first))
      elsewhere(world, closeEf56())
      await pollAndTick($, clock)
      expect(world.toasts).toEqual(['handily-ef56 closed: Fix the parser'])
    },
  )

  toastTest('keeps the 30 s limit across a second session start', async (world, $, clock) => {
    await startSession($)
    elsewhere(world, closeAb12())
    await pollAndTick($, clock)
    expect(world.toasts).toHaveLength(1)
    await startSession($)
    elsewhere(world, closeEf56())
    await pollAndTick($, clock)
    expect(world.toasts).toHaveLength(1)
    await clock.advance(WINDOW_MS)
    expect(world.toasts).toEqual([
      'handily-ab12 closed: Draw text mocks for the mods',
      'handily-ef56 closed: Fix the parser',
    ])
  })

  toastTest('ignores a call that completes after its session ended', async (world, $, clock) => {
    await startSession($)
    world.plans[CLOSE_AB12] = { afterMs: TICK_MS * 2, output: { backgroundTaskId: 'b5' } }
    const running = bash($, CLOSE_AB12, true)
    await clock.settle()
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    await startSession($)
    await clock.advance(TICK_MS * 2)
    await running
    await clock.advance(30 * 60 * 1000)
    elsewhere(world, closeEf56())
    await pollAndTick($, clock)
    expect(world.toasts).toEqual(['handily-ef56 closed: Fix the parser'])
  })
})

describe('ready value for /handily', () => {
  test(
    'writes the ready value that /handily reads when the session starts',
    { plugins: [fakeWorkitems] },
    async ($, on) => {
      engineBeneath(on, newWorld())
      const ready: unknown[] = []
      on('state.set', { plugin: 'handily-item-toasts', key: 'ready' }, (_$, e, next) => {
        ready.push(e.value)
        return next(e)
      })
      await startSession($)
      expect(ready).toEqual([{ root: expect.stringMatching(/[\\/]handily-item-toasts$/) }])
    },
  )
})
