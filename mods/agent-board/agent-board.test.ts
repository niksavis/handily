import type { AgentInfo, On, RenderSurface, ToolCallArgs, UiPane } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import { TARGET_CHARS_AT_MOST, toolTarget } from './hooks/agents'
import { EMPTY_TEXT, formatElapsed, NOT_LISTED_BADGE, planKey } from './hooks/board'
import { planView, readPlan, type PlanStatus } from './hooks/plan'
import { REDRAW_INTERVAL_MS } from './hooks/register'

const NOW = 1_791_400_000_000
const PANE_ID = 'agent-board'
const SURFACES = ['terminal', 'desktop'] as const

const EXPLORE: AgentInfo = {
  id: 'a0000001',
  description: 'find the element table',
  type: 'Explore',
  status: 'running',
}

const PLAN: AgentInfo = {
  id: 'a0000002',
  description: 'map the code',
  type: 'Plan',
  status: 'completed',
}

const UNLISTED_ID = 'f0000009'

type World = {
  panes: UiPane[]
  paneReads: number
  subagents: AgentInfo[]
  calls: Record<string, unknown>[]
  spawns: number
  nextAgentId: string
  hold: Promise<void> | null
  logs: string[]
}

function fakeWorld(on: On): World {
  const world: World = {
    panes: [],
    paneReads: 0,
    subagents: [],
    calls: [],
    spawns: 0,
    nextAgentId: EXPLORE.id,
    hold: null,
    logs: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
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
  on('ui.panes', () => {
    world.paneReads += 1
    return { value: world.panes }
  })
  on('ui.log', (_$, e) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  on('agent.list', () => ({ value: world.subagents }))
  on('agent.spawn', () => {
    world.spawns += 1
    return { model: 'test-model', agentId: world.nextAgentId }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', async (_$, e) => {
    world.calls.push({ ...e })
    if (world.hold) await world.hold
    return { result: `ran ${e.tool}` }
  })
  return world
}

async function command(engine: Engine, args: string): Promise<string> {
  const result = await engine.command.run({
    command: 'agent-board',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: true, columns: 140 },
  })
  return result.text ?? ''
}

async function mountBoard(engine: Engine, surface: RenderSurface) {
  return engine.ui.mount({
    plugin: 'agent-board',
    surface,
    component: 'Pane',
    requestId: PANE_ID,
    props: {
      title: 'Subagents',
      isFocused: false,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
}

async function shownTexts(engine: Engine, surface: RenderSurface = 'terminal'): Promise<string[]> {
  const ui = await mountBoard(engine, surface)
  const texts = (await ui.findAll({ type: 'Text' })).map((found) => found.text)
  await ui.unmount()
  return texts
}

async function openBoard(engine: Engine, clock?: MockClock): Promise<string> {
  await engine.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const reply = await command(engine, '')
  await clock?.settle()
  return reply
}

async function subagentCall(engine: Engine, agentId: string, filePath = 'docs/design.md') {
  const input = { tool: 'Read' as const, file_path: filePath, agentId }
  return engine.tool.call(input)
}

async function handBack(engine: Engine, agentId: string) {
  const outsideTheToolTable = { tool: 'SubagentHandback', message: 'report', agentId }
  return engine.tool.call(outsideTheToolTable as unknown as ToolCallArgs)
}

async function spawn(engine: Engine, description: string, subagentType: string) {
  return engine.agent.spawn({
    tool_use_id: `use-${description}`,
    prompt: 'Read the README.',
    description,
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'test-model',
    background: true,
    fork: false,
  })
}

async function endTurn(engine: Engine, agentId: string) {
  return engine.turn.complete({
    turnId: `turn-${agentId}`,
    reason: 'answer',
    answer: 'report',
    durationMs: 1,
    isAborted: false,
    agentId,
  })
}

describe('the pane', () => {
  for (const surface of SURFACES) {
    test(`opens and shows one row per listed or calling subagent on ${surface}`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const world = fakeWorld(on)
      world.subagents = [EXPLORE, PLAN]
      expect(await openBoard($, clock)).toBe('Agent board opened.')
      expect(world.panes.map((pane) => [pane.id, pane.title])).toEqual([[PANE_ID, 'Subagents']])
      await subagentCall($, UNLISTED_ID)
      const texts = await shownTexts($, surface)
      expect(texts).toContain('Subagents')
      expect(texts).toContain('  1 active · 1 done · 1 not listed')
      const titles = texts.filter((text) => ['Explore', 'Plan', UNLISTED_ID].includes(text))
      expect(titles).toEqual(['Explore', 'Plan', UNLISTED_ID])
      expect(texts.indexOf(NOT_LISTED_BADGE)).toBe(texts.indexOf(UNLISTED_ID) + 1)
      expect(texts.indexOf('unknown')).toBe(texts.indexOf(UNLISTED_ID) + 2)
      expect(texts).toContain('find the element table')
      expect(texts).toContain('map the code')
      expect(texts).toContain('running')
      expect(texts).toContain('done')
      expect(texts).not.toContain(EMPTY_TEXT)
    })

    test(`says that no subagent exists yet on ${surface}`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      fakeWorld(on)
      await openBoard($, clock)
      const texts = await shownTexts($, surface)
      expect(texts).toEqual(['Subagents', EMPTY_TEXT])
    })
  }

  test('answers an unknown argument with the two valid forms', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    await openBoard($, clock)
    expect(await command($, 'x')).toBe(
      'Unknown argument "x". Use /agent-board or /agent-board close.',
    )
    expect(await command($, 'close')).toBe('Agent board closed.')
    expect(world.panes).toEqual([])
  })
})

describe('the tool calls of a subagent', () => {
  test('shows the running tool and its target, then adds 1 to the count when it resolves', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [EXPLORE]
    await openBoard($, clock)
    await subagentCall($, EXPLORE.id, 'mods/agent-board/README.md')
    const gate = { release: () => undefined as unknown }
    world.hold = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const pending = subagentCall($, EXPLORE.id)
    await clock.settle()
    const running = await shownTexts($)
    expect(running).toContain('▸ ')
    expect(running).toContain('Read docs/design.md')
    expect(running).toContain(' · 1 tool')
    gate.release()
    expect(await pending).toMatchObject({ result: 'ran Read' })
    const resolved = await shownTexts($)
    expect(resolved).toContain('last ')
    expect(resolved).toContain('Read docs/design.md')
    expect(resolved).toContain(' · 2 tools')
    expect(resolved).not.toContain('▸ ')
  })

  test('keeps the tool and target of the last other call after a SubagentHandback', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [{ ...EXPLORE, status: 'completed' }]
    await openBoard($, clock)
    await subagentCall($, EXPLORE.id, 'mods/agent-board/README.md')
    expect(await handBack($, EXPLORE.id)).toMatchObject({ result: 'ran SubagentHandback' })
    const texts = await shownTexts($)
    expect(texts).toContain('Read mods/agent-board/README.md')
    expect(texts).toContain(' · 2 tools')
    expect(texts.filter((text) => text.includes('SubagentHandback'))).toEqual([])
  })

  test('shows the SubagentHandback when it is the only call of the subagent', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [{ ...EXPLORE, status: 'completed' }]
    await openBoard($, clock)
    await handBack($, EXPLORE.id)
    const texts = await shownTexts($)
    expect(texts).toContain('SubagentHandback')
    expect(texts).toContain(' · 1 tool')
    expect(texts).not.toContain('no tool calls yet')
  })

  test('shows no tool calls yet for a listed subagent that made none', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [EXPLORE]
    await openBoard($, clock)
    expect(await shownTexts($)).toContain('no tool calls yet')
  })

  test('passes a main-loop call on unchanged and changes no row', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    await openBoard($, clock)
    const input = { tool: 'Read' as const, file_path: 'docs/design.md' }
    const result = await $.tool.call(input)
    expect(result).toMatchObject({ result: 'ran Read' })
    expect(world.calls).toHaveLength(1)
    expect(world.calls[0]).toMatchObject(input)
    expect(world.calls[0]?.agentId).toBeUndefined()
    expect(await shownTexts($)).toEqual(['Subagents', EMPTY_TEXT])
  })

  test('keeps only the first line of a target, cut to its limit', () => {
    const long = `${'x'.repeat(TARGET_CHARS_AT_MOST + 50)}\nsecond line`
    expect(toolTarget({ command: long })).toBe('x'.repeat(TARGET_CHARS_AT_MOST))
    expect(toolTarget({ pattern: 'TODO', path: 'src' })).toBe('TODO')
    expect(toolTarget({ todos: [] })).toBeNull()
  })
})

describe('a hook that throws', () => {
  function failingClock(on: On): void {
    on('clock.now', () => {
      throw new Error('the clock is down')
    })
  }

  test('still resolves a subagent tool call with the result of next', async ($, on) => {
    failingClock(on)
    const world = fakeWorld(on)
    expect(await subagentCall($, EXPLORE.id)).toMatchObject({ result: 'ran Read' })
    expect(world.calls).toHaveLength(1)
  })

  test('still resolves a spawn and a subagent turn with the result of next', async ($, on) => {
    failingClock(on)
    const world = fakeWorld(on)
    expect(await spawn($, 'find the element table', 'Explore')).toMatchObject({
      model: 'test-model',
      agentId: EXPLORE.id,
    })
    expect(world.spawns).toBe(1)
    expect(await endTurn($, EXPLORE.id)).toMatchObject({ text: 'report' })
  })
})

describe('the redraw', () => {
  test('redraws every second with the time since the spawn and stops when the pane closes', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    await spawn($, 'find the element table', 'Explore')
    world.subagents = [EXPLORE]
    await clock.advance(65_000)
    await openBoard($, clock)
    const ui = await mountBoard($, 'terminal')
    const shown = async () => (await ui.findAll({ type: 'Text' })).map((found) => found.text)
    expect(await shown()).toContain('1m 05s')
    await clock.advance(REDRAW_INTERVAL_MS)
    expect(await shown()).toContain('1m 06s')
    await clock.advance(REDRAW_INTERVAL_MS)
    expect(await shown()).toContain('1m 07s')
    expect(await command($, 'close')).toBe('Agent board closed.')
    const readsAtClose = world.paneReads
    await clock.advance(REDRAW_INTERVAL_MS * 5)
    expect(await shown()).toContain('1m 07s')
    expect(world.paneReads).toBe(readsAtClose)
    await ui.unmount()
  })

  test('does not redraw while the pane is a hidden tab', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [EXPLORE]
    await openBoard($, clock)
    const ui = await mountBoard($, 'terminal')
    const shown = async () => (await ui.findAll({ type: 'Text' })).map((found) => found.text)
    expect(await shown()).toContain('0s')
    world.panes = world.panes.map((pane) => ({ ...pane, isShown: false }))
    await clock.advance(REDRAW_INTERVAL_MS * 3)
    expect(await shown()).toContain('0s')
    world.panes = world.panes.map((pane) => ({ ...pane, isShown: true }))
    await clock.advance(REDRAW_INTERVAL_MS)
    expect(await shown()).toContain('4s')
    await ui.unmount()
  })

  test('formats the elapsed time in seconds, minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(59_999)).toBe('59s')
    expect(formatElapsed(65_000)).toBe('1m 05s')
    expect(formatElapsed(2 * 3_600_000 + 3 * 60_000)).toBe('2h 03m')
  })
})

describe('a subagent with a parent', () => {
  test('shows under and the name or the description of its parent', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [
      { ...PLAN, status: 'running' },
      { ...EXPLORE, parentId: PLAN.id },
      {
        id: 'a0000003',
        description: 'check links',
        type: 'Explore',
        status: 'running',
        name: 'scout',
      },
      {
        id: 'a0000004',
        description: 'read tests',
        type: 'Explore',
        status: 'running',
        parentId: 'a0000003',
      },
      {
        id: 'a0000005',
        description: 'lost child',
        type: 'Explore',
        status: 'running',
        parentId: 'b0000099zz',
      },
    ]
    await openBoard($, clock)
    const texts = await shownTexts($)
    expect(texts).toContain('under map the code')
    expect(texts).toContain('under scout')
    expect(texts).toContain('under b0000099')
    expect(texts.filter((text) => text.startsWith('under '))).toHaveLength(3)
  })
})

describe('when every subagent ended', () => {
  test('the header reads all N done and the rows keep their tool count and time', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    await spawn($, 'find the element table', 'Explore')
    world.nextAgentId = PLAN.id
    await spawn($, 'map the code', 'Plan')
    world.subagents = [EXPLORE, { ...PLAN, status: 'running' }]
    await subagentCall($, EXPLORE.id)
    await subagentCall($, EXPLORE.id)
    await subagentCall($, PLAN.id)
    await clock.advance(30_000)
    await endTurn($, EXPLORE.id)
    await clock.advance(10_000)
    world.subagents = [
      { ...EXPLORE, status: 'completed' },
      { ...PLAN, status: 'failed' },
      { id: 'a0000003', description: 'stop me', type: 'Explore', status: 'killed' },
    ]
    await openBoard($, clock)
    const first = await shownTexts($)
    await clock.advance(120_000)
    world.subagents = []
    const later = await shownTexts($)
    for (const texts of [first, later]) {
      expect(texts).toContain('  all 3 done')
      expect(texts).toContain(' · 2 tools')
      expect(texts).toContain(' · 1 tool')
      expect(texts).toContain('30s')
      expect(texts).toContain('40s')
      expect(texts).toContain('done')
      expect(texts).toContain('failed')
      expect(texts).toContain('killed')
    }
  })

  test('a loop that agent.list never shows counts apart and does not block all N done', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [{ ...EXPLORE, status: 'completed' }]
    await openBoard($, clock)
    const input = { tool: 'AskUserQuestion' as const, questions: [], agentId: UNLISTED_ID }
    await $.tool.call(input)
    await clock.advance(20_000)
    const texts = await shownTexts($)
    expect(texts).toContain('  all 1 done · 1 not listed')
    expect(texts.indexOf(UNLISTED_ID)).toBeGreaterThan(texts.indexOf('Explore'))
    expect(texts[texts.indexOf(UNLISTED_ID) + 3]).toBe('0s')
  })

  test('the header counts a subagent whose history expired as unknown, its time stopped', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [EXPLORE]
    await openBoard($, clock)
    expect(await shownTexts($)).toContain('0s')
    await clock.advance(10_000)
    const listed = await shownTexts($)
    expect(listed).toContain('  1 active')
    expect(listed).toContain('10s')
    world.subagents = []
    await clock.advance(50_000)
    const texts = await shownTexts($)
    expect(texts).toContain('  1 unknown')
    expect(texts).toContain('Explore')
    expect(texts).toContain('10s')
  })
})

describe('the repairs of the review', () => {
  for (const reason of ['clear', 'resume'] as const) {
    test(`a session end with reason ${reason} clears the rows of the last conversation`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const world = fakeWorld(on)
      on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
      world.subagents = [{ ...EXPLORE, status: 'completed' }, PLAN]
      await openBoard($, clock)
      await subagentCall($, EXPLORE.id)
      expect(await shownTexts($)).toContain('  all 2 done')
      world.subagents = []
      await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
      expect(await shownTexts($)).toEqual(['Subagents', EMPTY_TEXT])
    })
  }

  test('an agent whose turn ended stays done after agent.list drops it', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [EXPLORE]
    await openBoard($, clock)
    expect(await shownTexts($)).toContain('  1 active')
    await subagentCall($, EXPLORE.id)
    await clock.advance(7000)
    await endTurn($, EXPLORE.id)
    world.subagents = []
    await clock.advance(60_000)
    const texts = await shownTexts($)
    expect(texts).toContain('  all 1 done')
    expect(texts).toContain('done')
    expect(texts).toContain('7s')
    expect(texts).not.toContain('unknown')
  })

  test('keeps at most 20 idle not-listed loops and never drops a listed or running one', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [{ ...EXPLORE, status: 'completed' }]
    await openBoard($, clock)
    const forks = Array.from({ length: 25 }, (_, index) => `f${String(index).padStart(7, '0')}`)
    for (const fork of forks) {
      await clock.advance(1000)
      await subagentCall($, fork)
      await endTurn($, fork)
    }
    const gate = { release: () => undefined as unknown }
    world.hold = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const pending = subagentCall($, 'r0000001')
    await clock.settle()
    const texts = await shownTexts($)
    expect(texts.filter((text) => text === NOT_LISTED_BADGE)).toHaveLength(21)
    expect(texts).toContain('Explore')
    expect(texts).toContain('r0000001')
    expect(forks.filter((fork) => texts.includes(fork))).toEqual(forks.slice(5))
    gate.release()
    await pending
  })

  test('a spawned agent with no loop events and no list row does not block all N done', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.nextAgentId = 'w0000001'
    await spawn($, 'remote review', 'general-purpose')
    world.subagents = [{ ...EXPLORE, status: 'completed' }]
    await openBoard($, clock)
    const texts = await shownTexts($)
    expect(texts).toContain('  all 1 done · 1 not listed')
    expect(texts.indexOf(NOT_LISTED_BADGE)).toBe(texts.indexOf('general-purpose') + 1)
    expect(texts).toContain('remote review')
  })
})

type Node = { type: string; props: Record<string, unknown>; text: string; children: Node[] }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nodeOf(value: unknown): Node | null {
  if (!isObject(value) || typeof value.type !== 'string') return null
  const raw = Array.isArray(value.children) ? (value.children as unknown[]) : []
  return {
    type: value.type,
    props: isObject(value.props) ? value.props : {},
    text: raw.filter((child) => typeof child === 'string').join(''),
    children: raw.map(nodeOf).filter((child) => child !== null),
  }
}

function textsOf(node: Node): Node[] {
  return node.type === 'Text' ? [node] : node.children.flatMap(textsOf)
}

function wrappingTexts(node: Node): string[] {
  const inRow = node.props.flexDirection === 'row'
  const own = inRow
    ? node.children
        .filter((child) => child.type === 'Text' || child.props.flexShrink !== 0)
        .flatMap(textsOf)
        .filter((found) => found.props.wrap !== 'truncate-end')
        .map((found) => found.text)
    : []
  return [...own, ...node.children.flatMap(wrappingTexts)]
}

const THEME_KEYS = new Set(['success', 'warning', 'error', 'subtle', 'suggestion'])

const EVERY_STATE: AgentInfo[] = [
  { ...EXPLORE, name: 'scout-with-a-long-name-that-cannot-fit-in-the-pane-at-all' },
  { ...PLAN, parentId: EXPLORE.id },
  { id: 'a0000003', description: 'wait for a plan', type: 'Plan', status: 'waiting' },
  { id: 'a0000004', description: 'start soon', type: 'Explore', status: 'pending' },
  { id: 'a0000005', description: 'between turns', type: 'teammate', status: 'idle' },
  { id: 'a0000006', description: 'broke', type: 'Explore', status: 'failed' },
  { id: 'a0000007', description: 'stopped', type: 'Explore', status: 'killed' },
]

describe('the drawing', () => {
  test('no line of the board can wrap: each part keeps its width or truncates', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = EVERY_STATE
    await openBoard($, clock)
    await subagentCall($, EXPLORE.id, `docs/${'deep/'.repeat(30)}design.md`)
    await subagentCall($, UNLISTED_ID)
    const ui = await mountBoard($, 'terminal')
    const board = nodeOf(await ui.drawn())
    if (board === null) throw new Error('the board drew nothing')
    const cards = board.children.filter((child) => String(child.props.key).startsWith('agent:'))
    expect(cards).toHaveLength(EVERY_STATE.length + 1)
    expect(wrappingTexts(board)).toEqual([])
    expect(textsOf(board).some((found) => found.props.wrap === 'truncate-end')).toBe(true)
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`draws only theme colours, never a fixed colour, on ${surface}`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const world = fakeWorld(on)
      world.subagents = EVERY_STATE
      await openBoard($, clock)
      const ui = await mountBoard($, surface)
      const found = [
        ...(await ui.findAll({ type: 'Text' })),
        ...(await ui.findAll({ type: 'Box' })),
      ]
      const colours = found.flatMap((element) =>
        [element.props.color, element.props.borderColor].filter((value) => value !== undefined),
      )
      expect(colours.length > 0).toBe(true)
      expect(
        colours.filter((colour) => typeof colour !== 'string' || !THEME_KEYS.has(colour)),
      ).toEqual([])
      await ui.unmount()
    })
  }
})

describe('ready value for /handily', () => {
  test('writes the ready value that /handily reads when the session starts', async ($, on) => {
    fakeWorld(on)
    const ready: unknown[] = []
    on('state.set', { plugin: 'agent-board', key: 'ready' }, (_$, e, next) => {
      ready.push(e.value)
      return next(e)
    })
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    expect(ready).toEqual([{ root: expect.stringMatching(/[\\/]agent-board$/) }])
  })
})

const PLAN_TITLES = [
  'Read the design',
  'Map the hooks',
  'Draw the plan',
  'Test the fold',
  'Update the mock',
  'Bump the version',
  'Write the changelog',
  'Run the gates',
] as const

const MARK_OF: Record<PlanStatus, string> = { completed: '✓ ', in_progress: '▶ ', pending: '○ ' }

function planList(statuses: readonly PlanStatus[], titles: readonly string[] = PLAN_TITLES) {
  return {
    tasks: statuses.map((status, index) => ({
      id: statuses.length - index,
      title: titles[index] ?? `Task ${String(index + 1)}`,
      status,
      by: 'model',
      item: null,
    })),
    nextId: statuses.length + 1,
  }
}

const taskPane: Plugin = {
  name: 'task-pane',
  register(on) {
    on('command.run', async ($, e, next) => {
      if (e.command !== 'tp-plan') return next(e)
      const { agentId, list } = JSON.parse(e.args) as { agentId: string; list: unknown }
      await $.state.set({ plugin: 'task-pane', key: 'agentList', id: agentId }, list)
      return { text: 'set' }
    })
  },
}

async function setPlan(engine: Engine, agentId: string, list: unknown): Promise<void> {
  await engine.command.run({
    command: 'tp-plan',
    args: JSON.stringify({ agentId, list }),
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: true, columns: 140 },
  })
}

function planTexts(statuses: readonly PlanStatus[], from = 0, to = statuses.length): string[] {
  return statuses
    .slice(from, to)
    .flatMap((status, index) => [MARK_OF[status], PLAN_TITLES[from + index] ?? ''])
}

function cardTexts(texts: readonly string[], title: string): string[] {
  const start = texts.indexOf(title) - 1
  const end = texts.indexOf('─'.repeat(60), start)
  return texts.slice(start, end < 0 ? texts.length : end)
}

const FOUR: readonly PlanStatus[] = ['completed', 'completed', 'in_progress', 'pending']
const EIGHT: readonly PlanStatus[] = [
  'completed',
  'completed',
  'completed',
  'completed',
  'in_progress',
  'pending',
  'pending',
  'pending',
]

describe('the plan of a subagent', () => {
  for (const surface of SURFACES) {
    test(
      `shows the tasks in list order with done, in-progress and open marks and a done count on ${surface}`,
      { plugins: [taskPane] },
      async ($, on) => {
        const clock = mock.clock(on, { now: NOW })
        const world = fakeWorld(on)
        world.subagents = [EXPLORE]
        await openBoard($, clock)
        await subagentCall($, EXPLORE.id)
        const ui = await mountBoard($, surface)
        const shown = async () => (await ui.findAll({ type: 'Text' })).map((found) => found.text)
        expect((await shown()).at(-1)).toBe(' · 1 tool')
        await setPlan($, EXPLORE.id, planList(FOUR))
        const texts = await shown()
        expect(texts.slice(texts.indexOf(' · 1 tool') + 1)).toEqual([
          'plan 2/4 done',
          ...planTexts(FOUR),
        ])
        const styleOf = async (shown: string) =>
          (await ui.find({ type: 'Text', text: shown }))?.props
        expect(await styleOf('✓ ')).toMatchObject({ color: 'success' })
        expect(await styleOf('Read the design')).toMatchObject({ dimColor: true })
        expect(await styleOf('Draw the plan')).toMatchObject({ bold: true })
        expect(await styleOf('○ ')).toMatchObject({ dimColor: true })
        expect(await ui.findAll({ type: 'Button' })).toEqual([])
        await ui.unmount()
      },
    )
  }

  test(
    'folds a list of more than 5 to the task in progress, 2 before, 2 after and the count',
    { plugins: [taskPane] },
    async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const world = fakeWorld(on)
      world.subagents = [EXPLORE]
      await openBoard($, clock)
      await setPlan($, EXPLORE.id, planList(EIGHT))
      const texts = await shownTexts($)
      expect(texts.slice(texts.indexOf('no tool calls yet') + 1)).toEqual([
        ' · 5 of 8 shown',
        ...planTexts(EIGHT, 2, 7),
      ])
      const ui = await mountBoard($, 'terminal')
      const fold = await ui.find({ key: planKey(EXPLORE.id) })
      expect(fold?.props).toMatchObject({ label: 'plan 4/8 done' })
      await ui.unmount()
    },
  )

  for (const surface of SURFACES) {
    test(
      `a click on the plan of a card unfolds the whole list and a second click folds it on ${surface}`,
      { plugins: [taskPane] },
      async ($, on) => {
        const clock = mock.clock(on, { now: NOW })
        const world = fakeWorld(on)
        world.subagents = [EXPLORE, { ...PLAN, status: 'running' }]
        await openBoard($, clock)
        await setPlan($, EXPLORE.id, planList(EIGHT))
        await setPlan($, PLAN.id, planList(EIGHT))
        const ui = await mountBoard($, surface)
        const shown = async () => (await ui.findAll({ type: 'Text' })).map((found) => found.text)
        const buttons = await ui.findAll({ type: 'Button' })
        expect(buttons.map((button) => button.props.key)).toEqual([
          planKey(EXPLORE.id),
          planKey(PLAN.id),
        ])
        await ui.press({ key: planKey(EXPLORE.id) })
        const open = await shown()
        expect(cardTexts(open, 'Explore')).toContain(' · all 8 shown')
        expect(cardTexts(open, 'Explore').slice(-16)).toEqual(planTexts(EIGHT))
        expect(cardTexts(open, 'Plan')).toContain(' · 5 of 8 shown')
        await ui.press({ key: planKey(EXPLORE.id) })
        const folded = await shown()
        expect(cardTexts(folded, 'Explore')).toContain(' · 5 of 8 shown')
        expect(cardTexts(folded, 'Explore').slice(-10)).toEqual(planTexts(EIGHT, 2, 7))
        await ui.unmount()
      },
    )
  }

  const BEFORE = [
    '● ',
    'Explore',
    'running',
    '0s',
    'find the element table',
    'last ',
    'Read docs/design.md',
    ' · 1 tool',
  ]

  test('draws the card as before when task-pane is not installed', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [EXPLORE]
    await openBoard($, clock)
    await subagentCall($, EXPLORE.id)
    expect(await shownTexts($)).toEqual(['Subagents', '  1 active', ...BEFORE])
  })

  test(
    'draws the card as before when the subagent has no list or an empty one',
    { plugins: [taskPane] },
    async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const world = fakeWorld(on)
      world.subagents = [EXPLORE, { ...PLAN, status: 'running' }]
      await openBoard($, clock)
      await subagentCall($, EXPLORE.id)
      await setPlan($, PLAN.id, planList(FOUR))
      expect(cardTexts(await shownTexts($), 'Explore')).toEqual(BEFORE)
      await setPlan($, EXPLORE.id, planList([]))
      expect(cardTexts(await shownTexts($), 'Explore')).toEqual(BEFORE)
      expect(cardTexts(await shownTexts($), 'Plan')).toContain('plan 2/4 done')
    },
  )

  test('no plan line can wrap, folded or unfolded', { plugins: [taskPane] }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = fakeWorld(on)
    world.subagents = [EXPLORE]
    await openBoard($, clock)
    const long = PLAN_TITLES.map((title) => `${title} ${'and more '.repeat(20)}`)
    await setPlan($, EXPLORE.id, planList(EIGHT, long))
    const ui = await mountBoard($, 'terminal')
    for (let press = 0; press < 2; press += 1) {
      const board = nodeOf(await ui.drawn())
      if (board === null) throw new Error('the board drew nothing')
      expect(wrappingTexts(board)).toEqual([])
      await ui.press({ key: planKey(EXPLORE.id) })
    }
    await ui.unmount()
  })

  test('shows a hidden character in a plan title as an escape, as task-pane does', () => {
    const titles = ['Run\u200bthe gates', 'Run the gates\u{E0049}', 'soft\u00adhyphen', 'tab\there']
    const plan = readPlan(planList(Array<PlanStatus>(titles.length).fill('pending'), titles))
    expect(plan?.map((task) => task.title)).toEqual([
      'Run\\u200bthe gates',
      'Run the gates\\udb40\\udc49',
      'soft\\u00adhyphen',
      'tab\\u0009here',
    ])
  })

  test('anchors the fold on the task in progress, else the next open task, else the last', () => {
    const titles = (statuses: readonly PlanStatus[]) =>
      planView(
        statuses.map((status, index) => ({ title: String(index), status })),
        false,
      ).shown.map((task) => task.title)
    const open = Array<PlanStatus>(8).fill('pending')
    expect(titles(['in_progress', ...open.slice(1)])).toEqual(['0', '1', '2'])
    expect(titles(['completed', 'completed', 'completed', ...open.slice(3)])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
    expect(titles(Array<PlanStatus>(8).fill('completed'))).toEqual(['5', '6', '7'])
    expect(titles(open.slice(0, 5))).toEqual(['0', '1', '2', '3', '4'])
  })
})
