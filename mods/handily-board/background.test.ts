import type { On, RenderPropsOf, RenderSurface } from 'claude-code'
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
import {
  NO_TURN,
  besideAskText,
  STALE_AFTER_MS,
  newBackgroundKeep,
  noteStop,
  noteTurnStart,
  sharedBackground,
  turnState,
  waitingLook,
  waitingStatusText,
  wakeupTime,
} from './hooks/background'
import { GLYPH_SETS } from './hooks/glyphs'
import { EMPTY_CHECKS } from './hooks/checks'
import { DEFAULT_PALETTE } from './hooks/palette'
import { NO_REQUEST } from './hooks/request'
import { sessionStateParts } from './hooks/session'
import { EMPTY_VITALS } from './hooks/vitals'
import { signalLooks } from './hooks/signals'
import { PLAIN_SIGNALS } from './hooks/toasting'
import { displayWidth } from './hooks/width'

const ROOT = '/work/app'
const PANE = 'tasks'
const PLUGIN = 'handily-board'
const OWN_ID = '00000000-0000-4000-8000-0000000000aa'
const TOOL_ADD = 'mcp__handily-board__task_add'
const TOOL_UPDATE = 'mcp__handily-board__task_update'
const SECOND = 1000
const MINUTE = 60 * SECOND
const START = Date.UTC(2026, 10, 16, 13, 0)
const SURFACES = ['terminal', 'desktop'] as const
const TOKEN = `ghp_${'a'.repeat(30)}`
const NERD_WATCH = '\u{EB7C}'

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
          create: () => Promise.reject(new Error('the fake workitems creates no item')),
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

type World = {
  clock: MockClock
  statuses: (string | undefined)[]
  redraws: number
  commands: string[]
  store: Map<string, unknown>
  surfaces: RenderSurface[]
}

function world(on: On, surfaces: RenderSurface[] = ['terminal']): World {
  const state: World = {
    clock: mock.clock(on, { now: START }),
    statuses: [],
    redraws: 0,
    commands: [],
    store: new Map(),
    surfaces,
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: OWN_ID }))
  on('session.surfaces', () => ({ value: state.surfaces }))
  on('session.cwd', () => ({ value: ROOT }))
  on('agent.list', () => ({ value: [] }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__handily-board__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', { command: 'tasks' }, (_$, e) => {
    state.commands.push(e.command)
    return { text: '' }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', (_$, e, next) => {
    if (e.event === 'ui.render') state.redraws += 1
    return next(e)
  })
  on('ui.status', (_$, e) => {
    state.statuses.push(e.text)
    return { value: undefined }
  })
  on('store.get', (_$, e) => ({ value: state.store.get(e.key) }))
  on('store.keys', () => ({ value: [...state.store.keys()] }))
  on('store.delete', (_$, e) => {
    state.store.delete(e.key)
    return { value: undefined }
  })
  on('store.set', (_$, e) => {
    state.store.set(e.key, e.value)
    return { value: undefined }
  })
  return state
}

async function start($: Engine, surface: Surface): Promise<void> {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
}

function classicBase() {
  return {
    session_id: OWN_ID,
    transcript_path: '/work/t.jsonl',
    cwd: ROOT,
    permission_mode: 'default',
  }
}

const SHELL = {
  id: 'bakfjlhsk',
  type: 'shell',
  status: 'running',
  description: 'Watch the CI run',
  command: 'gh run watch 18842 --exit-status',
}

const MONITOR = {
  id: 'mon1',
  type: 'monitor',
  status: 'running',
  description: 'deploy log',
  server: 'ci-mcp',
  tool: 'watch_deploy',
}

const WAKEUP = {
  id: 'cron1',
  schedule: '0 14 16 11 *',
  recurring: false,
  prompt: 'Check the CI run again and merge when it is green',
}

const POLL = { id: 'cron2', schedule: '*/10 * * * *', recurring: true, prompt: 'Poll the release' }

type StopLists = { tasks?: readonly object[]; crons?: readonly object[] }

async function stop($: Engine, lists: StopLists): Promise<void> {
  await $.classic.Stop({
    ...classicBase(),
    stop_hook_active: false,
    ...(lists.tasks === undefined ? {} : { background_tasks: lists.tasks }),
    ...(lists.crons === undefined ? {} : { session_crons: lists.crons }),
  } as Parameters<Engine['classic']['Stop']>[0])
}

async function turn($: Engine, seen: World, id: string): Promise<void> {
  await $.turn.start({ text: 'go', turnId: id })
  await seen.clock.advance(5 * SECOND)
  await $.turn.complete({
    turnId: id,
    reason: 'answer',
    answer: '',
    durationMs: 5 * SECOND,
    isAborted: false,
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
  if (element.type === 'Text') return displayWidth(element.text)
  if (element.type === 'Button') {
    const label = element.text.length
    return element.props.plain === true ? label : label + 4
  }
  const inner =
    typeof element.props.width === 'number'
      ? element.props.width
      : element.children.reduce((sum, child) => sum + drawnWidth(child), 0)
  return inner + numberProp(element, 'marginLeft') + numberProp(element, 'paddingLeft')
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

function linesOf(element: Drawn, columns: number): string[] {
  const lines = screenOf(element, columns).map((line) => line.trimEnd())
  for (const line of lines) {
    expect(displayWidth(line) <= columns, `"${line}" is wider than ${String(columns)}`).toBe(true)
  }
  return lines
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

async function tabLines(
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
  const root = drawnOf(await ui.find({ type: 'Box' }))
  await ui.unmount()
  if (root === null) throw new Error('the pane drew no Box')
  return linesOf(root, columns)
}

function sessionPart(lines: readonly string[]): string[] {
  const first = lines.findIndex((line) => /^(╭─ )?Session /u.test(line))
  if (first < 0) throw new Error(`no Session section in:\n${lines.join('\n')}`)
  const isFramed = lines[first]?.startsWith('╭') === true
  const end = isFramed
    ? lines.findIndex((line, index) => index > first && line.startsWith('╰'))
    : lines.findIndex((line, index) => index > first && /^(ctx|req|limits) /u.test(line))
  return lines.slice(first, end < 0 ? undefined : isFramed ? end + 1 : end)
}

function bandProps(bodyColumns: number, maxRows: number): RenderPropsOf['AbovePrompt'] {
  return {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  }
}

async function mountBand($: Engine, surface: Surface, columns: number, maxRows = 10) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: bandProps(columns, maxRows),
  })
}

async function bandLines(
  $: Engine,
  surface: Surface,
  columns: number,
  maxRows = 10,
): Promise<string[] | undefined> {
  const ui = await mountBand($, surface, columns, maxRows)
  const band = drawnOf(await ui.find({ key: 'band' }))
  await ui.unmount()
  return band === null ? undefined : linesOf(band, columns)
}

async function pressIn(
  ui: { find: Mounted['find']; press: Mounted['press'] },
  key: string,
): Promise<void> {
  expect(await ui.find({ key })).toBeDefined()
  await ui.press({ key })
}

function lastStatus(seen: World): string | undefined {
  return seen.statuses.at(-1)
}

describe('the background state rule', () => {
  test('a Stop that lists work reads each kind, masks credentials and names the oldest first', () => {
    const keep = newBackgroundKeep()
    noteStop(keep, { background_tasks: [SHELL], session_crons: [] }, START)
    const token = { ...MONITOR, id: 'mon2', description: `deploy log ${TOKEN}` }
    const agent = {
      id: 'ag1',
      type: 'subagent',
      status: 'running',
      description: 'Map the hooks',
      agent_type: 'Explore',
    }
    const flow = {
      id: 'wf1',
      type: 'workflow',
      status: 'running',
      description: 'Ship',
      name: 'rel',
    }
    const later = noteStop(
      keep,
      { background_tasks: [token, agent, flow, SHELL], session_crons: [WAKEUP, POLL] },
      START + 3 * MINUTE,
    )
    if (later.kind !== 'waiting') throw new Error(`expected waiting, got ${later.kind}`)
    expect(later.items.map((item) => [item.kind, item.title, item.detail, item.hasButton])).toEqual(
      [
        ['shell', 'Watch the CI run', 'gh run watch 18842 --exit-status', true],
        ['monitor', 'deploy log ***', 'ci-mcp watch_deploy', true],
        ['agent', 'Explore', 'Map the hooks', true],
        ['workflow', 'Ship', 'rel', true],
        ['wakeup', 'at 14:00', 'Check the CI run again and merge when it is green', false],
        ['wakeup', 'cron */10 * * * *', 'Poll the release', false],
      ],
    )
    expect(later.items[0]?.firstSeenAt).toBe(START)
    expect(JSON.stringify(later)).not.toContain(TOKEN)
  })

  test('the status line names the first item, the age at the left, and the count of the rest, as mock C', () => {
    const lines = [
      [SHELL],
      [MONITOR],
      [],
      [
        {
          ...SHELL,
          id: 'ag',
          type: 'subagent',
          description: 'Map the hooks',
          agent_type: 'Explore',
        },
      ],
      [SHELL, MONITOR, { ...SHELL, id: 's2' }, { ...SHELL, id: 's3' }],
    ].map((tasks, index) => {
      const keep = newBackgroundKeep()
      const crons = index === 2 ? [WAKEUP] : []
      const state = noteStop(keep, { background_tasks: tasks, session_crons: crons }, START)
      if (state.kind !== 'waiting') throw new Error('expected waiting')
      return waitingStatusText(state, START + 3 * MINUTE, PLAIN_SIGNALS)
    })
    expect(lines).toEqual([
      '◷ waiting 3m · shell Watch the CI run · gh run watch 18842 --exit-status',
      '◷ waiting 3m · monitor deploy log · ci-mcp watch_deploy',
      '◷ waiting 3m · wakeup at 14:00 · Check the CI run again and merge when it is green',
      '◷ waiting 3m · agent Explore · Map the hooks',
      '◷ waiting 3m · shell Watch the CI run · +3 more in background',
    ])
  })

  test('lists that hold no readable item read as no turn, never idle', () => {
    const keep = newBackgroundKeep()
    expect(noteStop(keep, { background_tasks: [42, { id: 1 }], session_crons: [] }, START)).toEqual(
      {
        kind: 'noTurn',
        isUnreported: true,
      },
    )
  })

  test('the Session head beside an agent wait reads the waits, then the short waiting age', () => {
    const keep = newBackgroundKeep()
    const background = noteStop(keep, { background_tasks: [SHELL], session_crons: [] }, START)
    const view = {
      vitals: EMPTY_VITALS,
      background,
      waits: 1,
      checks: EMPTY_CHECKS,
      request: NO_REQUEST,
      now: START + 3 * MINUTE,
      signals: PLAIN_SIGNALS,
      palette: DEFAULT_PALETTE,
      hasResets: false,
    }
    expect(
      sessionStateParts(view)
        .map((part) => part.text)
        .join(''),
    ).toBe('◆ 1 waits · ◷ 3m')
    if (background.kind !== 'waiting') throw new Error('expected waiting')
    expect(besideAskText(background, PLAIN_SIGNALS)).toBe('◷ +1 in background')
  })

  test('a one shot wakeup shows its time, a recurring one and an odd field show the schedule raw', () => {
    expect(wakeupTime('5 9 16 11 *', false)).toBe('at 09:05')
    expect(wakeupTime('*/10 * * * *', true)).toBe('cron */10 * * * *')
    expect(wakeupTime('0 25 16 11 *', false)).toBe('cron 0 25 16 11 *')
    expect(wakeupTime('*/5 14 * * *', false)).toBe('cron */5 14 * * *')
  })

  test('empty lists read as idle, a missing list reads as no turn, and a turn start clears waiting', () => {
    const keep = newBackgroundKeep()
    expect(turnState(false, keep.current)).toBe('noTurn')
    expect(noteStop(keep, { background_tasks: [], session_crons: [] }, START).kind).toBe('idle')
    expect(noteStop(keep, { background_tasks: [] }, START).kind).toBe('noTurn')
    expect(noteStop(keep, { session_crons: [] }, START).kind).toBe('noTurn')
    expect(noteStop(keep, { background_tasks: [SHELL], session_crons: [] }, START).kind).toBe(
      'waiting',
    )
    expect(turnState(true, keep.current)).toBe('working')
    noteTurnStart(keep)
    expect(keep.current).toEqual(NO_TURN)
    const again = noteStop(keep, { background_tasks: [SHELL], session_crons: [] }, START + MINUTE)
    expect(again.kind === 'waiting' ? again.items[0]?.firstSeenAt : null).toBe(START)
  })

  test('after 30 minutes with no turn the age carries a question mark and the line says when it was last seen', () => {
    const keep = newBackgroundKeep()
    const state = noteStop(keep, { background_tasks: [SHELL], session_crons: [] }, START)
    if (state.kind !== 'waiting') throw new Error('expected waiting')
    expect(waitingStatusText(state, START + STALE_AFTER_MS + 10 * MINUTE, PLAIN_SIGNALS)).toBe(
      '◷ waiting 40m? · not seen since 40m · shell Watch the CI run · gh run watch 18842 --exit-status',
    )
  })

  test('the waiting mark is one column in both sets, the nerd watch icon with nerd signals and plain otherwise', () => {
    expect(waitingLook(PLAIN_SIGNALS)).toEqual({ mark: '◷', color: 'suggestion' })
    expect(waitingLook(signalLooks(GLYPH_SETS.nerd))).toEqual({
      mark: NERD_WATCH,
      color: 'suggestion',
    })
    expect(displayWidth(GLYPH_SETS.plain.waiting)).toBe(1)
    expect(displayWidth(GLYPH_SETS.nerd.waiting)).toBe(1)
  })

  test('the shared entry keeps only the first item, cut, and reads back; an entry without it reads as none', () => {
    const keep = newBackgroundKeep()
    const long = { ...SHELL, description: 'x'.repeat(1000) }
    const state = noteStop(keep, { background_tasks: [long, MONITOR], session_crons: [] }, START)
    const shared = sharedBackground(state)
    expect(shared).toEqual({
      since: START,
      seenAt: START,
      count: 2,
      kind: 'shell',
      title: 'x'.repeat(80),
    })
    expect(sharedBackground(NO_TURN)).toBeNull()
  })
})

const WAITING_CRITERION =
  'When a main session turn ends and the Stop input lists background work or session crons, the board shows waiting with the mark, the age and the first item, on the band, the status line under attention and the Session card head, on terminal and desktop.'
const CLEAR_CRITERION =
  'When the next turn starts or a Stop input lists no background work and no crons, the board clears waiting and shows working or idle.'
const NO_TURN_CRITERION =
  'When the Stop input has no background list, the board shows no turn and never idle.'

const FRAMED_WAITING = [
  '╭─ Session ────────────── ◷ waiting 3m ─╮',
  '│ on shell   Watch the CI run        3m │',
  '│    monitor deploy log              3m │',
  '│    [ tasks ] +1 more                  │',
]

describe(WAITING_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `the band, the status line and the Session head show waiting 3m and the first item, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL, MONITOR], crons: [WAKEUP] })
        await seen.clock.advance(3 * MINUTE)
        expect(lastStatus(seen)).toBe(
          '◷ waiting 3m · shell Watch the CI run · +2 more in background',
        )
        expect(await bandLines($, surface, 120)).toEqual([
          '◷ waiting 3m · 3 in background · no open task                                                                  [ board ]',
          '◷ shell     waiting   Watch the CI run · gh run watch 18842 --exit-status                                       open  3m',
          '◷ monitor   waiting   deploy log · ci-mcp watch_deploy                                                          open  3m',
          '◷ wakeup    waiting   at 14:00 · Check the CI run again and merge when it is green                                    3m',
        ])
        const tab = sessionPart(await tabLines($, surface, 'dock', 41))
        if (surface === 'terminal') expect(tab.slice(0, 4)).toEqual(FRAMED_WAITING)
        else
          expect(tab.slice(0, 2)).toEqual([
            'Session  ◷ waiting 3m',
            'on shell Watch the CI run +2 more open',
          ])
        expect(sessionPart(await tabLines($, surface, 'inline', 40)).slice(0, 2)).toEqual([
          'Session  ◷ waiting 3m',
          '    on shell Watch the CI … +2 more open',
        ])
      },
    )

    test(
      `the band head leads with waiting before the task in progress, and the age ticks with no pane open, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await $.tool.call({ tool: TOOL_ADD, title: 'Write the tab mocks' })
        await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'in_progress' })
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await seen.clock.advance(MINUTE)
        expect(lastStatus(seen)).toBe(
          '◷ waiting 1m · shell Watch the CI run · gh run watch 18842 --exit-status',
        )
        await seen.clock.advance(2 * MINUTE)
        expect(lastStatus(seen)).toBe(
          '◷ waiting 3m · shell Watch the CI run · gh run watch 18842 --exit-status',
        )
        const band = await bandLines($, surface, 120)
        expect(band?.[0]).toBe(
          '◷ waiting 3m · ▶ 1 Write the tab mocks                                                                3m ▰ 0/1 [ board ]',
        )
        expect(band?.[1]).toBe(
          '◷ shell     waiting   Watch the CI run · gh run watch 18842 --exit-status                                       open  3m',
        )
      },
    )

    test(
      `the open button of a shell row runs /tasks and a wakeup row has none, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [WAKEUP] })
        const ui = await mountBand($, surface, 120)
        await pressIn(ui, `band-background-open:${SHELL.id}`)
        expect(await ui.find({ key: `band-background-open:cron:${WAKEUP.id}` })).toBeUndefined()
        await ui.unmount()
        await seen.clock.settle()
        expect(seen.commands).toEqual(['tasks'])
      },
    )

    test(
      `at 40 columns the band keeps the mark, the word and the age and cuts the rest, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL, MONITOR], crons: [WAKEUP, POLL] })
        await seen.clock.advance(3 * MINUTE)
        expect(await bandLines($, surface, 35, 5)).toEqual([
          '◷ waiting 3m · no task    [ board ]',
          '◷ shell     waiting Watch the… open',
          '◷ monitor   waiting deploy log open',
          '◷ wakeup    waiting at 14:00…',
          '[ +1 more · 1 in background ]',
        ])
      },
    )

    test(
      `after 30 minutes with no turn the board says not seen since and never clears waiting, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await seen.clock.advance(40 * MINUTE)
        expect(lastStatus(seen)).toBe(
          '◷ waiting 40m? · not seen since 40m · shell Watch the CI run · gh run watch 18842 --exit-status',
        )
        const tab = sessionPart(await tabLines($, surface, 'dock', 41))
        if (surface === 'terminal') {
          expect(tab[0]).toBe('╭─ Session ──────────── ◷ waiting 40m? ─╮')
        } else {
          expect(tab.slice(0, 3)).toEqual([
            'Session  ◷ waiting 40m?',
            'on shell Watch the CI run open',
            'not seen since 40m',
          ])
        }
        const band = await bandLines($, surface, 120)
        expect(band?.[0]?.startsWith('◷ waiting 40m? · not seen since 40m · 1 in background')).toBe(
          true,
        )
      },
    )

    test(
      `with the status line off the board sets no line while it waits, on ${surface}`,
      { ...withWorkitems, options: { statusLine: 'off' } },
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await seen.clock.advance(MINUTE)
        expect(seen.statuses).toEqual([])
      },
    )
  }

  test('a Stop of a subagent changes nothing on the board', withWorkitems, async ($, on) => {
    const seen = world(on, ['terminal'])
    await start($, 'terminal')
    await turn($, seen, 't1')
    await $.classic.Stop({
      ...classicBase(),
      stop_hook_active: false,
      agent_id: 'a0000002scout',
      background_tasks: [SHELL],
      session_crons: [],
    })
    expect(seen.statuses).toEqual([])
    expect(sessionPart(await tabLines($, 'terminal', 'dock', 41))[0]).toBe(
      '╭─ Session ───────────────── ○ no turn ─╮',
    )
  })
})

describe(CLEAR_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `the next turn start clears waiting to working, and an empty Stop shows idle, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await seen.clock.advance(MINUTE)
        expect(lastStatus(seen)).toContain('◷ waiting 1m')
        await $.turn.start({ text: 'Background command completed', turnId: 't2' })
        expect(lastStatus(seen)).toBeUndefined()
        const running = sessionPart(await tabLines($, surface, 'dock', 41))
        expect(running[0]).toBe(
          surface === 'terminal'
            ? '╭─ Session ───────────────── ▶ working ─╮'
            : 'Session  ▶ working',
        )
        expect(await bandLines($, surface, 120)).toBeUndefined()
        await seen.clock.advance(5 * SECOND)
        await $.turn.complete({
          turnId: 't2',
          reason: 'answer',
          answer: '',
          durationMs: 5 * SECOND,
          isAborted: false,
        })
        await stop($, { tasks: [], crons: [] })
        const idle = sessionPart(await tabLines($, surface, 'dock', 41))
        expect(idle[0]).toBe(
          surface === 'terminal' ? '╭─ Session ──────────────────── ○ idle ─╮' : 'Session  ○ idle',
        )
        expect(lastStatus(seen)).toBeUndefined()
        const statuses = seen.statuses.length
        await seen.clock.advance(MINUTE)
        expect(seen.statuses.length).toBe(statuses)
      },
    )
  }
})

describe(NO_TURN_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `a Stop with no background list shows no turn and background not reported, and never idle, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        const fresh = sessionPart(await tabLines($, surface, 'dock', 41))
        expect(fresh[0]).toBe(
          surface === 'terminal' ? '╭─ Session ──────────────────── ○ idle ─╮' : 'Session  ○ idle',
        )
        await turn($, seen, 't1')
        await stop($, { crons: [] })
        const lines = sessionPart(await tabLines($, surface, 'dock', 41))
        if (surface === 'terminal') {
          expect(lines.slice(0, 2)).toEqual([
            '╭─ Session ───────────────── ○ no turn ─╮',
            '│ background: not reported              │',
          ])
        } else {
          expect(lines[0]).toBe('Session  ○ no turn')
        }
        expect(lines.join('\n')).not.toContain('idle')
        expect(seen.statuses).toEqual([])
      },
    )

    test(
      `a cleared session after waiting resets to no turn and clears the status line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        expect(lastStatus(seen)).toContain('◷ waiting')
        await $.session.end({ reason: 'clear', sessionId: OWN_ID, resume: { id: OWN_ID } })
        expect(lastStatus(seen)).toBeUndefined()
        const lines = sessionPart(await tabLines($, surface, 'dock', 41))
        expect(lines[0]).toBe(
          surface === 'terminal'
            ? '╭─ Session ───────────────── ○ no turn ─╮'
            : 'Session  ○ no turn',
        )
      },
    )
  }
})

const REPAIR_CRITERION =
  'The board keeps waiting through a subagent turn and an interrupted main turn, reads a new session as idle, and stops its timer at every session end.'

async function sessionStart($: Engine, source: string): Promise<void> {
  await $.classic.SessionStart({
    ...classicBase(),
    hook_event_name: 'SessionStart',
    source,
  } as Parameters<Engine['classic']['SessionStart']>[0])
}

function headOf(lines: readonly string[]): string {
  return lines[0] ?? ''
}

describe(REPAIR_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `a subagent turn start keeps the published waiting state and the head, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await $.turn.start({ text: 'scout', turnId: 'a1', agentId: 'a0000002scout' })
        await $.turn.start({ text: 'scout again', turnId: 'a2', agentId: 'a0000002scout' })
        expect(headOf(sessionPart(await tabLines($, surface, 'dock', 41)))).toContain('◷ waiting')
      },
    )

    test(
      `a main turn interrupted with no Stop restores waiting with its first seen age, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await seen.clock.advance(2 * MINUTE)
        await $.turn.start({ text: 'go on', turnId: 't2' })
        await seen.clock.advance(MINUTE)
        await $.turn.complete({
          turnId: 't2',
          reason: 'aborted',
          answer: '',
          durationMs: MINUTE,
          isAborted: true,
        })
        expect(lastStatus(seen)).toBe(
          '◷ waiting 3m · shell Watch the CI run · gh run watch 18842 --exit-status',
        )
        expect(headOf(sessionPart(await tabLines($, surface, 'dock', 41)))).toBe(
          surface === 'terminal'
            ? '╭─ Session ────────────── ◷ waiting 3m ─╮'
            : 'Session  ◷ waiting 3m',
        )
      },
    )

    test(
      `an interrupted turn after an idle Stop stays no turn, and a turn that answers restores nothing, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await turn($, seen, 't2')
        expect(headOf(sessionPart(await tabLines($, surface, 'dock', 41)))).toContain('○ no turn')
        await stop($, { tasks: [], crons: [] })
        await $.turn.start({ text: 'go on', turnId: 't3' })
        await $.turn.complete({
          turnId: 't3',
          reason: 'aborted',
          answer: '',
          durationMs: SECOND,
          isAborted: true,
        })
        expect(headOf(sessionPart(await tabLines($, surface, 'dock', 41)))).toContain('○ no turn')
      },
    )

    test(
      `a new session reads idle before its first Stop, and a resume or a clear reads no turn, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, [surface])
        await start($, surface)
        await sessionStart($, 'startup')
        expect(headOf(sessionPart(await tabLines($, surface, 'dock', 41)))).toBe(
          surface === 'terminal' ? '╭─ Session ──────────────────── ○ idle ─╮' : 'Session  ○ idle',
        )
        await sessionStart($, 'resume')
        expect(headOf(sessionPart(await tabLines($, surface, 'dock', 41)))).toBe(
          surface === 'terminal'
            ? '╭─ Session ───────────────── ○ no turn ─╮'
            : 'Session  ○ no turn',
        )
      },
    )

    test(
      `a resume that starts the process reads no turn before its first Stop, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, [surface])
        await sessionStart($, 'resume')
        await start($, surface)
        expect(headOf(sessionPart(await tabLines($, surface, 'dock', 41)))).toContain('○ no turn')
      },
    )

    test(
      `at 30 columns with a task open the band head fits its width, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await $.tool.call({ tool: TOOL_ADD, title: 'Write the tab mocks' })
        await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'in_progress' })
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await seen.clock.advance(6 * MINUTE)
        for (const columns of [25, 30, 32, 35]) {
          const head = (await bandLines($, surface, columns))?.[0] ?? ''
          expect(head.startsWith('◷ waiting 6m'), head).toBe(true)
          expect(head.endsWith('[ board ]'), head).toBe(true)
        }
      },
    )

    test(
      `a session end of any reason stops the waiting timer, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, [surface])
        await start($, surface)
        await turn($, seen, 't1')
        await stop($, { tasks: [SHELL], crons: [] })
        await $.session.end({ reason: 'other', sessionId: OWN_ID, resume: { id: OWN_ID } })
        const redraws = seen.redraws
        await seen.clock.advance(MINUTE)
        expect(seen.redraws).toBe(redraws)
        expect(lastStatus(seen)).toBeUndefined()
      },
    )
  }

  test('the shared entry keeps a control character unescaped, and the line escapes it once', () => {
    const keep = newBackgroundKeep()
    const bell = { ...SHELL, description: 'Watch\u0007 the CI run' }
    const state = noteStop(keep, { background_tasks: [bell], session_crons: [] }, START)
    expect(sharedBackground(state)?.title).toBe('Watch\u0007 the CI run')
    if (state.kind !== 'waiting') throw new Error('expected waiting')
    expect(waitingStatusText(state, START, PLAIN_SIGNALS)).toBe(
      '◷ waiting 0s · shell Watch\\u0007 the CI run · gh run watch 18842 --exit-status',
    )
  })
})
