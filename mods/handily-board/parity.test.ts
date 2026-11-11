import type {
  AgentInfo,
  ConfigRow,
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
import { NEEDS_YOU_AFTER_MS, RUN_SETTLE_MS } from './hooks/agents'
import { displayWidth } from './hooks/width'

const ROOT = '/work/app'
const PANE = 'tasks'
const PLUGIN = 'handily-board'
const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const START = new Date(2026, 9, 30, 14, 0, 0).getTime()
const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [41, 30, 76, 89] as const
const SCOUT = 'a0000002scout'
const EXPLORE = 'a0000003explore'
const TOKEN = `ghp_${'a'.repeat(30)}`
const MOCHA = 'catppuccin-mocha'

type Surface = (typeof SURFACES)[number]

type Placement = 'dock' | 'inline'

type Verdict = 'allow' | 'ask' | 'deny'

type StepUsage = { fresh: number; written: number; read: number; output: number }

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

type Config = { theme: string | undefined; palette: string | undefined; isRefused: boolean }

type World = {
  agents: AgentInfo[]
  clock: MockClock
  verdicts: Map<string, Verdict>
  failing: Set<string>
  usage: Map<string, StepUsage>
  config: Config
  ttftMs: number | undefined
  isTabShown: boolean
  redraws: number
  isAskHeld: boolean
  waiting: (() => void)[]
  asked: Promise<void>
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

function stepped(turnId: string, usage: StepUsage | undefined): TurnStepResult {
  return {
    turnId,
    index: 0,
    answer: '',
    toolUses: [],
    stopReason: 'end_turn',
    usage:
      usage === undefined
        ? null
        : {
            model: 'opus',
            input_tokens: usage.fresh,
            cache_creation_input_tokens: usage.written,
            cache_read_input_tokens: usage.read,
            output_tokens: usage.output,
          },
  }
}

function configRow(key: string, value: string, plugin: string): ConfigRow {
  return {
    key,
    label: key,
    kind: 'choice',
    value,
    provider: { plugin, tier: plugin === 'engine' ? 'core' : 'user' },
    isLocked: false,
  }
}

function configRows(config: Config): ConfigRow[] {
  if (config.isRefused) throw new Error('the config menu cannot be listed on this host')
  return [
    ...(config.theme === undefined ? [] : [configRow('theme', config.theme, 'engine')]),
    ...(config.palette === undefined
      ? []
      : [configRow('handily.palette', config.palette, 'handily@niksavis')]),
  ]
}

function world(on: On): World {
  let ask = (): void => undefined
  const state: World = {
    agents: [],
    clock: mock.clock(on, { now: START }),
    verdicts: new Map(),
    failing: new Set(),
    usage: new Map(),
    config: { theme: 'dark', palette: undefined, isRefused: false },
    ttftMs: undefined,
    isTabShown: true,
    redraws: 0,
    isAskHeld: false,
    waiting: [],
    asked: new Promise<void>((resolve) => {
      ask = resolve
    }),
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.usage', () => ({
    value: { startedAt: START, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('config.list', () => ({ value: configRows(state.config) }))
  on('config.set', (_$, e) => ({ value: e.value }))
  on('agent.list', () => ({ value: state.agents }))
  on('agent.spawn', (_$, e) => ({ model: 'opus', agentId: e.tool_use_id.slice('spawn:'.length) }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_$, e) {
    if (e.agentId === undefined && state.ttftMs !== undefined) {
      await state.clock.advance(state.ttftMs)
      yield { kind: 'text' as const, index: 0, text: 'hello' }
    }
    await Promise.resolve()
    return stepped(e.turnId, e.agentId === undefined ? undefined : state.usage.get(e.agentId))
  })
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__handily-board__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({
    value: [
      {
        id: PANE,
        title: 'this session',
        isShown: state.isTabShown,
        isFocused: false,
        isPlaced: true,
      },
    ],
  }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true as const, channel: 'kitty' as const } }))
  on('ui.invalidate', (_$, e, next) => {
    if (e.event === 'ui.render') state.redraws += 1
    return next(e)
  })
  on('tool.check', (_$, e) => ({
    decision: state.verdicts.get(askedOf(e.input) ?? '') ?? 'allow',
  }))
  on('classic.PermissionRequest', async () => {
    if (state.isAskHeld) {
      await new Promise<void>((resolve) => {
        state.waiting.push(resolve)
        ask()
      })
    }
    return { decision: { behavior: 'allow' as const } }
  })
  on('tool.call', (_$, e) => {
    const asked = askedOf(e) ?? ''
    if (state.failing.has(asked)) {
      return { isError: true as const, result: 'exit 1', text: 'exit 1' }
    }
    return { result: '' }
  })
  return state
}

async function start($: Engine, surface: Surface): Promise<void> {
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

function paneProps(
  placement: Placement,
  bodyColumns: number,
  inView?: string,
): RenderPropsOf['Pane'] {
  return {
    title: 'this session',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 80 },
    view: inView === undefined ? {} : { agentId: inView },
  }
}

async function mountTab(
  $: Engine,
  surface: Surface,
  placement: Placement,
  columns: number,
  inView?: string,
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: paneProps(placement, columns, inView),
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

function hotkeyText(element: Drawn): string {
  const { hotkey, plain } = element.props
  return plain === true && typeof hotkey === 'string' ? `${hotkey}: ` : ''
}

function buttonText(element: Drawn): string {
  if (element.props.plain === true) return `${hotkeyText(element)}${element.text}`
  return `[ ${element.text} ]`
}

function drawnWidth(element: Drawn): number {
  if (element.type === 'Text') return displayWidth(element.text)
  if (element.type === 'Button') return displayWidth(buttonText(element))
  const inner =
    typeof element.props.width === 'number'
      ? element.props.width
      : element.children.reduce((sum, child) => sum + drawnWidth(child), 0)
  return inner + numberProp(element, 'marginLeft') + numberProp(element, 'paddingLeft')
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
      const margin = numberProp(child, 'marginLeft')
      return padded(' '.repeat(margin) + screenOf(child, room - margin).join(''), room)
    })
    .join('')
}

function screenOf(element: Drawn, width: number): string[] {
  if (element.type === 'Text') return [element.text]
  if (element.type === 'Button') return [buttonText(element)]
  if (element.type === 'Input') {
    return [`[ ${String(element.props.placeholder)} ][${String(element.props.submitLabel)}]`]
  }
  const indent = numberProp(element, 'paddingLeft')
  const inner = width - indent
  const lines =
    element.props.flexDirection === 'column'
      ? element.children.flatMap((child) => screenOf(child, inner))
      : [rowLine(element.children, inner)]
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

async function screenOn(
  $: Engine,
  surface: Surface,
  placement: Placement,
  columns: number,
  inView?: string,
): Promise<string[]> {
  const ui = await mountTab($, surface, placement, columns, inView)
  const lines = await screen(ui, columns)
  await ui.unmount()
  return lines
}

function cutTo(text: string, room: number): string {
  if (displayWidth(text) <= room) return text
  return `${text.slice(0, room - 1)}…`
}

function framed(surface: Surface, columns: number): boolean {
  return surface === 'terminal' && columns >= 41
}

function inner(line: string): string {
  return line.replace(/^│ /u, '').replace(/ │$/u, '').trimEnd()
}

function body(lines: readonly string[]): string[] {
  return lines.map(inner)
}

type Coloured = { text: string; color: unknown; bold: unknown; dim: unknown }

function texts(element: Drawn): Drawn[] {
  if (element.type === 'Text') return [element]
  return element.children.flatMap(texts)
}

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

async function buttonOf(ui: { find: Mounted['find'] }, key: string): Promise<Drawn> {
  const found = drawnOf(await ui.find({ key }))
  if (found === null) throw new Error(`no Button ${key} is drawn`)
  return found
}

function limit(kind: string, percentUsed: number, resetsInMs: number): SessionRateLimit {
  return { kind, percentUsed, resetsAt: new Date(START + resetsInMs).toISOString() }
}

async function measure($: Engine, usd = 9.02): Promise<void> {
  await $.session.measure({
    context: { window: 1_000_000, percent: 66.3, tokens: 663_000 },
    rateLimits: [limit('five_hour', 31, 2 * HOUR), limit('seven_day', 13, 4 * DAY)],
    cost: { usd },
    changed: ['context', 'cost', 'rateLimits'],
  })
}

async function mainStep($: Engine, turnId = 'turn-1'): Promise<void> {
  const stream = $.turn.step({
    turnId,
    index: 0,
    model: 'claude-opus-5-5',
    effort: 'high',
    messageCount: 3,
  })
  let read = await stream.next()
  while (read.done !== true) read = await stream.next()
}

async function agentStep($: Engine, agentId: string, turnId: string): Promise<void> {
  const stream = $.turn.step({ turnId, index: 0, model: 'opus', messageCount: 3, agentId })
  let read = await stream.next()
  while (read.done !== true) read = await stream.next()
}

function inLoop(input: ToolCallArgs, agentId: string): ToolCallArgs {
  return Object.assign({}, input, { agentId })
}

async function spawn($: Engine, id: string, name: string, description: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `spawn:${id}`,
    prompt: description,
    description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
    name,
  })
}

function listed(id: string, name: string, type: string, description: string): AgentInfo {
  return { id, type, status: 'running', name, description }
}

async function bash($: Engine, command: string, agentId?: string): Promise<void> {
  const input: ToolCallArgs = { tool: 'Bash', command }
  await $.tool.call(agentId === undefined ? input : inLoop(input, agentId))
}

async function edit($: Engine, file: string, agentId?: string): Promise<void> {
  const input: ToolCallArgs = {
    tool: 'Edit',
    file_path: `${ROOT}/${file}`,
    old_string: 'a',
    new_string: 'b',
  }
  await $.tool.call(agentId === undefined ? input : inLoop(input, agentId))
}

async function read($: Engine, file: string): Promise<void> {
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/${file}` })
}

async function prompt($: Engine, text: string): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

async function turnStarts($: Engine, turnId = 'turn-1'): Promise<void> {
  await $.turn.start({ text: 'go on', turnId })
}

async function turnEnds($: Engine, turnId = 'turn-1', agentId?: string): Promise<void> {
  await $.turn.complete({
    turnId,
    reason: 'answer',
    answer: 'done',
    durationMs: 4 * MINUTE,
    isAborted: false,
    ...(agentId === undefined ? {} : { agentId }),
  })
}

async function checks($: Engine, seen: World): Promise<void> {
  seen.verdicts.set('npm test', 'ask')
  seen.verdicts.set(`git push https://${TOKEN}@example.org/repo`, 'deny')
  await read($, 'docs/design.md')
  await bash($, 'npm test')
  await bash($, 'git status')
  await bash($, `git push https://${TOKEN}@example.org/repo`)
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.org', prompt: 'read it' })
}

async function sessionScene($: Engine, seen: World, surface: Surface): Promise<void> {
  await start($, surface)
  await measure($)
  seen.ttftMs = 1_200
  await mainStep($)
  await turnStarts($)
  await checks($, seen)
  await seen.clock.advance(3 * MINUTE)
}

function sectionOf(lines: readonly string[], title: string): string[] {
  const first = lines.findIndex(
    (line) => line.startsWith(`╭─ ${title}`) || line.startsWith(`${title}  `),
  )
  if (first < 0) throw new Error(`no ${title} section in:\n${lines.join('\n')}`)
  const isFramed = lines[first]?.startsWith('╭') === true
  const end = isFramed
    ? lines.findIndex((line, index) => index > first && line.startsWith('╰'))
    : lines.findIndex(
        (line, index) =>
          index > first &&
          (/^(Tasks|Agents|Log) /u.test(line) || line.startsWith('─') || line === ''),
      )
  return lines.slice(first, end < 0 ? undefined : isFramed ? end + 1 : end)
}

const TITLE_CRITERION =
  'When the Session section draws in a frame (terminal, body 41 or more), its title ends with the waits, if any, and then ▶ working while a main turn runs or ○ idle after it.'

for (const surface of SURFACES) {
  describe(TITLE_CRITERION, () => {
    test(
      `the Session title says working while a turn runs and idle after it, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        const before = await screenOn($, surface, 'dock', 41)
        await turnStarts($)
        const running = await screenOn($, surface, 'dock', 41)
        await turnEnds($)
        const after = await screenOn($, surface, 'dock', 41)
        if (surface === 'terminal') {
          expect(before[0]).toBe('╭─ Session ──────────────────── ○ idle ─╮')
          expect(running[0]).toBe('╭─ Session ───────────────── ▶ working ─╮')
          expect(after[0]).toBe('╭─ Session ──────────────────── ○ idle ─╮')
        } else {
          expect(before.slice(0, 2)).toEqual(['Session  ○ idle', 'ctx — until the first reply'])
          expect(running.slice(0, 2)).toEqual(['Session  ▶ working', 'ctx — until the first reply'])
          expect(after[0]).toBe('Session  ○ idle')
        }
        expect(seen.redraws).toBeGreaterThan(0)
      },
    )

    test(
      `the waits come first, in warning, then working in claude, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        await turnStarts($)
        await spawn($, SCOUT, 'scout', 'find the element table')
        seen.agents.push(listed(SCOUT, 'scout', 'general-purpose', 'find the element table'))
        seen.verdicts.set('npm test', 'ask')
        seen.isAskHeld = true
        const call = bash($, 'npm test', SCOUT)
        await seen.asked
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        const ui = await mountTab($, surface, 'dock', 41)
        const lines = await screen(ui, 41)
        if (surface === 'terminal') {
          expect(lines[0]).toBe('╭─ Session ───── ◆ 1 waits · ▶ working ─╮')
          const title = await coloured(ui, 'session-header')
          expect(title.find((part) => part.text === '◆ 1 waits')?.color).toBe('warning')
          expect(title.find((part) => part.text === '▶ working')?.color).toBe('claude')
          expect(lines[1]).toBe('│ ctx — until the first reply           │')
        } else {
          expect(lines[0]).toBe('Session  ◆ 1 waits · ▶ working')
          const head = await coloured(ui, 'session')
          expect(head.find((part) => part.text === '◆ 1 waits')?.color).toBe('warning')
          expect(head.find((part) => part.text === '▶ working')?.color).toBe('claude')
        }
        await ui.unmount()
        for (const columns of WIDTHS) await screenOn($, surface, 'dock', columns)
        await screenOn($, surface, 'inline', 76)
        seen.waiting.shift()?.()
        await call
      },
    )
  })
}

const TOKENS_CRITERION =
  'When the board knows the context window, the first Session row shows the tokens over the window as 663k/1.0M after the percent.'

for (const surface of SURFACES) {
  describe(TOKENS_CRITERION, () => {
    test(
      `the first Session row shows 663k/1.0M after the percent, and 182k/200k for a smaller window, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($, surface)
        await measure($)
        const wide = await screenOn($, surface, 'dock', 41)
        const first = surface === 'terminal' ? inner(wide[1] ?? '') : wide[1]
        expect(first?.startsWith('ctx ▰▰▰▰▰▰▱▱▱▱ 66% · 663k/1.0M')).toBe(true)
        await $.session.measure({
          context: { window: 200_000, percent: 91, tokens: 182_000 },
          rateLimits: [],
          cost: { usd: 12.4 },
          changed: ['context'],
        })
        const high = await screenOn($, surface, 'dock', 41)
        const row = surface === 'terminal' ? inner(high[1] ?? '') : high[1]
        expect(row?.startsWith('ctx ▰▰▰▰▰▰▰▰▰▱ 91% high · 182k/200k')).toBe(true)
        for (const columns of WIDTHS) await screenOn($, surface, 'dock', columns)
        await screenOn($, surface, 'inline', 76)
      },
    )

    test(`before the first reply no tokens show, on ${surface}`, withWorkitems, async ($, on) => {
      world(on)
      await start($, surface)
      const lines = await screenOn($, surface, 'dock', 41)
      expect(lines.join('\n')).not.toContain('/')
    })
  })
}

const REQUEST_CRITERION =
  'When a main-loop request reports, the model row counts the main-loop requests as N req and shows the latest time to first token as ttft 1.2s. Before any request it shows req — and no ttft.'

function modelRow(lines: readonly string[]): string | undefined {
  return body(lines).find((line) => line.includes('req'))
}

for (const surface of SURFACES) {
  describe(REQUEST_CRITERION, () => {
    test(
      `the model row shows req — before a request, then the count and the latest ttft, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        expect(modelRow(await screenOn($, surface, 'dock', 41))).toBe('req —')
        seen.ttftMs = 1_200
        await mainStep($)
        expect(modelRow(await screenOn($, surface, 'dock', 41))).toBe(
          'opus-5-5 · high · 1 req · ttft 1.2s',
        )
        seen.ttftMs = 450
        await mainStep($, 'turn-2')
        await agentStep($, SCOUT, 'turn-s')
        expect(modelRow(await screenOn($, surface, 'dock', 41))).toBe(
          'opus-5-5 · high · 2 req · ttft 0.5s',
        )
      },
    )

    test(
      `a request without a token shows no ttft, and the ttft drops first at body 30, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        await mainStep($)
        expect(modelRow(await screenOn($, surface, 'dock', 41))).toBe('opus-5-5 · high · 1 req')
        seen.ttftMs = 1_200
        await mainStep($, 'turn-2')
        expect(modelRow(await screenOn($, surface, 'dock', 30))).toBe('opus-5-5 · high · 2 req')
        expect(modelRow(await screenOn($, surface, 'inline', 76))).toContain(
          'opus-5-5 · high · 2 req · ttft 1.2s',
        )
      },
    )
  })
}

const RESETS_CRITERION =
  'When the body is 56 columns or wider, each limit shows resets 2h after its percent. Narrower, the reset times stay in the details.'

for (const surface of SURFACES) {
  describe(RESETS_CRITERION, () => {
    test(
      `from body 56 each limit shows when it resets, and below it the details keep the resets, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($, surface)
        await measure($)
        const wide = (await screenOn($, surface, 'dock', 56)).join('\n')
        expect(wide).toContain('5h ▰▱▱▱▱ 31% resets 2h')
        expect(wide).toMatch(/7d (▱▱▱▱▱ )?13% resets 4d/u)
        const inline = (await screenOn($, surface, 'inline', 76)).join('\n')
        expect(inline).toMatch(/5h (▰▱▱▱▱ )?31% resets 2h/u)
        expect(inline).toMatch(/7d (▱▱▱▱▱ )?13% resets 4d/u)
        const narrow = (await screenOn($, surface, 'dock', 55)).join('\n')
        expect(narrow).not.toContain('resets')
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'session' })
        await ui.unmount()
        const opened = (await screenOn($, surface, 'dock', 41)).join('\n')
        expect(opened).toContain('resets 5h in 2h · 7d in 4d')
        for (const columns of WIDTHS) await screenOn($, surface, 'dock', columns)
      },
    )
  })
}

const GATE_CRITERION =
  'When a permission check settles, the gate row shows the total after gate. A counts row shows allowed, asked and denied, with denied in error and never cut. Three plain Buttons with hotkeys f, s and o name the file, shell and other counts.'

for (const surface of SURFACES) {
  describe(GATE_CRITERION, () => {
    test(
      `the gate row shows the total, the counts row the verdicts and three family Buttons, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await sessionScene($, seen, surface)
        const ui = await mountTab($, surface, 'dock', 41)
        const lines = body(await screen(ui, 41))
        expect(lines).toContain('gate 5 ▮▯▮■▮')
        expect(lines).toContain('3 allowed · 1 asked · 1 denied')
        expect(lines).toContain('f: file 1  s: shell 3  o: other 1')
        const counts = await coloured(ui, 'session-verdicts')
        expect(counts.find((part) => part.text === '1 denied')?.color).toBe('error')
        expect(counts.find((part) => part.text === '3 allowed')?.dim).toBe(true)
        const hotkeys = []
        for (const family of ['file', 'shell', 'other']) {
          const button = await buttonOf(ui, `checks:${family}`)
          hotkeys.push([button.props.hotkey, button.props.plain])
        }
        expect(hotkeys).toEqual([
          ['f', true],
          ['s', true],
          ['o', true],
        ])
        await ui.unmount()
      },
    )

    test(
      `with no check there is no counts row and no family Button, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($, surface)
        const lines = body(await screenOn($, surface, 'dock', 41))
        if (surface === 'terminal') expect(lines).toContain('gate no checks yet')
        expect(lines.join('\n')).not.toContain('f: file')
        expect(lines.join('\n')).not.toContain('allowed')
      },
    )

    test(
      `at body 30 the denied count is never cut and the family words drop, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await sessionScene($, seen, surface)
        const lines = await screenOn($, surface, 'dock', 30)
        expect(lines).toContain('3 allowed · 1 asked · 1 denied')
        expect(lines).toContain('f: 1  s: 3  o: 1')
        for (const columns of WIDTHS) await screenOn($, surface, 'dock', columns)
        const inline = await screenOn($, surface, 'inline', 76)
        expect(inline).toContain('    f: file 1  s: shell 3  o: other 1')
      },
    )
  })
}

const FAMILY_CRITERION =
  'When the person presses f, s or o, or the Button, the last 5 checks of that family show with the verdict word first and the credentials masked. Pressing the same key again hides them.'

for (const surface of SURFACES) {
  describe(FAMILY_CRITERION, () => {
    test(
      `s shows the last shell checks newest first with the verdict word first, and s again hides them, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await sessionScene($, seen, surface)
        for (const index of [1, 2, 3]) await bash($, `ls part${String(index)}`)
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'checks:shell' })
        await ui.unmount()
        const opened = await mountTab($, surface, 'dock', 41)
        const lines = body(await screen(opened, 41))
        const head = lines.indexOf('shell: last 5 of 6')
        expect(head).toBeGreaterThan(0)
        expect(lines.slice(head + 1, head + 7)).toEqual([
          'allowed  Bash ls part3',
          'allowed  Bash ls part2',
          'allowed  Bash ls part1',
          expect.stringMatching(/^denied {3}Bash git push https:\/\/\*\*\*@e[a-z]*…$/u),
          'allowed  Bash git status',
          '[ hide shell ]',
        ])
        expect(lines.join('\n')).not.toContain(TOKEN)
        const button = await coloured(opened, 'checks:shell')
        expect(button[0]?.bold).toBe(true)
        await opened.press({ key: 'checks:shell' })
        await opened.unmount()
        const closed = body(await screenOn($, surface, 'dock', 41))
        expect(closed.join('\n')).not.toContain('shell: last')
      },
    )

    test(
      `f after s switches the family, and the hide Button closes it, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await sessionScene($, seen, surface)
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'checks:shell' })
        await ui.press({ key: 'checks:file' })
        await ui.unmount()
        const lines = body(await screenOn($, surface, 'dock', 41))
        expect(lines).toContain('file: last 1 of 1')
        expect(lines).toContain('allowed  Read docs/design.md')
        expect(lines.join('\n')).not.toContain('shell: last')
        const again = await mountTab($, surface, 'dock', 41)
        await again.press({ key: 'hide:checks:file' })
        await again.unmount()
        expect((await screenOn($, surface, 'dock', 41)).join('\n')).not.toContain('file: last')
        for (const columns of WIDTHS) await screenOn($, surface, 'dock', columns)
      },
    )
  })
}

async function cardScene($: Engine, seen: World, surface: Surface): Promise<void> {
  await start($, surface)
  await spawn($, SCOUT, 'scout', 'find the element table in the engine types')
  seen.agents.push(
    listed(SCOUT, 'scout', 'general-purpose', 'find the element table in the engine types'),
  )
  await seen.clock.advance(10 * SECOND)
  await spawn($, EXPLORE, 'Explore', 'map the hooks')
  seen.agents.push(listed(EXPLORE, 'Explore', 'Explore', 'map the hooks'))
  seen.usage.set(SCOUT, { fresh: 1_000, written: 5_000, read: 25_000, output: 2_400 })
  seen.usage.set(EXPLORE, { fresh: 2_000, written: 6_000, read: 40_000, output: 6_100 })
  for (const turnId of ['s1', 's2', 's3']) await agentStep($, SCOUT, turnId)
  await agentStep($, EXPLORE, 'e1')
  seen.failing.add('npm test')
  await bash($, 'npm test', SCOUT)
  const scout = seen.agents[0]
  if (scout !== undefined) scout.status = 'failed'
  await seen.clock.advance(2 * MINUTE)
}

const CARDS_CRITERION =
  'When the agents that are not folded fit side by side as cards of at least 18 columns (2 at body 41, 4 at body 89, never more than 5), each draws as a card with a title Button, the state word, the wait or failure line, the task, the type, the ctx and out tokens, the steps and a clock that ticks each second while the tab shows.'

const CARDS_41 = [
  '╭─ Agents  2 · 1 failed ────────────────╮',
  '│ ╭────────────────╮ ╭────────────────╮ │',
  '│ │ 1: ■ scout     │ │ 2: ▶ Explore   │ │',
  '│ │ failed         │ │ quiet 2m       │ │',
  '│ │ Bash npm test  │ │ map the hooks  │ │',
  '│ │ find the elem… │ │ Explore        │ │',
  '│ │ gene…l-purpose │ │ ctx 48k out 6k │ │',
  '│ │ ctx 31k out 2k │ │ 1 step    2:00 │ │',
  '│ │ 3 steps   2:10 │ │                │ │',
  '│ ╰────────────────╯ ╰────────────────╯ │',
  '╰───────────────────────────────────────╯',
]

for (const surface of SURFACES) {
  describe(CARDS_CRITERION, () => {
    test(
      `two agents draw as two cards at body 41 on the terminal and as rows on ${surface === 'terminal' ? 'no other view' : 'the desktop'}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await cardScene($, seen, surface)
        const ui = await mountTab($, surface, 'dock', 41)
        const lines = await screen(ui, 41)
        if (surface === 'terminal') {
          expect(sectionOf(lines, 'Agents')).toEqual(CARDS_41)
          const title = await buttonOf(ui, `open:agent:${SCOUT}`)
          expect([title.props.hotkey, title.props.plain]).toEqual(['1', true])
          const border = await coloured(ui, 'cards:0')
          expect(border[0]?.color).toBe('error')
          expect(border.at(-1)?.color).toBe('subtle')
        } else {
          expect(lines.join('\n')).not.toMatch(/[╭╮╰╯│]/u)
          expect(lines).toContain('1: ■ scout     failed                  2m')
          expect(lines).toContain('    failed after Bash npm test')
        }
        await ui.unmount()
        for (const columns of WIDTHS) await screenOn($, surface, 'dock', columns)
      },
    )

    test(
      `four cards fit at body 89 and each card is 20 columns wide, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await cardScene($, seen, surface)
        for (const [id, name] of [
          ['a0000004tester', 'tester'],
          ['a0000005lane', 'lane-c'],
        ] as const) {
          await spawn($, id, name, `run the ${name} work`)
          seen.agents.push(listed(id, name, 'implementer', `run the ${name} work`))
        }
        const lines = await screenOn($, surface, 'dock', 89)
        if (surface === 'terminal') {
          const agents = sectionOf(lines, 'Agents')
          expect(agents[1]).toBe(`│ ${'╭──────────────────╮ '.repeat(4).trimEnd()}   │`)
          expect(agents[2]).toContain('│ 4: ▶ lane-c      │')
        } else {
          expect(lines.join('\n')).not.toContain('╭')
        }
      },
    )

    test(
      `the clock of a card ticks each second while the tab shows and stops when it hides, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await cardScene($, seen, surface)
        const ui = await mountTab($, surface, 'dock', 41)
        await screen(ui, 41)
        const before = seen.redraws
        await seen.clock.advance(SECOND)
        const ticks = seen.redraws - before
        if (surface === 'terminal') {
          expect(ticks).toBe(1)
          expect((await screen(ui, 41)).join('\n')).toContain('1 step    2:01')
          seen.isTabShown = false
          await seen.clock.advance(SECOND)
          const hidden = seen.redraws
          await seen.clock.advance(3 * SECOND)
          expect(seen.redraws).toBe(hidden)
        } else {
          expect(ticks).toBe(0)
        }
        await ui.unmount()
      },
    )
  })
}

const LAYOUT_CRITERION =
  'When cards do not fit, a body of 80 or more draws the lanes and a narrower body draws rows. Inline and desktop always draw rows.'

async function sixAgents($: Engine, seen: World, surface: Surface): Promise<void> {
  await start($, surface)
  for (const [index, name] of [
    'scout',
    'lane-c',
    'lane-b',
    'Explore',
    'tester',
    'implementer',
  ].entries()) {
    const id = `a000001${String(index)}${name}`
    await spawn($, id, name, `do the ${name} work`)
    seen.agents.push(listed(id, name, 'general-purpose', `do the ${name} work`))
    await seen.clock.advance(15 * SECOND)
  }
}

for (const surface of SURFACES) {
  describe(LAYOUT_CRITERION, () => {
    test(
      `three agents at body 41 draw rows with digits, and six agents at body 89 draw lanes, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await sixAgents($, seen, surface)
        const narrow = await screenOn($, surface, 'dock', 41)
        const agents = body(sectionOf(narrow, 'Agents'))
        expect(agents[1]).toMatch(/^1: ▶ scout {5}running +open {2}1m$/u)
        expect(agents[5]).toMatch(/^5: ▶ tester {4}running +open 30s$/u)
        expect(agents[6]).toMatch(/^ {3}▶ impl…nter running +open 15s$/u)
        const wide = await screenOn($, surface, 'dock', 89)
        const lanes = sectionOf(wide, 'Agents').join('\n')
        if (surface === 'terminal') expect(lanes).toContain('lanes from')
        else expect(lanes).not.toContain('lanes from')
      },
    )

    test(
      `inline draws rows, never cards or lanes, at 80 columns and wider, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await cardScene($, seen, surface)
        for (const columns of [76, 80, 116]) {
          const lines = await screenOn($, surface, 'inline', columns)
          const text = lines.join('\n')
          expect(text).not.toContain('╭')
          expect(text).not.toContain('lanes from')
          expect(text).toContain('1: ■ scout')
        }
        const narrow = await screenOn($, surface, 'dock', 30)
        expect(narrow.join('\n')).not.toContain('╭')
        expect(narrow).toContain('1: ■ scout  failed          2m')
      },
    )
  })
}

const DIGIT_CRITERION =
  'When the person presses a digit 1 to 5 while the board has the keyboard, that agent opens, and the same digit closes it. A sixth agent has no digit.'

for (const surface of SURFACES) {
  describe(DIGIT_CRITERION, () => {
    test(
      `digit 1 opens the first agent below the cards and 1 again closes it, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await cardScene($, seen, surface)
        const ui = await mountTab($, surface, 'dock', 41)
        const title = await buttonOf(ui, `open:agent:${SCOUT}`)
        expect(title.props.hotkey).toBe('1')
        await ui.press({ key: `open:agent:${SCOUT}` })
        await ui.unmount()
        const opened = (await screenOn($, surface, 'dock', 41)).join('\n')
        if (surface === 'terminal') expect(opened).toContain('1 scout, opened:')
        expect(opened).toContain('find the element table in the')
        const again = await mountTab($, surface, 'dock', 41)
        await again.press({ key: `open:agent:${SCOUT}` })
        await again.unmount()
        const closed = (await screenOn($, surface, 'dock', 41)).join('\n')
        expect(closed).not.toContain('opened:')
        expect(closed).not.toContain('find the element table in the')
      },
    )

    test(
      `the first five agents get the digits 1 to 5 and the sixth none, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await sixAgents($, seen, surface)
        const ui = await mountTab($, surface, 'dock', 41)
        const hotkeys = []
        for (const agent of seen.agents) {
          hotkeys.push((await buttonOf(ui, `open:agent:${agent.id}`)).props.hotkey)
        }
        expect(hotkeys).toEqual(['1', '2', '3', '4', '5', undefined])
        await ui.unmount()
      },
    )
  })
}

async function logScene($: Engine, seen: World, surface: Surface, isEnded = true): Promise<void> {
  await start($, surface)
  await prompt($, `run the gate pass with password=${TOKEN}`)
  await seen.clock.advance(MINUTE)
  await spawn($, SCOUT, 'scout', 'find the element table')
  seen.agents.push(listed(SCOUT, 'scout', 'general-purpose', 'find the element table'))
  await seen.clock.advance(MINUTE)
  await edit($, 'hooks/vitals.ts')
  await edit($, 'docs/design.md', SCOUT)
  seen.failing.add('npm test')
  await bash($, 'npm test', SCOUT)
  seen.verdicts.set(`git push https://${TOKEN}@example.org/repo`, 'deny')
  await bash($, `git push https://${TOKEN}@example.org/repo`, SCOUT)
  await seen.clock.advance(MINUTE)
  if (isEnded) await turnEnds($, 'turn-s', SCOUT)
}

const LOG_CRITERION =
  'When a prompt, a spawn, a completion, an edit, an error or a denial happens, the Log shows it newest first as time, who and what, with credentials masked. It keeps the last 100 events and shows 5 at body 41, 3 at body 30 and none inline.'

for (const surface of SURFACES) {
  describe(LOG_CRITERION, () => {
    test(
      `the Log shows the newest 5 events as time, who and what, with credentials masked, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await logScene($, seen, surface)
        const ui = await mountTab($, surface, 'dock', 41)
        const lines = await screen(ui, 41)
        const log = body(sectionOf(lines, 'Log'))
        const isFramedHere = framed(surface, 41)
        expect(log[0]).toBe(isFramedHere ? `╭─ Log  7 events ${'─'.repeat(23)}╮` : 'Log  7 events')
        const room = isFramedHere ? 37 : 41
        expect(log.slice(1, 7)).toEqual([
          '14:03 scout     ✓ done 4m',
          cutTo('14:02 scout     ■ denied Bash git push https://***@example.org/repo', room),
          cutTo('14:02 scout     ■ failed Bash npm test', room),
          '14:02 scout     Edit docs/design.md',
          '14:02 main      Edit hooks/vitals.ts',
          '[ +2 earlier ]',
        ])
        expect(lines.join('\n')).not.toContain(TOKEN)
        const denied = await coloured(ui, 'log:1')
        expect(denied.find((part) => part.text === '■ denied')?.color).toBe('error')
        await ui.press({ key: 'group:log-earlier' })
        await ui.unmount()
        const all = body(sectionOf(await screenOn($, surface, 'dock', 41), 'Log'))
        expect(all).toContain(cutTo('14:01 scout     spawned: find the element table', room))
        expect(all).toContain(cutTo('14:00 you       run the gate pass with password=***', room))
        expect(all.join('\n')).not.toContain(TOKEN)
        for (const columns of WIDTHS) await screenOn($, surface, 'dock', columns)
      },
    )

    test(
      `body 30 shows 3 events with who cut to 5, body 76 shows seconds, and inline shows no Log, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await logScene($, seen, surface)
        const narrow = sectionOf(await screenOn($, surface, 'dock', 30), 'Log')
        const rows = body(narrow).filter((line) => /^\d\d:\d\d/u.test(line))
        expect(rows).toHaveLength(3)
        expect(rows[0]).toBe('14:03 scout ✓ done 4m')
        const wide = body(sectionOf(await screenOn($, surface, 'dock', 89), 'Log'))
        expect(wide).toContain('14:02:00 main      Edit hooks/vitals.ts')
        const inline = await screenOn($, surface, 'inline', 76)
        expect(inline.join('\n')).not.toMatch(/^Log /mu)
      },
    )

    test(
      `the Log keeps the last 100 events and counts every event it saw, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($, surface)
        for (let index = 0; index < 105; index += 1) await edit($, `src/file${String(index)}.ts`)
        const log = body(sectionOf(await screenOn($, surface, 'dock', 41), 'Log'))
        expect(log[0]).toContain('Log  105 events · 100 kept')
        expect(log).toContain('[ +95 earlier ]')
        const text = await board($, 'log')
        expect(text.split('\n')).toHaveLength(100)
        expect(text).toContain('src/file5.ts')
        expect(text).not.toContain('src/file4.ts')
      },
    )

    test(`an empty Log says what it will show, on ${surface}`, withWorkitems, async ($, on) => {
      world(on)
      await start($, surface)
      const log = body(sectionOf(await screenOn($, surface, 'dock', 41), 'Log'))
      expect(log[0]).toContain('Log  nothing yet')
      expect(log.join(' ')).toContain('Prompts, spawns, edits, errors and')
    })
  })
}

const FILTER_CRITERION =
  "When an agent card is open or its transcript is in view, the Log shows only that agent's events under a dim filter line."

for (const surface of SURFACES) {
  describe(FILTER_CRITERION, () => {
    test(
      `an open agent filters the Log to its events under a dim line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await logScene($, seen, surface, false)
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: `open:agent:${SCOUT}` })
        await ui.unmount()
        await turnEnds($, 'turn-s', SCOUT)
        const ended = await mountTab($, surface, 'dock', 41)
        await ended.press({ key: 'group:ended-agents' })
        await ended.unmount()
        const opened = await mountTab($, surface, 'dock', 41)
        const log = body(sectionOf(await screen(opened, 41), 'Log'))
        const where = framed(surface, 41) ? 'card 1' : 'row 1'
        expect(log[0]).toContain('Log  scout · 5 of 7')
        expect(log[1]).toBe(`only scout, while ${where} is open`)
        expect(log.join('\n')).not.toContain(' main ')
        expect(log.join('\n')).not.toContain(' you ')
        const line = await coloured(opened, framed(surface, 41) ? 'frame:log' : 'log-body')
        expect(line.find((part) => part.text.startsWith('only scout'))?.dim).toBe(true)
        await opened.unmount()
      },
    )

    test(
      `the transcript of an agent in view filters the Log too, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await logScene($, seen, surface)
        const log = body(sectionOf(await screenOn($, surface, 'dock', 41, SCOUT), 'Log'))
        expect(log[1]).toBe('only scout: its transcript is in view')
        const main = body(sectionOf(await screenOn($, surface, 'dock', 41), 'Log'))
        expect(main[1]).not.toContain('only')
      },
    )
  })
}

const PALETTE_CRITERION =
  'When the palette setting of the handily bundle is catppuccin-mocha and the theme is dark, the frames and the gauge fill draw the hex values of mocks 14.4 and every state keeps its theme key. When the theme is light or cannot be read, theme keys draw.'

async function paletteScene($: Engine, seen: World, config: Partial<Config>): Promise<void> {
  seen.config = { ...seen.config, ...config }
  await cardScene($, seen, 'terminal')
  await measure($)
  await $.session.measure({
    context: { window: 200_000, percent: 91, tokens: 182_000 },
    rateLimits: [limit('five_hour', 31, 2 * HOUR)],
    cost: { usd: 9 },
    changed: ['context', 'cost', 'rateLimits'],
  })
}

async function setConfig($: Engine, key: string, value: string, plugin: string): Promise<void> {
  await $.config.set({
    key,
    value,
    previous: '',
    provider: { plugin, tier: plugin === 'engine' ? 'core' : 'user' },
    origin: { kind: 'composer' },
  })
}

function colourOf(parts: readonly Coloured[], text: string): unknown {
  return parts.find((part) => part.text === text)?.color
}

async function frameColours(
  $: Engine,
  surface: Surface,
): Promise<{ edges: unknown[]; fill: unknown; high: unknown; empty: unknown; card: unknown }> {
  const ui = await mountTab($, surface, 'dock', 41)
  await screen(ui, 41)
  const edges = []
  for (const key of ['session-header', 'tasks-header', 'agents-header', 'log-header']) {
    const parts = surface === 'terminal' ? await coloured(ui, key) : []
    edges.push(parts[0]?.color)
  }
  const root = drawnOf(await ui.find({ type: 'Box' }))
  const all =
    root === null
      ? []
      : texts(root).map((text) => ({
          text: text.text,
          color: text.props.color,
          bold: undefined,
          dim: undefined,
        }))
  const cards = surface === 'terminal' ? await coloured(ui, 'cards:0') : []
  await ui.unmount()
  return {
    edges,
    fill: colourOf(all, '▰'),
    high: colourOf(all, '▰▰▰▰▰▰▰▰▰'),
    empty: colourOf(all, '▱▱▱▱'),
    card: cards.at(-1)?.color,
  }
}

for (const surface of SURFACES) {
  describe(PALETTE_CRITERION, () => {
    test(
      `catppuccin-mocha on a dark theme draws the hex values on the terminal and keeps the states, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await paletteScene($, seen, { palette: MOCHA, theme: 'dark' })
        const drawn = await frameColours($, surface)
        if (surface === 'terminal') {
          expect(drawn).toEqual({
            edges: ['#cba6f7', '#89b4fa', '#f5c2e7', '#9399b2'],
            fill: '#cba6f7',
            high: 'warning',
            empty: '#585b70',
            card: '#585b70',
          })
          const ui = await mountTab($, surface, 'dock', 41)
          const cards = await coloured(ui, 'cards:0')
          expect(cards[0]?.color).toBe('error')
          expect(colourOf(await coloured(ui, `open:agent:${SCOUT}`), '■ ')).toBe('error')
          expect(colourOf(await coloured(ui, `open:agent:${EXPLORE}`), '▶ ')).toBe('claude')
          await ui.unmount()
        } else {
          expect(drawn).toEqual({
            edges: [undefined, undefined, undefined, undefined],
            fill: 'claude',
            high: 'warning',
            empty: 'subtle',
            card: undefined,
          })
        }
      },
    )

    test(
      `a light theme, a dark-daltonized theme and an unread theme row, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await paletteScene($, seen, { palette: MOCHA, theme: 'light' })
        const keys = ['claude', 'planMode', 'merged', 'inactive']
        const light = await frameColours($, surface)
        expect(light.fill).toBe('claude')
        expect(light.empty).toBe('subtle')
        if (surface === 'terminal') expect(light.edges).toEqual(keys)
        seen.config = { ...seen.config, theme: 'dark-daltonized' }
        await setConfig($, 'theme', 'dark-daltonized', 'engine')
        const daltonized = await frameColours($, surface)
        expect(daltonized.fill).toBe(surface === 'terminal' ? '#cba6f7' : 'claude')
        seen.config = { ...seen.config, theme: undefined }
        await setConfig($, 'handily.palette', MOCHA, 'handily@niksavis')
        expect((await frameColours($, surface)).fill).toBe('claude')
        seen.config = { ...seen.config, theme: 'dark', isRefused: true }
        await $.session.start({ cwd: ROOT, surface, isInteractive: true })
        expect((await frameColours($, surface)).fill).toBe('claude')
      },
    )

    test(
      `the theme auto draws catppuccin-mocha and an ANSI theme keeps the theme keys, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await paletteScene($, seen, { palette: MOCHA, theme: 'auto' })
        const auto = await frameColours($, surface)
        expect(auto.fill).toBe(surface === 'terminal' ? '#cba6f7' : 'claude')
        if (surface === 'terminal') {
          expect(auto.edges).toEqual(['#cba6f7', '#89b4fa', '#f5c2e7', '#9399b2'])
        }
        for (const theme of ['dark-ansi', 'light-ansi']) {
          seen.config = { ...seen.config, theme }
          await setConfig($, 'theme', theme, 'engine')
          const ansi = await frameColours($, surface)
          expect(ansi.fill).toBe('claude')
          expect(ansi.empty).toBe('subtle')
          if (surface === 'terminal') {
            expect(ansi.edges).toEqual(['claude', 'planMode', 'merged', 'inactive'])
          }
        }
      },
    )

    test(
      `the default theme palette draws the theme keys, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await paletteScene($, seen, { palette: 'theme', theme: 'dark' })
        const drawn = await frameColours($, surface)
        expect(drawn.fill).toBe('claude')
        expect(drawn.empty).toBe('subtle')
        if (surface === 'terminal') {
          expect(drawn.edges).toEqual(['claude', 'planMode', 'merged', 'inactive'])
          expect(drawn.card).toBe('subtle')
        }
      },
    )
  })
}

const STATS_CRITERION =
  'When /board stats runs, it prints the requests, the ttft, the tokens over the window, the resets and the verdicts as words. When /board log runs, it prints the kept log.'

for (const surface of SURFACES) {
  describe(STATS_CRITERION, () => {
    test(
      `/board stats prints the requests, the ttft, the tokens, the resets and the verdicts in words, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await sessionScene($, seen, surface)
        const lines = (await board($, 'stats')).split('\n')
        expect(lines).toContain(
          '    Requests 1; time to first token 1.2 seconds (latest main request).',
        )
        expect(lines).toContain(
          '    Context 663k of 1.0M tokens. Limits reset: 5h in 1 hour, 7d in 3 days.',
        )
        expect(lines).toContain(
          '    Checks 5: 3 allowed, 1 asked (the classifier or you), 1 denied.',
        )
        expect(lines.join('\n')).not.toContain(TOKEN)
      },
    )

    test(
      `/board log prints the kept log newest first with full targets, and /board log scout only its events, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await logScene($, seen, surface)
        expect(await board($, 'log')).toBe(
          [
            '14:03:00 scout ✓ done 4m',
            '14:02:00 scout ■ denied Bash git push https://***@example.org/repo',
            '14:02:00 scout ■ failed Bash npm test',
            '14:02:00 scout Edit docs/design.md',
            '14:02:00 main Edit hooks/vitals.ts',
            '14:01:00 scout spawned: find the element table',
            '14:00:00 you run the gate pass with password=***',
          ].join('\n'),
        )
        expect((await board($, 'log scout')).split('\n')).toHaveLength(5)
        expect(await board($, 'log nobody')).toBe('The log has no event of "nobody".')
      },
    )

    test(
      `/board log on an empty log says what it keeps, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($, surface)
        expect(await board($, 'log')).toBe(
          'The log is empty. It keeps the prompts, spawns, completions, edits, errors and denials that the board saw since it loaded.',
        )
      },
    )
  })
}

async function heldAsk($: Engine, seen: World, surface: Surface): Promise<{ call: Promise<void> }> {
  await start($, surface)
  await spawn($, SCOUT, 'scout', 'find the element table')
  seen.verdicts.set('npm test', 'ask')
  seen.isAskHeld = true
  const call = bash($, 'npm test', SCOUT)
  await seen.asked
  await seen.clock.advance(SECOND)
  return { call }
}

async function agentTurnEnds($: Engine, agentId: string, reason: 'answer' | 'aborted') {
  await $.turn.complete({
    turnId: `turn-${agentId}`,
    reason,
    answer: '',
    durationMs: 4 * MINUTE,
    isAborted: reason === 'aborted',
    agentId,
  })
}

function agentsTitle(lines: readonly string[]): string {
  return inner(sectionOf(lines, 'Agents')[0] ?? '')
}

function agentsText(lines: readonly string[]): string {
  return sectionOf(lines, 'Agents').join('\n')
}

async function spawnUnnamed($: Engine, id: string, description: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `spawn:${id}`,
    prompt: description,
    description,
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
  })
}

const RUNNING_TITLE = /^(╭─ )?Agents {2}1(?: |$)/u

async function endedScout($: Engine, seen: World, surface: Surface): Promise<AgentInfo> {
  await start($, surface)
  await spawn($, SCOUT, 'scout', 'find the element table')
  const scout = listed(SCOUT, 'scout', 'general-purpose', 'find the element table')
  seen.agents.push(scout)
  await screenOn($, surface, 'dock', 41)
  await agentTurnEnds($, SCOUT, 'answer')
  scout.status = 'completed'
  await screenOn($, surface, 'dock', 41)
  await seen.clock.advance(MINUTE)
  return scout
}

async function endLines($: Engine): Promise<string[]> {
  return (await board($, 'log')).split('\n').filter((line) => /[✓■] (done|aborted)/u.test(line))
}

for (const surface of SURFACES) {
  describe(LOG_CRITERION, () => {
    test(
      `an agent aborted while its ask waits ends with no asked state and no running call, also with its row unfolded, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const { call } = await heldAsk($, seen, surface)
        seen.agents.push(listed(SCOUT, 'scout', 'general-purpose', 'find the element table'))
        expect(agentsText(await screenOn($, surface, 'dock', 41))).toContain('asked')
        await agentTurnEnds($, SCOUT, 'aborted')
        const ui = await mountTab($, surface, 'dock', 41)
        await ui.press({ key: 'group:ended-agents' })
        const lines = await screen(ui, 41)
        await ui.unmount()
        expect(agentsTitle(lines)).toMatch(/^(╭─ )?Agents {2}all 1 done/u)
        expect(agentsText(lines)).toContain('scout')
        expect(agentsText(lines)).not.toMatch(/asked|running|▸/u)
        seen.failing.add('npm test')
        seen.waiting.shift()?.()
        await call
        const scout = seen.agents[0]
        if (scout !== undefined) scout.status = 'killed'
        await screenOn($, surface, 'dock', 41)
        expect((await board($, 'log')).split('\n')).toEqual([
          '14:00:01 scout ■ failed Bash npm test',
          '14:00:01 scout ■ aborted 4m',
          '14:00:00 scout spawned: find the element table',
        ])
      },
    )

    test(
      `an end that the agent list reports is logged once, at the time the board learned it, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        await spawn($, SCOUT, 'scout', 'find the element table')
        seen.agents.push(listed(SCOUT, 'scout', 'general-purpose', 'find the element table'))
        await screenOn($, surface, 'dock', 41)
        const scout = seen.agents[0]
        if (scout !== undefined) scout.status = 'completed'
        await seen.clock.advance(MINUTE)
        expect(agentsText(await screenOn($, surface, 'dock', 41))).not.toMatch(/running/u)
        await screenOn($, surface, 'dock', 41)
        expect((await board($, 'log')).split('\n')).toEqual([
          '14:00:10 scout ✓ done 10s',
          '14:00:00 scout spawned: find the element table',
        ])
        await agentTurnEnds($, SCOUT, 'answer')
        await screenOn($, surface, 'dock', 41)
        expect(await endLines($)).toEqual(['14:00:10 scout ✓ done 10s'])
      },
    )

    test(
      `a resumed agent runs again and gets one new end line, with a tool call or with text only, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const scout = await endedScout($, seen, surface)
        scout.status = 'running'
        await $.turn.start({ text: 'go on', turnId: 'turn-two', agentId: SCOUT })
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(RUNNING_TITLE)
        expect(await endLines($)).toEqual(['14:00:00 scout ✓ done 4m'])
        await bash($, 'git status', SCOUT)
        await screenOn($, surface, 'dock', 41)
        await agentTurnEnds($, SCOUT, 'answer')
        scout.status = 'completed'
        await screenOn($, surface, 'dock', 41)
        expect(await endLines($)).toEqual(['14:01:00 scout ✓ done 4m', '14:00:00 scout ✓ done 4m'])
        await seen.clock.advance(MINUTE)
        await $.turn.start({ text: 'go on', turnId: 'turn-three', agentId: SCOUT })
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(RUNNING_TITLE)
        await agentTurnEnds($, SCOUT, 'aborted')
        await screenOn($, surface, 'dock', 41)
        expect(await endLines($)).toEqual([
          '14:02:00 scout ■ aborted 4m',
          '14:01:00 scout ✓ done 4m',
          '14:00:00 scout ✓ done 4m',
        ])
      },
    )

    test(
      `an agent resumed by a spawn runs again and gets no duplicate end line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const scout = await endedScout($, seen, surface)
        scout.status = 'running'
        await $.agent.spawn({
          tool_use_id: `spawn:${SCOUT}`,
          prompt: 'look again',
          description: 'look again',
          subagentType: 'general-purpose',
          provider: { plugin: 'engine', tier: 'core' },
          parentModel: 'opus',
          background: true,
          fork: false,
          name: 'scout',
          resume: { agentId: SCOUT },
        })
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(RUNNING_TITLE)
        expect(await endLines($)).toEqual(['14:00:00 scout ✓ done 4m'])
        await agentTurnEnds($, SCOUT, 'answer')
        expect(await endLines($)).toEqual(['14:01:00 scout ✓ done 4m', '14:00:00 scout ✓ done 4m'])
      },
    )

    test(
      `a resumed agent that ends with no turn end, while the agent list says completed before and after its run, ends with one end line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await endedScout($, seen, surface)
        await $.turn.start({ text: 'go on', turnId: 'turn-two', agentId: SCOUT })
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(RUNNING_TITLE)
        await seen.clock.advance(RUN_SETTLE_MS)
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(
          /^(╭─ )?Agents {2}all 1 done/u,
        )
        await screenOn($, surface, 'dock', 41)
        expect(await endLines($)).toEqual(['14:01:03 scout ✓ done 1m', '14:00:00 scout ✓ done 4m'])
      },
    )

    test(
      `a resumed agent that ends with a turn end only gets one end line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await endedScout($, seen, surface)
        await $.turn.start({ text: 'go on', turnId: 'turn-two', agentId: SCOUT })
        await agentTurnEnds($, SCOUT, 'answer')
        await seen.clock.advance(RUN_SETTLE_MS)
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(
          /^(╭─ )?Agents {2}all 1 done/u,
        )
        await screenOn($, surface, 'dock', 41)
        expect(await endLines($)).toEqual(['14:01:00 scout ✓ done 4m', '14:00:00 scout ✓ done 4m'])
      },
    )

    test(
      `a resumed agent that the agent list ends before a late turn end keeps one end line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await endedScout($, seen, surface)
        await $.turn.start({ text: 'go on', turnId: 'turn-two', agentId: SCOUT })
        await seen.clock.advance(RUN_SETTLE_MS)
        await screenOn($, surface, 'dock', 41)
        const ends = ['14:01:03 scout ✓ done 1m', '14:00:00 scout ✓ done 4m']
        expect(await endLines($)).toEqual(ends)
        await agentTurnEnds($, SCOUT, 'answer')
        await screenOn($, surface, 'dock', 41)
        expect(await endLines($)).toEqual(ends)
      },
    )

    test(
      `a list read right after a resumed turn start that still says completed keeps the agent running, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await endedScout($, seen, surface)
        await $.turn.start({ text: 'go on', turnId: 'turn-two', agentId: SCOUT })
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(RUNNING_TITLE)
        await seen.clock.advance(RUN_SETTLE_MS - SECOND)
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(RUNNING_TITLE)
        expect(await endLines($)).toEqual(['14:00:00 scout ✓ done 4m'])
      },
    )

    test(
      `101 agents that end get one end line each, and a later render logs and redraws nothing, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        for (let index = 0; index < 101; index += 1) {
          const id = `a${String(index).padStart(4, '0')}many`
          seen.agents.push(listed(id, `agent${String(index)}`, 'general-purpose', 'do the work'))
        }
        await board($, 'log')
        for (const agent of seen.agents) agent.status = 'completed'
        await board($, 'log')
        expect(await endLines($)).toHaveLength(100)
        const redraws = []
        for (let render = 0; render < 3; render += 1) {
          const before = seen.redraws
          await screenOn($, surface, 'dock', 41)
          await board($, 'log')
          redraws.push(seen.redraws - before)
        }
        expect(redraws).toEqual([0, 0, 0])
      },
    )

    test(
      `an agent already ended when the board first sees it, or still listed after /clear, gets no end line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        seen.agents.push({
          ...listed(SCOUT, 'scout', 'general-purpose', 'old'),
          status: 'completed',
        })
        await screenOn($, surface, 'dock', 41)
        expect(await endLines($)).toEqual([])
        seen.agents.push(listed(EXPLORE, 'Explore', 'Explore', 'map the hooks'))
        await screenOn($, surface, 'dock', 41)
        const explore = seen.agents[1]
        if (explore !== undefined) explore.status = 'completed'
        await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
        await screenOn($, surface, 'dock', 41)
        expect(await endLines($)).toEqual([])
      },
    )

    test(
      `a recorded turn end wins over a listed running status until a new call starts, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        await spawn($, SCOUT, 'scout', 'find the element table')
        seen.agents.push(listed(SCOUT, 'scout', 'general-purpose', 'find the element table'))
        await bash($, 'git status', SCOUT)
        await agentTurnEnds($, SCOUT, 'answer')
        await seen.clock.advance(MINUTE)
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(
          /^(╭─ )?Agents {2}all 1 done/u,
        )
        await bash($, 'git log', SCOUT)
        expect(agentsTitle(await screenOn($, surface, 'dock', 41))).toMatch(
          /^(╭─ )?Agents {2}1(?: |$)/u,
        )
      },
    )

    test(
      `an aborted agent turn is logged as aborted, not done, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($, surface)
        await spawn($, SCOUT, 'scout', 'find the element table')
        await agentTurnEnds($, SCOUT, 'aborted')
        expect((await board($, 'log')).split('\n')[0]).toBe('14:00:00 scout ■ aborted 4m')
        const ui = await mountTab($, surface, 'dock', 41)
        const log = body(sectionOf(await screen(ui, 41), 'Log'))
        expect(log[1]).toBe('14:00 scout     ■ aborted 4m')
        expect(colourOf(await coloured(ui, 'log:0'), '■ aborted')).toBe('error')
        await ui.unmount()
      },
    )

    test(
      `a password glued to -p in a mysql command is masked in the Log, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        await spawn($, SCOUT, 'scout', 'find the element table')
        seen.failing.add('mysql -u root -phunter2secret -h db')
        await bash($, 'mysql -u root -phunter2secret -h db', SCOUT)
        expect((await board($, 'log')).split('\n')[0]).toBe(
          '14:00:00 scout ■ failed Bash mysql -u root -p***',
        )
        const lines = await screenOn($, surface, 'dock', 89)
        expect(lines.join('\n')).toContain('mysql -u root -p***')
        expect(lines.join('\n')).not.toContain('hunter2')
      },
    )
  })

  describe(STATS_CRITERION, () => {
    test(
      `/board log filters by the name of the agent and by its id, not by the drawn name, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        const id = 'a0000009implementer'
        await spawn($, id, 'implementer', 'build the feature')
        seen.agents.push(listed(id, 'implementer', 'general-purpose', 'build the feature'))
        await edit($, 'hooks/log.ts', id)
        const all = await board($, 'log')
        expect(all.split('\n')[0]).toBe('14:00:00 impl…nter Edit hooks/log.ts')
        expect(await board($, 'log implementer')).toBe(all)
        expect(await board($, `log ${id}`)).toBe(all)
        expect(await board($, 'log a0000009')).toBe(all)
        expect(await board($, 'log main')).toBe('The log has no event of "main".')
      },
    )

    test(
      `/board log takes each drawn name of two unnamed Explore agents as exactly that agent, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        for (const [id, file] of [
          [SCOUT, 'docs/one.md'],
          [EXPLORE, 'docs/two.md'],
        ] as const) {
          await spawnUnnamed($, id, `read ${file}`)
          seen.agents.push({ id, type: 'Explore', status: 'running', description: `read ${file}` })
          await edit($, file, id)
          await seen.clock.advance(MINUTE)
        }
        expect(await board($, 'log Explore')).toBe(
          ['14:00:00 Explore Edit docs/one.md', '14:00:00 Explore spawned: read docs/one.md'].join(
            '\n',
          ),
        )
        expect(await board($, 'log Explore 2')).toBe(
          [
            '14:01:00 Explore 2 Edit docs/two.md',
            '14:01:00 Explore 2 spawned: read docs/two.md',
          ].join('\n'),
        )
      },
    )
  })

  describe(REQUEST_CRITERION, () => {
    test(
      `the request count and the ttft reset on /clear and on a resume, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($, surface)
        for (const reason of ['clear', 'resume'] as const) {
          seen.ttftMs = 1_200
          await mainStep($)
          expect(modelRow(await screenOn($, surface, 'dock', 41))).toBe(
            'opus-5-5 · high · 1 req · ttft 1.2s',
          )
          await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
          expect(modelRow(await screenOn($, surface, 'dock', 41))).toBe('opus-5-5 · high · req —')
          expect(await board($, 'stats')).not.toContain('Requests')
        }
      },
    )
  })
}

describe(CARDS_CRITERION, () => {
  test(
    'a desktop render does not stop the clock of the terminal cards',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await cardScene($, seen, 'terminal')
      await screenOn($, 'terminal', 'dock', 41)
      await screenOn($, 'desktop', 'dock', 41)
      const before = seen.redraws
      await seen.clock.advance(SECOND)
      expect(seen.redraws - before).toBe(1)
      expect((await screenOn($, 'terminal', 'dock', 41)).join('\n')).toContain('1 step    2:01')
    },
  )

  test(
    'the clock stops when the terminal pane unmounts while a desktop pane stays',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await cardScene($, seen, 'terminal')
      const terminal = await mountTab($, 'terminal', 'dock', 41)
      await screen(terminal, 41)
      const desktop = await mountTab($, 'desktop', 'dock', 41)
      await screen(desktop, 41)
      await terminal.unmount()
      await seen.clock.advance(2 * SECOND)
      const stopped = seen.redraws
      await seen.clock.advance(3 * SECOND)
      expect(seen.redraws).toBe(stopped)
      await desktop.unmount()
    },
  )

  for (const surface of SURFACES) {
    test(
      `the clock stops while no card runs and starts again when one runs, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await cardScene($, seen, surface)
        const explore = seen.agents[1]
        if (explore !== undefined) explore.status = 'completed'
        const ui = await mountTab($, surface, 'dock', 41)
        await screen(ui, 41)
        const stopped = seen.redraws
        await seen.clock.advance(3 * SECOND)
        expect(seen.redraws).toBe(stopped)
        if (explore !== undefined) explore.status = 'running'
        await screen(ui, 41)
        await ui.unmount()
        const again = await mountTab($, surface, 'dock', 41)
        await screen(again, 41)
        const running = seen.redraws
        await seen.clock.advance(SECOND)
        expect(seen.redraws - running).toBe(surface === 'terminal' ? 1 : 0)
        await again.unmount()
      },
    )
  }
})
