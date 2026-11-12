import type { AgentInfo, On, RenderPropsOf, ToolCallResult } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import type { BoardAgent } from './types'

const ROOT = '/work/app'
const PANE = 'tasks'
const PLUGIN = 'handily-board'
const MINUTE = 60_000
const START = Date.UTC(2026, 10, 12, 10, 0)
const SURFACES = ['terminal', 'desktop'] as const
const LANE = 'a0000001lane'
const EXPLORE = 'a0000003explore'
const NPM_TEST = 'npm test'
const NPM_TEST_ASKED = 'Run the unit tests'
const ENGINE_ROW = { type: 'engine', ref: 0 } as const

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

type Gate = { arrived: Promise<void>; release: () => void }

type World = {
  agents: AgentInfo[]
  clock: MockClock
  failing: Set<string>
  exitCodes: Map<string, number>
  meanings: Map<string, string>
  refused: Set<string>
  asked: Set<string>
  askedIds: Map<string, string>
  dialogOpened: () => Promise<void>
  answerDialog: (isRefused: boolean) => void
  hold: (command: string) => Gate
  stored: (readonly BoardAgent[])[]
}

function fake(...parts: readonly string[]): string {
  return parts.join('')
}

function commandOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('command' in input)) return undefined
  return typeof input.command === 'string' ? input.command : undefined
}

function world(on: On): World {
  const gates = new Map<string, { arrive: () => void; gate: Promise<void> }>()
  const state: World = {
    agents: [],
    clock: mock.clock(on, { now: START }),
    failing: new Set(),
    exitCodes: new Map(),
    meanings: new Map(),
    refused: new Set(),
    asked: new Set(),
    askedIds: new Map(),
    dialogOpened: () => Promise.resolve(),
    answerDialog: () => undefined,
    hold: (command) => {
      let arrive: () => void = () => undefined
      let release: () => void = () => undefined
      const arrived = new Promise<void>((resolve) => {
        arrive = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      gates.set(command, { arrive, gate })
      return { arrived, release }
    },
    stored: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: START, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: ROOT }))
  on('agent.list', () => ({ value: state.agents }))
  on('agent.spawn', (_$, e) => ({ model: 'opus', agentId: e.tool_use_id.slice('spawn:'.length) }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__handily-board__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('telemetry.log', { to: 'collector' }, () => ({ value: undefined }))
  on('ui.render', () => ENGINE_ROW)
  on('state.set', { plugin: PLUGIN, key: 'agents' }, (_$, e, next) => {
    state.stored.push(e.value)
    return next(e)
  })
  const waiting: ((isRefused: boolean) => void)[] = []
  const openers: (() => void)[] = []
  on('tool.check', (_$, e) => {
    const command = commandOf(e.input)
    if (command !== undefined && state.asked.has(command) && e.tool_use_id !== undefined) {
      state.askedIds.set(command, e.tool_use_id)
      return { decision: 'ask' }
    }
    return { decision: command !== undefined && state.refused.has(command) ? 'deny' : 'allow' }
  })
  on('classic.PermissionRequest', async () => {
    const isRefused = await new Promise<boolean>((resolve) => {
      waiting.push(resolve)
      for (const open of openers.splice(0)) open()
    })
    return isRefused
      ? { decision: { behavior: 'deny' as const, message: 'The person refused it.' } }
      : { decision: { behavior: 'allow' as const } }
  })
  state.dialogOpened = () =>
    new Promise<void>((resolve) => {
      if (waiting.length > 0) resolve()
      else openers.push(resolve)
    })
  state.answerDialog = (isRefused) => {
    const first = waiting.shift()
    if (first === undefined) throw new Error('no permission dialog is open')
    first(isRefused)
  }
  on('tool.call', async (_$, e) => {
    const command = commandOf(e)
    if (command === undefined) return { result: '' }
    const held = gates.get(command)
    if (held !== undefined) {
      gates.delete(command)
      held.arrive()
      await held.gate
    }
    if (state.failing.has(command)) {
      const code = state.exitCodes.get(command) ?? 1
      return {
        isError: true as const,
        result: `Error: Exit code ${String(code)}\n${command}: failed`,
      }
    }
    const meaning = state.meanings.get(command)
    return {
      result: {
        stdout: '',
        stderr: '',
        interrupted: false,
        isImage: false,
        noOutputExpected: false,
        ...(meaning === undefined ? {} : { returnCodeInterpretation: meaning }),
      },
    }
  })
  return state
}

async function startOn($: Engine, surface: Surface): Promise<void> {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
}

async function spawn($: Engine, seen: World, id: string, name: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `spawn:${id}`,
    prompt: name,
    description: name,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
    name,
  })
  seen.agents.push({ id, name, type: 'general-purpose', status: 'running', description: name })
}

function bashAs(
  $: Engine,
  agentId: string,
  command: string,
  description = NPM_TEST_ASKED,
): Promise<ToolCallResult> {
  return $.tool.call({ tool: 'Bash', command, description, agentId })
}

async function editAs($: Engine, agentId: string): Promise<void> {
  await $.tool.call({
    tool: 'Edit',
    file_path: `${ROOT}/src/app.ts`,
    old_string: 'a',
    new_string: 'b',
    agentId,
  })
}

async function writeAs($: Engine, agentId: string): Promise<void> {
  await $.tool.call({
    tool: 'Write',
    file_path: `${ROOT}/src/new.ts`,
    content: 'export {}',
    agentId,
  })
}

async function failsWithEdits(
  $: Engine,
  seen: World,
  command: string,
  times: number,
): Promise<void> {
  seen.failing.add(command)
  for (let index = 0; index < times; index += 1) {
    if (index > 0) {
      if (index % 2 === 0) await writeAs($, LANE)
      else await editAs($, LANE)
    }
    await bashAs($, LANE, command)
  }
}

type Scene = { seen: World; rerun: Promise<ToolCallResult>; release: () => void }

async function retryScene($: Engine, on: On, surface: Surface): Promise<Scene> {
  const seen = world(on)
  await startOn($, surface)
  await spawn($, seen, EXPLORE, 'Explore')
  await seen.clock.advance(1_000)
  await spawn($, seen, LANE, 'lane-b')
  await seen.clock.set(START + 1_000 + 6 * MINUTE - 45_000)
  await failsWithEdits($, seen, NPM_TEST, 3)
  await editAs($, LANE)
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/app.ts`, agentId: EXPLORE })
  const gate = seen.hold(NPM_TEST)
  const rerun = bashAs($, LANE, NPM_TEST)
  await gate.arrived
  await seen.clock.set(START + 1_000 + 6 * MINUTE)
  return { seen, rerun, release: gate.release }
}

async function landed(scene: Scene): Promise<void> {
  scene.release()
  await scene.rerun
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

function bandProps(bodyColumns: number): RenderPropsOf['AbovePrompt'] {
  return {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  }
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

function hotkeyText(element: Drawn): string {
  const { hotkey, plain } = element.props
  return plain === true && typeof hotkey === 'string' ? `${hotkey}: ` : ''
}

function drawnWidth(element: Drawn): number {
  if (element.type === 'Text') return element.text.length
  if (element.type === 'Button') {
    const label =
      typeof element.props.label === 'string'
        ? element.text.length
        : element.children.reduce((sum, child) => sum + drawnWidth(child), 0)
    return element.props.plain === true ? hotkeyText(element).length + label : label + 4
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
    return [
      element.props.plain === true
        ? `${hotkeyText(element)}${element.text}`
        : `[ ${element.text} ]`,
    ]
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

function linesOf(element: Drawn | null, columns: number): string[] {
  if (element === null) throw new Error('nothing was drawn')
  const lines = screenOf(element, columns).map((line) => line.trimEnd())
  for (const line of lines) {
    expect(line.length <= columns, `"${line}" is wider than ${String(columns)}`).toBe(true)
  }
  return lines
}

async function agentLines(
  $: Engine,
  surface: Surface,
  placement: 'dock' | 'inline',
  columns: number,
): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: paneProps(placement, columns),
  })
  const lines = linesOf(drawnOf(await ui.find({ type: 'Box' })), columns)
  await ui.unmount()
  const first = lines.findIndex((line) => line.startsWith('Agents'))
  const rest = lines.slice(first)
  const end = rest.findIndex((line, index) => index > 0 && !/^( {4}|\d: )/u.test(line))
  return end < 0 ? rest : rest.slice(0, end)
}

async function bandLines($: Engine, surface: Surface, body: number): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: bandProps(body),
  })
  const lines = linesOf(drawnOf(await ui.find({ key: 'band' })), body)
  await ui.unmount()
  return lines
}

async function bandStateLook($: Engine, surface: Surface, id: string): Promise<unknown[]> {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: bandProps(75),
  })
  const row = drawnOf(await ui.find({ key: `band-agent:${id}` }))
  await ui.unmount()
  const [mark, , word] = row === null ? [] : texts(row)
  return [mark?.text, word?.text, word?.props.color]
}

async function paneLook($: Engine, surface: Surface): Promise<unknown[]> {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: paneProps('dock', 40),
  })
  const row = drawnOf(await ui.find({ key: `row:agent:${LANE}` }))
  const head = await ui.find({ type: 'Text', text: '1 retry' })
  await ui.unmount()
  const [mark, , word] = row === null ? [] : texts(row)
  return [mark?.text, word?.text, word?.props.color, head?.props.color]
}

const BAND_80 = '▶ lane-b    retry 3   ▸ Bash npm test                              open  6m'
const BAND_40 = '▶ lane-b    retry 3 ▸ Bash np… open'
const EXPLORE_80 = '▶ Explore   running   Read src/app.ts                              open  6m'
const EXPLORE_40 = '▶ Explore   running Read src/… open'
const INLINE_HEAD = 'Agents  2 · 1 retry'
const INLINE_ROW = '2: ▶ lane-b     retry 3    ▸ Bash npm test · 3 fails                open  6m'
const DOCK_ROW = '2: ▶ lane-b    retry 3          open  6m'
const DOCK_LINE = '    3 fails: Bash npm test'

const RETRY_CRITERION =
  'When a subagent fails the same Bash command 3 times with an Edit or Write by that agent between the failures, its row in the band and in the this session tab shows retry 3 in the state column, the Agents head counts 1 retry, and retry rows come first among the running agents in the band, as the mocks recorded on this record on 2026-11-12.'

for (const surface of SURFACES) {
  describe(RETRY_CRITERION, () => {
    test(
      `3 failures with an edit or a write between show retry 3 first in the band at body 75 and 35, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const scene = await retryScene($, on, surface)
        expect(await bandLines($, surface, 75)).toEqual([
          'Agents  2 · no open task                                          [ board ]',
          BAND_80,
          EXPLORE_80,
        ])
        expect(await bandLines($, surface, 35)).toEqual([
          'Agents 2 · no open task   [ board ]',
          BAND_40,
          EXPLORE_40,
        ])
        expect(await bandStateLook($, surface, LANE)).toEqual(['▶ ', 'retry 3', 'warning'])
        await landed(scene)
      },
    )

    test(
      `the this session tab shows retry 3, the fails and the head count inline at body 76 and docked at 40, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const scene = await retryScene($, on, surface)
        const inline = await agentLines($, surface, 'inline', 76)
        expect([inline[0], inline[2]]).toEqual([INLINE_HEAD, INLINE_ROW])
        const docked = await agentLines($, surface, 'dock', 40)
        expect([docked[0], ...docked.slice(2, 4)]).toEqual([INLINE_HEAD, DOCK_ROW, DOCK_LINE])
        expect(await paneLook($, surface)).toEqual(['▶ ', 'retry 3', 'warning', 'warning'])
        await landed(scene)
      },
    )
  })
}

describe(RETRY_CRITERION, () => {
  test(
    '3 failures with no edit between show no retry mark and count as one',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await spawn($, seen, LANE, 'lane-b')
      seen.failing.add(NPM_TEST)
      for (let index = 0; index < 3; index += 1) await bashAs($, LANE, NPM_TEST)
      await editAs($, LANE)
      await bashAs($, LANE, NPM_TEST)
      const lines = await agentLines($, 'terminal', 'inline', 80)
      expect(lines.join('\n')).not.toContain('retry')
      expect(lines.join('\n')).not.toContain('fails')
      await editAs($, LANE)
      await bashAs($, LANE, NPM_TEST)
      expect((await agentLines($, 'terminal', 'inline', 80)).join('\n')).toContain('retry 3')
    },
  )

  test('a refused call does not count toward the streak', withWorkitems, async ($, on) => {
    const seen = world(on)
    await startOn($, 'terminal')
    await spawn($, seen, LANE, 'lane-b')
    await failsWithEdits($, seen, NPM_TEST, 2)
    await editAs($, LANE)
    seen.refused.add(NPM_TEST)
    const refused = await bashAs($, LANE, NPM_TEST)
    expect(refused.deny ?? (refused.isError === true ? 'error' : undefined)).toBeDefined()
    seen.refused.delete(NPM_TEST)
    const lines = await agentLines($, 'terminal', 'inline', 80)
    expect(lines.join('\n')).not.toContain('retry')
    await bashAs($, LANE, NPM_TEST)
    expect((await agentLines($, 'terminal', 'inline', 80)).join('\n')).toContain('retry 3')
  })

  test(
    'another command does not count toward the streak and does not reset it',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await spawn($, seen, LANE, 'lane-b')
      seen.failing.add(NPM_TEST)
      seen.failing.add('npm run lint')
      await bashAs($, LANE, NPM_TEST)
      await editAs($, LANE)
      await bashAs($, LANE, 'npm run lint')
      await editAs($, LANE)
      await bashAs($, LANE, 'npm run lint')
      await editAs($, LANE)
      await bashAs($, LANE, NPM_TEST)
      expect((await agentLines($, 'terminal', 'inline', 80)).join('\n')).not.toContain('retry')
      await editAs($, LANE)
      seen.failing.add('npm  test ')
      await bashAs($, LANE, 'npm  test ')
      const lines = await agentLines($, 'terminal', 'inline', 80)
      expect(lines.slice(0, 2)).toEqual([
        'Agents  1 · 1 retry',
        '1: ▶ lane-b     retry 3    Bash npm test · 3 fails                      open  0s',
      ])
    },
  )

  test(
    'a retry row comes first among the running agents in the band',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await spawn($, seen, EXPLORE, 'Explore')
      await seen.clock.advance(1_000)
      await spawn($, seen, 'a0000004tester', 'tester')
      await seen.clock.advance(1_000)
      await spawn($, seen, LANE, 'lane-b')
      expect((await bandLines($, 'terminal', 75)).map((line) => line.slice(0, 11))).toEqual([
        'Agents  3 ·',
        '▶ Explore  ',
        '▶ tester   ',
        '▶ lane-b   ',
      ])
      await failsWithEdits($, seen, NPM_TEST, 3)
      expect((await bandLines($, 'terminal', 75)).map((line) => line.slice(0, 21))).toEqual([
        'Agents  3 · no open t',
        '▶ lane-b    retry 3  ',
        '▶ Explore   running  ',
        '▶ tester    running  ',
      ])
    },
  )
})

async function personRefuses($: Engine, seen: World, command: string): Promise<void> {
  seen.asked.add(command)
  const call = bashAs($, LANE, command)
  await seen.dialogOpened()
  const callId = seen.askedIds.get(command)
  if (callId === undefined) throw new Error(`no check asked about ${command}`)
  await $.telemetry.log({
    to: 'collector',
    event: 'tool_decision',
    attributes: {
      tool_use_id: callId,
      decision: 'reject',
      source: 'user_reject',
      permission_mode: 'default',
    },
    loggedAt: '2026-11-12T10:00:00.000Z',
  })
  seen.answerDialog(true)
  expect((await call).isError).toBe(true)
  seen.asked.delete(command)
}

describe(RETRY_CRITERION, () => {
  test(
    'a call the person refuses in the permission dialog does not count toward the streak',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await spawn($, seen, LANE, 'lane-b')
      await failsWithEdits($, seen, NPM_TEST, 2)
      await editAs($, LANE)
      await personRefuses($, seen, NPM_TEST)
      expect((await agentLines($, 'terminal', 'inline', 80)).join('\n')).not.toContain('retry')
      await bashAs($, LANE, NPM_TEST)
      expect((await agentLines($, 'terminal', 'inline', 80)).join('\n')).toContain('retry 3')
    },
  )
})

const PROBE = 'test -f /tmp/handily-retry-probe-missing'
const PROBE_ASKED = 'Check that a probe file is missing'
const SEARCH = 'grep -rn handilyRetryNeedle src'
const SEARCH_ASKED = 'Search the sources for the needle'
const MISSING = 'grep -q needle /tmp/handily-retry-missing.txt'
const MISSING_ASKED = 'Search a missing file for the needle'

describe(RETRY_CRITERION, () => {
  test(
    'three test -f and three grep results that Claude Code names Condition is false and No matches found, with a write between, show no retry mark',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await spawn($, seen, LANE, 'lane-b')
      seen.meanings.set(PROBE, 'Condition is false')
      seen.meanings.set(SEARCH, 'No matches found')
      for (let index = 0; index < 3; index += 1) {
        if (index > 0) await writeAs($, LANE)
        await bashAs($, LANE, PROBE, PROBE_ASKED)
        await bashAs($, LANE, SEARCH, SEARCH_ASKED)
      }
      const wait = 'python3 -c "import time; time.sleep(30)"'
      const gate = seen.hold(wait)
      const sleeping = bashAs($, LANE, wait, 'Sleep for 30 seconds')
      await gate.arrived
      expect((await bandLines($, 'terminal', 75))[1]).toBe(
        '▶ lane-b    running   ▸ Bash Sleep for 30 seconds                  open  0s',
      )
      const lines = await agentLines($, 'terminal', 'inline', 80)
      expect(lines[0]).toBe('Agents  1')
      expect(lines.join('\n')).not.toContain('retry')
      expect(lines.join('\n')).not.toContain('fails')
      gate.release()
      await sleeping
    },
  )

  test(
    'three grep calls that Claude Code returns as Error Exit code 2, with a write between, mark retry 3',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await spawn($, seen, LANE, 'lane-b')
      seen.failing.add(MISSING)
      seen.exitCodes.set(MISSING, 2)
      const first = await bashAs($, LANE, MISSING, MISSING_ASKED)
      expect([first.isError, first.result]).toEqual([
        true,
        `Error: Exit code 2\n${MISSING}: failed`,
      ])
      await writeAs($, LANE)
      await bashAs($, LANE, MISSING, MISSING_ASKED)
      await writeAs($, LANE)
      await bashAs($, LANE, MISSING, MISSING_ASKED)
      const wait = 'python3 -c "import time; time.sleep(30)"'
      const gate = seen.hold(wait)
      const sleeping = bashAs($, LANE, wait, 'Sleep for 30 seconds')
      await gate.arrived
      expect((await bandLines($, 'terminal', 75))[1]).toBe(
        '▶ lane-b    retry 3   Bash grep -q needle /tmp/handily-retry-miss… open  0s',
      )
      expect((await agentLines($, 'terminal', 'inline', 80))[0]).toBe('Agents  1 · 1 retry')
      gate.release()
      await sleeping
      seen.failing.delete(MISSING)
      await bashAs($, LANE, MISSING, MISSING_ASKED)
      expect((await agentLines($, 'terminal', 'inline', 80)).join('\n')).not.toContain('retry')
    },
  )
})

const CLEARS_CRITERION = 'When that command passes or the agent ends, the retry mark clears.'

describe(CLEARS_CRITERION, () => {
  test(
    'the mark stays while 5 other commands fail once each, because it clears only on a pass or an end',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await startOn($, 'terminal')
      await spawn($, seen, LANE, 'lane-b')
      await failsWithEdits($, seen, NPM_TEST, 3)
      for (let index = 0; index < 5; index += 1) {
        const other = `npm run step${String(index)}`
        seen.failing.add(other)
        await bashAs($, LANE, other)
      }
      expect((await agentLines($, 'terminal', 'inline', 80))[0]).toBe('Agents  1 · 1 retry')
    },
  )

  for (const surface of SURFACES) {
    test(`the mark clears when the command passes, on ${surface}`, withWorkitems, async ($, on) => {
      const seen = world(on)
      await startOn($, surface)
      await spawn($, seen, LANE, 'lane-b')
      await failsWithEdits($, seen, NPM_TEST, 3)
      expect((await agentLines($, surface, 'inline', 80))[0]).toBe('Agents  1 · 1 retry')
      seen.failing.delete(NPM_TEST)
      await bashAs($, LANE, NPM_TEST)
      const lines = await agentLines($, surface, 'inline', 80)
      expect(lines[0]).toBe('Agents  1')
      expect(lines.join('\n')).not.toContain('retry')
      expect((await bandLines($, surface, 75)).join('\n')).not.toContain('retry')
      seen.failing.add(NPM_TEST)
      await editAs($, LANE)
      await bashAs($, LANE, NPM_TEST)
      expect((await agentLines($, surface, 'inline', 80)).join('\n')).not.toContain('retry')
    })

    test(`the mark clears when the agent ends, on ${surface}`, withWorkitems, async ($, on) => {
      const seen = world(on)
      await startOn($, surface)
      await spawn($, seen, LANE, 'lane-b')
      await failsWithEdits($, seen, NPM_TEST, 3)
      expect((await agentLines($, surface, 'inline', 80))[0]).toBe('Agents  1 · 1 retry')
      seen.agents.splice(0, 1, { ...seen.agents[0], status: 'completed' } as AgentInfo)
      await $.turn.complete({
        turnId: 'turn-lane',
        reason: 'answer',
        answer: 'The tests still fail.',
        durationMs: MINUTE,
        isAborted: false,
        agentId: LANE,
      })
      expect((await agentLines($, surface, 'inline', 80))[0]).toBe('Agents  all 1 done')
      expect((await bandLines($, surface, 75)).join('\n')).not.toContain('retry')
      expect(seen.stored.at(-1)?.find((agent) => agent.id === LANE)?.retries).toBeUndefined()
    })
  }

  test('an agent killed by the list shows no retry mark', withWorkitems, async ($, on) => {
    const seen = world(on)
    await startOn($, 'terminal')
    await spawn($, seen, LANE, 'lane-b')
    await failsWithEdits($, seen, NPM_TEST, 3)
    expect((await agentLines($, 'terminal', 'inline', 80))[0]).toBe('Agents  1 · 1 retry')
    seen.agents.splice(0, 1, { ...seen.agents[0], status: 'killed' } as AgentInfo)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'Pane',
      requestId: PANE,
      props: paneProps('inline', 80),
    })
    await ui.press({ key: 'group:ended-agents' })
    const lines = linesOf(drawnOf(await ui.find({ type: 'Box' })), 80)
    await ui.unmount()
    expect(lines.join('\n')).toContain('killed')
    expect(lines.join('\n')).not.toContain('retry')
  })

  test('an old stored agent with no retry field reads and draws', withWorkitems, async ($, on) => {
    const seen = world(on)
    const old: BoardAgent = {
      id: LANE,
      startedAt: START,
      isSpawnSeen: true,
      seenAt: START,
      endedAt: null,
      tools: 2,
      running: [{ id: 'old-call', tool: 'Bash', target: NPM_TEST_ASKED, startedAt: START }],
      last: { tool: 'Bash', target: NPM_TEST_ASKED },
      calls: [{ tool: 'Bash', target: NPM_TEST_ASKED, outcome: 'failed', at: START }],
      description: 'lane-b',
      type: 'general-purpose',
      name: 'lane-b',
      parentId: null,
      listedStatus: 'running',
      isListed: true,
      hasLoopEvents: true,
    }
    seen.agents.push({
      id: LANE,
      name: 'lane-b',
      type: 'general-purpose',
      status: 'running',
      description: 'lane-b',
    })
    let seed: readonly BoardAgent[] | undefined = [old]
    on('state.set', { plugin: PLUGIN, key: 'agents' }, (_$, e, next) => {
      seed = undefined
      return next(e)
    })
    on('state.get', { plugin: PLUGIN, key: 'agents' }, (_$, e, next) =>
      seed === undefined ? next(e) : { value: { value: seed, version: 0 } },
    )
    await startOn($, 'terminal')
    const lines = await agentLines($, 'terminal', 'inline', 80)
    expect(lines[0]).toBe('Agents  1')
    expect(lines[1]).toContain('lane-b')
    expect(lines.join('\n')).not.toContain('retry')
    await failsWithEdits($, seen, NPM_TEST, 3)
    expect((await agentLines($, 'terminal', 'inline', 80))[0]).toBe('Agents  1 · 1 retry')
  })
})

const MASK_CRITERION =
  'When the retried command carries a token in an argument, the row shows the command through the board credential mask and never the token.'

const SECRET = fake('sk-', 'abc123def456ghi789jkl012')
const CURL = `curl -H "Authorization: Bearer ${SECRET}" https://example.com/api`

describe(MASK_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `a command with a bearer token shows masked in the band and the tab and is never kept, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await spawn($, seen, LANE, 'lane-b')
        await failsWithEdits($, seen, CURL, 3)
        const inline = await agentLines($, surface, 'inline', 120)
        const docked = await agentLines($, surface, 'dock', 40)
        const band = await bandLines($, surface, 115)
        expect(inline[1]).toContain('retry 3')
        expect(inline[1]).toContain('Bash curl -H "Authorization: ***" https://example.com/api')
        expect(docked[2]).toBe('    3 fails: Bash curl -H "Authorizatio…')
        expect(band[1]).toContain('Bash curl -H "Authorization: ***" https://example.com/api')
        const shown = [...inline, ...docked, ...band].join('\n')
        expect(shown).not.toContain(SECRET)
        expect(shown).not.toContain('abc123')
        expect(JSON.stringify(seen.stored)).not.toContain('abc123')
      },
    )
  }
})
