import type {
  AgentInfo,
  On,
  RenderPropsOf,
  SessionUsage,
  ToolCallArgs,
  ToolCallResult,
} from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Mounted,
  type Plugin,
} from 'claude-code/testing'
import type { BoardAgent, BoardTask } from './types'
import { cutName } from './hooks/agent-rows'
import { NEEDS_YOU_AFTER_MS, withAgentPlan } from './hooks/agents'
import { maskedCredentials } from './hooks/credentials'

const ROOT = '/work/app'
const PANE = 'tasks'
const PLUGIN = 'handily-board'
const TOOL_ADD = 'mcp__handily-board__task_add'
const TOOL_UPDATE = 'mcp__handily-board__task_update'
const MINUTE = 60_000
const START = Date.UTC(2026, 9, 13, 10, 0)
const SURFACES = ['terminal', 'desktop'] as const

type Surface = (typeof SURFACES)[number]

const fakeWorkitems: Plugin = {
  name: 'handily-workitems',
  register(on) {
    on('engine.create', async (_$, e, next) => {
      const built = await next(e)
      return {
        ...built,
        workitems: {
          refresh: () =>
            Promise.resolve({ created: [], updated: [], closed: [], version: 1, state: 'read' }),
          writeVerbs: () => Promise.reject(new Error('the fake workitems has no write verbs')),
          classify: () => Promise.reject(new Error('the fake workitems classifies no command')),
          trackerFile: () => Promise.reject(new Error('the fake workitems names no tracker file')),
          lines: () => Promise.resolve([]),
        },
      }
    })
  },
}

const withWorkitems = { plugins: [fakeWorkitems] }

type Flight = { arrived: (count: number) => Promise<void>; release: () => void }

type World = {
  agents: AgentInfo[]
  clock: MockClock
  held: Map<string, Flight>
  runs: string[]
  isRefused: boolean
  toasts: string[]
  logs: string[]
}

type Hold = { flight: Flight; arrive: () => void; gate: Promise<void> }

function hold(): Hold {
  let calls = 0
  const waiters: { count: number; resolve: () => void }[] = []
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const arrive = () => {
    calls += 1
    for (const waiter of waiters) if (waiter.count <= calls) waiter.resolve()
  }
  const flight: Flight = {
    arrived: (count) =>
      new Promise<void>((resolve) => {
        if (calls >= count) resolve()
        else waiters.push({ count, resolve })
      }),
    release: () => {
      release()
    },
  }
  return { flight, arrive, gate }
}

const FRESH_USAGE: SessionUsage = {
  startedAt: START,
  context: { window: 200_000 },
  rateLimits: [],
  cost: { usd: 0 },
}

function world(on: On, heldTools: readonly string[] = []): World {
  const holds = new Map(heldTools.map((tool) => [tool, hold()]))
  const state: World = {
    agents: [],
    clock: mock.clock(on, { now: START }),
    held: new Map([...holds].map(([tool, one]) => [tool, one.flight])),
    runs: [],
    isRefused: false,
    toasts: [],
    logs: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: FRESH_USAGE }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: ROOT }))
  on('agent.list', () => ({ value: state.agents }))
  on('agent.spawn', (_$, e) => ({ model: 'opus', agentId: e.tool_use_id.slice('spawn:'.length) }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__handily-board__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const open = new Set<string>()
  on('ui.open', (_$, e) => {
    open.add(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({
    value: [...open].map((id) => ({
      id,
      title: id,
      isShown: id === PANE,
      isFocused: false,
      isPlaced: true,
    })),
  }))
  on('ui.toast', (_$, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    state.logs.push(e.text)
    return { value: undefined }
  })
  on('command.run', { command: 'tasks' }, (_$, e, next) => {
    state.runs.push(`${e.command} ${e.args}`.trim())
    if (state.isRefused) return next(e)
    return { text: '' }
  })
  on('tool.call', async (_$, e) => {
    const held = holds.get(e.tool)
    if (held === undefined) return { result: '' }
    held.arrive()
    await held.gate
    return { result: 'released' }
  })
  return state
}

function flightOf(seen: World, tool: string): Flight {
  const flight = seen.held.get(tool)
  if (flight === undefined) throw new Error(`the world holds no ${tool} calls`)
  return flight
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

async function openBoard($: Engine): Promise<void> {
  await $.command.run({
    command: 'board',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
}

type SpawnOptions = { name?: string; parentAgentId?: string }

async function spawn(
  $: Engine,
  id: string,
  type: string,
  description: string,
  options: SpawnOptions = {},
): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `spawn:${id}`,
    prompt: description,
    description,
    subagentType: type,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
    ...options,
  })
}

function listed(
  id: string,
  type: string,
  status: AgentInfo['status'],
  options: { name?: string; parentId?: string; description?: string } = {},
): AgentInfo {
  const { description = '', ...rest } = options
  return { id, type, status, description, ...rest }
}

function inLoop(input: ToolCallArgs, agentId: string): ToolCallArgs {
  return Object.assign({}, input, { agentId })
}

async function bashAs($: Engine, agentId: string, command: string): Promise<void> {
  await $.tool.call(inLoop({ tool: 'Bash', command }, agentId))
}

function paneProps(placement: 'dock' | 'inline', bodyColumns: number): RenderPropsOf['Pane'] {
  return {
    title: 'this session',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  }
}

async function mountTab(
  $: Engine,
  surface: Surface,
  placement: 'dock' | 'inline',
  columns: number,
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
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
      ? props.label
      : `${own}${children.map((child) => child.text).join('')}`
  return { type: value.type, props, text, children }
}

function numberProp(element: Drawn, name: string): number {
  const value = element.props[name]
  return typeof value === 'number' ? value : 0
}

function drawnWidth(element: Drawn): number {
  if (element.type === 'Text') return element.text.length
  if (element.type === 'Button') {
    const label =
      typeof element.props.label === 'string'
        ? element.text.length
        : element.children.reduce((sum, child) => sum + drawnWidth(child), 0)
    return element.props.plain === true ? label : label + 4
  }
  const inner =
    typeof element.props.width === 'number'
      ? element.props.width
      : element.children.reduce((sum, child) => sum + drawnWidth(child), 0)
  return inner + numberProp(element, 'marginLeft') + numberProp(element, 'paddingLeft')
}

function texts(element: Drawn): Drawn[] {
  if (element.type === 'Text') return [element]
  return element.children.flatMap(texts)
}

function screenOf(element: Drawn, width: number): string[] {
  if (element.type === 'Text') return [element.text]
  if (element.type === 'Button') {
    return [element.props.plain === true ? element.text : `[ ${element.text} ]`]
  }
  if (element.type === 'Input') {
    return [`[ ${String(element.props.placeholder)} ][${String(element.props.submitLabel)}]`]
  }
  const indent = numberProp(element, 'paddingLeft') + numberProp(element, 'marginLeft')
  const inner = width - indent
  const lines =
    element.props.flexDirection === 'column'
      ? element.children.flatMap((child) => screenOf(child, inner))
      : [rowLine(element.children, inner)]
  return lines.map((line) => `${' '.repeat(indent)}${line}`)
}

function rowLine(children: readonly Drawn[], width: number): string {
  const fixed = children
    .filter((child) => child.props.flexGrow !== 1)
    .reduce((sum, child) => sum + drawnWidth(child), 0)
  return children
    .map((child) => {
      const room = child.props.flexGrow === 1 ? width - fixed : drawnWidth(child)
      return screenOf(child, room).join('').padEnd(room)
    })
    .join('')
}

async function screen(ui: { find: Mounted['find'] }, columns: number): Promise<string[]> {
  const root = drawnOf(await ui.find({ type: 'Box' }))
  if (root === null) throw new Error('the pane drew no Box')
  const lines = screenOf(root, columns).map((line) => line.trimEnd())
  for (const line of lines) {
    expect(line.length <= columns, `"${line}" is wider than ${String(columns)}`).toBe(true)
  }
  return lines
}

function agentLines(lines: readonly string[]): string[] {
  const first = lines.findIndex((line) => line.startsWith('Agents'))
  const input = lines.findIndex((line) => line.startsWith('[ Add a task'))
  return lines.slice(first, input)
}

async function textsUnder(ui: { find: Mounted['find'] }, key: string): Promise<string[]> {
  const found = drawnOf(await ui.find({ key }))
  return found === null ? [] : texts(found).map((one) => one.text)
}

const LANE = 'a0000001lane'
const SCOUT = 'a0000002scout'
const EXPLORE = 'a0000003explore'
const PLAN = 'a0000004plan'
const REVIEW = 'a0000005review'
const PLAN_TITLES = [
  'Read the design',
  'Map the hooks',
  'Draw the plan',
  'Test the fold',
  'Bump the version',
  'Write the notes',
  'Ask for review',
]

type Scene = { seen: World; flights: Flight[]; calls: Promise<ToolCallResult>[] }

async function mockScene($: Engine, on: On): Promise<Scene> {
  const seen = world(on, ['Agent', 'Read'])
  const agentCall = flightOf(seen, 'Agent')
  const read = flightOf(seen, 'Read')
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'cat docs/design.md' })
  for (const title of ['Read the design', 'Write the tab mocks', 'Review the mocks with Codex']) {
    await $.tool.call({ tool: TOOL_ADD, title })
  }
  await $.tool.call({ tool: TOOL_ADD, title: 'Ask the person about tabs' })
  await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed' })
  await seen.clock.advance(10 * MINUTE)
  await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'in_progress' })
  for (let index = 0; index < 9; index += 1) {
    await $.tool.call({
      tool: 'Edit',
      file_path: `${ROOT}/docs/mocks.md`,
      old_string: 'a',
      new_string: 'b',
    })
  }
  await spawn($, LANE, 'general-purpose', 'run the unit tests', { name: 'lane-b' })
  await bashAs($, LANE, 'npm test')
  await spawn($, PLAN, 'Plan', 'plan the release')
  await spawn($, REVIEW, 'code-reviewer', 'review the board')
  await seen.clock.advance(2 * MINUTE)
  await spawn($, SCOUT, 'general-purpose', 'scout the hooks', { name: 'scout' })
  const scoutCall = $.tool.call(
    inLoop(
      {
        tool: 'Agent',
        description: 'find the element table',
        prompt: 'find the element table',
        subagent_type: 'Explore',
      },
      SCOUT,
    ),
  )
  await agentCall.arrived(1)
  await seen.clock.advance(MINUTE)
  await spawn($, EXPLORE, 'Explore', 'find the element table', { parentAgentId: SCOUT })
  for (const title of PLAN_TITLES) {
    await $.tool.call({ tool: TOOL_ADD, title, agentId: EXPLORE })
  }
  await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed', agentId: EXPLORE })
  await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'completed', agentId: EXPLORE })
  await $.tool.call({ tool: TOOL_UPDATE, id: 3, status: 'in_progress', agentId: EXPLORE })
  for (let index = 0; index < 7; index += 1) {
    await bashAs($, EXPLORE, `cat hooks/file${String(index)}.ts`)
  }
  const readCall = $.tool.call(inLoop({ tool: 'Read', file_path: `${ROOT}/pane.tsx` }, EXPLORE))
  await read.arrived(1)
  await seen.clock.advance(MINUTE)
  seen.agents.push(
    listed(LANE, 'general-purpose', 'failed', {
      name: 'lane-b',
      description: 'run the unit tests',
    }),
    listed(PLAN, 'Plan', 'completed', { description: 'plan the release' }),
    listed(REVIEW, 'code-reviewer', 'completed', { description: 'review the board' }),
    listed(SCOUT, 'general-purpose', 'waiting', { name: 'scout', description: 'scout the hooks' }),
    listed(EXPLORE, 'Explore', 'running', {
      parentId: SCOUT,
      description: 'find the element table',
    }),
  )
  return { seen, flights: [agentCall, read], calls: [scoutCall, readCall] }
}

async function land(scene: Scene): Promise<void> {
  for (const flight of scene.flights) flight.release()
  await Promise.all(scene.calls)
}

const ROW_CRITERION =
  'The this session tab draws an agent row with its mark, name, state, current tool and age, failed agents with a second line, and held agents as on hold'

const SCENE_SCREENS: readonly {
  placement: 'dock' | 'inline'
  columns: number
  lines: readonly string[]
}[] = [
  {
    placement: 'dock',
    columns: 41,
    lines: [
      'Session  ctx — until the first reply',
      'Tasks  1 of 4 done · 14m',
      '▶ 2 Write the tab mocks         4m [ rm ]',
      '    ▸ Edit docs/mocks.md          9 tools',
      '○ 3 Review the mocks with Codex    [ rm ]',
      '○ 4 Ask the person about tabs      [ rm ]',
      '[ +1 done ]',
      '─────────────────────────────────────────',
      'Agents  3 · 1 failed',
      '■ lane-b    failed                     4m',
      '    failed after Bash npm test',
      '▶ Explore   plan 2/7  ▸ Read pa… open  1m',
      '▶ scout     on hold   ▸ Agent find t…  2m',
      '[ +2 ended ]',
      '',
      '[ Add a task ][Add]',
    ],
  },
  {
    placement: 'dock',
    columns: 30,
    lines: [
      'Session  ctx —',
      'Tasks  1 of 4 done · 14m',
      '▶ 2 Write the tab m… 4m [ rm ]',
      '    ▸ Edit docs/mocks… 9 tools',
      '○ 3 Review the mocks w… [ rm ]',
      '○ 4 Ask the person abo… [ rm ]',
      '[ +1 done ]',
      '──────────────────────────────',
      'Agents  3 · 1 failed',
      '■ lane-b    failed          4m',
      '    failed after Bash npm test',
      '▶ Explore   plan 2/7  open  1m',
      '▶ scout     on hold         2m',
      '[ +2 ended ]',
      '',
      '[ Add a task ][Add]',
    ],
  },
  {
    placement: 'inline',
    columns: 76,
    lines: [
      'Session  ctx — until the first reply',
      'Tasks  1 of 4 done · 14m',
      '▶ 2 Write the tab mocks             ▸ Edit docs/mocks.md · 9 tools 4m [ rm ]',
      '○ 3 Review the mocks with Codex                                       [ rm ]',
      '○ 4 Ask the person about tabs                                         [ rm ]',
      '[ +1 done ]',
      'Agents  3 · 1 failed',
      '■ lane-b     failed     failed after Bash npm test                        4m',
      '▶ Explore    plan 2/7   ▸ Read pane.tsx                             open  1m',
      '▶ scout      on hold    ▸ Agent find the element table                    2m',
      '[ +2 ended ]',
      '',
      '[ Add a task ][Add]',
    ],
  },
]

describe(ROW_CRITERION, () => {
  for (const { placement, columns, lines } of SCENE_SCREENS) {
    test(
      `the agent rows draw as mock 8.1a at ${String(columns)} columns, ${placement}`,
      withWorkitems,
      async ($, on) => {
        const scene = await mockScene($, on)
        for (const surface of SURFACES) {
          const ui = await mountTab($, surface, placement, columns)
          expect(await screen(ui, columns)).toEqual(lines)
          await ui.unmount()
        }
        await land(scene)
      },
    )
  }

  test(
    'each mark and state word takes the colour of its signal, and the failed count is red',
    withWorkitems,
    async ($, on) => {
      const scene = await mockScene($, on)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const look = async (id: string) => {
          const row = drawnOf(await ui.find({ key: `row:agent:${id}` }))
          const [mark, name, state] = row === null ? [] : texts(row)
          return [mark?.text, mark?.props.color, name?.props.bold, state?.text, state?.props.color]
        }
        expect(await look(LANE)).toEqual(['■ ', 'error', true, 'failed', 'error'])
        expect(await look(SCOUT)).toEqual(['▶ ', 'claude', true, 'on hold', 'claude'])
        expect(await look(EXPLORE)).toEqual(['▶ ', 'claude', true, 'plan 2/7', undefined])
        expect((await ui.find({ type: 'Text', text: '1 failed' }))?.props.color).toBe('error')
        await ui.press({ key: 'group:ended-agents' })
        expect(await look(PLAN)).toEqual(['✓ ', 'success', true, 'done', 'success'])
        await ui.press({ key: 'group:ended-agents' })
        await ui.unmount()
      }
      await land(scene)
    },
  )

  test(
    'a pending or idle agent draws as to do, a killed one as done, and the ended fold opens below its button',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      seen.agents.push(
        listed('b1', 'Explore', 'pending'),
        listed('b2', 'Plan', 'idle'),
        listed('b3', 'code-reviewer', 'killed'),
        listed('b4', 'implementer', 'completed'),
      )
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        expect(agentLines(await screen(ui, 41))).toEqual([
          'Agents  2',
          '○ Explore   pending                    0s',
          '○ Plan      idle                       0s',
          '[ +2 ended ]',
          '',
        ])
        await ui.press({ key: 'group:ended-agents' })
        expect(agentLines(await screen(ui, 41))).toEqual([
          'Agents  2',
          '○ Explore   pending                    0s',
          '○ Plan      idle                       0s',
          '[ hide 2 ended ]',
          '✓ code…ewer killed                     0s',
          '✓ impl…nter done                       0s',
          '',
        ])
        await ui.press({ key: 'group:ended-agents' })
        await ui.unmount()
      }
      seen.agents.splice(0, seen.agents.length, listed('b4', 'implementer', 'completed'))
      const ended = await mountTab($, 'terminal', 'dock', 41)
      expect(agentLines(await screen(ended, 41)).slice(0, 2)).toEqual([
        'Agents  all 1 done',
        '[ +1 ended ]',
      ])
      await ended.unmount()
    },
  )
})

const OPEN_CRITERION =
  'When the person presses an agent name, the row opens with its description, parent, spawn age, tool count and plan, and repeats no field of the row'

describe(OPEN_CRITERION, () => {
  test(
    'the Explore row opens as mock 8.2b, and all 7 shows the whole plan',
    withWorkitems,
    async ($, on) => {
      const scene = await mockScene($, on)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: `open:agent:${EXPLORE}` })
        const lines = agentLines(await screen(ui, 41))
        expect(lines.slice(3, 14)).toEqual([
          '▶ Explore   plan 2/7  ▸ Read pa… open  1m',
          '    find the element table',
          '    under scout · spawned 1m ago',
          '    7 tool calls',
          '    ✓ Read the design',
          '    ✓ Map the hooks',
          '    ▶ Draw the plan',
          '    ○ Test the fold',
          '    ○ Bump the version',
          '    [ all 7 ]',
          '▶ scout     on hold   ▸ Agent find t…  2m',
        ])
        const opened = await textsUnder(ui, `under:agent:${EXPLORE}`)
        for (const field of ['Explore', 'plan 2/7', 'pane.tsx', 'on hold']) {
          expect(opened.some((text) => text.includes(field))).toBe(false)
        }
        await ui.press({ key: `plan:${EXPLORE}` })
        expect(agentLines(await screen(ui, 41)).slice(7, 17)).toEqual([
          '    ✓ Read the design',
          '    ✓ Map the hooks',
          '    ▶ Draw the plan',
          '    ○ Test the fold',
          '    ○ Bump the version',
          '    ○ Write the notes',
          '    ○ Ask for review',
          '    [ fold ]  all 7 shown',
          '▶ scout     on hold   ▸ Agent find t…  2m',
          '[ +2 ended ]',
        ])
        await ui.press({ key: `plan:${EXPLORE}` })
        await ui.press({ key: `open:agent:${EXPLORE}` })
        expect(await ui.find({ key: `under:agent:${EXPLORE}` })).toBeUndefined()
        await ui.unmount()
      }
      await land(scene)
    },
  )

  test(
    'a main loop agent opens under main, a failed one keeps its one failure line, and a plan of 5 shows no button',
    withWorkitems,
    async ($, on) => {
      const scene = await mockScene($, on)
      for (const title of PLAN_TITLES.slice(0, 5)) {
        await $.tool.call({ tool: TOOL_ADD, title, agentId: SCOUT })
      }
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: `open:agent:${SCOUT}` })
        expect(await textsUnder(ui, `under:agent:${SCOUT}`)).toEqual([
          'scout the hooks',
          'under main · spawned 2m ago',
          'no tool calls yet',
          '○ ',
          'Read the design',
          '○ ',
          'Map the hooks',
          '○ ',
          'Draw the plan',
          '○ ',
          'Test the fold',
          '○ ',
          'Bump the version',
        ])
        expect(await ui.find({ key: `plan:${SCOUT}` })).toBeUndefined()
        await ui.press({ key: `open:agent:${LANE}` })
        expect(await textsUnder(ui, `under:agent:${LANE}`)).toEqual([
          'failed after Bash npm test',
          'run the unit tests',
          'under main · spawned 4m ago',
          '1 tool call',
        ])
        await ui.press({ key: `open:agent:${SCOUT}` })
        await ui.press({ key: `open:agent:${LANE}` })
        await ui.unmount()
      }
      await land(scene)
    },
  )

  test(
    'a description that equals the shown name is not repeated, and an agent seen first in the list says first seen',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      seen.agents.push(listed('c1', 'Explore', 'running', { description: 'Explore' }))
      await seen.clock.advance(MINUTE)
      const ui = await mountTab($, 'desktop', 'dock', 41)
      await ui.press({ key: 'open:agent:c1' })
      expect(await textsUnder(ui, 'under:agent:c1')).toEqual([
        'under main · first seen 0s ago',
        'no tool calls yet',
      ])
      await ui.unmount()
    },
  )
})

const OPEN_BUTTON_CRITERION =
  'When the person presses the open button on a running agent row of the this session tab, handily-board runs the tasks command once through the command API'

describe(OPEN_BUTTON_CRITERION, () => {
  test(
    'one press on the Explore row runs the tasks command once, and only the running row has the button',
    withWorkitems,
    async ($, on) => {
      const scene = await mockScene($, on)
      const { seen } = scene
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const before = seen.runs.length
        await ui.press({ key: `tasks:agent:${EXPLORE}` })
        expect(seen.runs.slice(before)).toEqual(['tasks'])
        for (const id of [LANE, SCOUT]) {
          expect(await ui.find({ key: `tasks:agent:${id}` })).toBeUndefined()
        }
        await ui.press({ key: 'group:ended-agents' })
        for (const id of [PLAN, REVIEW]) {
          expect(await ui.find({ key: `row:agent:${id}` })).toBeDefined()
          expect(await ui.find({ key: `tasks:agent:${id}` })).toBeUndefined()
        }
        await ui.press({ key: 'group:ended-agents' })
        await ui.unmount()
      }
      await land(scene)
    },
  )

  test('a refused run is logged and named in a toast', withWorkitems, async ($, on) => {
    const seen = world(on)
    await start($)
    await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
    seen.agents.push(listed('d1', 'Explore', 'running'))
    seen.isRefused = true
    const ui = await mountTab($, 'terminal', 'dock', 41)
    await ui.press({ key: 'tasks:agent:d1' })
    expect(seen.runs).toEqual(['tasks'])
    expect(seen.logs.filter((text) => text.includes('the agents view did not open'))).toHaveLength(
      1,
    )
    expect(seen.toasts).toEqual([
      'handily-board: the agents view did not open; see the transcript log.',
    ])
    await ui.unmount()
  })
})

const NO_OPEN_CRITERION =
  'When no agent of this session runs, the this session tab draws no open button'

describe(NO_OPEN_CRITERION, () => {
  test(
    'pending, idle, held, failed, killed and done agents draw no open button',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      const statuses: AgentInfo['status'][] = [
        'pending',
        'idle',
        'waiting',
        'failed',
        'killed',
        'completed',
      ]
      seen.agents.push(
        ...statuses.map((status, index) => listed(`e${String(index)}`, 'Plan', status)),
      )
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'group:ended-agents' })
        for (const index of statuses.keys()) {
          const id = `e${String(index)}`
          expect(await ui.find({ key: `row:agent:${id}` })).toBeDefined()
          expect(await ui.find({ key: `tasks:agent:${id}` })).toBeUndefined()
        }
        expect(await ui.find({ type: 'Button', text: 'open' })).toBeUndefined()
        await ui.press({ key: 'group:ended-agents' })
        await ui.unmount()
      }
    },
  )
})

const FOLD_CRITERION =
  'When more than 6 agents are active, the tab draws 6 rows, failed ones first, and folds the rest, so the Add input stays visible at 41 columns'

async function manyAgents($: Engine, on: On): Promise<void> {
  const seen = world(on)
  await start($)
  await $.tool.call({ tool: TOOL_ADD, title: 'Write the tab mocks' })
  for (let index = 1; index <= 15; index += 1) {
    const id = `d${String(index).padStart(2, '0')}`
    await spawn($, id, 'Explore', `explore part ${String(index)}`)
    seen.agents.push(listed(id, 'Explore', 'running'))
  }
  for (let index = 1; index <= 5; index += 1) {
    const id = `e${String(index)}`
    await spawn($, id, 'Plan', `plan part ${String(index)}`)
    seen.agents.push(listed(id, 'Plan', 'completed'))
  }
  await seen.clock.advance(MINUTE)
  await spawn($, 'f1', 'general-purpose', 'run the tests', { name: 'lane-b' })
  await bashAs($, 'f1', 'npm test')
  seen.agents.push(listed('f1', 'general-purpose', 'failed', { name: 'lane-b' }))
}

describe(FOLD_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `16 active agents fold to 6 rows on ${surface}, the failed one first`,
      withWorkitems,
      async ($, on) => {
        await manyAgents($, on)
        const ui = await mountTab($, surface, 'dock', 41)
        expect(await screen(ui, 41)).toEqual([
          'Session  ctx — until the first reply',
          'Tasks  0 of 1 done',
          '○ 1 Write the tab mocks            [ rm ]',
          '─────────────────────────────────────────',
          'Agents  16 · 1 failed',
          '■ lane-b    failed                     0s',
          '    failed after Bash npm test',
          '▶ Explore   running              open  1m',
          '▶ Explore 2 running              open  1m',
          '▶ Explore 3 running              open  1m',
          '▶ Explore 4 running              open  1m',
          '▶ Explore 5 running              open  1m',
          '[ +10 more agents ]  [ +5 ended ]',
          '',
          '[ Add a task ][Add]',
        ])
        await ui.press({ key: 'group:more-agents' })
        const lines = await screen(ui, 41)
        expect(lines.filter((line) => line.startsWith('▶ Expl'))).toHaveLength(15)
        expect(lines.slice(-4)).toEqual([
          '▶ Expl…e 15 running              open  1m',
          '[ hide 10 more agents ]  [ +5 ended ]',
          '',
          '[ Add a task ][Add]',
        ])
        await ui.press({ key: 'group:more-agents' })
        await ui.unmount()
        const narrow = await mountTab($, surface, 'dock', 30)
        expect((await screen(narrow, 30)).slice(-5)).toEqual([
          '▶ Explore 5 running   open  1m',
          '[ +10 more agents ]',
          '[ +5 ended ]',
          '',
          '[ Add a task ][Add]',
        ])
        await narrow.unmount()
      },
    )
  }
})

describe('an agent spawned before the list names it', () => {
  test('keeps its spawn time and its row past 20 such spawns', withWorkitems, async ($, on) => {
    const seen = world(on)
    await start($)
    await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
    for (let index = 1; index <= 22; index += 1) {
      await spawn($, `k${String(index).padStart(2, '0')}`, 'Explore', `part ${String(index)}`)
    }
    await seen.clock.advance(3 * MINUTE)
    const ui = await mountTab($, 'terminal', 'dock', 41)
    await ui.press({ key: 'group:ended-agents' })
    await ui.press({ key: 'open:agent:k01' })
    expect(await textsUnder(ui, 'under:agent:k01')).toEqual([
      'part 1',
      'under main · spawned 3m ago',
      'no tool calls yet',
    ])
    expect(await ui.find({ key: 'row:agent:k22' })).toBeDefined()
    await ui.unmount()
  })
})

const UNLISTED_CRITERION =
  'An agent that the engine no longer lists but that still has a call in flight stays with the active agents'

describe(UNLISTED_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `a loop with a call in flight stays active and an idle one goes under ended, on ${surface}, as mock 8.2c`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, ['AskUserQuestion'])
        const ask = flightOf(seen, 'AskUserQuestion')
        await start($)
        await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
        await spawn($, 'g1', 'Explore', 'find the element table')
        await bashAs($, 'g1', 'cat a.ts')
        seen.agents.push(listed('g1', 'Explore', 'running'))
        await bashAs($, 'f0000009aaaa', 'ls')
        await openBoard($)
        const shown = await mountTab($, surface, 'dock', 41)
        await seen.clock.advance(5 * MINUTE)
        await shown.unmount()
        const flight = $.tool.call(
          inLoop({ tool: 'AskUserQuestion', questions: [] }, 'f0000010bbbb'),
        )
        await ask.arrived(1)
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'group:ended-agents' })
        expect(agentLines(await screen(ui, 41))).toEqual([
          'Agents  1 · 2 not listed',
          '▶ Explore   running   Bash cat … open  5m',
          '? f0000010  not listed ▸ AskUserQues…  0s',
          '[ hide 1 ended ]',
          '? f0000009  not listed Bash ls         0s',
          '',
        ])
        seen.agents.splice(0)
        const dropped = $.tool.call(inLoop({ tool: 'AskUserQuestion', questions: [] }, 'g1'))
        await ask.arrived(2)
        await ui.press({ key: 'group:ended-agents' })
        expect(agentLines(await screen(ui, 41)).slice(0, 4)).toEqual([
          'Agents  3 not listed',
          '? Explore   not listed ▸ AskUserQues…  5m',
          '? f0000010  not listed ▸ AskUserQues…  0s',
          '[ +1 ended ]',
        ])
        await ui.unmount()
        ask.release()
        await flight
        await dropped
        const settled = await mountTab($, surface, 'dock', 41)
        expect(agentLines(await screen(settled, 41))).toEqual([
          'Agents  3 not listed',
          '[ +3 ended ]',
          '',
        ])
        await settled.unmount()
      },
    )
  }
})

const NAME_CRITERION =
  'A long agent name is cut in the middle, and two cut names that look alike get a number'

describe(NAME_CRITERION, () => {
  for (const surface of SURFACES) {
    test(`names cut as 8.0 says on ${surface}`, withWorkitems, async ($, on) => {
      const seen = world(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      const types = [
        'general-purpose',
        'implementer',
        'code-reviewer',
        'Explore',
        'Explore',
        'general-purpose',
      ]
      for (const [index, type] of types.entries()) {
        const id = `h${String(index)}`
        await spawn($, id, type, `part ${String(index)}`)
        await seen.clock.advance(1_000)
        seen.agents.push(listed(id, type, 'running'))
      }
      const ui = await mountTab($, surface, 'dock', 41)
      expect(agentLines(await screen(ui, 41)).slice(1, 7)).toEqual([
        '▶ gene…pose running              open  6s',
        '▶ impl…nter running              open  5s',
        '▶ code…ewer running              open  4s',
        '▶ Explore   running              open  3s',
        '▶ Explore 2 running              open  2s',
        '▶ gene…se 2 running              open  1s',
      ])
      await ui.unmount()
    })
  }

  test('the agents state carries the label the board draws', withWorkitems, async ($, on) => {
    const seen = world(on)
    const stored: (readonly BoardAgent[])[] = []
    on('state.set', { plugin: 'handily-board', key: 'agents' }, (_$, e, next) => {
      stored.push(e.value)
      return next(e)
    })
    await start($)
    await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
    for (const [index, type] of ['general-purpose', 'Explore', 'general-purpose'].entries()) {
      const id = `s${String(index)}`
      await spawn($, id, type, `part ${String(index)}`)
      await seen.clock.advance(1_000)
      seen.agents.push(listed(id, type, 'running'))
    }
    expect(stored.at(-1)?.map((agent) => [agent.id, agent.label])).toEqual([
      ['s0', 'gene…pose'],
      ['s1', 'Explore'],
      ['s2', 'gene…se 2'],
    ])
  })

  test(
    'a name with a line separator is escaped and cut on its one line',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      seen.agents.push(listed('i1', 'Explore', 'running', { name: 'a\u2028b' }))
      const ui = await mountTab($, 'terminal', 'dock', 41)
      expect(agentLines(await screen(ui, 41))[1]).toBe('▶ a\\u2028b  running              open  0s')
      expect(await ui.find({ type: 'Text', text: /\u2028/ })).toBeUndefined()
      await ui.unmount()
    },
  )

  test('a cut name keeps a whole keycap at its end or none of it', () => {
    const name = 'abcdef1\u{FE0F}\u{20E3}'
    expect(cutName(name, 6)).toBe('abcd…')
    expect(cutName(name, 7)).toBe('abcd…1\u{FE0F}\u{20E3}')
  })
})

const askingPlugin: Plugin = {
  name: 'asking-plugin',
  register(on) {
    on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
      await $.ui
        .ask('May the tracker run?', ['Not now', 'Allow'])
        .catch((error: unknown) => `refused: ${String(error)}`)
      if (e.agentId !== undefined) {
        await $.tool.call(
          Object.assign(
            {},
            { tool: 'Read' as const, file_path: '/work/app/raised.ts' },
            { agentId: e.agentId },
          ),
        )
      }
      return next(e)
    })
  },
}

const ORIGIN_CRITERION =
  'A tool call that a plugin raises, such as the AskUserQuestion of $.ui.ask, counts as no agent work: only calls whose next.origin.plugin is engine move an agent row'

describe(ORIGIN_CRITERION, () => {
  test(
    'the AskUserQuestion of $.ui.ask and a Read that a plugin raises inside a subagent call neither count nor show on the agent row',
    { plugins: [fakeWorkitems, askingPlugin] },
    async ($, on) => {
      const seen = world(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      await spawn($, 'j1', 'Explore', 'find the element table')
      seen.agents.push(listed('j1', 'Explore', 'running'))
      await bashAs($, 'j1', 'grep -rn Pane hooks')
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        expect(agentLines(await screen(ui, 41))).toEqual([
          'Agents  1',
          '▶ Explore   running   Bash grep… open  0s',
          '',
        ])
        await ui.press({ key: 'open:agent:j1' })
        expect(await textsUnder(ui, 'under:agent:j1')).toEqual([
          'find the element table',
          'under main · spawned 0s ago',
          '1 tool call',
        ])
        await ui.press({ key: 'open:agent:j1' })
        expect(await ui.find({ type: 'Text', text: /AskUserQuestion|raised/ })).toBeUndefined()
        await ui.unmount()
      }
    },
  )
})

const RING_MARK = 0xe000

function ringMarked(element: Drawn, count: { buttons: number }): Drawn {
  if (element.type === 'Button') {
    const mark = String.fromCodePoint(RING_MARK + count.buttons)
    count.buttons += 1
    return { ...element, text: mark.repeat(element.text.length) }
  }
  return { ...element, children: element.children.map((child) => ringMarked(child, count)) }
}

type Ring = { keys: string[]; read: string[]; inputs: string[] }

function isOutOfFlow(element: Drawn): boolean {
  const direction = element.props.flexDirection
  const isReversed = typeof direction === 'string' && direction.endsWith('-reverse')
  return isReversed || element.props.position === 'absolute'
}

function outOfFlow(element: Drawn): Drawn[] {
  return [...(isOutOfFlow(element) ? [element] : []), ...element.children.flatMap(outOfFlow)]
}

async function ringOf(ui: Pick<Mounted, 'find' | 'findAll'>, columns: number): Promise<Ring> {
  const root = drawnOf(await ui.find({ type: 'Box' }))
  if (root === null) throw new Error('the pane drew no Box')
  expect(outOfFlow(root), 'a reversed or absolute Box draws out of document order').toEqual([])
  const count = { buttons: 0 }
  const marks = screenOf(ringMarked(root, count), columns)
    .flatMap((line) => Array.from(line))
    .map((character) => (character.codePointAt(0) ?? 0) - RING_MARK)
    .filter((index) => index >= 0 && index < count.buttons)
  const keys = (await ui.findAll({ type: 'Button' })).map((button) => button.key ?? '')
  const read = [...new Set(marks)].map((index) => keys[index] ?? '')
  const inputs = (await ui.findAll({ type: 'Input' })).map((input) => input.key ?? '')
  return { keys, read, inputs }
}

const RING_CRITERION =
  'When a board tab has the keyboard, Tab reaches every Button on it in reading order and Enter presses it, on terminal and desktop'

const OPENED_ONLY = ['done:3', 'start:3', 'up:3:2', 'down:3:2', `plan:${EXPLORE}`]

const SCENE_RING = [
  'session',
  'open:task:2',
  'rm:2',
  'open:task:3',
  'rm:3',
  'done:3',
  'start:3',
  'up:3:2',
  'down:3:2',
  'open:task:4',
  'rm:4',
  'done',
  `open:agent:${LANE}`,
  `open:agent:${EXPLORE}`,
  `tasks:agent:${EXPLORE}`,
  `plan:${EXPLORE}`,
  `open:agent:${SCOUT}`,
  'group:ended-agents',
]

describe(RING_CRITERION, () => {
  test(
    'the this session tab draws each Button once, under its own key, in the order a person reads the tab, before the Add input',
    withWorkitems,
    async ($, on) => {
      const scene = await mockScene($, on)
      for (const surface of SURFACES) {
        for (const { placement, columns } of SCENE_SCREENS) {
          const ui = await mountTab($, surface, placement, columns)
          await ui.press({ key: 'open:task:3' })
          await ui.press({ key: `open:agent:${EXPLORE}` })
          const ring = await ringOf(ui, columns)
          expect(ring.keys).toEqual(SCENE_RING)
          expect(ring.read).toEqual(ring.keys)
          expect(ring.inputs).toEqual(['add'])
          await ui.press({ key: `open:agent:${EXPLORE}` })
          await ui.press({ key: 'open:task:3' })
          const closed = await ringOf(ui, columns)
          expect(closed.keys).toEqual(SCENE_RING.filter((key) => !OPENED_ONLY.includes(key)))
          expect(closed.read).toEqual(closed.keys)
          await ui.unmount()
        }
      }
      await land(scene)
    },
  )

  test(
    'unfolding the done and ended folds adds their rows after the fold, in reading order',
    withWorkitems,
    async ($, on) => {
      const scene = await mockScene($, on)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'done' })
        await ui.press({ key: 'group:ended-agents' })
        const ring = await ringOf(ui, 41)
        expect(ring.read).toEqual(ring.keys)
        expect(new Set(ring.keys).size).toBe(ring.keys.length)
        const done = ring.keys.indexOf('done')
        expect(ring.keys.slice(done, done + 2)).toEqual(['done', 'open:task:1'])
        expect(ring.keys.slice(-3)).toEqual([
          'group:ended-agents',
          `open:agent:${PLAN}`,
          `open:agent:${REVIEW}`,
        ])
        await ui.press({ key: 'done' })
        await ui.press({ key: 'group:ended-agents' })
        await ui.unmount()
      }
      await land(scene)
    },
  )
})

const CHECK_ENGINE_CRITERION =
  'The keyboard ring tests, the needs you tests and the checks tests run on an engine that raises tool.check for a tool call of a test, so a missing session Button names its cause'

const OLD_ENGINE =
  'this engine raises no tool.check for a tool call of a test, so the board keeps no check and the Session line is no Button: run the tests on the Claude Code version that .github/workflows/basicly-gates.yml pins'

describe(CHECK_ENGINE_CRITERION, () => {
  test(
    'a subagent call of a test reaches tool.check from the engine, and the kept check makes the Session line a Button',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const raised: string[] = []
      on('tool.check', async (_$, e, next) => {
        const verdict = await next(e)
        raised.push(next.origin.plugin)
        return verdict
      })
      await start($)
      await spawn($, SCOUT, 'general-purpose', 'scout the hooks', { name: 'scout' })
      seen.agents.push(listed(SCOUT, 'general-purpose', 'running', { name: 'scout' }))
      await bashAs($, SCOUT, 'npm test')
      expect(raised, OLD_ENGINE).toEqual(['engine'])
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        expect(await ui.find({ type: 'Button', key: 'session' }), OLD_ENGINE).toBeDefined()
        await ui.unmount()
      }
    },
  )
})

const KEYBOARD_PLAN_CRITERION =
  'When the this session tab has the keyboard and an agent plan is folded, the keyboard alone unfolds and folds that plan'

async function shownPlan(ui: Pick<Mounted, 'find'>): Promise<string[]> {
  return (await textsUnder(ui, `under:agent:${EXPLORE}`)).filter((text) =>
    PLAN_TITLES.includes(text),
  )
}

describe(KEYBOARD_PLAN_CRITERION, () => {
  test(
    'the agent name and the plan button keep their key and their place among the Buttons when pressed, so Enter in the same place unfolds and folds the plan',
    withWorkitems,
    async ($, on) => {
      const scene = await mockScene($, on)
      const name = `open:agent:${EXPLORE}`
      const plan = `plan:${EXPLORE}`
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const closed = await ringOf(ui, 41)
        expect(closed.keys).not.toContain(plan)
        const namePlace = closed.keys.indexOf(name)
        expect(namePlace).toBeGreaterThan(-1)
        await ui.press({ key: name })
        const folded = await ringOf(ui, 41)
        expect(folded.keys.indexOf(name)).toBe(namePlace)
        expect(folded.read).toEqual(folded.keys)
        const planPlace = folded.keys.indexOf(plan)
        expect(planPlace).toBe(namePlace + 2)
        expect((await ui.find({ key: plan }))?.text).toBe('all 7')
        expect(await shownPlan(ui)).toEqual(PLAN_TITLES.slice(0, 5))
        await ui.press({ key: plan })
        expect((await ringOf(ui, 41)).keys.indexOf(plan)).toBe(planPlace)
        expect((await ui.find({ key: plan }))?.text).toBe('fold')
        expect(await shownPlan(ui)).toEqual(PLAN_TITLES)
        await ui.press({ key: plan })
        expect((await ringOf(ui, 41)).keys.indexOf(plan)).toBe(planPlace)
        expect((await ui.find({ key: plan }))?.text).toBe('all 7')
        expect(await shownPlan(ui)).toEqual(PLAN_TITLES.slice(0, 5))
        await ui.press({ key: name })
        expect(await ui.find({ key: plan })).toBeUndefined()
        await ui.unmount()
      }
      await land(scene)
    },
  )
})

const DRAW_WORK_CRITERION =
  'When the this session tab draws 30 agents of 20 tasks each, a test pins the number of state reads per draw, and that number does not grow with the number of agents'

const TASKS_PER_AGENT = 20
const ROWS_OF_ACTIVE_AGENTS = 6
const STATE_READS_PER_DRAW = 5
const SLOW_RUNNER_FILL_TIMEOUT_MS = 30_000
const withRoomToFillAgents = { ...withWorkitems, timeoutMs: SLOW_RUNNER_FILL_TIMEOUT_MS }

async function fillAgents($: Engine, seen: World, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const id = `a${String(index).padStart(7, '0')}lane`
    const description = `lane ${String(index)}`
    await spawn($, id, 'general-purpose', description)
    for (let task = 1; task <= TASKS_PER_AGENT; task += 1) {
      await $.tool.call({ tool: TOOL_ADD, title: `Step ${String(task)}`, agentId: id })
    }
    await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'in_progress', agentId: id })
    seen.agents.push(listed(id, 'general-purpose', 'running', { description }))
  }
}

describe(DRAW_WORK_CRITERION, () => {
  for (const agents of [1, 30]) {
    test(
      `a draw with ${String(agents)} agents of ${String(TASKS_PER_AGENT)} tasks reads the state ${String(STATE_READS_PER_DRAW)} times`,
      withRoomToFillAgents,
      async ($, on) => {
        const seen = world(on)
        const reads: string[] = []
        let isCounting = false
        on('state.get', (_$, e, next) => {
          if (isCounting) reads.push(`${e.plugin}:${e.key}`)
          return next(e)
        })
        await start($)
        await $.tool.call({ tool: TOOL_ADD, title: 'Lead the lanes' })
        await fillAgents($, seen, agents)
        for (const surface of SURFACES) {
          reads.length = 0
          isCounting = true
          const ui = await mountTab($, surface, 'dock', 41)
          isCounting = false
          const lines = await screen(ui, 41)
          expect(lines).toContain(`Agents  ${String(agents)}`)
          const plans = lines.filter((line) => line.includes(`plan 0/${String(TASKS_PER_AGENT)}`))
          expect(plans).toHaveLength(Math.min(agents, ROWS_OF_ACTIVE_AGENTS))
          expect(reads, reads.join(', ')).toHaveLength(STATE_READS_PER_DRAW)
          await ui.unmount()
        }
      },
    )
  }

  test(
    'a session from a version that kept no agentPlans draws every plan on the first draw and reads the state 5 times from the second',
    withRoomToFillAgents,
    async ($, on) => {
      const agents = 30
      const seen = world(on)
      const reads: string[] = []
      let isCounting = false
      let isOlderVersion = true
      on('state.get', (_$, e, next) => {
        if (isCounting) reads.push(`${e.plugin}:${e.key}`)
        return next(e)
      })
      on('state.set', (_$, e, next) =>
        isOlderVersion && e.plugin === PLUGIN && e.key === 'agentPlans'
          ? { value: { isSet: true, version: 0 } }
          : next(e),
      )
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Lead the lanes' })
      await fillAgents($, seen, agents)
      isOlderVersion = false
      const planRows = (lines: readonly string[]) =>
        lines.filter((line) => line.includes(`plan 0/${String(TASKS_PER_AGENT)}`))
      isCounting = true
      const first = await mountTab($, 'terminal', 'dock', 41)
      isCounting = false
      expect(planRows(await screen(first, 41))).toHaveLength(ROWS_OF_ACTIVE_AGENTS)
      expect(reads.filter((read) => read === `${PLUGIN}:agentList`)).toHaveLength(agents)
      expect(reads).toHaveLength(STATE_READS_PER_DRAW + agents)
      await first.press({ key: 'group:more-agents' })
      expect(planRows(await screen(first, 41))).toHaveLength(agents)
      await first.unmount()
      await seen.clock.advance(0)
      for (const surface of SURFACES) {
        reads.length = 0
        isCounting = true
        const ui = await mountTab($, surface, 'dock', 41)
        isCounting = false
        expect(planRows(await screen(ui, 41))).toHaveLength(agents)
        expect(reads, reads.join(', ')).toHaveLength(STATE_READS_PER_DRAW)
        await ui.unmount()
      }
    },
  )

  test('a plan that lands after a newer plan of the same agent keeps the newer plan', () => {
    const task: BoardTask = { id: 1, title: 'Step 1', status: 'pending', by: 'model', item: null }
    const older = [task]
    const newer = [{ ...task, status: 'completed' as const }]
    const kept = withAgentPlan({}, LANE, newer, 3)
    expect(withAgentPlan(kept, LANE, older, 2)).toEqual({ [LANE]: { version: 3, tasks: newer } })
    expect(withAgentPlan(kept, SCOUT, older, 2)[SCOUT]).toEqual({ version: 2, tasks: older })
  })
})

type Verdict = 'allow' | 'ask' | 'deny'

type Answer = 'allow' | 'deny'

type Dialog = { opened: (count: number) => Promise<void>; answer: (behavior: Answer) => void }

function verdictOf(verdicts: Readonly<Record<string, Verdict>>, input: unknown): Verdict {
  if (!isRecord(input)) return 'allow'
  const asked = [input.command, input.file_path].find((value) => typeof value === 'string')
  return typeof asked === 'string' ? (verdicts[asked] ?? 'allow') : 'allow'
}

function decisionOf(behavior: Answer) {
  return behavior === 'allow'
    ? { decision: { behavior: 'allow' as const } }
    : { decision: { behavior: 'deny' as const, message: 'The person refused it.' } }
}

function personDialog(on: On, verdicts: Readonly<Record<string, Verdict>>): Dialog {
  const open: ((behavior: Answer) => void)[] = []
  const waiters: { count: number; resolve: () => void }[] = []
  let opened = 0
  on('tool.check', (_$, e) => ({ decision: verdictOf(verdicts, e.input) }))
  on('classic.PermissionRequest', async () => {
    const behavior = await new Promise<Answer>((resolve) => {
      open.push(resolve)
      opened += 1
      for (const waiter of waiters) if (waiter.count <= opened) waiter.resolve()
    })
    return decisionOf(behavior)
  })
  return {
    opened: (count) =>
      new Promise<void>((resolve) => {
        if (opened >= count) resolve()
        else waiters.push({ count, resolve })
      }),
    answer: (behavior) => {
      const first = open.shift()
      if (first === undefined) throw new Error('no permission dialog is open')
      first(behavior)
    },
  }
}

function classifier(
  on: On,
  clock: MockClock,
  verdicts: Readonly<Record<string, Verdict>>,
  answerAfterMs: number,
): void {
  on('tool.check', (_$, e) => ({ decision: verdictOf(verdicts, e.input) }))
  on('classic.PermissionRequest', async () => {
    if (answerAfterMs > 0) await clock.sleep(answerAfterMs)
    return decisionOf('allow')
  })
}

async function measureSession($: Engine): Promise<void> {
  await $.session.measure({
    context: { window: 200_000, percent: 62, tokens: 124_000 },
    rateLimits: [],
    cost: { usd: 4.18 },
    changed: ['context', 'cost'],
  })
}

type Asking = { call: Promise<ToolCallResult> }

async function scoutAsks($: Engine, seen: World): Promise<Asking> {
  await start($)
  await measureSession($)
  await spawn($, SCOUT, 'general-purpose', 'scout the hooks', { name: 'scout' })
  seen.agents.push(
    listed(SCOUT, 'general-purpose', 'running', { name: 'scout', description: 'scout the hooks' }),
  )
  await seen.clock.advance(2 * MINUTE)
  return { call: $.tool.call(inLoop({ tool: 'Bash', command: 'npm test' }, SCOUT)) }
}

async function scoutTurnEnds($: Engine): Promise<void> {
  await $.turn.complete({
    turnId: 'scout-turn',
    reason: 'answer',
    answer: 'done',
    durationMs: 1,
    isAborted: false,
    agentId: SCOUT,
  })
}

const NEEDS_YOU_CRITERION =
  'When a subagent call waits for the permission dialog, its row shows needs you with the waits for line, and the Session line counts it'

const WAIT_SCREENS: readonly {
  placement: 'dock' | 'inline'
  columns: number
  session: string
  agents: readonly string[]
}[] = [
  {
    placement: 'dock',
    columns: 41,
    session: 'Session  ◆ 1 waits · ctx 62% · $4.18',
    agents: [
      'Agents  1 · 1 needs you',
      '◆ scout     needs you            open  2m',
      '    waits for: permission · Bash npm test',
      '',
    ],
  },
  {
    placement: 'dock',
    columns: 30,
    session: 'Session  ◆ 1 waits · ctx 62%',
    agents: [
      'Agents  1 · 1 needs you',
      '◆ scout     needs you open  2m',
      '    waits for: permission · B…',
      '',
    ],
  },
  {
    placement: 'inline',
    columns: 76,
    session: 'Session  ◆ 1 waits · ctx 62% · $4.18',
    agents: [
      'Agents  1 · 1 needs you',
      '◆ scout      needs you  waits for: permission · Bash npm test       open  2m',
      '',
    ],
  },
]

describe(NEEDS_YOU_CRITERION, () => {
  for (const { placement, columns, session, agents } of WAIT_SCREENS) {
    test(
      `an ask that stays unsettled for 3 s draws needs you, the waits for line and the wait on the Session line, as mock 8.10e, at ${String(columns)} columns, ${placement}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on, { 'npm test': 'ask' })
        const { call } = await scoutAsks($, seen)
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        for (const surface of SURFACES) {
          const ui = await mountTab($, surface, placement, columns)
          const lines = await screen(ui, columns)
          expect(lines[0]).toBe(session)
          expect(agentLines(lines)).toEqual(agents)
          await ui.unmount()
        }
        dialog.answer('allow')
        await call
      },
    )
  }

  test(
    'before 3 s the row says asked with no mark, and a shown tab turns it into needs you at the 3 s mark',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const dialog = personDialog(on, { 'npm test': 'ask' })
      const { call } = await scoutAsks($, seen)
      await dialog.opened(1)
      await seen.clock.advance(NEEDS_YOU_AFTER_MS - 1)
      const shown = await Promise.all(SURFACES.map((surface) => mountTab($, surface, 'dock', 41)))
      for (const ui of shown) {
        const asked = await screen(ui, 41)
        expect(asked[0]).toBe('Session  ctx 62% · $4.18')
        expect(agentLines(asked)).toEqual([
          'Agents  1',
          '▶ scout     asked     ▸ Bash np… open  2m',
          '',
        ])
      }
      await seen.clock.advance(1)
      for (const ui of shown) {
        const waits = await screen(ui, 41)
        expect(waits[0]).toBe('Session  ◆ 1 waits · ctx 62% · $4.18')
        expect(agentLines(waits).slice(0, 2)).toEqual([
          'Agents  1 · 1 needs you',
          '◆ scout     needs you            open  2m',
        ])
        await ui.unmount()
      }
      dialog.answer('allow')
      await call
    },
  )

  test(
    'two waiting agents come first in the rows and the Session line counts both',
    withWorkitems,
    async ($, on) => {
      const seen = world(on, ['Read'])
      const dialog = personDialog(on, { 'npm test': 'ask', 'npm run lint': 'ask' })
      const { call: scout } = await scoutAsks($, seen)
      await spawn($, LANE, 'general-purpose', 'run the lint', { name: 'lane-b' })
      await spawn($, EXPLORE, 'Explore', 'find the element table')
      seen.agents.push(
        listed(LANE, 'general-purpose', 'running', { name: 'lane-b' }),
        listed(EXPLORE, 'Explore', 'running'),
      )
      const reading = $.tool.call(inLoop({ tool: 'Read', file_path: `${ROOT}/a.ts` }, EXPLORE))
      const lane = $.tool.call(inLoop({ tool: 'Bash', command: 'npm run lint' }, LANE))
      await dialog.opened(2)
      await flightOf(seen, 'Read').arrived(1)
      await seen.clock.advance(NEEDS_YOU_AFTER_MS)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const lines = await screen(ui, 41)
        expect(lines[0]).toBe('Session  ◆ 2 wait · ctx 62% · $4.18')
        expect(agentLines(lines)).toEqual([
          'Agents  3 · 2 need you',
          '◆ scout     needs you            open  2m',
          '    waits for: permission · Bash npm test',
          '◆ lane-b    needs you            open  3s',
          '    waits for: permission · Bash npm run…',
          '▶ Explore   running   ▸ Read a.… open  3s',
          '',
        ])
        await ui.unmount()
      }
      dialog.answer('allow')
      dialog.answer('allow')
      flightOf(seen, 'Read').release()
      await Promise.all([scout, lane, reading])
    },
  )
})

const CLEARS_CRITERION =
  'When that call runs, is refused or its turn ends, the needs you mark clears'

async function waitingShown($: Engine): Promise<void> {
  for (const surface of SURFACES) {
    const ui = await mountTab($, surface, 'dock', 41)
    const lines = await screen(ui, 41)
    expect(lines[0]).toBe('Session  ◆ 1 waits · ctx 62% · $4.18')
    expect(agentLines(lines)[1]).toBe('◆ scout     needs you            open  2m')
    await ui.unmount()
  }
}

async function clearedRow($: Engine, row: string): Promise<void> {
  for (const surface of SURFACES) {
    const ui = await mountTab($, surface, 'dock', 41)
    const lines = await screen(ui, 41)
    expect(lines[0]).toBe('Session  ctx 62% · $4.18')
    expect(agentLines(lines)).toEqual(['Agents  1', row, ''])
    expect(lines.join('\n')).not.toContain('◆')
    await ui.unmount()
  }
}

describe(CLEARS_CRITERION, () => {
  test(
    'the mark clears when the person allows the call and it runs',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const dialog = personDialog(on, { 'npm test': 'ask' })
      const { call } = await scoutAsks($, seen)
      await dialog.opened(1)
      await seen.clock.advance(NEEDS_YOU_AFTER_MS)
      await waitingShown($)
      dialog.answer('allow')
      expect(await call).toEqual({ result: '' })
      await clearedRow($, '▶ scout     running   Bash npm … open  2m')
    },
  )

  test('the mark clears when the person refuses the call', withWorkitems, async ($, on) => {
    const seen = world(on)
    const dialog = personDialog(on, { 'npm test': 'ask' })
    const { call } = await scoutAsks($, seen)
    await dialog.opened(1)
    await seen.clock.advance(NEEDS_YOU_AFTER_MS)
    await waitingShown($)
    dialog.answer('deny')
    expect((await call).isError).toBe(true)
    await clearedRow($, '▶ scout     running   Bash npm … open  2m')
  })

  test(
    'the mark clears when the turn of the agent ends, while the call still waits',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const dialog = personDialog(on, { 'npm test': 'ask' })
      const { call } = await scoutAsks($, seen)
      await dialog.opened(1)
      await seen.clock.advance(NEEDS_YOU_AFTER_MS)
      await waitingShown($)
      await scoutTurnEnds($)
      await clearedRow($, '▶ scout     running   ▸ Bash np… open  2m')
      dialog.answer('deny')
      await call
    },
  )
})

const CHECKS_CRITERION =
  'When the person opens the last 5 checks, each shows the verdict word, the tool and the target with credentials masked'

function fake(...parts: readonly string[]): string {
  return parts.join('')
}

const BEARER = fake('abcdef', '1234567890')
const URL_PASSWORD = fake('hunter', '22')
const QUERY_TOKEN = fake('s3cr3t', 'value')
const GITHUB_TOKEN = fake('ghp', '_abcdefghijklmnopqrstuvwxyz0123456789')
const CURL = `curl -H "Authorization: Bearer ${BEARER}" https://deploy:${URL_PASSWORD}@example.com/api?token=${QUERY_TOKEN}`
const PUSH = `GITHUB_TOKEN=${GITHUB_TOKEN} git push --force origin main`
const SECRETS = [BEARER, URL_PASSWORD, QUERY_TOKEN, GITHUB_TOKEN]

async function sixChecks($: Engine, on: On): Promise<void> {
  const seen = world(on)
  classifier(
    on,
    seen.clock,
    { 'npm test': 'ask', [`${ROOT}/docs/mocks.md`]: 'ask', [PUSH]: 'deny' },
    0,
  )
  await start($)
  await spawn($, SCOUT, 'general-purpose', 'scout the hooks', { name: 'scout' })
  await spawn($, EXPLORE, 'Explore', 'find the element table')
  seen.agents.push(
    listed(SCOUT, 'general-purpose', 'running', { name: 'scout' }),
    listed(EXPLORE, 'Explore', 'running'),
  )
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/hooks/pane.tsx` })
  await $.tool.call(inLoop({ tool: 'Read', file_path: `${ROOT}/hooks/agents.ts` }, EXPLORE))
  await bashAs($, SCOUT, 'npm test')
  await $.tool.call({
    tool: 'Edit',
    file_path: `${ROOT}/docs/mocks.md`,
    old_string: 'a',
    new_string: 'b',
  })
  await $.tool.call({ tool: 'Bash', command: CURL })
  expect((await $.tool.call({ tool: 'Bash', command: PUSH })).isError).toBe(true)
}

for (const surface of SURFACES) {
  test(
    `the Now row and an agent row draw a credential in a call target masked on ${surface}`,
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await spawn($, SCOUT, 'general-purpose', 'scout the hooks', { name: 'scout' })
      seen.agents.push(listed(SCOUT, 'general-purpose', 'running', { name: 'scout' }))
      await bashAs($, SCOUT, `GITHUB_TOKEN=${GITHUB_TOKEN} gh pr list`)
      await $.tool.call({ tool: 'Bash', command: `GITHUB_TOKEN=${GITHUB_TOKEN} gh run list` })
      const ui = await mountTab($, surface, 'dock', 100)
      const lines = await screen(ui, 100)
      expect(lines.some((text) => text.includes('ghp_'))).toBe(false)
      expect(lines.some((text) => text.includes('▶ Now  Bash GITHUB_TOKEN=*** gh run list'))).toBe(
        true,
      )
      expect(lines.some((text) => text.includes('GITHUB_TOKEN=*** gh pr list'))).toBe(true)
      await ui.unmount()
    },
  )
}

const CHECK_SCREENS: readonly { columns: number; lines: readonly string[] }[] = [
  {
    columns: 41,
    lines: [
      'Session  ctx — until the first reply',
      '    checks 6 · 3 allowed · 2 asked',
      '    1 denied',
      '    [ hide checks ]',
      '    denied   Bash GITHUB_TOKEN=*** git p…',
      '    allowed  Bash curl -H "Authorization…',
      '    asked    Edit docs/mocks.md',
      '    asked    Bash npm test   scout',
      '    allowed  Read hooks/agents…   Explore',
    ],
  },
  {
    columns: 100,
    lines: [
      'Session  ctx — until the first reply',
      '    checks 6 · 3 allowed · 2 asked · 1 denied',
      '    [ hide checks ]',
      '    denied   Bash GITHUB_TOKEN=*** git push --force origin main',
      '    allowed  Bash curl -H "Authorization: ***" https://***@example.com/api?token=***',
      '    asked    Edit docs/mocks.md',
      '    asked    Bash npm test   scout',
      '    allowed  Read hooks/agents.ts   Explore',
    ],
  },
]

describe(CHECKS_CRITERION, () => {
  for (const { columns, lines } of CHECK_SCREENS) {
    test(
      `a press on the Session line and on last 5 checks shows the newest 5 checks, the verdict word first and the credentials masked, as mock 8.10d, at ${String(columns)} columns`,
      withWorkitems,
      async ($, on) => {
        await sixChecks($, on)
        for (const surface of SURFACES) {
          const ui = await mountTab($, surface, 'dock', columns)
          expect(await ui.find({ key: 'session:checks' })).toBeUndefined()
          await ui.press({ key: 'session' })
          expect((await ui.find({ key: 'session:checks' }))?.text).toBe('last 5 checks')
          await ui.press({ key: 'session:checks' })
          const shown = await screen(ui, columns)
          expect(shown.slice(0, lines.length)).toEqual(lines)
          const rows = shown.slice(0, lines.length).join('\n')
          for (const secret of SECRETS) expect(rows).not.toContain(secret)
          const denied = await ui.find({ type: 'Text', text: /^denied/ })
          expect(denied?.props.color).toBe('error')
          await ui.press({ key: 'session:checks' })
          await ui.press({ key: 'session' })
          await ui.unmount()
        }
      },
    )
  }

  test(
    'before any check the Session line is no Button and has no details',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        expect(await ui.find({ type: 'Button', key: 'session' })).toBeUndefined()
        expect(await ui.find({ type: 'Box', key: 'session' })).toBeDefined()
        await ui.unmount()
      }
    },
  )

  test('the board masks each kind of credential in a check target and leaves plain words', () => {
    const cases: readonly (readonly [string, string])[] = [
      [CURL, 'curl -H "Authorization: ***" https://***@example.com/api?token=***'],
      [PUSH, 'GITHUB_TOKEN=*** git push --force origin main'],
      ['mysql --password hunter2 -h db', 'mysql --password *** -h db'],
      ["psql --token='abc def' -d app", 'psql --token=*** -d app'],
      ['gh auth login --with-token "abc def"', 'gh auth login --with-token ***'],
      ['curl -u deploy:hunter22 https://x.dev', 'curl -u deploy:*** https://x.dev'],
      ['echo sk-ant-abcdefghijklmnopqrstuvwx', 'echo ***'],
      [`aws s3 ls ${fake('AKIA', 'ABCDEFGHIJKLMNOP')}`, 'aws s3 ls ***'],
      [
        'npm config set //r.npmjs.org/:_authToken=npm_abc123',
        'npm config set //r.npmjs.org/:_authToken=***',
      ],
      ['git clone https://me:pa55w0rd@github.com/a/b', 'git clone https://***@github.com/a/b'],
      [
        `curl -H "x: Bearer ${fake('eyJ', 'hbGciOiJIUzI1NiJ9.', 'eyJ', 'zdWIiOiIxMjM0In0.abcdefghijk')}"`,
        'curl -H "x: Bearer ***"',
      ],
      ['git log --author=me hooks/tokens.ts', 'git log --author=me hooks/tokens.ts'],
      ['npm test', 'npm test'],
    ]
    for (const [text, masked] of cases) expect(maskedCredentials(text)).toBe(masked)
  })
})

const CLASSIFIER_CRITERION =
  'When the classifier answers an ask with no dialog, no needs you mark is drawn'

describe(CLASSIFIER_CRITERION, () => {
  test(
    'an ask that the classifier settles in 0.6 s draws asked while it waits and no needs you mark before or after the 3 s mark',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      classifier(on, seen.clock, { 'npm test': 'ask' }, 600)
      const { call } = await scoutAsks($, seen)
      await seen.clock.settle()
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        expect(agentLines(await screen(ui, 41))[1]).toBe(
          '▶ scout     asked     ▸ Bash np… open  2m',
        )
        await ui.unmount()
      }
      await seen.clock.advance(600)
      expect(await call).toEqual({ result: '' })
      await seen.clock.advance(NEEDS_YOU_AFTER_MS)
      await clearedRow($, '▶ scout     running   Bash npm … open  2m')
    },
  )
})
