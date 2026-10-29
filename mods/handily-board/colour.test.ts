import type {
  AgentInfo,
  On,
  RenderPropsOf,
  SessionRateLimit,
  ToolCallArgs,
  TurnStepResult,
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
import { displayWidth } from './hooks/width'

const ROOT = '/work/app'
const PANE = 'tasks'
const PLUGIN = 'handily-board'
const TOOL_ADD = 'mcp__handily-board__task_add'
const TOOL_UPDATE = 'mcp__handily-board__task_update'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const START = Date.UTC(2026, 9, 29, 10, 0)
const SURFACES = ['terminal', 'desktop'] as const
const SCOUT = 'a0000002scout'
const TOKEN = `ghp_${'a'.repeat(30)}`

type Surface = (typeof SURFACES)[number]

type Verdict = 'allow' | 'ask' | 'deny'

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

type Flight = { release: () => void; arrived: Promise<void> }

type World = {
  agents: AgentInfo[]
  clock: MockClock
  verdicts: Map<string, Verdict>
  failing: Set<string>
  held: Map<string, Flight>
  redraws: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function askedOf(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  const asked = [input.command, input.file_path, input.pattern].find(
    (value) => typeof value === 'string',
  )
  return typeof asked === 'string' ? asked : undefined
}

function holdOf(): { flight: Flight; arrive: () => void; gate: Promise<void> } {
  let release: () => void = () => undefined
  let arrive: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve
  })
  return { flight: { release, arrived }, arrive, gate }
}

function world(on: On, heldCommands: readonly string[] = []): World {
  const holds = new Map(heldCommands.map((command) => [command, holdOf()]))
  const state: World = {
    agents: [],
    clock: mock.clock(on, { now: START }),
    verdicts: new Map(),
    failing: new Set(),
    held: new Map([...holds].map(([command, one]) => [command, one.flight])),
    redraws: 0,
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.usage', () => ({
    value: { startedAt: START, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: ROOT }))
  on('agent.list', () => ({ value: state.agents }))
  on('agent.spawn', (_$, e) => ({ model: 'opus', agentId: e.tool_use_id.slice('spawn:'.length) }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    await Promise.resolve()
    yield* []
    return stepped(e.turnId)
  })
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Stop', () => ({}))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__handily-board__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', (_$, e, next) => {
    if (e.event === 'ui.render') state.redraws += 1
    return next(e)
  })
  on('tool.check', (_$, e) => ({
    decision: state.verdicts.get(askedOf(e.input) ?? '') ?? 'allow',
  }))
  on('tool.call', async (_$, e) => {
    const asked = askedOf(e) ?? ''
    const held = holds.get(asked)
    if (held !== undefined) {
      held.arrive()
      await held.gate
    }
    if (state.failing.has(asked))
      return { isError: true as const, result: 'exit 1', text: 'exit 1' }
    return { result: '' }
  })
  return state
}

function stepped(turnId: string): TurnStepResult {
  return { turnId, index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
}

async function start($: Engine, surface: Surface = 'terminal'): Promise<void> {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
}

async function board($: Engine, args: string): Promise<string> {
  const result = await $.command.run({
    command: 'board',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  return result.text ?? ''
}

function paneProps(placement: 'dock' | 'inline', bodyColumns: number): RenderPropsOf['Pane'] {
  return {
    title: 'this session',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 60 },
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
  if (element.type === 'Text') return displayWidth(element.text)
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

function padded(text: string, room: number): string {
  return text + ' '.repeat(Math.max(room - displayWidth(text), 0))
}

function rowLine(children: readonly Drawn[], width: number): string {
  const fixed = children
    .filter((child) => child.props.flexGrow !== 1)
    .reduce((sum, child) => sum + drawnWidth(child), 0)
  return children
    .map((child) => {
      const room = child.props.flexGrow === 1 ? width - fixed : drawnWidth(child)
      return padded(screenOf(child, room).join(''), room)
    })
    .join('')
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

async function screenOn(
  $: Engine,
  surface: Surface,
  placement: 'dock' | 'inline',
  columns: number,
): Promise<string[]> {
  const ui = await mountTab($, surface, placement, columns)
  const lines = await screen(ui, columns)
  await ui.unmount()
  return lines
}

function limit(kind: string, percentUsed: number): SessionRateLimit {
  return { kind, percentUsed, resetsAt: new Date(START + 2 * HOUR).toISOString() }
}

async function measure(
  $: Engine,
  percent: number,
  usd: number,
  limits: SessionRateLimit[],
): Promise<void> {
  await $.session.measure({
    context: { window: 200_000, percent, tokens: percent * 2_000 },
    rateLimits: limits,
    cost: { usd },
    changed: ['context', 'cost', 'rateLimits'],
  })
}

async function mainStep(
  $: Engine,
  model: string,
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  agentId?: string,
): Promise<void> {
  const stream = $.turn.step({
    turnId: 'turn-1',
    index: 0,
    model,
    messageCount: 3,
    ...(effort === undefined ? {} : { effort }),
    ...(agentId === undefined ? {} : { agentId }),
  })
  let read = await stream.next()
  while (read.done !== true) read = await stream.next()
}

function classicBase(mode: string) {
  return { session_id: 's1', transcript_path: '/work/t.jsonl', cwd: ROOT, permission_mode: mode }
}

async function spawn($: Engine, id: string, name: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `spawn:${id}`,
    prompt: 'scout the hooks',
    description: 'scout the hooks',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
    name,
  })
}

function inLoop(input: ToolCallArgs, agentId: string): ToolCallArgs {
  return Object.assign({}, input, { agentId })
}

async function addTasks($: Engine): Promise<void> {
  for (const title of ['Read the design', 'Build the vitals line', 'Wire the waits']) {
    await $.tool.call({ tool: TOOL_ADD, title })
  }
  await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed' })
  await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'in_progress' })
}

async function edit($: Engine, file: string): Promise<void> {
  await $.tool.call({
    tool: 'Edit',
    file_path: `${ROOT}/${file}`,
    old_string: 'a',
    new_string: 'b',
  })
}

async function fullScene($: Engine, seen: World, surface: Surface = 'terminal'): Promise<void> {
  await start($, surface)
  await addTasks($)
  await measure($, 71, 9.02, [limit('five_hour', 31), limit('seven_day', 13)])
  await mainStep($, 'claude-opus-5-5', 'high')
  await $.classic.UserPromptSubmit({
    ...classicBase('acceptEdits'),
    prompt: 'go on',
  })
  await $.turn.start({ text: 'go on', turnId: 'turn-1' })
  await edit($, 'hooks/vitals.ts')
  await edit($, 'hooks/pane.tsx')
  await seen.clock.advance(3 * MINUTE)
  await measure($, 71, 9.33, [limit('five_hour', 31), limit('seven_day', 13)])
  await spawn($, SCOUT, 'scout')
  seen.agents.push({
    id: SCOUT,
    type: 'general-purpose',
    status: 'running',
    name: 'scout',
    description: 'scout the hooks',
  })
}

type Coloured = { text: string; color: unknown; bold: unknown; dim: unknown }

async function coloured(ui: { find: Mounted['find'] }, key: string): Promise<Coloured[]> {
  const found = drawnOf(await ui.find({ key }))
  if (found === null) throw new Error(`nothing is drawn under ${key}`)
  return texts(found).map((text) => ({
    text: text.text,
    color: text.props.color,
    bold: text.props.bold,
    dim: text.props.dimColor,
  }))
}

function colourOf(parts: readonly Coloured[], text: string): unknown {
  return parts.find((part) => part.text === text)?.color
}

const FRAME_CRITERION =
  'When the board body is 41 columns or more on the terminal, the Session, Tasks and Agents sections each draw in a rounded text frame in their role key, with the section title on the top edge; below 41 columns, inline and on the desktop no frame draws and each title draws bold in its role key'

const FRAMED_41 = [
  '╭─ Session ─────────────────────────────╮',
  '│ ctx ▰▰▰▰▰▰▰▱▱▱ 71%                    │',
  '│ $9.33 · 5h ▰▱▱▱▱ 31% · 7d ▱▱▱▱▱ 13%   │',
  '│ opus-5-5 · high · accept edits        │',
  '│ turn 3m · 2 edits · 0 errors · +$0.31 │',
  '│ gate ▮▮ f2                            │',
  '╰───────────────────────────────────────╯',
  '╭─ Tasks  ▰▰▱ 1/3 · ▶1 ○1 · 3m ─────────╮',
  '│ ▶ 2 Build the vitals line   3m [ rm ] │',
  '│     ▸ Edit hooks/pane.tsx     2 tools │',
  '│ ○ 3 Wire the waits             [ rm ] │',
  '│ [ +1 done ]                           │',
  '╰───────────────────────────────────────╯',
  '╭─ Agents  1 ───────────────────────────╮',
  '│ ▶ scout     running          open  0s │',
  '╰───────────────────────────────────────╯',
  '',
  '[ Add a task ][Add]',
]

const EDGE = /[╭╮╰╯│─]/u

describe(FRAME_CRITERION, () => {
  test(
    'at body 41 on the terminal the three sections draw in text frames with the title on the top edge, as mock B1',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await fullScene($, seen)
      const ui = await mountTab($, 'terminal', 'dock', 41)
      expect(await screen(ui, 41)).toEqual(FRAMED_41)
      const looks = [
        ['frame:session', 'Session', 'claude'],
        ['frame:tasks', 'Tasks', 'planMode'],
        ['frame:agents', 'Agents', 'merged'],
      ] as const
      for (const [key, title, color] of looks) {
        const parts = await coloured(ui, key)
        const edges = parts.filter((part) => EDGE.test(part.text))
        expect(edges.length).toBeGreaterThan(2)
        expect(new Set(edges.map((part) => part.color))).toEqual(new Set([color]))
        expect(parts.find((part) => part.text === title)).toEqual({
          text: title,
          color,
          bold: true,
          dim: undefined,
        })
      }
      await ui.unmount()
      const wide = await screenOn($, 'terminal', 'dock', 60)
      expect(wide[0]).toBe(`╭─ Session ${'─'.repeat(48)}╮`)
    },
  )

  test(
    'below body 41, inline above the prompt and on the desktop no frame draws, and each title is bold in its role key',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await fullScene($, seen)
      const views = [
        ['terminal', 'dock', 40],
        ['terminal', 'dock', 30],
        ['terminal', 'inline', 76],
        ['desktop', 'dock', 41],
        ['desktop', 'dock', 80],
      ] as const
      for (const [surface, placement, columns] of views) {
        const ui = await mountTab($, surface, placement, columns)
        const lines = await screen(ui, columns)
        expect(lines.join('\n')).not.toMatch(/[╭╮╰╯│]/u)
        expect(lines[0]?.startsWith('Session  ctx ▰▰▰▰▰▰▰▱▱▱ 71%')).toBe(true)
        for (const [key, title, color] of [
          ['session', 'Session', 'claude'],
          ['tasks-header', 'Tasks', 'planMode'],
          ['agents', 'Agents', 'merged'],
        ] as const) {
          const parts = await coloured(ui, key)
          expect(parts[0]).toEqual({ text: title, color, bold: true, dim: undefined })
        }
        await ui.unmount()
      }
    },
  )

  test(
    'with no agent the terminal draws no Agents frame and says no agents yet under the Tasks frame, as mock B2',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      const framed = await screenOn($, 'terminal', 'dock', 41)
      expect(framed.slice(0, 5)).toEqual([
        '╭─ Session ─────────────────────────────╮',
        '│ ctx — until the first reply           │',
        '│ limits — until the first reply        │',
        '│ gate no checks yet                    │',
        '╰───────────────────────────────────────╯',
      ])
      expect(framed.filter((line) => line.startsWith('╭─ Agents'))).toEqual([])
      expect(framed.at(-3)).toBe('No agents yet.')
      expect(framed.at(-4)?.startsWith('╰')).toBe(true)
      const flat = await screenOn($, 'desktop', 'dock', 41)
      expect(flat[0]).toBe('Session  ctx — until the first reply')
      expect(flat[1]?.startsWith('Tasks')).toBe(true)
      expect(flat).toContain('No agents yet.')
    },
  )
})

const GAUGE_CRITERION =
  'When the context percent is known, the Session section shows a ten-cell gauge and the percent, and the 5 hour and 7 day limits show five-cell gauges with their percents; a gauge rounds down, the percent always prints, and at 80 percent or more the gauge and the percent draw in warning with the word high'

const GAUGE_VIEWS: readonly {
  surface: Surface
  placement: 'dock' | 'inline'
  columns: number
  lines: readonly string[]
}[] = [
  {
    surface: 'terminal',
    placement: 'dock',
    columns: 41,
    lines: [
      '│ ctx ▰▰▰▰▰▰▰▱▱▱ 71%                    │',
      '│ $9.02 · 5h ▰▱▱▱▱ 31% · 7d ▱▱▱▱▱ 13%   │',
    ],
  },
  {
    surface: 'desktop',
    placement: 'dock',
    columns: 41,
    lines: ['Session  ctx ▰▰▰▰▰▰▰▱▱▱ 71% · $9.02', '5h ▰▱▱▱▱ 31% · 7d ▱▱▱▱▱ 13%'],
  },
  {
    surface: 'terminal',
    placement: 'dock',
    columns: 30,
    lines: ['Session  ctx ▰▰▰▰▰▰▰▱▱▱ 71%', '$9.02 · 5h ▰▱▱▱▱ 31% · 7d 13%'],
  },
  {
    surface: 'terminal',
    placement: 'inline',
    columns: 76,
    lines: ['Session  ctx ▰▰▰▰▰▰▰▱▱▱ 71% · $9.02 · 5h ▰▱▱▱▱ 31% · 7d ▱▱▱▱▱ 13%'],
  },
]

describe(GAUGE_CRITERION, () => {
  for (const { surface, placement, columns, lines } of GAUGE_VIEWS) {
    test(
      `the context and the two limits draw gauges that round down, as mock B1, at ${String(columns)} columns, ${placement}, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($, surface)
        await measure($, 71, 9.02, [limit('five_hour', 31), limit('seven_day', 13)])
        const shown = await screenOn($, surface, placement, columns)
        const first = shown.findIndex((line) => line.includes('ctx'))
        expect(shown.slice(first, first + lines.length)).toEqual(lines)
        const ui = await mountTab($, surface, placement, columns)
        const parts = await coloured(ui, 'session')
        expect(colourOf(parts, '▰▰▰▰▰▰▰')).toBe('claude')
        expect(colourOf(parts, '▱▱▱')).toBe('subtle')
        expect(parts.find((part) => part.text === '71%')?.dim).toBe(true)
        await ui.unmount()
      },
    )
  }

  test(
    'at 80 percent and more the gauge and the percent take the warning colour with the word high, and the 7d gauge drops first, as mock B5',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, 91, 12.4, [limit('five_hour', 84), limit('seven_day', 13)])
      expect((await screenOn($, 'terminal', 'dock', 41)).slice(1, 3)).toEqual([
        '│ ctx ▰▰▰▰▰▰▰▰▰▱ 91% high               │',
        '│ $12.40 · 5h ▰▰▰▰▱ 84% high · 7d 13%   │',
      ])
      expect((await screenOn($, 'desktop', 'dock', 41)).slice(0, 2)).toEqual([
        'Session  ctx ▰▰▰▰▰▰▰▰▰▱ 91% high · $12.40',
        '5h ▰▰▰▰▱ 84% high · 7d ▱▱▱▱▱ 13%',
      ])
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const head = await coloured(ui, 'session')
        expect(colourOf(head, '▰▰▰▰▰▰▰▰▰')).toBe('warning')
        expect(colourOf(head, '91% high')).toBe('warning')
        const money = surface === 'terminal' ? 'session-money' : 'session-more'
        const limits = await coloured(ui, money)
        expect(colourOf(limits, '▰▰▰▰')).toBe('warning')
        expect(colourOf(limits, '84% high')).toBe('warning')
        await ui.unmount()
      }
    },
  )

  test(
    'a gauge never overstates: 19.9 percent fills 1 of 10 cells, 99 percent fills 9, and 9 percent of a limit fills none',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, 19.9, 1, [limit('five_hour', 9), limit('seven_day', 99)])
      for (const surface of SURFACES) {
        const lines = (await screenOn($, surface, 'inline', 76)).slice(0, 1)
        expect(lines).toEqual([
          'Session  ctx ▰▱▱▱▱▱▱▱▱▱ 20% · $1.00 · 5h ▱▱▱▱▱ 9% · 7d ▰▰▰▰▱ 99% high',
        ])
      }
    },
  )
})

const GATE_CRITERION =
  'When permission checks have run, the Session section shows one cell for each of the last 20 checks, oldest first, the counts of the file family, the shell family and every other tool, and 1 denied in error in place of the counts when a denied check is among the last 20; /board stats lists the same verdicts as words'

async function checksRun($: Engine, seen: World, count: number): Promise<void> {
  seen.verdicts.set('npm test', 'ask')
  for (let index = 0; index < count; index += 1) {
    const kind = index % 5
    if (kind === 0) await $.tool.call({ tool: 'Bash', command: 'npm test' })
    else if (kind === 1) await $.tool.call({ tool: 'mcp__search__grep', pattern: 'ui.render' })
    else await $.tool.call({ tool: 'Read', file_path: `${ROOT}/hooks/file${String(index)}.ts` })
  }
}

describe(GATE_CRITERION, () => {
  test(
    'the gate row draws the last 20 of 25 checks, oldest first, in their verdict colours with the family counts, on terminal and desktop',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await checksRun($, seen, 25)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const gate = await coloured(ui, 'session-gate')
        expect(gate.map((part) => part.text).join('')).toBe('gate ▯▮▮▮▮▯▮▮▮▮▯▮▮▮▮▯▮▮▮▮ f15 s5 o5')
        expect(colourOf(gate, '▯')).toBe('permission')
        expect(colourOf(gate, '▮▮▮▮')).toBe('success')
        expect(gate.find((part) => part.text === 'f15 s5 o5')?.dim).toBe(true)
        await ui.unmount()
      }
      expect(
        (await screenOn($, 'terminal', 'dock', 30)).find((line) => line.startsWith('gate')),
      ).toBe('gate ▯▮▮▮▮▯▮▮▮▮▯▮▮▮▮▯▮▮▮▮')
    },
  )

  test(
    'a denied check among the last 20 puts 1 denied in error in place of the counts, and /board stats lists the verdicts as words',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await checksRun($, seen, 4)
      seen.verdicts.set('git push', 'deny')
      expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).isError).toBe(true)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const gate = await coloured(ui, 'session-gate')
        expect(gate.map((part) => part.text).join('')).toBe('gate ▯▮▮▮■ 1 denied')
        expect(colourOf(gate, '■')).toBe('error')
        expect(colourOf(gate, '1 denied')).toBe('error')
        await ui.unmount()
      }
      const lines = (await board($, 'stats')).split('\n')
      expect(lines).toContain('    checks 5 · 3 allowed · 1 asked · 1 denied')
      expect(lines).toContain('    file 2 · shell 2 · other 1')
      expect(lines).toContain('    last 5 checks, oldest first: 1 asked, 3 allowed, 1 denied')
    },
  )

  test(
    'before any check the framed gate row says no checks yet and the flat board draws no gate row, and the opened details name each family in words, as mock B3',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      expect(await screenOn($, 'terminal', 'dock', 41)).toContain(
        '│ gate no checks yet                    │',
      )
      expect((await screenOn($, 'desktop', 'dock', 41)).join('\n')).not.toContain('gate')
      await checksRun($, seen, 5)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'session' })
        const lines = await screen(ui, 41)
        const families = 'file 3 · shell 1 · other 1'
        expect(lines).toContain(
          surface === 'terminal' ? `│   ${families.padEnd(35)} │` : `    ${families}`,
        )
        await ui.press({ key: 'session' })
        await ui.unmount()
      }
    },
  )
})

const MODEL_CRITERION =
  'When a main-loop request starts, the Session section shows the model id without a leading claude-, the effort of that request and the permission mode from the latest classic SessionStart, UserPromptSubmit or Stop event; a part with no source is left out'

async function modelLine($: Engine, surface: Surface): Promise<Coloured[] | undefined> {
  const ui = await mountTab($, surface, 'dock', 41)
  const found = await ui.find({ key: 'session-request' })
  const parts = found === undefined ? undefined : await coloured(ui, 'session-request')
  await ui.unmount()
  return parts
}

function lineText(parts: readonly Coloured[] | undefined): string | undefined {
  return parts?.map((part) => part.text).join('')
}

describe(MODEL_CRITERION, () => {
  test(
    'the model, the effort and the mode show from their own sources, each mode word in its key, on terminal and desktop',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      for (const surface of SURFACES) expect(await modelLine($, surface)).toBeUndefined()
      await mainStep($, 'claude-opus-5-5', 'high')
      for (const surface of SURFACES) {
        expect(lineText(await modelLine($, surface))).toBe('opus-5-5 · high')
      }
      const modes = [
        ['SessionStart', 'plan', 'plan', 'planMode'],
        ['UserPromptSubmit', 'acceptEdits', 'accept edits', 'autoAccept'],
        ['Stop', 'bypassPermissions', 'bypass', 'error'],
        ['UserPromptSubmit', 'default', 'default', undefined],
      ] as const
      for (const [event, mode, word, color] of modes) {
        if (event === 'SessionStart') {
          await $.classic.SessionStart({
            ...classicBase(mode),
            source: 'startup',
          })
        } else if (event === 'Stop') {
          await $.classic.Stop({
            ...classicBase(mode),
            stop_hook_active: false,
          })
        } else {
          await $.classic.UserPromptSubmit({
            ...classicBase(mode),
            prompt: 'go on',
          })
        }
        for (const surface of SURFACES) {
          const parts = await modelLine($, surface)
          expect(lineText(parts)).toBe(`opus-5-5 · high · ${word}`)
          expect(colourOf(parts ?? [], word)).toBe(color)
        }
      }
    },
  )

  test(
    'a model with no effort leaves the effort out, a subagent step and a subagent event change nothing, and a mode alone shows alone',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await $.classic.UserPromptSubmit({
        ...classicBase('acceptEdits'),
        prompt: 'go on',
      })
      for (const surface of SURFACES) {
        expect(lineText(await modelLine($, surface))).toBe('accept edits')
      }
      await mainStep($, 'haiku-4-5')
      await mainStep($, 'claude-sonnet-5', 'max', SCOUT)
      await $.classic.Stop({
        ...classicBase('plan'),
        stop_hook_active: false,
        agent_id: SCOUT,
      })
      for (const surface of SURFACES) {
        expect(lineText(await modelLine($, surface))).toBe('haiku-4-5 · accept edits')
      }
      const before = seen.redraws
      await mainStep($, 'haiku-4-5')
      expect(seen.redraws).toBe(before)
      await mainStep($, 'claude-opus-5-5', 'low')
      expect(seen.redraws).toBe(before + 1)
      expect((await board($, 'stats')).split('\n')).toContain(
        '    model opus-5-5, effort low, mode accept edits',
      )
    },
  )

  test(
    'where the row is too narrow the mode word is cut with an ellipsis, as mock B6',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await mainStep($, 'claude-opus-5-5', 'high')
      await $.classic.UserPromptSubmit({
        ...classicBase('acceptEdits'),
        prompt: 'go on',
      })
      for (const surface of SURFACES) {
        expect(await screenOn($, surface, 'dock', 30)).toContain('opus-5-5 · high · accept edits')
        expect(await screenOn($, surface, 'dock', 28)).toContain('opus-5-5 · high · accept ed…')
      }
    },
  )
})

const RECEIPT_CRITERION =
  'When a turn runs, the Session section shows the turn duration, the edits, the errors and the cost added; when the session is idle, the same row shows the last turn dim'

describe(RECEIPT_CRITERION, () => {
  test(
    'a running turn shows its receipt, and the idle session shows the last turn in the same row, dim, on terminal and desktop',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await measure($, 62, 4.18, [])
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        expect(await ui.find({ key: 'session-receipt' })).toBeUndefined()
        await ui.unmount()
      }
      await $.turn.start({ text: 'go on', turnId: 'turn-1' })
      await edit($, 'hooks/vitals.ts')
      await edit($, 'hooks/pane.tsx')
      seen.failing.add('npm test')
      await $.tool.call({ tool: 'Bash', command: 'npm test' })
      await seen.clock.advance(3 * MINUTE)
      await measure($, 62, 4.49, [])
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const receipt = await coloured(ui, 'session-receipt')
        expect(lineText(receipt)).toBe('turn 3m · 2 edits · 1 error · +$0.31')
        expect(colourOf(receipt, '1 error')).toBe('error')
        expect(receipt.filter((part) => part.text !== '1 error').every((part) => part.dim)).toBe(
          true,
        )
        await ui.unmount()
      }
      await $.turn.complete({
        turnId: 'turn-1',
        reason: 'answer',
        answer: 'done',
        durationMs: 3 * MINUTE,
        isAborted: false,
      })
      await seen.clock.advance(MINUTE)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 41)
        const receipt = await coloured(ui, 'session-receipt')
        expect(lineText(receipt)).toBe('last 3m · 2 edits · 1 error · +$0.31')
        await ui.unmount()
      }
    },
  )

  test(
    'at body 30 the receipt drops 0 errors and keeps the cost, as mock B6, and an error count above 0 is never cut',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await measure($, 62, 4.18, [])
      await $.turn.start({ text: 'go on', turnId: 'turn-1' })
      await edit($, 'hooks/vitals.ts')
      await edit($, 'hooks/pane.tsx')
      await seen.clock.advance(3 * MINUTE)
      await measure($, 62, 4.49, [])
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 30)
        expect(lineText(await coloured(ui, 'session-receipt'))).toBe('turn 3m · 2 edits · +$0.31')
        await ui.unmount()
        expect(await screenOn($, surface, 'dock', 41)).toContain(
          surface === 'terminal'
            ? '│ turn 3m · 2 edits · 0 errors · +$0.31 │'
            : 'turn 3m · 2 edits · 0 errors · +$0.31',
        )
      }
      seen.failing.add('npm test')
      await $.tool.call({ tool: 'Bash', command: 'npm test' })
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, 'dock', 30)
        expect(lineText(await coloured(ui, 'session-receipt'))).toBe('turn 3m · 2 edits · 1 error…')
        await ui.unmount()
      }
    },
  )
})

const CALLS_CRITERION =
  'When the person opens a subagent row, the board shows the last 3 tool calls of that agent, each with a mark for its outcome and its age, and, once the agent has ended, the first line of its answer, with credentials masked as in the checks'

const HELD = 'npm run check'

async function scoutWorks(
  $: Engine,
  seen: World,
  surface: Surface,
): Promise<{ held: Promise<unknown> }> {
  await start($, surface)
  await $.tool.call({ tool: TOOL_ADD, title: 'Build the vitals line' })
  await spawn($, SCOUT, 'scout')
  seen.agents.push({
    id: SCOUT,
    type: 'general-purpose',
    status: 'running',
    name: 'scout',
    description: 'scout the hooks',
  })
  seen.failing.add('npm test')
  await $.tool.call(inLoop({ tool: 'Read', file_path: `${ROOT}/docs/design.md` }, SCOUT))
  await seen.clock.advance(20_000)
  await $.tool.call(inLoop({ tool: 'Bash', command: `echo ${TOKEN}` }, SCOUT))
  await seen.clock.advance(17_000)
  await $.tool.call(inLoop({ tool: 'Bash', command: 'npm test' }, SCOUT))
  const held = $.tool.call(inLoop({ tool: 'Bash', command: HELD }, SCOUT))
  await seen.held.get(HELD)?.arrived
  await seen.clock.advance(3_000)
  return { held }
}

async function openedScout(
  $: Engine,
  surface: Surface,
  columns: number,
): Promise<{ lines: string[]; parts: Coloured[] }> {
  const ui = await mountTab($, surface, 'dock', columns)
  if ((await ui.find({ key: `answer:agent:${SCOUT}` })) === undefined) {
    await ui.press({ key: `open:agent:${SCOUT}` })
  }
  const lines = await screen(ui, columns)
  const parts = await coloured(ui, `under:agent:${SCOUT}`)
  await ui.unmount()
  return { lines, parts }
}

function bare(line: string | undefined): string | undefined {
  return line?.replace(/^[│ ]+|[│ ]+$/gu, '')
}

function underScout(lines: readonly string[]): string[] {
  const at = lines.findIndex((line) => line.includes('last calls'))
  return lines.slice(at, at + 5)
}

describe(CALLS_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `an opened running agent shows its last 3 calls with a mark and an age, the newest running, and no answer yet, as mock B4a, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [HELD])
        const { held } = await scoutWorks($, seen, surface)
        const { lines, parts } = await openedScout($, surface, 41)
        expect(underScout(lines)).toEqual(
          surface === 'terminal'
            ? [
                '│     last calls                        │',
                '│       ✓ Bash echo ***             20s │',
                '│       ■ Bash npm test              3s │',
                '│       ▸ Bash npm run check         3s │',
                '│     answer: none yet                  │',
              ]
            : [
                '    last calls',
                '      ✓ Bash echo ***                 20s',
                '      ■ Bash npm test                  3s',
                '      ▸ Bash npm run check             3s',
                '    answer: none yet',
              ],
        )
        expect(lines.join('\n')).not.toContain(TOKEN)
        expect(colourOf(parts, '✓ ')).toBe('success')
        expect(colourOf(parts, '■ ')).toBe('error')
        expect(parts.find((part) => part.text === '▸ ')?.dim).toBe(true)
        expect(parts.find((part) => part.text === 'answer: ')?.dim).toBe(true)
        seen.held.get(HELD)?.release()
        await held
      },
    )

    test(
      `an ended agent shows the first line of its answer with credentials masked, and a failed agent says none, the run failed, as mock B4b, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [HELD])
        const { held } = await scoutWorks($, seen, surface)
        seen.held.get(HELD)?.release()
        await held
        await $.turn.complete({
          turnId: 'scout-turn',
          reason: 'answer',
          answer: `\nTwo mods read ui.render with token=${TOKEN} and more words here.\nThe rest.`,
          durationMs: MINUTE,
          isAborted: false,
          agentId: SCOUT,
        })
        seen.agents.splice(0, 1, {
          id: SCOUT,
          type: 'general-purpose',
          status: 'completed',
          name: 'scout',
          description: 'scout the hooks',
        })
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'group:ended-agents' })
        await ui.unmount()
        const ended = await openedScout($, surface, 41)
        const answer = ended.lines.find((line) => line.includes('answer:'))
        expect(bare(answer)).toBe(
          surface === 'terminal'
            ? 'answer: Two mods read ui.render …'
            : 'answer: Two mods read ui.render with…',
        )
        expect(ended.lines.join('\n')).not.toContain(TOKEN)
        expect(ended.lines.some((line) => line.includes('✓ Bash npm run check'))).toBe(true)
        expect((await board($, 'stats')).includes(TOKEN)).toBe(false)
        seen.agents.splice(0, 1, {
          id: SCOUT,
          type: 'general-purpose',
          status: 'failed',
          name: 'scout',
          description: 'scout the hooks',
        })
        const failed = await openedScout($, surface, 41)
        const none = failed.lines.find((line) => line.includes('answer:'))
        expect(bare(none)).toBe('answer: none, the run failed')
        expect(colourOf(failed.parts, 'none, the run failed')).toBe('error')
      },
    )
  }
})
