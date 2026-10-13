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
          refresh: () => Promise.resolve({ created: [], updated: [], closed: [], version: 1 }),
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

type World = { agents: AgentInfo[]; clock: MockClock; held: Map<string, Flight> }

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
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
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

type Scene = { flights: Flight[]; calls: Promise<ToolCallResult>[] }

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
  return { flights: [agentCall, read], calls: [scoutCall, readCall] }
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
      '○ 3 Review the mocks with Codex',
      '○ 4 Ask the person about tabs',
      '[ +1 done ]',
      '─────────────────────────────────────────',
      'Agents  3 · 1 failed',
      '■ lane-b    failed                     4m',
      '    failed after Bash npm test',
      '▶ Explore   plan 2/7  ▸ Read pane.tsx  1m',
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
      '○ 3 Review the mocks with Cod…',
      '○ 4 Ask the person about tabs',
      '[ +1 done ]',
      '──────────────────────────────',
      'Agents  3 · 1 failed',
      '■ lane-b    failed          4m',
      '    failed after Bash npm test',
      '▶ Explore   plan 2/7        1m',
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
      '○ 3 Review the mocks with Codex',
      '○ 4 Ask the person about tabs',
      '[ +1 done ]',
      'Agents  3 · 1 failed',
      '■ lane-b     failed     failed after Bash npm test                        4m',
      '▶ Explore    plan 2/7   ▸ Read pane.tsx                                   1m',
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
          '▶ Explore   plan 2/7  ▸ Read pane.tsx  1m',
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
          '○ 1 Write the tab mocks',
          '─────────────────────────────────────────',
          'Agents  16 · 1 failed',
          '■ lane-b    failed                     0s',
          '    failed after Bash npm test',
          '▶ Explore   running                    1m',
          '▶ Explore 2 running                    1m',
          '▶ Explore 3 running                    1m',
          '▶ Explore 4 running                    1m',
          '▶ Explore 5 running                    1m',
          '[ +10 more agents ]  [ +5 ended ]',
          '',
          '[ Add a task ][Add]',
        ])
        await ui.press({ key: 'group:more-agents' })
        const lines = await screen(ui, 41)
        expect(lines.filter((line) => line.startsWith('▶ Expl'))).toHaveLength(15)
        expect(lines.slice(-4)).toEqual([
          '▶ Expl…e 15 running                    1m',
          '[ hide 10 more agents ]  [ +5 ended ]',
          '',
          '[ Add a task ][Add]',
        ])
        await ui.press({ key: 'group:more-agents' })
        await ui.unmount()
        const narrow = await mountTab($, surface, 'dock', 30)
        expect((await screen(narrow, 30)).slice(-5)).toEqual([
          '▶ Explore 5 running         1m',
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
          '▶ Explore   running   Bash cat a.ts    5m',
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
        '▶ gene…pose running                    6s',
        '▶ impl…nter running                    5s',
        '▶ code…ewer running                    4s',
        '▶ Explore   running                    3s',
        '▶ Explore 2 running                    2s',
        '▶ gene…se 2 running                    1s',
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
      expect(agentLines(await screen(ui, 41))[1]).toBe('▶ a\\u2028b  running                    0s')
      expect(await ui.find({ type: 'Text', text: /\u2028/ })).toBeUndefined()
      await ui.unmount()
    },
  )
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
          '▶ Explore   running   Bash grep -rn …  0s',
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
