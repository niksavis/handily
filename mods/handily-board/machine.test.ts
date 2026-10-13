import type { AgentInfo, On, RenderPropsOf, RenderSurface } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Mounted,
} from 'claude-code/testing'
import { AGENTS_ARGV, AGENTS_CACHE_KEY, parseAgents, POLL_INTERVAL_MS } from './hooks/agents-json'
import {
  ENTRY_BYTES_AT_MOST,
  entryBytes,
  progressKey,
  readProgress,
  withinLimit,
  type AgentSummary,
  type Progress,
} from './hooks/progress'
import { displayWidth } from './hooks/width'
import { MACHINE_AGENTS, MACHINE_NOW, RECORDED_AGENTS, type AgentEntry } from './fixtures/agents'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const NOW = MACHINE_NOW
const ROOT = '/work/app'
const PLUGIN = 'handily-board'
const TASKS = 'tasks'
const MACHINE = 'sessions'
const TOOL_ADD = 'mcp__handily-board__task_add'
const TOOL_UPDATE = 'mcp__handily-board__task_update'
const OWN_ID = '00000000-0000-4000-8000-00000000000a'
const API_ID = '00000000-0000-4000-8000-00000000000c'
const LANE_ID = '00000000-0000-4000-8000-00000000000b'
const SURFACES = ['terminal', 'desktop'] as const

type AgentsAnswer =
  { exitCode: number; stdout: string; isStdoutTruncated?: boolean } | { deny: string }

type World = {
  clock: MockClock
  store: Map<string, unknown>
  surfaces: RenderSurface[]
  panes: Set<string>
  shown: string | undefined
  agents: AgentsAnswer
  agentsRuns: number
  gitCwds: string[]
  subagents: AgentInfo[]
  logs: string[]
  hold: (() => Promise<void>) | null
}

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
    branch: 'lane/a1',
  },
  '/work/app.wt/lane-b2': {
    top: '/work/app.wt/lane-b2',
    gitDir: '/work/app/.git/worktrees/lane-b2',
    commonDir: '/work/app/.git',
    branch: 'lane/b2',
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

function answer(exitCode: number, stdout: string) {
  return { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

function agentsJson(entries: readonly AgentEntry[]): AgentsAnswer {
  return { exitCode: 0, stdout: JSON.stringify(entries) }
}

function progressOf(sessionId: string, fields: Partial<Progress>): Progress {
  return {
    sessionId,
    cwd: ROOT,
    updatedAt: NOW - MINUTE,
    isWorking: false,
    turnStartedAt: null,
    workedMs: 0,
    task: null,
    taskStatus: null,
    done: 0,
    total: 0,
    taskIds: [],
    firstTaskAt: null,
    lastAddedAt: null,
    agents: [],
    agentCount: 0,
    ...fields,
  }
}

const API_PROGRESS = progressOf(API_ID, {
  cwd: '/work/api',
  workedMs: 2 * HOUR,
  task: 'Fix the login redirect',
  taskStatus: 'in_progress',
  done: 2,
  total: 3,
  taskIds: [1, 2, 3],
})

const LANE_PROGRESS = progressOf(LANE_ID, {
  cwd: '/work/app.wt/lane-a1',
  workedMs: 22 * MINUTE,
  task: 'Build the tab pane',
  taskStatus: 'in_progress',
  done: 3,
  total: 6,
  taskIds: [1, 2, 3, 4, 5, 6],
})

function storeWith(...entries: Progress[]): Record<string, unknown> {
  return Object.fromEntries(entries.map((entry) => [progressKey(entry.sessionId), entry]))
}

function memoryStore(on: On, entries: Record<string, unknown>): Map<string, unknown> {
  const store = new Map(Object.entries(entries))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  return store
}

function world(
  on: On,
  entries: Record<string, unknown> = storeWith(API_PROGRESS, LANE_PROGRESS),
  surfaces: RenderSurface[] = ['terminal'],
): World {
  const state: World = {
    clock: mock.clock(on, { now: NOW - 14 * MINUTE }),
    store: memoryStore(on, entries),
    surfaces,
    panes: new Set(),
    shown: undefined,
    agents: agentsJson(MACHINE_AGENTS),
    agentsRuns: 0,
    gitCwds: [],
    subagents: [],
    logs: [],
    hold: null,
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: OWN_ID }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: state.surfaces }))
  on('agent.list', () => ({ value: state.subagents }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__handily-board__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.call', () => ({ result: '' }))
  on('ui.open', (_$, e) => {
    state.panes.add(e.id)
    if (state.shown === undefined || e.focus === true) state.shown = e.id
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    state.panes.delete(e.id)
    if (state.shown === e.id) state.shown = [...state.panes][0]
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...state.panes].map((id) => ({
      id,
      title: id,
      isShown: id === state.shown,
      isFocused: false,
      isPlaced: true,
    })),
  }))
  on('ui.log', (_$, e) => {
    state.logs.push(e.text)
    return { value: undefined }
  })
  on('process.run', async (_$, e) => {
    const [command, flag, cwd, verb] = e.argv
    if (command === 'claude') {
      state.agentsRuns += 1
      expect(e.argv).toEqual(AGENTS_ARGV)
      if (state.hold) await state.hold()
      if ('deny' in state.agents) return { deny: state.agents.deny }
      const { exitCode, stdout, isStdoutTruncated = false } = state.agents
      return { value: { ...answer(exitCode, stdout), isStdoutTruncated } }
    }
    expect(command).toBe('git')
    expect(flag).toBe('-C')
    state.gitCwds.push(cwd ?? '')
    const repo = REPOS[cwd ?? '']
    if (!repo) return { value: answer(128, '') }
    if (verb === 'branch') return { value: answer(0, `${repo.branch}\n`) }
    return { value: answer(0, `${repo.top}\n${repo.gitDir}\n${repo.commonDir}\n`) }
  })
  return state
}

async function board($: Engine, args: string): Promise<string> {
  const result = await $.command.run({
    command: 'board',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  return result.text ?? ''
}

function subagent(id: string, type: string, status: AgentInfo['status']): AgentInfo {
  return { id, description: '', type, status }
}

const MOCK_SUBAGENTS: AgentInfo[] = [
  subagent('a1', 'lane-b', 'failed'),
  subagent('a2', 'Explore', 'running'),
  subagent('a3', 'scout', 'waiting'),
  subagent('a4', 'Plan', 'completed'),
  subagent('a5', 'tester', 'killed'),
]

async function mockWork($: Engine, seen: World): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await seen.clock.advance(4 * MINUTE)
  await $.tool.call({ tool: TOOL_ADD, title: 'Read the design' })
  await $.tool.call({ tool: TOOL_ADD, title: 'Write the tab mocks' })
  await $.tool.call({ tool: TOOL_ADD, title: 'Review the mocks with Codex' })
  await board($, 'add Ask the person about tabs')
  await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed' })
  await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'in_progress' })
  await seen.clock.advance(10 * MINUTE)
  seen.subagents = MOCK_SUBAGENTS
}

async function showMachine($: Engine, seen: World): Promise<void> {
  expect(await board($, 'machine')).toBe('Board opened: this machine.')
  const first = await mountTab($, 'terminal', 'dock', 41)
  await first.unmount()
  await seen.clock.settle()
}

function paneProps(placement: 'dock' | 'inline', bodyColumns: number): RenderPropsOf['Pane'] {
  return {
    title: 'this machine',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  }
}

async function mountTab(
  $: Engine,
  surface: RenderSurface,
  placement: 'dock' | 'inline',
  columns: number,
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: MACHINE,
    props: paneProps(placement, columns),
  })
}

type Drawn = { type: string; props: Record<string, unknown>; text: string; children: Drawn[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function drawnOf(value: unknown): Drawn | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const props = isRecord(value.props) ? value.props : {}
  const raw = Array.isArray(value.children) ? (value.children as unknown[]) : []
  const children = raw.map(drawnOf).filter((child) => child !== null)
  const own = raw.map((child) => (typeof child === 'string' ? child : '')).join('')
  const text =
    value.type === 'Button' && typeof props.label === 'string'
      ? `[ ${props.label} ]`
      : `${own}${children.map((child) => child.text).join('')}`
  return { type: value.type, props, text, children }
}

function numberProp(element: Drawn, name: string): number {
  const value = element.props[name]
  return typeof value === 'number' ? value : 0
}

function wrapped(text: string, width: number): string[] {
  if (text.length <= width || width <= 0) return [text]
  const space = text.lastIndexOf(' ', width)
  const cut = space > 0 ? space : width
  return [text.slice(0, cut), ...wrapped(text.slice(cut).trimStart(), width)]
}

function screenOf(element: Drawn, width: number): string[] {
  if (element.type === 'Text' || element.type === 'Button') return wrapped(element.text, width)
  const indent = numberProp(element, 'paddingLeft')
  const inner = width - indent
  const lines =
    element.props.flexDirection === 'row'
      ? [element.children.map((child) => child.text).join('')]
      : element.children.flatMap((child) => screenOf(child, inner))
  return lines.map((line) => `${' '.repeat(indent)}${line}`)
}

async function screen(ui: { find: Mounted['find'] }, columns: number): Promise<string[]> {
  const root = drawnOf(await ui.find({ type: 'Box' }))
  if (root === null) throw new Error('the pane drew no Box')
  const lines = screenOf(root, columns).map((line) => line.trimEnd())
  for (const line of lines) {
    expect(displayWidth(line) <= columns, `"${line}" is wider than ${String(columns)}`).toBe(true)
  }
  return lines
}

async function screenAt(
  $: Engine,
  surface: RenderSurface,
  placement: 'dock' | 'inline',
  columns: number,
): Promise<string[]> {
  const ui = await mountTab($, surface, placement, columns)
  const lines = await screen(ui, columns)
  await ui.unmount()
  return lines
}

const RULE_41 = '─'.repeat(41)
const RULE_30 = '─'.repeat(30)

const MOCK_41 = [
  'Sessions  4 · 1 needs you · 12s ago',
  '◆ api-login  interactive  needs you',
  '  waits for: permission',
  '  ▶ Fix the login redirect ▰▰▱ 2/3',
  '  api · feat/login · 2h worked',
  RULE_41,
  '▶ mocks  interactive  this  busy',
  '  ▶ Write the tab mocks ▰▱▱▱ 1/4',
  '  app · main · 14m worked · est. 30m left',
  '  agents 3 · 1 failed',
  RULE_41,
  '▶ lane-a1  background  working',
  '  ▶ Build the tab pane ▰▰▰▱▱▱ 3/6',
  '  app.wt/lane-a1 · lane/a1 · 22m worked',
  RULE_41,
  '✓ docs-pass  background  done',
  '  docs · main · ended',
  '1 older background job hidden',
]

const MOCK_30 = [
  'Sessions  4 · 1 needs you',
  '◆ api-login  needs you',
  '  waits for: permission',
  '  ▶ Fix the login red… ▰▰▱ 2/3',
  '  api · feat/login · 2h',
  RULE_30,
  '▶ mocks  this  busy',
  '  ▶ Write the tab mo… ▰▱▱▱ 1/4',
  '  app · main · 14m · est. 30m…',
  '  agents 3 · 1 failed',
  RULE_30,
  '▶ lane-a1  working',
  '  ▶ Build the tab … ▰▰▰▱▱▱ 3/6',
  '  app.wt/lane-a1 · lane/a1 · …',
  RULE_30,
  '✓ docs-pass  done',
  '  docs · main · ended',
  '1 older background job hidden',
]

const MOCK_76 = [
  'Sessions  4 · 1 needs you · polled 12s ago',
  '◆ api-login  inter needs you   api · feat/login                      2/3  2h',
  '    waits for: permission',
  '▶ mocks      inter this · busy app · main                            1/4 14m',
  '    agents 3 · 1 failed',
  '▶ lane-a1    bg    working     app.wt/lane-a1 · lane/a1              3/6 22m',
  '✓ docs-pass  bg    done        docs · main                                 —',
  '1 older background job hidden',
]

const CARD_CRITERION =
  'The this machine tab draws one card per local session from claude agents --json, polled every 15 seconds only while the tab is shown'

describe(CARD_CRITERION, () => {
  for (const surface of SURFACES) {
    for (const { placement, columns, lines } of [
      { placement: 'dock', columns: 41, lines: MOCK_41 },
      { placement: 'dock', columns: 30, lines: MOCK_30 },
      { placement: 'inline', columns: 76, lines: MOCK_76 },
    ] as const) {
      test(`draws mock 8.1b, 8.3 and 8.4 on ${surface}, ${placement}, at ${String(columns)} columns`, async ($, on) => {
        const seen = world(on, storeWith(API_PROGRESS, LANE_PROGRESS), ['terminal', surface])
        await mockWork($, seen)
        await showMachine($, seen)
        await seen.clock.advance(12 * SECOND)
        expect(await screenAt($, surface, placement, columns)).toEqual(lines)
      })
    }
  }

  test('the recorded claude agents output parses into four sessions with generic paths', () => {
    const outcome = parseAgents(RECORDED_AGENTS)
    if (outcome.kind !== 'ok') throw new Error(`expected rows, got ${outcome.kind}`)
    expect(outcome.rows.map((row) => [row.name, row.kind, row.word])).toEqual([
      ['docs-pass', 'background', 'blocked'],
      ['api-login', 'interactive', 'busy'],
      ['mocks', 'interactive', 'busy'],
      ['lane-a1', 'interactive', 'idle'],
    ])
    const text = RECORDED_AGENTS.toLowerCase()
    expect(text).not.toContain('/home/')
    expect(text).not.toContain('/users/')
  })

  test('polls every 15 seconds while the tab is shown, never while it is hidden or closed', async ($, on) => {
    const seen = world(on)
    await mockWork($, seen)
    await board($, '')
    expect(seen.shown).toBe(TASKS)
    await seen.clock.advance(POLL_INTERVAL_MS * 2)
    expect(seen.agentsRuns).toBe(0)
    await showMachine($, seen)
    expect(seen.agentsRuns).toBe(1)
    await seen.clock.advance(POLL_INTERVAL_MS)
    expect(seen.agentsRuns).toBe(2)
    await board($, '')
    expect(seen.shown).toBe(TASKS)
    await seen.clock.advance(POLL_INTERVAL_MS * 3)
    expect(seen.agentsRuns).toBe(2)
    await board($, 'machine')
    await seen.clock.advance(POLL_INTERVAL_MS)
    expect(seen.agentsRuns).toBe(3)
    expect(await board($, 'close')).toBe('Board closed.')
    await seen.clock.advance(POLL_INTERVAL_MS * 3)
    expect(seen.agentsRuns).toBe(3)
  })

  test('polls at once when the tab becomes shown with data older than 15 seconds', async ($, on) => {
    const seen = world(on)
    await mockWork($, seen)
    await showMachine($, seen)
    expect(seen.agentsRuns).toBe(1)
    await board($, '')
    expect(seen.shown).toBe(TASKS)
    await seen.clock.advance(POLL_INTERVAL_MS + 5 * SECOND)
    expect(seen.agentsRuns).toBe(1)
    await showMachine($, seen)
    expect(seen.shown).toBe(MACHINE)
    expect(seen.agentsRuns).toBe(2)
    expect((await screenAt($, 'terminal', 'dock', 41))[0]).toBe(
      'Sessions  4 · 1 needs you · 0s ago',
    )
  })

  test('does not poll again when the tab becomes shown with data newer than 15 seconds', async ($, on) => {
    const seen = world(on)
    await mockWork($, seen)
    await showMachine($, seen)
    expect(seen.agentsRuns).toBe(1)
    await board($, '')
    expect(seen.shown).toBe(TASKS)
    await seen.clock.advance(5 * SECOND)
    await showMachine($, seen)
    expect(seen.shown).toBe(MACHINE)
    expect(seen.agentsRuns).toBe(1)
    expect((await screenAt($, 'terminal', 'dock', 41))[0]).toBe(
      'Sessions  4 · 1 needs you · 5s ago',
    )
  })

  test('reuses the result that another session polled less than 15 seconds ago', async ($, on) => {
    const seen = world(on, {
      [AGENTS_CACHE_KEY]: {
        at: NOW - 5 * SECOND,
        failure: null,
        listed: { at: NOW - 5 * SECOND, rows: rowsOf(MACHINE_AGENTS) },
        places: {},
      },
    })
    await mockWork($, seen)
    await showMachine($, seen)
    expect(seen.agentsRuns).toBe(0)
    expect((await screenAt($, 'terminal', 'dock', 41))[0]).toBe(
      'Sessions  4 · 1 needs you · 5s ago',
    )
    await seen.clock.advance(POLL_INTERVAL_MS)
    expect(seen.agentsRuns).toBe(1)
    expect((await screenAt($, 'terminal', 'dock', 41))[0]).toBe(
      'Sessions  4 · 1 needs you · 0s ago',
    )
  })

  test('runs git only when the folder of a session changes', async ($, on) => {
    const seen = world(on)
    await mockWork($, seen)
    await showMachine($, seen)
    const listed = MACHINE_AGENTS.length * 2
    expect(seen.gitCwds).toHaveLength(listed)
    await seen.clock.advance(POLL_INTERVAL_MS)
    expect(seen.agentsRuns).toBe(2)
    expect(seen.gitCwds).toHaveLength(listed)
    seen.agents = agentsJson(
      MACHINE_AGENTS.map((entry) =>
        entry.sessionId === LANE_ID ? { ...entry, cwd: '/work/app.wt/lane-b2' } : entry,
      ),
    )
    await seen.clock.advance(POLL_INTERVAL_MS)
    expect(seen.gitCwds.slice(listed)).toEqual(['/work/app.wt/lane-b2', '/work/app.wt/lane-b2'])
    expect(await screenAt($, 'terminal', 'dock', 41)).toContain(
      '  app.wt/lane-b2 · lane/b2 · 22m worked',
    )
  })

  test('another session reads the progress key that this session writes in the handily-board store', async ($, on) => {
    const seen = world(on)
    await mockWork($, seen)
    await $.turn.complete({
      answer: 'ok',
      durationMs: 14 * MINUTE,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    })
    const kept = readProgress(seen.store.get(progressKey(OWN_ID)))
    expect(kept).toMatchObject({
      sessionId: OWN_ID,
      cwd: ROOT,
      isWorking: false,
      workedMs: 14 * MINUTE,
      task: 'Write the tab mocks',
      taskStatus: 'in_progress',
      done: 1,
      total: 4,
      firstTaskAt: NOW - 10 * MINUTE,
    })
  })
})

function rowsOf(entries: readonly AgentEntry[]) {
  const outcome = parseAgents(JSON.stringify(entries))
  if (outcome.kind !== 'ok') throw new Error(`expected rows, got ${outcome.kind}`)
  return outcome.rows
}

function session(name: string, fields: AgentEntry): AgentEntry {
  return { cwd: '/work/docs', startedAt: NOW - HOUR, sessionId: `${name}-id`, name, ...fields }
}

const STATE_AGENTS: AgentEntry[] = [
  session('bg-done', { id: 'b1', kind: 'background', state: 'done' }),
  session('bg-failed', { id: 'b2', kind: 'background', state: 'failed' }),
  session('inter-idle', { pid: 3001, kind: 'interactive', status: 'idle' }),
  session('bg-blocked', { id: 'b3', kind: 'background', state: 'blocked' }),
  session('inter-busy', { pid: 3002, kind: 'interactive', status: 'busy' }),
  session('bg-stopped', { id: 'b4', kind: 'background', state: 'stopped' }),
  session('inter-waiting', {
    pid: 3003,
    kind: 'interactive',
    status: 'waiting',
    waitingFor: 'permission',
  }),
  session('mocks', {
    pid: 2001,
    kind: 'interactive',
    status: 'busy',
    sessionId: OWN_ID,
    cwd: ROOT,
  }),
]

const SORT_CRITERION =
  'Cards sort by attention: a session that needs the person, then failed, working, idle and ended; this session leads its own group'

describe(SORT_CRITERION, () => {
  for (const surface of SURFACES) {
    test(`needs you, failed, working with this session first, idle, ended on ${surface}`, async ($, on) => {
      const seen = world(on, {}, ['terminal', surface])
      seen.agents = agentsJson(STATE_AGENTS)
      await mockWork($, seen)
      await showMachine($, seen)
      const ui = await mountTab($, surface, 'dock', 41)
      const heads = (await screen(ui, 41)).filter((line) => /^[▶◆○✓■] /.test(line))
      expect(heads).toEqual([
        '◆ bg-blocked  background  needs you',
        '◆ inter-waiting  interactive  needs you',
        '■ bg-failed  background  failed',
        '▶ mocks  interactive  this  busy',
        '▶ inter-busy  interactive  busy',
        '○ inter-idle  interactive  idle',
        '✓ bg-done  background  done',
        '✓ bg-stopped  background  stopped',
      ])
      const marks = (await ui.findAll({ type: 'Text', text: /^[▶◆○✓■] $/ })).map((found) => [
        found.text,
        found.props.color,
      ])
      expect(marks.slice(0, 3)).toEqual([
        ['◆ ', 'warning'],
        ['◆ ', 'warning'],
        ['■ ', 'error'],
      ])
      expect((await ui.find({ type: 'Text', text: '  needs you' }))?.props.color).toBe('warning')
      expect((await ui.find({ type: 'Text', text: '1 failed' }))?.props.color).toBe('error')
      await ui.unmount()
    })
  }

  test('inline, a name of more than 9 characters keeps its first 4 and last 4 characters', async ($, on) => {
    const seen = world(on, {})
    seen.agents = agentsJson(STATE_AGENTS)
    await mockWork($, seen)
    await showMachine($, seen)
    const lines = await screenAt($, 'terminal', 'inline', 76)
    expect(lines).toEqual([
      'Sessions  8 · 2 need you · 1 failed · polled 0s ago',
      '◆ bg-b…cked  bg    needs you   docs · main                                1h',
      '    waits for: an answer',
      '◆ inte…ting  inter needs you   docs · main                                1h',
      '    waits for: permission',
      '■ bg-failed  bg    failed      docs · main                                 —',
      '▶ mocks      inter this · busy app · main                            1/4 14m',
      '    agents 3 · 1 failed',
      '▶ inte…busy  inter busy        docs · main                                1h',
      '○ inte…idle  inter idle        docs · main                                1h',
      '✓ bg-done    bg    done        docs · main                                 —',
      '✓ bg-s…pped  bg    stopped     docs · main                                 —',
    ])
  })

  test('a session that needs the person goes before this session, which leads the working group', async ($, on) => {
    const seen = world(on, {})
    seen.agents = agentsJson([
      session('lane-a1', { id: 'b9', kind: 'background', state: 'working' }),
      session('mocks', {
        pid: 2001,
        kind: 'interactive',
        status: 'busy',
        sessionId: OWN_ID,
        cwd: ROOT,
      }),
      session('api-login', {
        pid: 2003,
        kind: 'interactive',
        status: 'waiting',
        waitingFor: 'permission',
      }),
    ])
    await mockWork($, seen)
    await showMachine($, seen)
    const heads = (await screenAt($, 'terminal', 'inline', 76)).filter((line) =>
      /^[▶◆○✓■] /.test(line),
    )
    expect(heads.map((line) => line.split(/\s+/)[1])).toEqual(['api-login', 'mocks', 'lane-a1'])
  })

  test('this session leads the idle group when it is idle', async ($, on) => {
    const seen = world(on, {})
    seen.agents = agentsJson([
      session('inter-idle', { pid: 3001, kind: 'interactive', status: 'idle' }),
      session('mocks', {
        pid: 2001,
        kind: 'interactive',
        status: 'idle',
        sessionId: OWN_ID,
        cwd: ROOT,
      }),
      session('bg-done', { id: 'b1', kind: 'background', state: 'done' }),
    ])
    await mockWork($, seen)
    await showMachine($, seen)
    const heads = (await screenAt($, 'terminal', 'dock', 41)).filter((line) =>
      /^[▶◆○✓■] /.test(line),
    )
    expect(heads).toEqual([
      '○ mocks  interactive  this  idle',
      '○ inter-idle  interactive  idle',
      '✓ bg-done  background  done',
    ])
  })
})

const WAITS_CRITERION = 'A session that needs the person shows a waits for line from waitingFor'

describe(WAITS_CRITERION, () => {
  for (const surface of SURFACES) {
    test(`the waits for line names waitingFor under the card on ${surface}, docked and inline`, async ($, on) => {
      const seen = world(on, storeWith(API_PROGRESS), ['terminal', surface])
      await mockWork($, seen)
      await showMachine($, seen)
      const docked = await screenAt($, surface, 'dock', 41)
      expect(docked.slice(1, 3)).toEqual([
        '◆ api-login  interactive  needs you',
        '  waits for: permission',
      ])
      const inline = await screenAt($, surface, 'inline', 76)
      expect(inline[2]).toBe('    waits for: permission')
      expect(docked.filter((line) => line.includes('waits for:'))).toHaveLength(1)
    })
  }

  test('a blocked session with no waitingFor waits for an answer', async ($, on) => {
    const seen = world(on, {})
    seen.agents = agentsJson(STATE_AGENTS)
    await mockWork($, seen)
    await showMachine($, seen)
    const lines = await screenAt($, 'terminal', 'dock', 41)
    const blocked = lines.indexOf('◆ bg-blocked  background  needs you')
    expect(lines[blocked + 1]).toBe('  waits for: an answer')
    const waiting = lines.indexOf('◆ inter-waiting  interactive  needs you')
    expect(lines[waiting + 1]).toBe('  waits for: permission')
  })
})

const LOCAL_CRITERION =
  "This session's card shows its agent counts from local state, not from the poll"

describe(LOCAL_CRITERION, () => {
  for (const surface of SURFACES) {
    test(`the agents line and the task line follow local state between two polls on ${surface}`, async ($, on) => {
      const seen = world(on, storeWith(API_PROGRESS, LANE_PROGRESS), ['terminal', surface])
      await mockWork($, seen)
      await showMachine($, seen)
      const runs = seen.agentsRuns
      const before = await screenAt($, surface, 'dock', 41)
      expect(before).toContain('  agents 3 · 1 failed')
      seen.subagents = [...MOCK_SUBAGENTS, subagent('a6', 'reviewer', 'running')]
      await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'completed' })
      const after = await screenAt($, surface, 'dock', 41)
      expect(seen.agentsRuns).toBe(runs)
      expect(after).toContain('  agents 4 · 1 failed')
      expect(after).toContain('  ○ Review the mocks with Codex ▰▰▱▱ 2/4')
      expect(after.filter((line) => line.startsWith('  agents'))).toHaveLength(1)
    })
  }

  test('no agents line while this session has no agent that runs or failed', async ($, on) => {
    const seen = world(on)
    await mockWork($, seen)
    seen.subagents = [subagent('a4', 'Plan', 'completed')]
    await showMachine($, seen)
    expect(
      (await screenAt($, 'terminal', 'dock', 41)).some((line) => line.includes('agents')),
    ).toBe(false)
    seen.subagents = [subagent('a2', 'Explore', 'running')]
    expect(await screenAt($, 'terminal', 'dock', 41)).toContain('  agents 1')
  })
})

const STATES_CRITERION =
  'The loading, empty, stale and error states draw as section 5 of the mock says'

describe(STATES_CRITERION, () => {
  test('loading: the first poll has not answered yet', async ($, on) => {
    const seen = world(on)
    await mockWork($, seen)
    seen.hold = () => seen.clock.sleep(20 * SECOND)
    await showMachine($, seen)
    for (const surface of SURFACES) {
      seen.surfaces = ['terminal', surface]
      for (const columns of [30, 41]) {
        expect(await screenAt($, surface, 'dock', columns)).toEqual([
          'Sessions',
          'Listing the local sessions…',
        ])
      }
    }
  })

  test('empty: the poll lists no session, and this session shows its card marked not listed', async ($, on) => {
    const seen = world(on)
    seen.agents = agentsJson([])
    await mockWork($, seen)
    await showMachine($, seen)
    expect(await screenAt($, 'terminal', 'dock', 41)).toEqual([
      'Sessions',
      'No local sessions are listed.',
      '▶ 00000000  this  busy',
      '  not listed (stale)',
      '  ▶ Write the tab mocks ▰▱▱▱ 1/4',
      '  app · 14m worked · est. 30m left',
      '  agents 3 · 1 failed',
    ])
  })

  test('only this session: the header counts 1 and says so', async ($, on) => {
    const seen = world(on)
    seen.agents = agentsJson(MACHINE_AGENTS.filter((entry) => entry.sessionId === OWN_ID))
    await mockWork($, seen)
    await showMachine($, seen)
    expect((await screenAt($, 'terminal', 'dock', 41)).slice(0, 3)).toEqual([
      'Sessions  1',
      'Only this session is running.',
      '▶ mocks  interactive  this  busy',
    ])
  })

  test('stale: a failed poll over 30 seconds after the last answer keeps the cards under a warning', async ($, on) => {
    const seen = world(on)
    await mockWork($, seen)
    await showMachine($, seen)
    seen.agents = { exitCode: 1, stdout: '' }
    await seen.clock.advance(POLL_INTERVAL_MS)
    const fresh = await screenAt($, 'terminal', 'dock', 41)
    expect(fresh[0]).toBe('Sessions  4 · 1 needs you · 15s ago')
    expect(fresh[1]).toBe('◆ api-login  interactive  needs you')
    await seen.clock.advance(POLL_INTERVAL_MS * 7)
    const lines = await screenAt($, 'terminal', 'dock', 41)
    expect(lines.slice(0, 4)).toEqual([
      'Sessions  4 · 1 needs you · 2m ago',
      'Last poll failed; showing 2m old data.',
      '  retry in 15s',
      '◆ api-login  interactive  needs you',
    ])
    expect(lines).toContain('▶ mocks  interactive  this  busy')
  })

  const FAILURES: readonly { answer: AgentsAnswer; lines: readonly string[] }[] = [
    {
      answer: { exitCode: 1, stdout: '' },
      lines: [
        'Sessions',
        'claude agents --json failed: exit 1.',
        'Run it in a shell to see why.',
        'retry in 15s',
      ],
    },
    {
      answer: { exitCode: 0, stdout: 'Usage: claude agents' },
      lines: ['Sessions', 'claude agents --json failed: the output', 'is not a JSON list.'],
    },
    {
      answer: { exitCode: 0, stdout: '[', isStdoutTruncated: true },
      lines: ['Sessions', 'claude agents --json failed: the output', 'is over 4 MiB and was cut.'],
    },
    {
      answer: { deny: 'spawn claude ENOENT' },
      lines: ['Sessions', 'claude is not on PATH, so other sessions', 'cannot be listed.'],
    },
  ]

  for (const { answer: failed, lines } of FAILURES) {
    test(`error: ${lines[1] ?? ''}`, async ($, on) => {
      const seen = world(on)
      seen.agents = failed
      await mockWork($, seen)
      await showMachine($, seen)
      for (const surface of SURFACES) {
        seen.surfaces = ['terminal', surface]
        expect(await screenAt($, surface, 'dock', 41)).toEqual(lines)
      }
      const ui = await mountTab($, 'terminal', 'dock', 41)
      expect((await ui.find({ type: 'Text', text: /^claude / }))?.props.color).toBe('error')
      await ui.unmount()
    })
  }

  test('a task key written over 60 seconds before its session started is stale, with the elapsed time', async ($, on) => {
    const lane = MACHINE_AGENTS.find((entry) => entry.sessionId === LANE_ID)
    if (!lane) throw new Error('the fixture has no lane session')
    const seen = world(
      on,
      storeWith({ ...LANE_PROGRESS, updatedAt: Number(lane.startedAt) - 61 * SECOND }),
    )
    await mockWork($, seen)
    await showMachine($, seen)
    const lines = await screenAt($, 'terminal', 'dock', 41)
    expect(lines).toContain('  ▶ Build the tab pane (stale) ▰▰▰▱▱▱ 3/6')
    expect(lines).toContain('  app.wt/lane-a1 · lane/a1 · 1h elapsed')
    expect(lines).toContain('  api · feat/login · 2h elapsed')
  })

  test('a session with the board and an empty list shows no tasks, and one without the board shows no task line', async ($, on) => {
    const seen = world(
      on,
      storeWith({ ...API_PROGRESS, task: null, taskStatus: null, done: 0, total: 0, taskIds: [] }),
    )
    await mockWork($, seen)
    await showMachine($, seen)
    const lines = await screenAt($, 'terminal', 'dock', 41)
    const api = lines.indexOf('◆ api-login  interactive  needs you')
    expect(lines.slice(api + 1, api + 4)).toEqual([
      '  waits for: permission',
      '  no tasks',
      '  api · feat/login · 2h worked',
    ])
    const lane = lines.indexOf('▶ lane-a1  background  working')
    expect(lines[lane + 1]).toBe('  app.wt/lane-a1 · lane/a1 · 1h elapsed')
  })

  test('desktop: other sessions are listed only in a terminal session, above this session card', async ($, on) => {
    const seen = world(on, storeWith(API_PROGRESS), ['desktop'])
    await mockWork($, seen)
    await showMachine($, seen)
    await seen.clock.advance(POLL_INTERVAL_MS)
    expect(seen.agentsRuns).toBe(0)
    expect(await screenAt($, 'desktop', 'dock', 41)).toEqual([
      'Sessions',
      'Other sessions are listed only in a',
      'terminal session.',
      '▶ 00000000  this  busy',
      '  ▶ Write the tab mocks ▰▱▱▱ 1/4',
      '  app · 14m worked · est. 30m left',
      '  agents 3 · 1 failed',
    ])
  })

  test('the bar holds at most 8 cells, each a share of the tasks', async ($, on) => {
    const seen = world(on)
    seen.agents = agentsJson(MACHINE_AGENTS.filter((entry) => entry.sessionId === OWN_ID))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    for (let index = 1; index <= 10; index += 1) {
      await $.tool.call({ tool: TOOL_ADD, title: `Step ${String(index)}` })
    }
    for (const id of [1, 2, 3, 4, 5])
      await $.tool.call({ tool: TOOL_UPDATE, id, status: 'completed' })
    await showMachine($, seen)
    expect((await screenAt($, 'terminal', 'dock', 41))[3]).toBe('  ○ Step 6 ▰▰▰▰▱▱▱▱ 5/10')
  })
})

function shared(name: string, fields: Partial<AgentSummary> = {}): AgentSummary {
  return { name, task: null, done: 0, total: 0, isFailed: false, ...fields }
}

const LANE_AGENTS: AgentSummary[] = [
  shared('Explore', { task: 'Map the hooks', done: 2, total: 5 }),
  shared('tester', { task: 'Run the unit tests', done: 0, total: 1 }),
  shared('reviewer', { task: 'Review board.tsx', done: 1, total: 3 }),
  shared('scout', { task: 'Ask about the plan', done: 4, total: 9, needsYou: true }),
  shared('lane-b'),
  shared('implementer', { task: 'Edit b.ts', done: 1, total: 2, isFailed: true }),
]

const SHARED_CRITERION =
  'When a subagent task list changes, handily-board writes the agent name, its current task and its done and total counts into its session store key, at most 4096 bytes for each session'

describe(SHARED_CRITERION, () => {
  test('a subagent task list change writes each active agent of this session into its store key', async ($, on) => {
    const seen = world(on)
    seen.subagents = [
      subagent('x1', 'Explore', 'running'),
      subagent('x2', 'tester', 'running'),
      subagent('x3', 'lane-b', 'failed'),
      subagent('x4', 'Plan', 'completed'),
    ]
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: TOOL_ADD, title: 'Read the design', agentId: 'x1' })
    await $.tool.call({ tool: TOOL_ADD, title: 'Map the hooks', agentId: 'x1' })
    await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed', agentId: 'x1' })
    const kept = readProgress(seen.store.get(progressKey(OWN_ID)))
    expect(kept?.agentCount).toBe(3)
    expect(kept?.agents).toEqual([
      shared('lane-b', { isFailed: true }),
      shared('Explore', { task: 'Map the hooks', done: 1, total: 2 }),
      shared('tester'),
    ])
  })

  test('the writer drops agents from the end until the entry is at most 4096 bytes, and keeps the full count', async ($, on) => {
    const seen = world(on)
    const ids = Array.from({ length: 30 }, (_, index) => `x${String(index + 10)}`)
    seen.subagents = ids.map((id) => subagent(id, `${id}-${'n'.repeat(60)}`, 'running'))
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    for (const id of ids) {
      await $.tool.call({ tool: TOOL_ADD, title: `${id} ${'t'.repeat(150)}`, agentId: id })
    }
    const raw = seen.store.get(progressKey(OWN_ID))
    const kept = readProgress(raw)
    if (kept === null) throw new Error('the session key was not written')
    expect(new TextEncoder().encode(JSON.stringify(raw)).length).toBeLessThanOrEqual(
      ENTRY_BYTES_AT_MOST,
    )
    expect(kept.agentCount).toBe(30)
    expect(kept.agents.length).toBeGreaterThan(0)
    expect(kept.agents.length).toBeLessThan(30)
    expect(kept.agents.map((agent) => agent.name.slice(0, 3))).toEqual(
      ids.slice(0, kept.agents.length),
    )
    expect(kept.agents[0]?.name).toHaveLength(40)
    expect(kept.agents[0]?.task).toHaveLength(80)
  })

  test('an entry over 4096 bytes with no agent is refused by name', () => {
    const entry = progressOf(OWN_ID, { cwd: `/${'d'.repeat(ENTRY_BYTES_AT_MOST)}` })
    expect(() => withinLimit(entry)).toThrow(/bytes with no agent, over the limit of 4096/)
    expect(entryBytes(progressOf(OWN_ID, {}))).toBeLessThan(ENTRY_BYTES_AT_MOST)
  })

  test('a key without agents, from an earlier version, reads as no agents', () => {
    const old = Object.fromEntries(
      Object.entries(LANE_PROGRESS).filter(([key]) => key !== 'agents' && key !== 'agentCount'),
    )
    expect(readProgress(old)).toMatchObject({ agents: [], agentCount: 0 })
    expect(readProgress({ ...LANE_PROGRESS, agents: [{ name: 1 }] })).toBeNull()
  })
})

const ROWS_CRITERION =
  'When the this machine tab draws a card whose store key lists agents, the card shows at most 4 agent rows, those that need the person first, then a fold that names how many more agents and how many of them need the person'

describe(ROWS_CRITERION, () => {
  for (const surface of SURFACES) {
    test(`docked at 41 and 30 columns on ${surface}: 4 agent rows, needs you first, then the fold, and this session keeps counts only`, async ($, on) => {
      const seen = world(
        on,
        storeWith(API_PROGRESS, { ...LANE_PROGRESS, agents: LANE_AGENTS, agentCount: 6 }),
        ['terminal', surface],
      )
      await mockWork($, seen)
      await showMachine($, seen)
      const ui = await mountTab($, surface, 'dock', 41)
      const lines = await screen(ui, 41)
      const lane = lines.indexOf('▶ lane-a1  background  working')
      expect(lines.slice(lane + 3, lane + 9)).toEqual([
        '  agents 6 · 1 needs you · 1 failed',
        '  ◆ scout      needs you            4/9',
        '  ▶ Explore    Map the hooks        2/5',
        '  ▶ tester     Run the unit tests   0/1',
        '  ▶ reviewer   Review board.tsx     1/3',
        '  [ +2 more agents ]',
      ])
      const mocks = lines.indexOf('▶ mocks  interactive  this  busy')
      expect(lines[mocks + 3]).toBe('  agents 3 · 1 failed')
      expect(lines[mocks + 4]).toBe(RULE_41)
      const more = await ui.find({ type: 'Button', text: '+2 more agents' })
      await ui.press({ key: more?.key ?? '' })
      const opened = await screen(ui, 41)
      expect(opened.slice(lane + 8, lane + 11)).toEqual([
        '  ▶ lane-b     no tasks',
        '  ■ impl…nter  Edit b.ts            1/2',
        '  [ hide 2 more agents ]',
      ])
      await ui.unmount()
      const narrow = await screenAt($, surface, 'dock', 30)
      const narrowLane = narrow.indexOf('▶ lane-a1  working')
      expect(narrow.slice(narrowLane + 4, narrowLane + 11)).toEqual([
        '  ◆ scout     needs you  4/9',
        '  ▶ Explore   Map the …  2/5',
        '  ▶ tester    Run the …  0/1',
        '  ▶ reviewer  Review b…  1/3',
        '  ▶ lane-b    no tasks',
        '  ■ impl…nter Edit b.ts  1/2',
        '  [ hide 2 more agents ]',
      ])
    })
  }

  test('the fold counts the agents it hides that need the person', async ($, on) => {
    const waiting = LANE_AGENTS.map((agent) => ({ ...agent, needsYou: true as const }))
    const seen = world(on, storeWith({ ...LANE_PROGRESS, agents: waiting, agentCount: 6 }))
    await mockWork($, seen)
    await showMachine($, seen)
    const lines = await screenAt($, 'terminal', 'dock', 41)
    expect(lines).toContain('  agents 6 · 6 need you · 1 failed')
    expect(lines).toContain('  [ +2 more agents · 2 need you ]')
  })

  test('inline at 76 columns: the row folds its agents into one button that unfolds them', async ($, on) => {
    const seen = world(
      on,
      storeWith(API_PROGRESS, { ...LANE_PROGRESS, agents: LANE_AGENTS, agentCount: 6 }),
    )
    await mockWork($, seen)
    await showMachine($, seen)
    await seen.clock.advance(12 * SECOND)
    const ui = await mountTab($, 'terminal', 'inline', 76)
    const lines = await screen(ui, 76)
    const lane = lines.findIndex((line) => line.startsWith('▶ lane-a1'))
    expect(lines[lane + 1]).toBe('    [ 6 agents · 1 needs you ]')
    expect(lines[lane + 2]).toMatch(/^✓ docs-pass/)
    const fold = await ui.find({ type: 'Button', text: '6 agents · 1 needs you' })
    await ui.press({ key: fold?.key ?? '' })
    const opened = await screen(ui, 76)
    expect(opened.slice(lane + 1, lane + 7)).toEqual([
      '    [ hide 6 agents ]',
      '    ◆ scout      needs you                                             4/9',
      '    ▶ Explore    Map the hooks                                         2/5',
      '    ▶ tester     Run the unit tests                                    0/1',
      '    ▶ reviewer   Review board.tsx                                      1/3',
      '    [ +2 more agents ]',
    ])
    await ui.unmount()
  })
})

const WIDTH_CRITERION =
  'A test with 10 sessions of 5 agents draws every card within the tab at 41 columns'

describe(WIDTH_CRITERION, () => {
  test('10 sessions of 5 agents with long names and titles stay within 41 columns', async ($, on) => {
    const sessions = Array.from({ length: 10 }, (_, index) => `lane-${String(index)}`)
    const agents = Array.from({ length: 5 }, (_, index) =>
      shared(`general-purpose-${String(index)}`, {
        task: `Write the ${'very '.repeat(12)}long title ${String(index)}`,
        done: 10 + index,
        total: 100,
      }),
    )
    const entries = sessions.map((name) =>
      progressOf(`${name}-id`, { agents, agentCount: 5, updatedAt: NOW - MINUTE }),
    )
    const seen = world(on, storeWith(...entries))
    seen.agents = agentsJson(
      sessions.map((name, index) =>
        session(name, { id: `c${String(index)}`, kind: 'background', state: 'working' }),
      ),
    )
    await mockWork($, seen)
    await showMachine($, seen)
    const lines = await screenAt($, 'terminal', 'dock', 41)
    expect(lines.filter((line) => line.startsWith('  ▶ gene…'))).toHaveLength(40)
    expect(lines.filter((line) => line === '  [ +1 more agents ]')).toHaveLength(10)
    expect(lines).toContain('  ▶ gene…se-0  Write the very ve…  10/100')
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(41)
  })
})
