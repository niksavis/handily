import type { AgentInfo, On, RenderSurface, UiPane } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import { AGENTS_ARGV, parseAgents, POLL_INTERVAL_MS, type AgentsCache } from './hooks/agents'
import { formatDuration } from './hooks/board'
import { RECORDED_AGENTS } from './fixtures/agents'
import {
  emptyProgress,
  estimateLeftMs,
  EST_QUIET_MS,
  progressKey,
  withTasks,
  type Progress,
} from './hooks/progress'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const NOW = 1_791_400_000_000
const OWN_ID = '00000000-0000-4000-8000-00000000000a'
const LANE_ID = '00000000-0000-4000-8000-00000000000b'
const API_ID = '00000000-0000-4000-8000-00000000000c'
const DOCS_ID = '00000000-0000-4000-8000-00000000000d'
const GONE_ID = '00000000-0000-4000-8000-00000000000e'
const KEPT_ID = '00000000-0000-4000-8000-00000000000f'
const PANE_ID = 'session-board'

type AgentEntry = Record<string, string | number>

const BOARD_AGENTS: AgentEntry[] = [
  {
    pid: 2001,
    cwd: '/work/app',
    kind: 'interactive',
    startedAt: NOW - 3 * HOUR,
    sessionId: OWN_ID,
    name: 'mocks',
    status: 'busy',
  },
  {
    id: '0000b002',
    cwd: '/work/app.wt/lane-a1',
    kind: 'background',
    startedAt: NOW - HOUR,
    sessionId: LANE_ID,
    name: 'lane-a1',
    status: 'waiting',
    waitingFor: 'permission',
    state: 'blocked',
  },
  {
    id: '0000b004',
    cwd: '/work/docs',
    kind: 'background',
    startedAt: NOW - 5 * HOUR,
    sessionId: DOCS_ID,
    name: 'docs-pass',
    state: 'done',
  },
  {
    pid: 2003,
    cwd: '/work/api',
    kind: 'interactive',
    startedAt: NOW - (2 * HOUR + 3 * MINUTE),
    sessionId: API_ID,
    name: 'api-login',
    status: 'idle',
  },
]

const REPOS: Record<string, { top: string; gitDir: string; commonDir: string; branch: string }> = {
  '/work/app': {
    top: '/work/app',
    gitDir: '/work/app/.git',
    commonDir: '/work/app/.git',
    branch: 'main',
  },
  '/work/app.wt/lane-a1': {
    top: '/work/app.wt/lane-a1',
    gitDir: '/work/app/.git/worktrees/lane-a1',
    commonDir: '/work/app/.git',
    branch: 'lane/app-x1y2',
  },
  '/work/app.wt/lane-b2': {
    top: '/work/app.wt/lane-b2',
    gitDir: '/work/app/.git/worktrees/lane-b2',
    commonDir: '/work/app/.git',
    branch: 'lane/app-b2',
  },
  '/work/api': {
    top: '/work/api',
    gitDir: '/work/api/.git',
    commonDir: '/work/api/.git',
    branch: 'feat/login',
  },
  '/work/docs': {
    top: '/work/docs',
    gitDir: '/work/docs/.git',
    commonDir: '/work/docs/.git',
    branch: 'main',
  },
}

function progressOf(sessionId: string, fields: Partial<Progress>): Progress {
  return { ...emptyProgress(sessionId, '/work/app', NOW), hasTasks: true, ...fields }
}

const OWN_PROGRESS = progressOf(OWN_ID, {
  workedMs: 41 * MINUTE,
  task: 'Draw quiet-items mocks',
  done: 2,
  total: 5,
  taskIds: [1, 2, 3, 4, 5],
  firstTaskAt: NOW - 20 * MINUTE,
  lastAddedAt: NOW - 10 * MINUTE,
})

const LANE_PROGRESS = progressOf(LANE_ID, {
  cwd: '/work/app.wt/lane-a1',
  workedMs: 18 * MINUTE,
  task: 'Write the beads reader',
  done: 0,
  total: 3,
  taskIds: [1, 2, 3],
  firstTaskAt: NOW - 30 * MINUTE,
  lastAddedAt: NOW - 30 * MINUTE,
})

const GONE_PROGRESS = progressOf(GONE_ID, {
  cwd: '/work/old',
  workedMs: 5 * MINUTE,
  task: 'Old task',
  done: 1,
  total: 2,
  taskIds: [1, 2],
})

type AgentsAnswer =
  { exitCode: number; stdout: string; isStdoutTruncated?: boolean } | { deny: string }

type World = {
  surfaces: RenderSurface[]
  panes: UiPane[]
  agents: AgentsAnswer
  agentsRuns: number
  gitCwds: string[]
  subagents: AgentInfo[]
  logs: string[]
  wait: (() => Promise<void>) | null
}

function agentsJson(entries: readonly AgentEntry[]): AgentsAnswer {
  return { exitCode: 0, stdout: JSON.stringify(entries) }
}

function fakeWorld(on: On, surfaces: RenderSurface[] = ['terminal']): World {
  const world: World = {
    surfaces,
    panes: [],
    agents: agentsJson(BOARD_AGENTS),
    agentsRuns: 0,
    gitCwds: [],
    subagents: [],
    logs: [],
    wait: null,
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: OWN_ID }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.surfaces', () => ({ value: world.surfaces }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    world.panes = [
      ...world.panes.filter((pane) => pane.id !== e.id),
      { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true },
    ]
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    world.panes = world.panes.filter((pane) => pane.id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.log', (_$, e) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  on('agent.list', () => ({ value: world.subagents }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('process.run', async (_$, e) => {
    const [command, flag, cwd, verb] = e.argv
    if (command === 'claude') {
      world.agentsRuns += 1
      expect(e.argv).toEqual(AGENTS_ARGV)
      if (world.wait) await world.wait()
      if ('deny' in world.agents) return { deny: world.agents.deny }
      const { exitCode, stdout, isStdoutTruncated = false } = world.agents
      return { value: { ...answer(exitCode, stdout), isStdoutTruncated } }
    }
    expect(command).toBe('git')
    expect(flag).toBe('-C')
    world.gitCwds.push(cwd ?? '')
    const repo = REPOS[cwd ?? '']
    if (!repo) return { value: answer(128, '') }
    if (verb === 'branch') return { value: answer(0, `${repo.branch}\n`) }
    return { value: answer(0, `${repo.top}\n${repo.gitDir}\n${repo.commonDir}\n`) }
  })
  return world
}

function answer(exitCode: number, stdout: string) {
  return { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

async function command(engine: Engine, args: string): Promise<string> {
  const result = await engine.command.run({
    command: 'session-board',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: true, columns: 140 },
  })
  return result.text ?? ''
}

async function mountBoard(engine: Engine, surface: RenderSurface, bodyColumns: number) {
  return engine.ui.mount({
    plugin: 'session-board',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: {
      title: 'Sessions',
      isFocused: false,
      bodyColumns,
      placement: bodyColumns >= 100 ? 'inline' : 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
}

async function shownTexts(
  engine: Engine,
  surface: RenderSurface,
  bodyColumns: number,
): Promise<string[]> {
  const ui = await mountBoard(engine, surface, bodyColumns)
  const texts = (await ui.findAll({ type: 'Text' })).map((found) => found.text)
  await ui.unmount()
  return texts
}

async function startSession(engine: Engine): Promise<void> {
  await engine.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
}

async function openBoard(engine: Engine, clock: MockClock): Promise<string> {
  const reply = await command(engine, '')
  await clock.settle()
  return reply
}

function storeWith(...entries: Progress[]): Record<string, unknown> {
  return Object.fromEntries(entries.map((entry) => [progressKey(entry.sessionId), entry]))
}

describe('the recorded claude agents output', () => {
  test('parses into four sessions with their state words', () => {
    const outcome = parseAgents(RECORDED_AGENTS)
    if (outcome.kind !== 'ok') throw new Error(`expected rows, got ${outcome.kind}`)
    expect(outcome.rows.map((row) => [row.name, row.kind, row.word])).toEqual([
      ['docs-pass', 'background', 'blocked'],
      ['api-login', 'interactive', 'busy'],
      ['mocks', 'interactive', 'busy'],
      ['lane-a1', 'interactive', 'idle'],
    ])
  })

  test('holds only generic paths and ids', () => {
    const outcome = parseAgents(RECORDED_AGENTS)
    if (outcome.kind !== 'ok') throw new Error(`expected rows, got ${outcome.kind}`)
    for (const row of outcome.rows) {
      expect(row.cwd).toMatch(/^\/work\/(app|api|docs)(\.wt\/lane-a1)?$/)
      expect(row.sessionId).toMatch(/^00000000-0000-4000-8000-0{10}\d{2}$/)
      expect(row.name).toMatch(/^(docs-pass|api-login|mocks|lane-a1)$/)
    }
    const text = RECORDED_AGENTS.toLowerCase()
    expect(text).not.toContain('/home/')
    expect(text).not.toContain('/users/')
    expect(text).not.toContain('\\\\')
  })

  test('refuses an output that is not a JSON list', () => {
    expect(parseAgents('not json').kind).toBe('not-a-list')
    expect(parseAgents('{"kind":"interactive"}').kind).toBe('not-a-list')
  })
})

describe('the poll of claude agents', () => {
  test('runs claude agents every 15 s while the board is shown', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    expect(await openBoard($, clock)).toBe('Session board opened.')
    expect(world.agentsRuns).toBe(1)
    await clock.advance(POLL_INTERVAL_MS)
    expect(world.agentsRuns).toBe(2)
    world.panes = world.panes.map((pane) => ({ ...pane, isShown: false }))
    await clock.advance(POLL_INTERVAL_MS * 2)
    expect(world.agentsRuns).toBe(2)
    world.panes = world.panes.map((pane) => ({ ...pane, isShown: true }))
    await clock.advance(POLL_INTERVAL_MS)
    expect(world.agentsRuns).toBe(3)
    expect(await command($, 'close')).toBe('Session board closed.')
    await clock.advance(POLL_INTERVAL_MS * 3)
    expect(world.agentsRuns).toBe(3)
  })

  test('reuses a result that another session polled less than 15 s ago', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const shared: AgentsCache = {
      at: NOW - 5000,
      outcome: parseAgents(JSON.stringify(BOARD_AGENTS)),
      places: {},
    }
    mock.store(on, { agents: shared })
    const world = fakeWorld(on)
    await openBoard($, clock)
    expect(world.agentsRuns).toBe(0)
    expect(await shownTexts($, 'terminal', 46)).toContain('  4 local · polled 5 s ago')
    await clock.advance(POLL_INTERVAL_MS)
    expect(world.agentsRuns).toBe(1)
    expect(await shownTexts($, 'terminal', 46)).toContain('  4 local · polled 0 s ago')
  })

  test('runs git only when the cwd of a session changes', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    await openBoard($, clock)
    expect(world.gitCwds).toHaveLength(BOARD_AGENTS.length * 2)
    await clock.advance(POLL_INTERVAL_MS)
    expect(world.agentsRuns).toBe(2)
    expect(world.gitCwds).toHaveLength(BOARD_AGENTS.length * 2)
    world.agents = agentsJson(
      BOARD_AGENTS.map((entry) =>
        entry.sessionId === LANE_ID ? { ...entry, cwd: '/work/app.wt/lane-b2' } : entry,
      ),
    )
    await clock.advance(POLL_INTERVAL_MS)
    expect(world.gitCwds.slice(BOARD_AGENTS.length * 2)).toEqual([
      '/work/app.wt/lane-b2',
      '/work/app.wt/lane-b2',
    ])
    expect(await shownTexts($, 'terminal', 46)).toContain(
      'app.wt/lane-b2 · lane/app-b2 · 1h 00m elapsed',
    )
  })
})

describe('the board rows', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows each session in two lines below 100 columns on ${surface}`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      mock.store(on, storeWith(OWN_PROGRESS, LANE_PROGRESS))
      fakeWorld(on, ['terminal', surface])
      await openBoard($, clock)
      const ui = await mountBoard($, surface, 46)
      const texts = (await ui.findAll({ type: 'Text' })).map((found) => found.text)
      expect(texts).toContain('  4 local · polled 0 s ago')
      expect(texts).toContain('mocks')
      expect(texts).toContain('inter')
      expect(texts).toContain('Draw quiet-items mocks')
      expect(texts).toContain(' 2/5')
      expect(texts).toContain('app · main · 41m worked · est. 30m left')
      expect(texts).toContain('blocked: permission')
      expect(texts).toContain('Write the beads reader')
      expect(texts).toContain(' 0/3')
      expect(texts).toContain('app.wt/lane-a1 · lane/app-x1y2 · 18m worked')
      expect(texts).toContain('no handily task data')
      expect(texts).toContain('api · feat/login · 2h 03m elapsed')
      expect(texts).toContain('docs · main · ended')
      expect((await ui.find({ type: 'Text', text: 'busy' }))?.props).toMatchObject({
        color: 'success',
      })
      expect((await ui.find({ type: 'Text', text: 'blocked: permission' }))?.props).toMatchObject({
        color: 'warning',
      })
      expect((await ui.find({ type: 'Text', text: 'done' }))?.props).toMatchObject({
        dimColor: true,
      })
      const names = texts.filter((text) =>
        ['mocks', 'lane-a1', 'api-login', 'docs-pass'].includes(text),
      )
      expect(names).toEqual(['mocks', 'lane-a1', 'api-login', 'docs-pass'])
      await ui.unmount()
    })
  }

  test('shows one table line per session from 100 columns', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, storeWith(OWN_PROGRESS, LANE_PROGRESS))
    fakeWorld(on)
    await openBoard($, clock)
    const texts = await shownTexts($, 'terminal', 120)
    expect(
      texts.some((text) => text.startsWith('name') && text.includes('worktree · branch')),
    ).toBe(true)
    expect(texts).toContain('app.wt/lane-a1 · lane/app-x1y2')
    expect(texts).toContain('41m worked')
    expect(texts).toContain('  est. 30m left')
    expect(texts).toContain('2h 03m elapsed')
    expect(texts).toContain('ended')
    expect(texts).toContain('—')
  })

  test('shows no row for a session key whose session claude agents does not list', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, storeWith(OWN_PROGRESS, GONE_PROGRESS))
    fakeWorld(on)
    await openBoard($, clock)
    const texts = await shownTexts($, 'terminal', 46)
    expect(texts).toContain('Draw quiet-items mocks')
    expect(texts).toContain('  4 local · polled 0 s ago')
    expect(texts).not.toContain('Old task')
    expect(texts).not.toContain(GONE_ID.slice(0, 8))
    expect(texts).not.toContain('not listed')
    expect(texts).not.toContain(' (stale)')
  })

  test('shows this session when claude agents does not list it yet', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, storeWith(OWN_PROGRESS))
    const world = fakeWorld(on)
    world.agents = agentsJson(BOARD_AGENTS.slice(1))
    await openBoard($, clock)
    const texts = await shownTexts($, 'terminal', 46)
    expect(texts).toContain(OWN_ID.slice(0, 8))
    expect(texts).toContain('Draw quiet-items mocks')
    expect(texts).toContain('  3 local · polled 0 s ago')
    expect(texts).toContain('not listed')
  })

  const OWN_STARTED_AT = NOW - 3 * HOUR
  const keyAges = [
    { before: 1622, label: 'the measured 1622 ms', isStale: false },
    { before: 59_000, label: '59 s', isStale: false },
    { before: 61_000, label: '61 s', isStale: true },
  ]
  for (const { before, label, isStale } of keyAges) {
    test(`marks a listed task stale: ${String(isStale)} for a key ${label} before the session start`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      mock.store(on, storeWith({ ...OWN_PROGRESS, updatedAt: OWN_STARTED_AT - before }))
      fakeWorld(on)
      await openBoard($, clock)
      const texts = await shownTexts($, 'terminal', 46)
      expect(texts).toContain('Draw quiet-items mocks')
      expect(texts).toContain('  4 local · polled 0 s ago')
      if (isStale) {
        expect(texts.filter((text) => text === ' (stale)')).toHaveLength(1)
        expect(texts.indexOf(' (stale)')).toBe(texts.indexOf(' 2/5') + 1)
        expect(texts).toContain('app · main · 41m worked')
      } else {
        expect(texts).not.toContain(' (stale)')
        expect(texts).toContain('app · main · 41m worked · est. 30m left')
      }
    })
  }

  test('says when only this session is running', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, storeWith(OWN_PROGRESS))
    const world = fakeWorld(on)
    world.agents = agentsJson(BOARD_AGENTS.slice(0, 1))
    await openBoard($, clock)
    const texts = await shownTexts($, 'terminal', 46)
    expect(texts).toContain('  polled 0 s ago')
    expect(texts).toContain('Only this session is running.')
    expect(texts).toContain('mocks')
  })
})

describe('the session progress', () => {
  const taskPane: Plugin = {
    name: 'task-pane',
    register(on) {
      on('command.run', async ($, e, next) => {
        if (e.command !== 'tp-set') return next(e)
        await $.state.set({ plugin: 'task-pane', key: 'list' }, JSON.parse(e.args) as unknown)
        return { text: 'set' }
      })
    },
  }

  async function setTasks(engine: Engine, statuses: readonly string[]): Promise<void> {
    await engine.command.run({
      command: 'tp-set',
      args: taskList(statuses),
      origin: { kind: 'sdk' },
      presentation: { isFullscreen: true, columns: 140 },
    })
  }

  function taskList(statuses: readonly string[]): string {
    return JSON.stringify({
      tasks: statuses.map((status, index) => ({
        id: index + 1,
        title: `Task ${String(index + 1)}`,
        status,
        by: 'model',
        item: null,
      })),
      nextId: statuses.length + 1,
    })
  }

  test(
    'writes the task, n/m and the worked turn spans of this session',
    {
      plugins: [taskPane],
    },
    async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      mock.store(on)
      fakeWorld(on)
      await startSession($)
      await openBoard($, clock)
      await setTasks($, ['in_progress', 'pending', 'pending'])
      await $.turn.start({ text: 'go', turnId: 't1' })
      await clock.advance(5 * MINUTE)
      await $.turn.complete({
        answer: 'sub',
        durationMs: 3 * MINUTE,
        isAborted: false,
        turnId: 't1',
        agentId: 'sub-1',
        reason: 'answer',
      })
      await clock.advance(7 * MINUTE)
      await setTasks($, ['completed', 'in_progress', 'pending'])
      await $.turn.complete({
        answer: 'ok',
        durationMs: 12 * MINUTE,
        isAborted: false,
        turnId: 't1',
        reason: 'answer',
      })
      const texts = await shownTexts($, 'terminal', 46)
      expect(texts).toContain('Task 2')
      expect(texts).toContain(' 1/3')
      expect(texts).toContain('app · main · 12m worked · est. 24m left')
    },
  )

  test('shows no task data when task-pane is not loaded', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    world.agents = agentsJson(BOARD_AGENTS.slice(0, 1))
    await startSession($)
    await openBoard($, clock)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await clock.advance(2 * MINUTE)
    const texts = await shownTexts($, 'terminal', 46)
    expect(texts).toContain('no handily task data')
    expect(texts).toContain('app · main · 2m worked')
  })
})

describe('the completion estimate', () => {
  const started = progressOf(OWN_ID, {
    done: 1,
    total: 4,
    taskIds: [1, 2, 3, 4],
    firstTaskAt: NOW - 30 * MINUTE,
    lastAddedAt: NOW - 10 * MINUTE,
  })

  test('applies done over all tasks to the time since the first task', () => {
    expect(estimateLeftMs(started, NOW)).toBe(90 * MINUTE)
    expect(formatDuration(90 * MINUTE)).toBe('1h 30m')
    expect(formatDuration(45 * 24 * HOUR + 8 * HOUR + 29 * MINUTE)).toBe('45d 08h')
  })

  test('shows nothing before the first task is completed', () => {
    expect(estimateLeftMs({ ...started, done: 0 }, NOW)).toBeNull()
  })

  test('shows nothing while a task was added less than the quiet time ago', () => {
    expect(estimateLeftMs({ ...started, lastAddedAt: NOW - EST_QUIET_MS + 1 }, NOW)).toBeNull()
    expect(estimateLeftMs({ ...started, lastAddedAt: NOW - EST_QUIET_MS }, NOW)).toBe(90 * MINUTE)
  })

  test('shows nothing when every task is done', () => {
    expect(estimateLeftMs({ ...started, done: 4 }, NOW)).toBeNull()
  })

  test('keeps the first task time and moves the added time only for a new task', () => {
    const first = withTasks(emptyProgress(OWN_ID, '/work/app', NOW), viewOf(2, 0), NOW)
    expect(first.firstTaskAt).toBe(NOW)
    expect(first.lastAddedAt).toBe(NOW)
    const progressed = withTasks(first, viewOf(2, 1), NOW + MINUTE)
    expect(progressed.firstTaskAt).toBe(NOW)
    expect(progressed.lastAddedAt).toBe(NOW)
    const added = withTasks(progressed, viewOf(3, 1), NOW + 2 * MINUTE)
    expect(added.firstTaskAt).toBe(NOW)
    expect(added.lastAddedAt).toBe(NOW + 2 * MINUTE)
  })
})

function viewOf(total: number, done: number) {
  return {
    current: done < total ? `Task ${String(done + 1)}` : null,
    done,
    total,
    ids: Array.from({ length: total }, (_, index) => index + 1),
  }
}

describe('the error lines', () => {
  test('names the exit code when claude agents fails', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    world.agents = { exitCode: 1, stdout: '' }
    await openBoard($, clock)
    const texts = await shownTexts($, 'terminal', 46)
    expect(texts).toContain('claude agents --json failed: exit 1.')
    expect(texts).toContain('Run it in a shell to see why.')
    expect(texts).toContain('  retry in 15 s')
  })

  test('says that claude is not on PATH when it cannot start', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    world.agents = { deny: 'spawn claude ENOENT' }
    await openBoard($, clock)
    const texts = await shownTexts($, 'terminal', 46)
    expect(texts).toContain('claude is not on PATH, so other sessions cannot be listed.')
    expect(texts).not.toContain('  retry in 15 s')
  })

  test('says that the output is not a JSON list', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    world.agents = { exitCode: 0, stdout: 'Usage: claude agents' }
    await openBoard($, clock)
    const texts = await shownTexts($, 'terminal', 46)
    expect(texts).toContain('claude agents --json failed: the output is not a JSON list.')
  })
})

describe('a session that cannot run claude agents', () => {
  test('shows this session and its subagents only', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, storeWith(OWN_PROGRESS))
    const world = fakeWorld(on, ['desktop'])
    world.subagents = [
      { id: 'a1', description: 'find the element table', type: 'Explore', status: 'running' },
      { id: 'a2', description: '', type: 'Plan', status: 'completed' },
    ]
    expect(await openBoard($, clock)).toBe(
      'Session board opened. Other sessions are listed only in a terminal session.',
    )
    const texts = await shownTexts($, 'desktop', 46)
    expect(world.agentsRuns).toBe(0)
    expect(texts).toContain(
      'Other sessions are listed only in a terminal session (claude agents needs a CLI).',
    )
    expect(texts).toContain('this session')
    expect(texts).toContain('  idle')
    expect(texts).toContain('Draw quiet-items mocks')
    expect(texts).toContain('41m worked · est. 30m left')
    expect(texts).toContain('subagents')
    expect(texts).toContain('Explore')
    expect(texts).toContain('  running')
    expect(texts).toContain('  find the element table')
    expect(texts).toContain('Plan')
    expect(texts).toContain('  done')
  })
})

describe('the command replies', () => {
  test('answers an unknown argument with the two valid forms', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    fakeWorld(on)
    expect(await command($, 'x')).toBe(
      'Unknown argument "x". Use /session-board or /session-board close.',
    )
  })

  test('closes the board', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    await openBoard($, clock)
    expect(world.panes.map((pane) => pane.id)).toEqual([PANE_ID])
    expect(await command($, 'close')).toBe('Session board closed.')
    expect(world.panes).toEqual([])
  })
})

function cacheOf(fields: Partial<AgentsCache>): AgentsCache {
  return { at: NOW, outcome: parseAgents(JSON.stringify(BOARD_AGENTS)), places: {}, ...fields }
}

function storeWithLimit(on: On, entries: Record<string, unknown>): Map<string, unknown> {
  const store = new Map(Object.entries(entries))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.set', (_$, e) => {
    if (e.key === 'agents' && store.has(progressKey(GONE_ID))) {
      return { deny: 'the store is over 4 MiB' }
    }
    store.set(e.key, e.value)
    return { value: undefined }
  })
  return store
}

const EXPIRED_PROGRESS = { ...GONE_PROGRESS, updatedAt: NOW - 25 * HOUR }

describe('the repairs of the review', () => {
  test('skips an unreadable row and keeps the others', () => {
    const outcome = parseAgents(
      JSON.stringify([BOARD_AGENTS[0], { kind: 'robot' }, 'text', BOARD_AGENTS[3]]),
    )
    expect(outcome).toMatchObject({ kind: 'ok', skipped: 2 })
    if (outcome.kind !== 'ok') throw new Error(`expected rows, got ${outcome.kind}`)
    expect(outcome.rows.map((row) => row.name)).toEqual(['mocks', 'api-login'])
  })

  test('draws the board when one row cannot be read and logs the count', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    world.agents = agentsJson([...BOARD_AGENTS, { kind: 'robot' }])
    await openBoard($, clock)
    const texts = await shownTexts($, 'terminal', 46)
    expect(texts).toContain('  4 local · polled 0 s ago')
    expect(world.logs).toContain('session-board: skipped 1 unreadable row of claude agents --json')
  })

  test('polls again when the cached time lies in the future', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, { agents: cacheOf({ at: NOW + HOUR }) })
    const world = fakeWorld(on)
    await openBoard($, clock)
    expect(world.agentsRuns).toBe(1)
  })

  test('polls again when a cached place cannot be read', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {
      agents: { ...cacheOf({}), places: { [OWN_ID]: { cwd: '/work/app', place: null } } },
    })
    const world = fakeWorld(on)
    await openBoard($, clock)
    expect(world.agentsRuns).toBe(1)
    expect(await shownTexts($, 'terminal', 46)).toContain('app · main · 3h 00m elapsed')
  })

  test('polls again when a cached row cannot be read', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, {
      agents: { ...cacheOf({}), outcome: { kind: 'ok', rows: [{ name: 5 }], skipped: 0 } },
    })
    const world = fakeWorld(on)
    await openBoard($, clock)
    expect(world.agentsRuns).toBe(1)
  })

  test('shows only the stored time of a stale key with an open turn', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, storeWith({ ...OWN_PROGRESS, turnStartedAt: NOW - 2 * HOUR }))
    const world = fakeWorld(on)
    world.agents = agentsJson(BOARD_AGENTS.slice(1))
    await openBoard($, clock)
    expect(await shownTexts($, 'terminal', 46)).toContain('app · 41m worked')
  })

  test('ignores an open turn that started before the session', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on, storeWith({ ...OWN_PROGRESS, turnStartedAt: NOW - 4 * HOUR }))
    fakeWorld(on)
    await openBoard($, clock)
    expect(await shownTexts($, 'terminal', 46)).toContain('app · main · 41m worked · est. 30m left')
  })

  test('leaves the first task time unknown when the first sight has done tasks', () => {
    const seen = withTasks(emptyProgress(OWN_ID, '/work/app', NOW), viewOf(3, 1), NOW)
    expect(seen.firstTaskAt).toBeNull()
    const later = withTasks(seen, viewOf(3, 2), NOW + HOUR)
    expect(later.firstTaskAt).toBeNull()
    expect(estimateLeftMs(later, NOW + 2 * HOUR)).toBeNull()
  })

  test('deletes keys older than 24 h at session start', async ($, on) => {
    mock.clock(on, { now: NOW })
    const kept = { ...GONE_PROGRESS, sessionId: KEPT_ID, updatedAt: NOW - 23 * HOUR }
    const store = storeWithLimit(on, {
      agents: cacheOf({}),
      ...storeWith(OWN_PROGRESS, EXPIRED_PROGRESS, kept),
    })
    fakeWorld(on)
    await startSession($)
    expect(store.has(progressKey(GONE_ID))).toBe(false)
    expect(store.has(progressKey(KEPT_ID))).toBe(true)
    expect(store.has(progressKey(OWN_ID))).toBe(true)
  })

  test('deletes expired keys before it saves the poll', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const store = storeWithLimit(on, storeWith(EXPIRED_PROGRESS))
    fakeWorld(on)
    await openBoard($, clock)
    expect(store.has(progressKey(GONE_ID))).toBe(false)
    expect(await shownTexts($, 'terminal', 46)).toContain('  4 local · polled 0 s ago')
  })

  test('runs one poll at a time', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    world.wait = () => clock.sleep(20_000)
    await openBoard($, clock)
    await clock.advance(POLL_INTERVAL_MS)
    expect(world.agentsRuns).toBe(1)
    await clock.advance(5_000)
    expect(world.agentsRuns).toBe(1)
  })

  test('names a cut output', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const world = fakeWorld(on)
    world.agents = { exitCode: 0, stdout: '[', isStdoutTruncated: true }
    await openBoard($, clock)
    expect(await shownTexts($, 'terminal', 46)).toContain(
      'claude agents --json failed: the output is over 4 MiB and was cut.',
    )
  })
})
