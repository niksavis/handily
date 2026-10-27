import type { AgentInfo, On, RenderPropsOf, ToolCallArgs, ToolCallResult } from 'claude-code'
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
import type { BoardTask } from './types'
import { cutName } from './hooks/agent-rows'
import { withAgentPlan } from './hooks/agents'

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
