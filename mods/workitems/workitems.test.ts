import type { On } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import type {
  WorkitemsDiff,
  WorkitemsItem,
  WorkitemsLine,
  WorkitemsSnapshot,
  WorkitemsWriteVerbs,
} from './types'

const ROOT = '/work/app'
const ISSUES = `${ROOT}/.beads/issues.jsonl`
const METADATA = `${ROOT}/.beads/metadata.json`
const OVER_4_MIB = 4 * 1024 * 1024 + 1

const FIXTURE_ISSUES = [
  '{"id":"app-ab12","title":"Add the export button","status":"open","priority":2,"issue_type":"feature","assignee":"dev-one","updated_at":"2026-10-01T09:00:00Z","labels":["ui"]}',
  '{"id":"app-cd34","title":"Fix the date parser","status":"in_progress","priority":1,"issue_type":"bug","updated_at":"2026-10-02T10:30:00Z","dependencies":[{"issue_id":"app-cd34","depends_on_id":"app-ab12","type":"parent-child"}]}',
  '{"id":"app-ef56","title":"Write the release notes","status":"closed","priority":3,"issue_type":"task","updated_at":"2026-10-03T08:15:00Z"}',
  '{"id":"app-gh78","title":"Drop the old importer","status":"tombstone","priority":4,"issue_type":"task","updated_at":"2026-10-04T12:00:00Z"}',
].join('\n')

type FakeFile = { text: string; mtimeMs: number; size?: number }

type World = {
  root: string
  files: Map<string, FakeFile>
  touched: string[]
  reads: string[]
  rootCalls: number
  readDelayMs: number
}

function fakeWorld(on: On, clock: MockClock, files: Record<string, FakeFile>): World {
  const world: World = {
    root: ROOT,
    files: new Map(Object.entries(files)),
    touched: [],
    reads: [],
    rootCalls: 0,
    readDelayMs: 0,
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.CwdChanged', () => ({}))
  on('session.root', () => {
    world.rootCalls += 1
    return { value: world.root }
  })
  on('fs.exists', (_$, e) => {
    world.touched.push(e.path)
    return { value: world.files.has(e.path) }
  })
  on('fs.stat', (_$, e) => {
    world.touched.push(e.path)
    const file = world.files.get(e.path)
    if (!file) return { deny: `ENOENT: ${e.path}` }
    const size = file.size ?? new TextEncoder().encode(file.text).length
    return { value: { kind: 'file', size, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.read', async (_$, e) => {
    world.touched.push(e.path)
    world.reads.push(e.path)
    if (world.readDelayMs > 0) await clock.sleep(world.readDelayMs)
    const file = world.files.get(e.path)
    if (!file) return { deny: `ENOENT: ${e.path}` }
    return { value: file.text }
  })
  return world
}

const consumer: Plugin = {
  name: 'consumer',
  register(on) {
    on('command.run', async ($, e, next) => {
      if (e.command === 'snapshot') {
        const { value } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
        return { text: JSON.stringify(value ?? null) }
      }
      if (e.command === 'refresh') {
        return { text: JSON.stringify(await $.workitems.refresh()) }
      }
      if (e.command === 'refresh-twice') {
        const both = await Promise.all([$.workitems.refresh(), $.workitems.refresh()])
        return { text: JSON.stringify(both) }
      }
      if (e.command === 'lines') {
        const { value } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
        if (!value) return { text: 'no snapshot' }
        return {
          text: JSON.stringify(await $.workitems.lines({ snapshot: value, now: Number(e.args) })),
        }
      }
      if (e.command === 'write-verbs') {
        return { text: JSON.stringify(await $.workitems.writeVerbs()) }
      }
      return next(e)
    })
  },
}

async function commandText(engine: Engine, command: string, args?: string): Promise<string> {
  const result = await engine.command.run({
    command,
    args: args ?? '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return result.text ?? ''
}

async function snapshotOf(engine: Engine): Promise<WorkitemsSnapshot> {
  return JSON.parse(await commandText(engine, 'snapshot')) as WorkitemsSnapshot
}

async function startSession(engine: Engine): Promise<void> {
  await engine.session.start({ cwd: ROOT, surface: null, isInteractive: false })
}

function keysOf(items: readonly WorkitemsItem[]): string[] {
  return items.map((item) => item.key)
}

describe('beads reader', () => {
  test(
    'publishes 3 normalized items from 3 issue lines and 1 tombstone',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on, { now: 1_000 })
      fakeWorld(on, clock, { [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10 } })
      await startSession($)
      const snapshot = await snapshotOf($)
      expect(snapshot.state).toBe('ok')
      expect(snapshot.source).toBe('beads')
      expect(snapshot.root).toBe(ROOT)
      expect(snapshot.at).toBe(1_000)
      expect(keysOf(snapshot.items)).toEqual(['beads:app-ab12', 'beads:app-cd34', 'beads:app-ef56'])
      expect(snapshot.items[0]).toEqual({
        key: 'beads:app-ab12',
        id: 'app-ab12',
        title: 'Add the export button',
        status: 'open',
        rawStatus: 'open',
        priority: 2,
        type: 'feature',
        assignee: 'dev-one',
        updatedAt: '2026-10-01T09:00:00Z',
        source: 'beads',
        labels: ['ui'],
      })
      expect(snapshot.items[1]?.parent).toBe('app-ab12')
      expect(snapshot.items[1]?.status).toBe('in_progress')
      expect(snapshot.items[2]?.status).toBe('closed')
    },
  )

  test(
    'skips a line whose _type is present and not issue',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const lines = [
        '{"_type":"issue","id":"app-1","title":"Kept","status":"open"}',
        '{"_type":"dependency","id":"app-2","title":"Skipped","status":"open"}',
        '{"id":"app-3","title":"No type field","status":"hooked"}',
      ].join('\n')
      fakeWorld(on, clock, { [ISSUES]: { text: lines, mtimeMs: 10 } })
      await startSession($)
      const snapshot = await snapshotOf($)
      expect(keysOf(snapshot.items)).toEqual(['beads:app-1', 'beads:app-3'])
      expect(snapshot.items[1]?.status).toBe('other')
      expect(snapshot.items[1]?.rawStatus).toBe('hooked')
      expect(snapshot.items[1]?.priority).toBeNull()
    },
  )

  test(
    'labels bd data possibly stale when the beads backend is dolt',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      fakeWorld(on, clock, {
        [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10 },
        [METADATA]: { text: '{"database":"dolt","backend":"dolt"}', mtimeMs: 10 },
      })
      await startSession($)
      const snapshot = await snapshotOf($)
      expect(snapshot.sourceLabel).toBe('beads (bd)')
      expect(snapshot.caveat).toBe('bd keeps data in Dolt')
      expect(snapshot.items[0]?.labels).toEqual(['ui', 'possibly stale'])
      expect(snapshot.items[1]?.labels).toEqual(['possibly stale'])
    },
  )
})

describe('detection', () => {
  test('reports no-tracker and reads no parent folder', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    const world = fakeWorld(on, clock, {
      '/work/.beads/issues.jsonl': { text: FIXTURE_ISSUES, mtimeMs: 10 },
    })
    await startSession($)
    const snapshot = await snapshotOf($)
    expect(snapshot.state).toBe('no-tracker')
    expect(snapshot.reason).toBe('looked for beads')
    expect(snapshot.items).toEqual([])
    expect(world.touched.length).toBeGreaterThan(0)
    expect(world.touched.filter((path) => !path.startsWith(`${ROOT}/`))).toEqual([])
  })

  test(
    'detects again at the new root when the directory changes',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, clock, {
        '/work/other/.beads/issues.jsonl': { text: FIXTURE_ISSUES, mtimeMs: 10 },
      })
      await startSession($)
      expect((await snapshotOf($)).state).toBe('no-tracker')
      world.root = '/work/other'
      await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: '/work/other' })
      const snapshot = await snapshotOf($)
      expect(snapshot.state).toBe('ok')
      expect(snapshot.root).toBe('/work/other')
      expect(snapshot.items.length).toBe(3)
    },
  )
})

describe('failures name the file', () => {
  test(
    'fails without reading when the tracker file is over 4 MiB',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, clock, {
        [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10, size: OVER_4_MIB },
      })
      await startSession($)
      const snapshot = await snapshotOf($)
      expect(snapshot.state).toBe('failed')
      expect(snapshot.reason).toBe('.beads/issues.jsonl is over 4 MiB.')
      expect(world.reads).toEqual([])
    },
  )

  test('reads a tracker file of exactly 4 MiB', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    fakeWorld(on, clock, { [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10, size: OVER_4_MIB - 1 } })
    await startSession($)
    expect((await snapshotOf($)).state).toBe('ok')
  })

  test(
    'fails with the file and line when a line is malformed',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const lines = ['{"id":"app-1","title":"Good","status":"open"}', '{"id":"app-2",', ''].join(
        '\n',
      )
      fakeWorld(on, clock, { [ISSUES]: { text: lines, mtimeMs: 10 } })
      await startSession($)
      const snapshot = await snapshotOf($)
      expect(snapshot.state).toBe('failed')
      expect(snapshot.reason).toBe('.beads/issues.jsonl line 2 is malformed.')
      expect(snapshot.items).toEqual([])
    },
  )

  test(
    'fails when an issue line has a priority outside 0 to 4',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const lines = '{"id":"app-1","title":"Bad priority","status":"open","priority":7}'
      fakeWorld(on, clock, { [ISSUES]: { text: lines, mtimeMs: 10 } })
      await startSession($)
      expect((await snapshotOf($)).reason).toBe('.beads/issues.jsonl line 1 is malformed.')
    },
  )
})

describe('refresh', () => {
  test(
    'returns the created, updated and closed items after a change',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, clock, { [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10 } })
      await startSession($)
      const changed = [
        '{"id":"app-ab12","title":"Add the export button","status":"closed","priority":2,"issue_type":"feature","assignee":"dev-one","updated_at":"2026-10-05T09:00:00Z","labels":["ui"]}',
        '{"id":"app-cd34","title":"Fix the date parser in reports","status":"in_progress","priority":1,"issue_type":"bug","updated_at":"2026-10-05T10:30:00Z"}',
        '{"id":"app-ef56","title":"Write the release notes","status":"closed","priority":3,"issue_type":"task","updated_at":"2026-10-03T08:15:00Z"}',
        '{"id":"app-ij90","title":"Add a dark theme","status":"open","priority":3,"issue_type":"feature"}',
      ].join('\n')
      world.files.set(ISSUES, { text: changed, mtimeMs: 20 })
      const diff = JSON.parse(await commandText($, 'refresh')) as WorkitemsDiff
      expect(keysOf(diff.created)).toEqual(['beads:app-ij90'])
      expect(keysOf(diff.updated)).toEqual(['beads:app-cd34'])
      expect(keysOf(diff.closed)).toEqual(['beads:app-ab12'])
    },
  )

  test(
    'returns an empty diff and reads nothing when the mtime is unchanged',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, clock, { [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10 } })
      await startSession($)
      const readsAfterStart = world.reads.length
      const diff = JSON.parse(await commandText($, 'refresh')) as WorkitemsDiff
      expect(diff).toEqual({ created: [], updated: [], closed: [] })
      expect(world.reads.length).toBe(readsAfterStart)
    },
  )

  test('a second refresh joins the one in flight', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    const world = fakeWorld(on, clock, { [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10 } })
    await startSession($)
    world.files.set(ISSUES, {
      text: `${FIXTURE_ISSUES}\n{"id":"app-x","title":"New","status":"open"}`,
      mtimeMs: 20,
    })
    world.reads.length = 0
    world.rootCalls = 0
    world.readDelayMs = 50
    const pending = commandText($, 'refresh-twice')
    await clock.settle()
    await clock.advance(50)
    const [first, second] = JSON.parse(await pending) as [WorkitemsDiff, WorkitemsDiff]
    expect(world.reads).toEqual([ISSUES])
    expect(world.rootCalls).toBe(1)
    expect(keysOf(first.created)).toEqual(['beads:app-x'])
    expect(second).toEqual(first)
  })

  test(
    'polls the tracker file mtime with clock.every every 2 s',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, clock, { [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10 } })
      await startSession($)
      world.files.set(ISSUES, {
        text: `${FIXTURE_ISSUES}\n{"id":"app-x","title":"New","status":"open"}`,
        mtimeMs: 20,
      })
      await clock.advance(1_999)
      expect((await snapshotOf($)).items.length).toBe(3)
      await clock.advance(1)
      expect((await snapshotOf($)).items.length).toBe(4)
      const readsAfterChange = world.reads.length
      await clock.advance(2_000)
      expect(world.reads.length).toBe(readsAfterChange)
    },
  )
})

describe('contract', () => {
  test(
    'lines give the state texts of the approved mocks',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on, { now: 100_000 })
      const world = fakeWorld(on, clock, {
        [ISSUES]: { text: FIXTURE_ISSUES, mtimeMs: 10 },
        [METADATA]: { text: '{"backend":"dolt"}', mtimeMs: 10 },
      })
      await startSession($)
      const okLines = JSON.parse(await commandText($, 'lines', '112000')) as WorkitemsLine[]
      expect(okLines).toEqual([
        {
          kind: 'header',
          tone: 'dim',
          text: 'beads (bd) · 2 open · read 12 s ago · may be stale: bd keeps data in Dolt',
        },
      ])
      world.files.set(ISSUES, { text: FIXTURE_ISSUES, mtimeMs: 30, size: OVER_4_MIB })
      await commandText($, 'refresh')
      const failedLines = JSON.parse(await commandText($, 'lines', '112000')) as WorkitemsLine[]
      expect(failedLines).toEqual([
        {
          kind: 'failed',
          tone: 'error',
          text: 'Work items unavailable: .beads/issues.jsonl is over 4 MiB.',
        },
      ])
      world.files.clear()
      await commandText($, 'refresh')
      const noTrackerLines = JSON.parse(await commandText($, 'lines', '112000')) as WorkitemsLine[]
      expect(noTrackerLines).toEqual([
        {
          kind: 'no-tracker',
          tone: 'dim',
          text: 'No tracker found at the repo root (looked for beads).',
        },
      ])
    },
  )

  test('write verbs list each tracker CLI', { plugins: [consumer] }, async ($, on) => {
    mock.clock(on)
    const verbs = JSON.parse(await commandText($, 'write-verbs')) as WorkitemsWriteVerbs
    expect(verbs['basicly tracker']).toEqual([
      'close',
      'comments add',
      'create',
      'dep add',
      'dep remove',
      'gate report',
      'update',
    ])
    expect(verbs['.basicly/core/kit/tracker/cli.py'].length).toBe(16)
    expect(verbs.br).toContain('comments add')
  })
})
