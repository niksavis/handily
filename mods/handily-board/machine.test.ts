import type { ConfigRow, On, RenderPropsOf, RenderSurface } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Mounted,
} from 'claude-code/testing'
import { isEnded, startOfStat } from './hooks/liveness'
import { readAsk, readSession, sessionRow, storeSetting, type FiledSession } from './hooks/store'
import { displayWidth } from './hooks/width'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const NOW = Date.parse('2026-11-19T16:00:00.000Z')
const ROOT = '/work/app'
const STORE = '/work/.orch'
const PLUGIN = 'handily-board'
const MACHINE = 'sessions'
const OWN_ID = 'dev'
const SURFACES = ['terminal', 'desktop'] as const
const WITH_STORE = { options: { store: STORE } }
const IN_ANSWER_WINDOW = { options: { store: STORE, answerWindow: 'orchestrator' } }
const OWN_PID = 4242
const SELF_START = 7

type FakeFile = { text: string; mtimeMs: number; size?: number }

type World = {
  clock: MockClock
  files: Map<string, FakeFile>
  folders: Set<string>
  surfaces: RenderSurface[]
  panes: Set<string>
  shown: string | undefined
  procs: Map<number, number>
  hasProc: boolean
  listDenial: string | null
  lists: string[]
  reads: string[]
  logs: string[]
  fills: string[]
  isFillRefused: boolean
  submitted: string[]
}

function iso(at: number): string {
  return new Date(at).toISOString()
}

function statOf(pid: number, start: number): string {
  return `${String(pid)} (node (worker)) S ${'0 '.repeat(18)}${String(start)} 0 0`
}

type Fields = Record<string, unknown>

function sessionFile(id: string, agoMs: number, fields: Fields = {}): [string, FakeFile] {
  const body = { v: 1, id, platform: 'linux', updated_at: iso(NOW - agoMs), ...fields }
  return [`${STORE}/sessions/${id}.json`, { text: JSON.stringify(body), mtimeMs: NOW - agoMs }]
}

function askFile(record: string, agoMs: number, fields: Fields = {}): [string, FakeFile] {
  const body = { v: 1, record, opened_at: iso(NOW - agoMs), ...fields }
  return [`${STORE}/asks/${record}.json`, { text: JSON.stringify(body), mtimeMs: NOW - agoMs }]
}

function rawFile(path: string, text: string, size?: number): [string, FakeFile] {
  return [
    `${STORE}/${path}`,
    size === undefined ? { text, mtimeMs: NOW } : { text, mtimeMs: NOW, size },
  ]
}

const RELEASE_ASK = askFile('handily-s3yqhr', 6 * MINUTE, {
  question: 'Release handily-board 0.24.0?',
  options: 'go|not now',
})

const API_LOGIN = sessionFile('api-login', 2 * MINUTE, {
  name: 'api-login',
  project: 'api',
  vendor: 'claude',
  state: 'needs-you',
  state_at: iso(NOW - 2 * MINUTE),
  waiting_on: 'owner go for the 0.24.0 release',
})

const OLD_LANE = sessionFile('old-lane', 25 * MINUTE, {
  name: 'old-lane',
  project: 'handily',
  vendor: 'claude',
  state: 'working',
  now: 'runs npm run check',
  now_at: iso(NOW - 25 * MINUTE),
  pid: 501,
  pid_start: 900,
})

const DEV = sessionFile(OWN_ID, MINUTE, {
  name: 'dev',
  project: 'development',
  vendor: 'claude',
  state: 'working',
  now: 'builds the work overview',
  now_at: iso(NOW - MINUTE),
  next: 'rehearsal 7c after 16:20',
  pid: 502,
  pid_start: 910,
})

const LANE_B = sessionFile('lane-b', 4 * MINUTE, {
  name: 'lane-b',
  project: 'handily',
  vendor: 'codex',
  state: 'working',
  now: 'writes the store reader',
  now_at: iso(NOW - 4 * MINUTE),
})

const DOCS_PASS = sessionFile('docs-pass', 40 * MINUTE, {
  name: 'docs-pass',
  project: 'docs',
  vendor: 'claude',
  state: 'idle',
  now: 'reviewed the README',
  now_at: iso(NOW - 40 * MINUTE),
})

const SCOUT = sessionFile('scout', 3 * HOUR, {
  name: 'scout',
  project: 'app',
  vendor: 'claude',
  state: 'working',
})

const FULL_STORE = [RELEASE_ASK, API_LOGIN, OLD_LANE, DEV, LANE_B, DOCS_PASS, SCOUT]

const LIVE_PROCS: [number, number][] = [
  [501, 999],
  [502, 910],
]

type WorldOptions = {
  files?: readonly [string, FakeFile][]
  surfaces?: RenderSurface[]
  folders?: readonly string[]
}

function world(on: On, options: WorldOptions = {}): World {
  const state: World = {
    clock: mock.clock(on, { now: NOW }),
    files: new Map(options.files ?? FULL_STORE),
    folders: new Set(options.folders ?? [`${STORE}/sessions`, `${STORE}/asks`]),
    surfaces: options.surfaces ?? ['terminal', 'desktop'],
    panes: new Set(),
    shown: undefined,
    procs: new Map(LIVE_PROCS),
    hasProc: true,
    listDenial: null,
    lists: [],
    reads: [],
    logs: [],
    fills: [],
    isFillRefused: false,
    submitted: [],
  }
  const store = new Map<string, unknown>()
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
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: OWN_ID }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: state.surfaces }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/person' : undefined }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__handily-board__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
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
  on('fs.list', (_$, e) => {
    state.lists.push(e.path)
    if (state.listDenial !== null) return { deny: state.listDenial }
    const prefix = `${e.path}/`
    const entries = [...state.files]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, one]) => ({
        name: path.slice(prefix.length),
        kind: 'file' as const,
        size: one.size ?? new TextEncoder().encode(one.text).length,
        mtimeMs: one.mtimeMs,
        isLink: false,
      }))
    if (entries.length === 0 && !state.folders.has(e.path)) {
      return { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
    }
    return { value: entries }
  })
  on('fs.read', (_$, e) => {
    state.reads.push(e.path)
    if (e.path === '/proc/self/stat') {
      return state.hasProc
        ? { value: statOf(OWN_PID, SELF_START) }
        : { deny: 'EACCES: permission denied' }
    }
    const pid = /^\/proc\/(\d+)\/stat$/.exec(e.path)?.[1]
    if (pid !== undefined) {
      const start = state.procs.get(Number(pid))
      return start === undefined
        ? { deny: `ENOENT: no such file or directory, open '${e.path}'` }
        : { value: statOf(Number(pid), start) }
    }
    const found = state.files.get(e.path)
    return found === undefined
      ? { deny: `ENOENT: no such file or directory, open '${e.path}'` }
      : { value: found.text }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_$, e) => {
    if (state.isFillRefused) return { isFilled: false }
    state.fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    state.submitted.push(e.text)
    return { text: e.text }
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

type Placement = RenderPropsOf['Pane']['placement']

function paneProps(placement: Placement, bodyColumns: number): RenderPropsOf['Pane'] {
  return {
    title: 'this machine',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  }
}

async function mountTab($: Engine, surface: RenderSurface, placement: Placement, columns: number) {
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

function screenOf(element: Drawn): string[] {
  if (element.type === 'Text' || element.type === 'Button') return [element.text]
  const indent = numberProp(element, 'paddingLeft')
  const lines =
    element.props.flexDirection === 'row'
      ? [element.children.map((child) => child.text).join('')]
      : element.children.flatMap((child) => screenOf(child))
  return lines.map((line) => `${' '.repeat(indent)}${line}`)
}

async function screen(ui: { find: Mounted['find'] }, columns: number): Promise<string[]> {
  const root = drawnOf(await ui.find({ type: 'Box' }))
  if (root === null) throw new Error('the pane drew no Box')
  const lines = screenOf(root).map((line) => line.trimEnd())
  for (const line of lines) {
    expect(displayWidth(line) <= columns, `"${line}" is wider than ${String(columns)}`).toBe(true)
  }
  return lines
}

async function screenAt(
  $: Engine,
  surface: RenderSurface,
  placement: Placement,
  columns: number,
): Promise<string[]> {
  const ui = await mountTab($, surface, placement, columns)
  const lines = await screen(ui, columns)
  await ui.unmount()
  return lines
}

async function showMachine($: Engine, seen: World): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(await board($, 'machine')).toBe('Board opened: this machine.')
  const first = await mountTab($, 'terminal', 'dock', 41)
  await first.unmount()
  await seen.clock.settle()
}

async function shownAfterRead($: Engine, seen: World): Promise<void> {
  await showMachine($, seen)
  await seen.clock.advance(12 * SECOND)
}

function sessionListings(seen: World): number {
  return seen.lists.filter((path) => path === `${STORE}/sessions`).length
}

const RULE_41 = '─'.repeat(41)

const MOCK_41 = [
  'Sessions  6 · 2 need you · 1 dead · 12s',
  '◆ decide  handily-s3yqhr               6m',
  '  Release handily-board 0.24.0?',
  '  options: go | not now',
  '  answer in the Orchestrator window',
  RULE_41,
  '◆ api-login  needs you                 2m',
  '  api · claude',
  '  waits on: owner go for the 0.24.0 rele…',
  RULE_41,
  '■ old-lane  dead                      25m',
  '  handily · claude · process gone',
  '  ▸ runs npm run check · 25m old',
  RULE_41,
  '▶ dev  this  working                   1m',
  '  development · claude',
  '  ▸ builds the work overview',
  '  next: rehearsal 7c after 16:20',
  RULE_41,
  '▶ lane-b  working                      4m',
  '  handily · codex',
  '  ▸ writes the store reader',
  RULE_41,
  '○ docs-pass  quiet                    40m',
  '  docs · claude',
  '  ▸ reviewed the README · 40m old',
  RULE_41,
  '? scout  stale                         3h',
  '  app · claude · last write 3h ago',
]

const MOCK_76 = [
  'Sessions  6 · 2 need you · 1 dead · read 12s ago',
  '◆ decide     handily-s3yqhr               Release handily-board 0.24.0?   6m',
  '    options: go | not now · answer in the Orchestrator window',
  '◆ api-login  needs you       api          waits on: owner go for the 0.…  2m',
  '■ old-lane   dead            handily      process gone · ▸ runs npm run… 25m',
  '▶ dev        this · working  development  ▸ builds the work overview      1m',
  '    next: rehearsal 7c after 16:20',
  '▶ lane-b     working         handily      ▸ writes the store reader · c…  4m',
  '○ docs-pass  quiet           docs         ▸ reviewed the README · 40m o… 40m',
  '? scout      stale           app          last write 3h ago               3h',
]

const NO_SETTING_CRITERION =
  'When the store setting is unset, the this machine tab names the setting to set and shows no session and no ask.'

describe(NO_SETTING_CRITERION, () => {
  for (const surface of SURFACES) {
    test(`with no store option the tab names the option and lists no folder, on ${surface}`, async ($, on) => {
      const seen = world(on)
      await showMachine($, seen)
      expect(await screenAt($, surface, 'dock', 41)).toEqual([
        'Sessions',
        'No store folder is set. Set the',
        'handily-board option store in /config to',
        'the folder that holds sessions/ and',
        'asks/.',
      ])
      expect(seen.lists).toEqual([])
      expect(seen.reads).toEqual([])
    })
  }

  test(
    'a relative store path is named as not usable and nothing is read',
    { options: { store: 'work/.orch' } },
    async ($, on) => {
      const seen = world(on)
      await showMachine($, seen)
      expect(await screenAt($, 'terminal', 'inline', 76)).toEqual([
        'Sessions',
        'The handily-board option store in /config is not usable: it is a relative',
        'path.',
        'Set it to the absolute path of the folder that holds sessions/ and asks/.',
      ])
      expect(seen.lists).toEqual([])
    },
  )

  test('the store setting refuses a relative path, a control character, a line break, a long path and a value that is not a text', () => {
    expect(storeSetting(undefined, '/home/person')).toEqual({ kind: 'unset' })
    expect(storeSetting('  ', '/home/person')).toEqual({ kind: 'unset' })
    expect(storeSetting('work/.orch', '/home/person')).toEqual({
      kind: 'refused',
      reason: 'it is a relative path',
    })
    expect(storeSetting('/work/\u{7}orch', '/home/person')).toEqual({
      kind: 'refused',
      reason: 'it holds a control character or a line break',
    })
    expect(storeSetting('/work/\norch', '/home/person')).toEqual({
      kind: 'refused',
      reason: 'it holds a control character or a line break',
    })
    expect(storeSetting(`/${'a'.repeat(4096)}`, '/home/person')).toEqual({
      kind: 'refused',
      reason: 'it is longer than 4096 characters',
    })
    expect(storeSetting(42, '/home/person')).toEqual({
      kind: 'refused',
      reason: 'it is not a text',
    })
  })

  test('a leading ~/ expands from HOME, and with no HOME it is refused by name', () => {
    expect(storeSetting('~/work/.orch/', '/home/person/')).toEqual({
      kind: 'set',
      path: '/home/person/work/.orch',
      shown: '~/work/.orch/',
    })
    expect(storeSetting('~/work/.orch', undefined)).toEqual({
      kind: 'refused',
      reason: 'it starts with ~/ and HOME is not set',
    })
  })

  test(
    'a session with only the desktop surface says the store is read only in a terminal session and reads nothing',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, { surfaces: ['desktop'] })
      await showMachine($, seen)
      expect(await screenAt($, 'desktop', 'dock', 41)).toEqual([
        'Sessions',
        'The store is read only in a terminal',
        'session.',
      ])
      expect(seen.lists).toEqual([])
    },
  )
})

const LIST_CRITERION =
  'When the store folder holds session files and ask files, the tab lists open asks first and then every session with its derived state (dead, stale, needs you, working, quiet), its project, its now text with its age past 15 minutes, and its next text, with a refresh every 15 seconds while the tab is shown.'

describe(LIST_CRITERION, () => {
  for (const surface of SURFACES) {
    test(`draws mock d41-full docked at 41 columns, on ${surface}`, WITH_STORE, async ($, on) => {
      const seen = world(on)
      await shownAfterRead($, seen)
      expect(await screenAt($, surface, 'dock', 41)).toEqual(MOCK_41)
    })

    test(`draws mock i76-full inline at 76 columns, on ${surface}`, WITH_STORE, async ($, on) => {
      const seen = world(on)
      await shownAfterRead($, seen)
      expect(await screenAt($, surface, 'inline', 76)).toEqual(MOCK_76)
    })
  }

  test('the widget placement draws the Sessions head alone', WITH_STORE, async ($, on) => {
    const seen = world(on)
    await shownAfterRead($, seen)
    expect(await screenAt($, 'terminal', 'widget', 76)).toEqual([
      'Sessions  6 · 2 need you · 1 dead · 12s',
    ])
  })

  test(
    'reads the store every 15 seconds while the tab is shown and never while it is hidden',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on)
      await showMachine($, seen)
      expect(sessionListings(seen)).toBe(1)
      await seen.clock.advance(15 * SECOND)
      expect(sessionListings(seen)).toBe(2)
      await seen.clock.advance(15 * SECOND)
      expect(sessionListings(seen)).toBe(3)
      expect(await board($, '')).toBe('Board opened: this session.')
      await seen.clock.advance(60 * SECOND)
      expect(sessionListings(seen)).toBe(3)
    },
  )

  test('each derived state follows its rule in order', () => {
    const now = NOW
    const base = (fields: Partial<FiledSession>): FiledSession => ({
      id: 'one',
      updatedAt: now - MINUTE,
      name: null,
      project: null,
      vendor: null,
      platform: 'linux',
      pid: null,
      pidStart: null,
      state: null,
      stateAt: null,
      now: null,
      nowAt: null,
      next: null,
      waitingOn: null,
      mtimeMs: now,
      isDead: false,
      ...fields,
    })
    const stateOf = (fields: Partial<FiledSession>) => sessionRow(base(fields), now, 'dev').state
    expect(stateOf({ isDead: true, state: 'needs-you', updatedAt: now - 3 * HOUR })).toBe('dead')
    expect(stateOf({ state: 'needs-you', updatedAt: now - 2 * HOUR })).toBe('stale')
    expect(stateOf({ state: 'working', updatedAt: now - 2 * HOUR + 1 })).toBe('quiet')
    expect(stateOf({ state: 'working', updatedAt: now + 6 * MINUTE })).toBe('stale')
    expect(sessionRow(base({ updatedAt: now + 6 * MINUTE }), now, 'dev').isClockAhead).toBe(true)
    expect(stateOf({ state: 'working', updatedAt: now + 4 * MINUTE })).toBe('working')
    expect(stateOf({ state: 'needs-you' })).toBe('needsYou')
    expect(stateOf({ state: 'working', updatedAt: now - 15 * MINUTE + 1 })).toBe('working')
    expect(stateOf({ state: 'working', updatedAt: now - 15 * MINUTE })).toBe('quiet')
    expect(stateOf({ state: 'idle' })).toBe('quiet')
    expect(stateOf({})).toBe('quiet')
    expect(sessionRow(base({ updatedAt: now + 4 * MINUTE }), now, 'dev').ageMs).toBe(0)
  })

  test(
    'a now text past 15 minutes shows its own age and a newer one shows none',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, {
        files: [
          sessionFile('fresh', MINUTE, {
            name: 'fresh',
            state: 'working',
            now: 'builds',
            now_at: iso(NOW - 14 * MINUTE),
          }),
          sessionFile('older', MINUTE, {
            name: 'older',
            state: 'working',
            now: 'reads',
            now_at: iso(NOW - 16 * MINUTE),
          }),
        ],
      })
      await shownAfterRead($, seen)
      const lines = await screenAt($, 'terminal', 'dock', 41)
      expect(lines).toContain('  ▸ builds')
      expect(lines).toContain('  ▸ reads · 16m old')
    },
  )

  test(
    'a stale session with a clock ahead says so instead of a last write age',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, {
        files: [sessionFile('ahead', -10 * MINUTE, { name: 'ahead', project: 'app' })],
      })
      await shownAfterRead($, seen)
      expect(await screenAt($, 'terminal', 'dock', 41)).toEqual([
        'Sessions  1 · 12s',
        '? ahead  stale                         0s',
        '  app · clock ahead',
      ])
    },
  )

  test(
    'a store folder that is missing names the folder and the option and retries in 15 seconds',
    { options: { store: '~/work/.orch' } },
    async ($, on) => {
      const seen = world(on, { files: [], folders: [] })
      await shownAfterRead($, seen)
      expect(await screenAt($, 'terminal', 'dock', 41)).toEqual([
        'Sessions',
        'The store folder is missing:',
        '~/work/.orch',
        'Check the option store in /config.',
        '  retry in 15s',
      ])
      expect(await screenAt($, 'terminal', 'inline', 76)).toEqual([
        'Sessions',
        'The store folder is missing: ~/work/.orch',
        'Check the option store in /config.  retry in 15s',
      ])
      expect(seen.lists).toContain('/home/person/work/.orch/sessions')
    },
  )

  test(
    'an empty store counts 0 and says that no session wrote and no ask is open',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, { files: [] })
      await shownAfterRead($, seen)
      expect(await screenAt($, 'terminal', 'dock', 41)).toEqual([
        'Sessions  0 · 12s',
        'No session has written to the store.',
        'No ask is open.',
      ])
      expect(await screenAt($, 'terminal', 'inline', 76)).toEqual([
        'Sessions  0 · read 12s ago',
        'No session has written to the store. No ask is open.',
      ])
    },
  )

  test(
    'a list that fails keeps the last read with its age and draws its marks dim',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, { files: [API_LOGIN] })
      await showMachine($, seen)
      seen.listDenial = 'EACCES: permission denied'
      await seen.clock.advance(2 * MINUTE)
      const ui = await mountTab($, 'terminal', 'dock', 41)
      expect(await screen(ui, 41)).toEqual([
        'Sessions  1 · 2m',
        'The store was not read: permission',
        'denied. The debug log names the file.',
        '  retry in 15s',
        'Showing the read of 2m ago.',
        '◆ api-login  needs you                 4m',
        '  api · claude',
        '  waits on: owner go for the 0.24.0 rele…',
      ])
      const head = drawnOf(await ui.find({ key: 'card:session:api-login:head' }))
      expect(head?.children[0]?.props.dimColor).toBe(true)
      expect(head?.children.map((part) => part.props.color)).not.toContain('warning')
      await ui.unmount()
      expect(seen.logs.some((line) => line.includes('EACCES'))).toBe(true)
    },
  )

  test('a first read that fails says that the store was not read', WITH_STORE, async ($, on) => {
    const seen = world(on)
    seen.listDenial = 'EACCES: permission denied'
    await shownAfterRead($, seen)
    expect(await screenAt($, 'terminal', 'dock', 41)).toEqual([
      'Sessions',
      'The store was not read: permission',
      'denied. The debug log names the file.',
      '  retry in 15s',
    ])
  })

  test(
    'of 205 session files and 53 ask files the newest 200 and 50 are read and the rest are counted',
    WITH_STORE,
    async ($, on) => {
      const sessions = Array.from({ length: 205 }, (_, index) =>
        sessionFile(`s${String(index).padStart(3, '0')}`, 3 * HOUR + index * SECOND),
      )
      const asks = Array.from({ length: 53 }, (_, index) =>
        askFile(`handily-a${String(index).padStart(3, '0')}`, 2 * HOUR + index * SECOND, {
          closed_by: 'approved',
          closed_at: iso(NOW - 2 * HOUR),
        }),
      )
      const seen = world(on, { files: [...sessions, ...asks] })
      await shownAfterRead($, seen)
      const read = seen.reads.filter((path) => path.startsWith(STORE))
      expect(read.filter((path) => path.includes('/sessions/'))).toHaveLength(200)
      expect(read.filter((path) => path.includes('/asks/'))).toHaveLength(50)
      expect(read).not.toContain(`${STORE}/sessions/s204.json`)
      expect(read).toContain(`${STORE}/sessions/s000.json`)
      const lines = await screenAt($, 'terminal', 'dock', 41)
      expect(lines[0]).toBe('Sessions  200 · 12s')
      expect(lines.slice(-2)).toEqual([
        '5 files over the limit of 200 not read',
        '3 ask files over the limit of 50 not read',
      ])
    },
  )

  test(
    'an open ask counts, an ask open for 24 hours is an old ask that does not count, and a closed ask shows dim for 1 hour',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, {
        files: [
          askFile('handily-open1', 23 * HOUR, { question: 'Merge it?' }),
          askFile('handily-cd34', 2 * 24 * HOUR, { question: 'Merge the lane?' }),
          askFile('handily-s3yqhr', 2 * HOUR, {
            question: 'Release handily-board 0.24.0?',
            closed_by: 'approved',
            closed_at: iso(NOW - 3 * MINUTE),
          }),
          askFile('handily-ab12', 2 * HOUR, {
            question: 'Which region should the probe use?',
            closed_by: 'withdrawn',
            closed_at: iso(NOW - 40 * MINUTE),
          }),
          askFile('handily-gone1', 3 * HOUR, {
            question: 'Gone?',
            closed_by: 'approved',
            closed_at: iso(NOW - 61 * MINUTE),
          }),
        ],
      })
      await shownAfterRead($, seen)
      const ui = await mountTab($, 'terminal', 'inline', 76)
      expect(await screen(ui, 76)).toEqual([
        'Sessions  0 · 1 needs you · read 12s ago',
        '◆ decide     handily-open1   Merge it?                                   23h',
        '    answer in the Orchestrator window',
        '? old ask    handily-cd34    Merge the lane? (open, not counted)          2d',
        '✓ approved   handily-s3yqhr  Release handily-board 0.24.0?                3m',
        '○ withdrawn  handily-ab12    Which region should the probe use?          40m',
      ])
      const approved = drawnOf(await ui.find({ key: 'card:ask:handily-s3yqhr:head' }))
      expect(approved?.children.map((part) => part.props.color ?? 'dim')).toEqual([
        'success',
        'success',
        'dim',
        'dim',
        'dim',
      ])
      await ui.unmount()
      await seen.clock.advance(21 * MINUTE)
      const later = (await screenAt($, 'terminal', 'inline', 76)).join('\n')
      expect(later).not.toContain('handily-ab12')
      expect(later).toContain('handily-s3yqhr')
    },
  )

  for (const surface of SURFACES) {
    test(
      `a control or bidi character from a file draws escaped, on ${surface}`,
      WITH_STORE,
      async ($, on) => {
        const seen = world(on, {
          files: [
            sessionFile('lane-a1', 4 * MINUTE, {
              name: 'lane\u{0}a1',
              project: 'handily',
              vendor: 'claude',
              state: 'working',
              now: 'Ship\u{2066} it\u{1b}[31m',
              now_at: iso(NOW - 4 * MINUTE),
            }),
          ],
        })
        await shownAfterRead($, seen)
        expect(await screenAt($, surface, 'dock', 41)).toEqual([
          'Sessions  1 · 12s',
          '▶ lane\\u0000a1  working                4m',
          '  handily · claude',
          '  ▸ Ship\\u2066 it\\u001b[31m',
        ])
      },
    )
  }

  test(
    'a file with no v or another v is not read and names the version it reads',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, {
        files: [
          rawFile('sessions/old.json', JSON.stringify({ id: 'old', updated_at: iso(NOW) })),
          rawFile('sessions/new.json', JSON.stringify({ v: 2, id: 'new', updated_at: iso(NOW) })),
          DEV,
        ],
      })
      await shownAfterRead($, seen)
      const lines = await screenAt($, 'terminal', 'dock', 41)
      expect(lines[1]).toBe('▶ dev  this  working                   1m')
      expect(lines).toContain('  new.json: v is 2; this board reads v 1')
      expect(lines).toContain('  old.json: v is missing; this board rea…')
      expect(seen.logs).toContain(
        'handily-board: the store file sessions/old.json was not read: v is missing; this board reads v 1',
      )
    },
  )

  test('a refused optional field is dropped with a debug line and the row still shows', () => {
    const dropped: string[] = []
    const body = {
      v: 1,
      id: 'one',
      updated_at: '2026-11-19T15:00:00+01:00',
      name: 'n'.repeat(41),
      state: 'busy',
      unknown: 1,
    }
    const read = readSession('one.json', JSON.stringify(body), (key, why) => {
      dropped.push(`${key}: ${why}`)
    })
    expect(
      read.kind === 'read' ? [read.value.name, read.value.state, read.value.updatedAt] : null,
    ).toEqual([null, null, Date.parse('2026-11-19T14:00:00Z')])
    expect(dropped).toEqual([
      'name: it is not a text of at most 40 characters',
      'state: it is not working, needs-you or idle',
    ])
    const late = { v: 1, id: 'one', updated_at: 'yesterday' }
    expect(readSession('one.json', JSON.stringify(late), () => undefined)).toEqual({
      kind: 'refused',
      reason: 'updated_at is not an ISO 8601 time',
    })
  })
})

const DEAD_CRITERION =
  'When a session file names a pid and a pid start that no live process matches, the row shows dead; when /proc/self/stat cannot be read, no row is shown dead and the tab says that it has no process check.'

describe(DEAD_CRITERION, () => {
  test(
    'a pid that runs with another start and a pid with no /proc entry both draw dead, and a matching start keeps the written state',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, {
        files: [
          sessionFile('reused', MINUTE, {
            name: 'reused',
            state: 'working',
            pid: 501,
            pid_start: 900,
          }),
          sessionFile('gone', MINUTE, { name: 'gone', state: 'working', pid: 503, pid_start: 1 }),
          sessionFile('alive', MINUTE, {
            name: 'alive',
            state: 'working',
            pid: 502,
            pid_start: 910,
          }),
        ],
      })
      await shownAfterRead($, seen)
      expect(await screenAt($, 'terminal', 'inline', 76)).toEqual([
        'Sessions  3 · 2 dead · read 12s ago',
        '■ gone    dead     process gone                                           1m',
        '■ reused  dead     process gone                                           1m',
        '▶ alive   working                                                         1m',
      ])
    },
  )

  test(
    'with no /proc/self/stat no row is dead and the tab says once that it has no process check',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, {
        files: [
          sessionFile('reused', MINUTE, {
            name: 'reused',
            state: 'working',
            pid: 501,
            pid_start: 900,
          }),
          sessionFile('gone', MINUTE, { name: 'gone', state: 'needs-you', pid: 503, pid_start: 1 }),
        ],
      })
      seen.hasProc = false
      await shownAfterRead($, seen)
      expect(await screenAt($, 'terminal', 'dock', 41)).toEqual([
        'Sessions  2 · 1 needs you · 12s',
        'No process check on this system; a',
        'session that ended shows as stale.',
        '◆ gone  needs you                      1m',
        RULE_41,
        '▶ reused  working                      1m',
      ])
      expect(seen.reads.filter((path) => /^\/proc\/\d+/.test(path))).toEqual([])
    },
  )

  test(
    'a pid without pid_start, or a pid on another platform, is dropped with a debug line and never dead',
    WITH_STORE,
    async ($, on) => {
      const seen = world(on, {
        files: [
          sessionFile('half', MINUTE, { name: 'half', state: 'working', pid: 503 }),
          sessionFile('mac', MINUTE, {
            name: 'mac',
            state: 'working',
            platform: 'darwin',
            pid: 503,
            pid_start: 1,
          }),
        ],
      })
      await shownAfterRead($, seen)
      const lines = await screenAt($, 'terminal', 'dock', 41)
      expect(lines.join('\n')).not.toContain('dead')
      expect(seen.logs).toContain(
        'handily-board: the store file sessions/half.json drops pid and pid_start: they come together',
      )
      expect(seen.logs).toContain(
        'handily-board: the store file sessions/mac.json drops pid and pid_start: they count only on platform linux',
      )
    },
  )

  test('the start of a process is field 22 of its stat, read after the last parenthesis', () => {
    expect(startOfStat(statOf(12, 345))).toBe(345)
    expect(startOfStat('12 (a) b) S 1 2')).toBeNull()
    expect(startOfStat('no parenthesis')).toBeNull()
    expect(isEnded({ canCheck: false, starts: new Map([[1, { kind: 'gone' }]]) }, 1, 5)).toBe(false)
    expect(isEnded({ canCheck: true, starts: new Map([[1, { kind: 'unknown' }]]) }, 1, 5)).toBe(
      false,
    )
  })
})

const ANSWER_CRITERION =
  'When the board runs in the session whose store file name equals the answerWindow setting, a press on an ask option fills the prompt box with the record id and the option label and does not send it; in every other session the ask shows the options read only with the words answer in the Orchestrator window.'

const ORCHESTRATOR = sessionFile(OWN_ID, MINUTE, { name: 'orchestrator', state: 'working' })

describe(ANSWER_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `in the answer window a press on an option fills the prompt box with the record and the label and sends nothing, on ${surface}`,
      IN_ANSWER_WINDOW,
      async ($, on) => {
        const seen = world(on, { files: [RELEASE_ASK, ORCHESTRATOR] })
        await shownAfterRead($, seen)
        const ui = await mountTab($, surface, 'dock', 41)
        expect((await screen(ui, 41)).slice(1, 6)).toEqual([
          '◆ decide  handily-s3yqhr               6m',
          '  Release handily-board 0.24.0?',
          '  [ go ]  [ not now ]',
          '  a press fills the prompt box with',
          '  "handily-s3yqhr: go"; Enter sends it',
        ])
        await ui.press({ key: 'machine:ask:handily-s3yqhr:0' })
        await seen.clock.settle()
        expect(seen.fills).toEqual(['handily-s3yqhr: go'])
        expect(seen.submitted).toEqual([])
        await ui.unmount()
        expect((await screenAt($, surface, 'dock', 41)).slice(3, 6)).toEqual([
          '  [ go ]  [ not now ]',
          '  in your prompt box, not sent:',
          '  handily-s3yqhr: go',
        ])
        expect((await screenAt($, surface, 'inline', 76)).slice(1, 3)).toEqual([
          '◆ decide        handily-s3yqhr  Release handily-board 0.24.0?             6m',
          '    [ go ]  [ not now ]  in your prompt box, not sent: handily-s3yqhr: go',
        ])
      },
    )

    test(
      `in another session the options are read only with answer in the Orchestrator window, on ${surface}`,
      WITH_STORE,
      async ($, on) => {
        const seen = world(on, { files: [RELEASE_ASK, ORCHESTRATOR] })
        await shownAfterRead($, seen)
        const ui = await mountTab($, surface, 'dock', 41)
        expect((await screen(ui, 41)).slice(1, 5)).toEqual([
          '◆ decide  handily-s3yqhr               6m',
          '  Release handily-board 0.24.0?',
          '  options: go | not now',
          '  answer in the Orchestrator window',
        ])
        expect(await ui.find({ type: 'Button' })).toBeUndefined()
        await ui.unmount()
      },
    )
  }

  test(
    'an ask with no options fills the record and a colon for the person to finish',
    IN_ANSWER_WINDOW,
    async ($, on) => {
      const seen = world(on, {
        files: [
          askFile('handily-ab12', HOUR, { question: 'Which region should the probe use?' }),
          ORCHESTRATOR,
        ],
      })
      await shownAfterRead($, seen)
      const ui = await mountTab($, 'terminal', 'dock', 41)
      expect((await screen(ui, 41)).slice(1, 6)).toEqual([
        '◆ decide  handily-ab12                 1h',
        '  Which region should the probe use?',
        '  [ answer ]',
        '  a press fills "handily-ab12: " and you',
        '  type the rest',
      ])
      await ui.press({ key: 'machine:ask:handily-ab12:answer' })
      await seen.clock.settle()
      expect(seen.fills).toEqual(['handily-ab12: '])
      expect(seen.submitted).toEqual([])
      await ui.unmount()
    },
  )

  test('a refused fill names the reason and the text to type', IN_ANSWER_WINDOW, async ($, on) => {
    const seen = world(on, { files: [RELEASE_ASK, ORCHESTRATOR] })
    seen.isFillRefused = true
    await shownAfterRead($, seen)
    const ui = await mountTab($, 'terminal', 'dock', 41)
    await ui.press({ key: 'machine:ask:handily-s3yqhr:0' })
    await seen.clock.settle()
    await ui.unmount()
    expect((await screenAt($, 'terminal', 'dock', 41)).slice(3, 7)).toEqual([
      '  [ go ]  [ not now ]',
      '  ■ not filled: the prompt box did not',
      '  take it.',
      '  Type it: handily-s3yqhr: go',
    ])
    expect(seen.submitted).toEqual([])
  })

  test('an option label with a control or format character drops the options, and the ask still shows', () => {
    const dropped: string[] = []
    const read = readAsk(
      'handily-ab12.json',
      JSON.stringify({ v: 1, record: 'handily-ab12', options: 'go\u{202e}|no' }),
      (key) => {
        dropped.push(key)
      },
    )
    expect(read.kind === 'read' ? read.value.options : null).toEqual([])
    expect(dropped).toEqual(['options'])
  })
})

const BAD_FILE_CRITERION =
  'When a session file or an ask file is not JSON, is over 16 KiB, or has an id that differs from its file name, the tab names the file as not read and still shows every other file.'

describe(BAD_FILE_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `a file that is not JSON, over 16 KiB or named apart from its id is named as not read and every other file shows, on ${surface}`,
      WITH_STORE,
      async ($, on) => {
        const seen = world(on, {
          files: [
            DEV,
            rawFile('sessions/a1b2c3d4.json', '{"v": 1,'),
            rawFile('sessions/e5f6a7b8.json', '{}', 17 * 1024),
            rawFile(
              'sessions/9c0d1e2f.json',
              JSON.stringify({ v: 1, id: 'other', updated_at: iso(NOW) }),
            ),
            rawFile('asks/handily-zz99.json', JSON.stringify({ v: 1, record: 'handily-zz98' })),
          ],
        })
        await shownAfterRead($, seen)
        expect(await screenAt($, surface, 'dock', 41)).toEqual([
          'Sessions  1 · 12s',
          '▶ dev  this  working                   1m',
          '  development · claude',
          '  ▸ builds the work overview',
          '  next: rehearsal 7c after 16:20',
          RULE_41,
          '■ 4 files not read; the debug log has',
          '  each reason',
          '  9c0d1e2f.json: id is not the file name',
          '  a1b2c3d4.json: not JSON',
          '  e5f6a7b8.json: over 16 KiB',
          '  handily-zz99.json: record is not the f…',
        ])
        expect((await screenAt($, surface, 'inline', 76)).at(-1)).toBe(
          '■ 4 files not read: 9c0d1e2f.json id is not the file name · a1b2c3d4.json n…',
        )
        expect(seen.reads).not.toContain(`${STORE}/sessions/e5f6a7b8.json`)
        expect(seen.logs).toContain(
          'handily-board: the store file sessions/a1b2c3d4.json was not read: not JSON',
        )
      },
    )
  }
})

describe(BAD_FILE_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `a reason that quotes a value from the file draws its bidi character escaped, on ${surface}`,
      WITH_STORE,
      async ($, on) => {
        const seen = world(on, {
          files: [rawFile('sessions/bidi.json', JSON.stringify({ v: '\u{202e}abc', id: 'bidi' }))],
        })
        await shownAfterRead($, seen)
        expect((await screenAt($, surface, 'dock', 41)).at(-1)).toBe(
          '  bidi.json: v is "\\u202eabc"; this boar…',
        )
        expect((await screenAt($, surface, 'inline', 76)).at(-1)).toBe(
          '■ 1 file not read: bidi.json v is "\\u202eabc"; this board reads v 1',
        )
      },
    )
  }
})

const WIDTH_CRITERION =
  'When the tab is drawn at 120, 80 and 40 columns, no state word, mark, name or age is cut, and a fold never hides an ask, a needs you session or a dead session.'

const LONG_NAME = 'a-session-name-of-forty-characters-long1'

function wideStore(): [string, FakeFile][] {
  return [
    askFile('handily-s3yqhr', 6 * MINUTE, {
      question: 'Release handily-board 0.24.0?',
      options: 'go|not now',
    }),
    sessionFile('long-a', 2 * MINUTE, {
      name: LONG_NAME,
      project: 'p'.repeat(64),
      state: 'needs-you',
      waiting_on: 'w'.repeat(200),
    }),
    sessionFile('long-b', 25 * MINUTE, {
      name: `${LONG_NAME.slice(0, 39)}2`,
      project: 'handily',
      pid: 501,
      pid_start: 900,
      now: 'n'.repeat(200),
      now_at: iso(NOW - 25 * MINUTE),
    }),
    sessionFile('long-c', 3 * HOUR, {
      name: `${LONG_NAME.slice(0, 39)}3`,
      project: 'app',
      state: 'working',
    }),
  ]
}

const WHOLE_HEADS: readonly (readonly [string, readonly string[]])[] = [
  ['card:ask:handily-s3yqhr', ['◆', 'decide', 'handily-s3yqhr', '6m']],
  ['card:session:long-a', ['◆', LONG_NAME, 'needs you', '2m']],
  ['card:session:long-b', ['■', `${LONG_NAME.slice(0, 39)}2`, 'dead', '25m']],
  ['card:session:long-c', ['?', `${LONG_NAME.slice(0, 39)}3`, 'stale', '3h']],
]

async function headWords(ui: { find: Mounted['find'] }, key: string): Promise<string[]> {
  const card = drawnOf(await ui.find({ key }))
  if (card === null) throw new Error(`no card ${key}`)
  const heads = card.children.filter(
    (child) => typeof child.props.key === 'string' && child.props.key.startsWith(`${key}:head`),
  )
  const pieces = heads.flatMap((head) =>
    head.children.length === 0 ? [head.text] : head.children.map((part) => part.text),
  )
  return pieces.map((piece) => piece.trim()).filter((piece) => piece !== '')
}

function foldStore(): [string, FakeFile][] {
  const many = (lead: string, count: number, agoMs: number, fields: Fields) =>
    Array.from({ length: count }, (_, index) =>
      sessionFile(`${lead}${String(index).padStart(2, '0')}`, agoMs, {
        name: `${lead}${String(index)}`,
        ...fields,
      }),
    )
  return [
    RELEASE_ASK,
    API_LOGIN,
    sessionFile('lane-c7', 9 * MINUTE, { name: 'lane-c7', state: 'needs-you' }),
    OLD_LANE,
    sessionFile('lane-a3', 2 * HOUR - MINUTE, { name: 'lane-a3', pid: 503, pid_start: 1 }),
    DEV,
    ...many('q', 9, 40 * MINUTE, { state: 'idle' }),
    ...many('w', 4, 4 * MINUTE, { state: 'working' }),
    ...many('s', 45, 3 * HOUR, {}),
  ]
}

describe(WIDTH_CRITERION, () => {
  for (const surface of SURFACES) {
    for (const placement of ['dock', 'inline'] as const) {
      for (const columns of [120, 80, 40]) {
        test(
          `${placement} at ${String(columns)} columns no mark, name, state word or age is cut, on ${surface}`,
          WITH_STORE,
          async ($, on) => {
            const seen = world(on, { files: wideStore() })
            await shownAfterRead($, seen)
            const ui = await mountTab($, surface, placement, columns)
            await screen(ui, columns)
            for (const [key, words] of WHOLE_HEADS) {
              const drawn = (await headWords(ui, key)).join('')
              for (const word of words) expect(drawn, `${key} ${word}`).toContain(word)
            }
            await ui.unmount()
          },
        )
      }
    }
  }

  test(
    'the fold never hides an ask, a needs you or a dead session, and a press opens and closes it',
    WITH_STORE,
    async ($, on) => {
      const quiet = Array.from({ length: 9 }, (_, index) =>
        sessionFile(`q${String(index)}`, 40 * MINUTE, { name: `q${String(index)}`, state: 'idle' }),
      )
      const working = Array.from({ length: 4 }, (_, index) =>
        sessionFile(`w${String(index)}`, 4 * MINUTE, {
          name: `w${String(index)}`,
          state: 'working',
        }),
      )
      const stale = Array.from({ length: 45 }, (_, index) =>
        sessionFile(`s${String(index).padStart(2, '0')}`, 3 * HOUR, { name: `s${String(index)}` }),
      )
      const seen = world(on, {
        files: [
          RELEASE_ASK,
          API_LOGIN,
          sessionFile('lane-c7', 9 * MINUTE, { name: 'lane-c7', state: 'needs-you' }),
          OLD_LANE,
          sessionFile('lane-a3', 2 * HOUR - MINUTE, { name: 'lane-a3', pid: 503, pid_start: 1 }),
          DEV,
          ...quiet,
          ...working,
          ...stale,
        ],
      })
      await shownAfterRead($, seen)
      const ui = await mountTab($, 'terminal', 'inline', 76)
      expect((await screen(ui, 76)).map((line) => line.slice(0, 24))).toEqual([
        'Sessions  63 · 3 need yo',
        '◆ decide     handily-s3y',
        '    options: go | not no',
        '◆ api-login  needs you  ',
        '◆ lane-c7    needs you  ',
        '■ old-lane   dead       ',
        '■ lane-a3    dead       ',
        '▶ dev        this · work',
        '    next: rehearsal 7c a',
        '[ +58 more · 4 working ·',
      ])
      expect(drawnOf(await ui.find({ key: 'machine:more' }))?.text).toBe(
        '[ +58 more · 4 working · 9 quiet · 45 stale ]',
      )
      await ui.press({ key: 'machine:more' })
      await ui.unmount()
      const open = await screenAt($, 'terminal', 'inline', 76)
      expect(open.at(-1)).toBe('[ hide 58 ]')
      expect(open.filter((line) => /^[▶○?◆■] /.test(line))).toHaveLength(64)
    },
  )

  for (const surface of SURFACES) {
    test(
      `docked at 41 columns the fold keeps every ask, needs you and dead card, on ${surface}`,
      WITH_STORE,
      async ($, on) => {
        const seen = world(on, { files: foldStore() })
        await shownAfterRead($, seen)
        const ui = await mountTab($, surface, 'dock', 41)
        const lines = await screen(ui, 41)
        expect(lines.filter((line) => /^[▶○?◆■] /.test(line))).toEqual([
          '◆ decide  handily-s3yqhr               6m',
          '◆ api-login  needs you                 2m',
          '◆ lane-c7  needs you                   9m',
          '■ old-lane  dead                      25m',
          '■ lane-a3  dead                        1h',
          '▶ dev  this  working                   1m',
        ])
        expect(lines.at(-1)).toBe('[ +58 · 4 working · 9 quiet · 45 stale ]')
        await ui.unmount()
      },
    )
  }
})

const NERD_OF_PLAIN: readonly (readonly [string, string])[] = [
  ['▶', '\u{EB2C}'],
  ['✓', '\u{EAB2}'],
  ['○', '\u{EBB5}'],
  ['■', '\u{EA87}'],
  ['◆', '\u{EAA2}'],
]

const NERD_ROW: ConfigRow = {
  key: 'handily.glyphs',
  label: 'Glyphs',
  kind: 'choice',
  value: 'nerd',
  options: ['plain', 'nerd'],
  provider: { plugin: 'handily@niksavis', tier: 'user' },
  isLocked: false,
}

function nerdSwapped(line: string): string {
  return NERD_OF_PLAIN.reduce((text, [plain, nerd]) => text.replaceAll(plain, nerd), line)
}

describe('With glyphs nerd the this machine tab swaps each signal mark one for one on the terminal, keeps the stale mark, and draws plain on the desktop', () => {
  for (const surface of SURFACES) {
    test(`the rows of mock d41-full at 41 columns on ${surface}`, WITH_STORE, async ($, on) => {
      const seen = world(on)
      on('config.list', () => ({ value: [NERD_ROW] }))
      await shownAfterRead($, seen)
      const drawn = await screenAt($, surface, 'dock', 41)
      expect(drawn).toEqual(surface === 'terminal' ? MOCK_41.map(nerdSwapped) : MOCK_41)
      expect(drawn.map(displayWidth)).toEqual(MOCK_41.map(displayWidth))
    })
  }
})
