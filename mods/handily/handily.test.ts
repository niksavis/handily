import type { On, RenderSurface } from 'claude-code'
import { describe, expect, test, type Engine, type Plugin } from 'claude-code/testing'
import { bundledMods, manifestVersion, replyText, statusesOf } from './hooks/status'

const SURFACES: RenderSurface[] = ['terminal', 'desktop']
const MODS = [
  'workitems',
  'quiet-items',
  'task-pane',
  'session-board',
  'item-toasts',
  'agent-board',
  'simple-view',
]
const MANIFEST = JSON.stringify({ name: 'handily', version: '0.1.0', dependencies: MODS })
const ALL_ENABLED = Object.fromEntries(MODS.map((name) => [`${name}@handily`, true]))
const MOD_VERSIONS: Record<string, string> = {
  workitems: '0.1.0',
  'quiet-items': '0.2.0',
  'task-pane': '0.1.1',
  'session-board': '0.3.0',
  'item-toasts': '1.0.0',
  'agent-board': '0.1.2',
  'simple-view': '0.4.0',
}

const WORKITEMS: Plugin = {
  name: 'workitems',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'workitems', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const QUIET_ITEMS: Plugin = {
  name: 'quiet-items',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'quiet-items', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const TASK_PANE: Plugin = {
  name: 'task-pane',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'task-pane', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const SESSION_BOARD: Plugin = {
  name: 'session-board',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'session-board', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const ITEM_TOASTS: Plugin = {
  name: 'item-toasts',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'item-toasts', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const AGENT_BOARD: Plugin = {
  name: 'agent-board',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'agent-board', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const SIMPLE_VIEW: Plugin = {
  name: 'simple-view',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'simple-view', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const HEARTBEATS = [
  WORKITEMS,
  QUIET_ITEMS,
  TASK_PANE,
  SESSION_BOARD,
  ITEM_TOASTS,
  AGENT_BOARD,
  SIMPLE_VIEW,
]

function heartbeatsWithout(name: string): Plugin[] {
  return HEARTBEATS.filter((plugin) => plugin.name !== name)
}

function silent(name: string): Plugin {
  return { name, register() {} }
}

function enabledWithout(name: string): Record<string, boolean> {
  return Object.fromEntries(Object.entries(ALL_ENABLED).filter(([id]) => id !== `${name}@handily`))
}

type World = { enabledPlugins: unknown; reads: string[]; sessionStarts: number }

function fakeWorld(on: On, world: Partial<World> = {}): World {
  const full: World = { enabledPlugins: ALL_ENABLED, reads: [], sessionStarts: 0, ...world }
  on('session.start', (_$, e) => {
    full.sessionStarts += 1
    return { cwd: e.cwd }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('settings.read', () => ({ value: { enabledPlugins: full.enabledPlugins } }))
  on('fs.read', (_$, e) => {
    full.reads.push(e.path)
    const folder = e.path.split(/[\\/]/).at(-3) ?? ''
    if (folder === 'handily') return { value: MANIFEST }
    const version = MOD_VERSIONS[folder]
    if (version === undefined) throw new Error(`no fixture for ${e.path}`)
    return { value: JSON.stringify({ name: folder, version }) }
  })
  return full
}

async function startSession(engine: Engine): Promise<void> {
  await engine.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
}

async function handily(engine: Engine, args = ''): Promise<string> {
  const result = await engine.command.run({
    command: 'handily',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  return result.text ?? ''
}

async function runHandily(engine: Engine, args = ''): Promise<string> {
  await startSession(engine)
  return handily(engine, args)
}

function engineRowText(reply: string): string {
  return `handily: ${reply}`
}

async function shownRows(engine: Engine, surface: RenderSurface, shownText: string) {
  const ui = await engine.ui.mount({
    plugin: 'handily',
    surface,
    component: 'CommandOutput',
    props: { command: 'handily', args: '', text: shownText, isErrored: false },
  })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map((found) => ({ text: found.text.trimEnd(), color: found.props.color }))
}

describe('/handily reply', () => {
  test(
    'names each mod whose session start wrote its ready value as loaded, with its version',
    { plugins: HEARTBEATS },
    async ($, on) => {
      fakeWorld(on)
      expect(await runHandily($)).toBe(
        [
          '- workitems 0.1.0: loaded',
          '- quiet-items 0.2.0: loaded',
          '- task-pane 0.1.1: loaded',
          '- session-board 0.3.0: loaded',
          '- item-toasts 1.0.0: loaded',
          '- agent-board 0.1.2: loaded',
          '- simple-view 0.4.0: loaded',
          '',
          'handily: 7 of 7 mods loaded',
        ].join('\n'),
      )
    },
  )

  test(
    'says that an enabled mod which never wrote its ready value did not load',
    { plugins: [...heartbeatsWithout('workitems'), silent('workitems')] },
    async ($, on) => {
      fakeWorld(on)
      const text = await runHandily($)
      expect(text).toContain(
        '- workitems: enabled, but it did not load. Run claude --debug to see why',
      )
      expect(text.split('\n').at(-1)).toBe('handily: 6 of 7 mods loaded')
    },
  )

  test(
    'gives the install line for a mod that is not installed',
    { plugins: heartbeatsWithout('task-pane') },
    async ($, on) => {
      fakeWorld(on, { enabledPlugins: enabledWithout('task-pane') })
      const text = await runHandily($)
      expect(text).toContain('- task-pane: not installed. Run /plugin install task-pane@handily')
      expect(text.split('\n').at(-1)).toBe('handily: 6 of 7 mods loaded')
    },
  )

  test(
    'gives the enable line for a mod that is disabled',
    { plugins: heartbeatsWithout('session-board') },
    async ($, on) => {
      fakeWorld(on, { enabledPlugins: { ...ALL_ENABLED, 'session-board@handily': false } })
      const text = await runHandily($)
      expect(text).toContain('- session-board: disabled. Run /plugin enable session-board@handily')
      expect(text.split('\n').at(-1)).toBe('handily: 6 of 7 mods loaded')
    },
  )

  test('counts no mod as loaded when none wrote its ready value', async ($, on) => {
    fakeWorld(on, { enabledPlugins: {} })
    const text = await runHandily($)
    for (const name of MODS) {
      expect(text).toContain(`- ${name}: not installed. Run /plugin install ${name}@handily`)
    }
    expect(text.split('\n').at(-1)).toBe('handily: 0 of 7 mods loaded')
  })

  test(
    'keeps every mod loaded when a reload starts the sessions again',
    { plugins: HEARTBEATS },
    async ($, on) => {
      const world = fakeWorld(on)
      const before = await runHandily($)
      await startSession($)
      expect(world.sessionStarts).toBe(2)
      expect(await handily($)).toBe(before)
      expect(before.split('\n').at(-1)).toBe('handily: 7 of 7 mods loaded')
    },
  )

  test('reads the list of mods from its own plugin.json', async ($, on) => {
    const world = fakeWorld(on, { enabledPlugins: {} })
    await runHandily($)
    expect(world.reads).toHaveLength(1)
    expect(world.reads[0]).toMatch(/[\\/]handily[\\/]\.claude-plugin[\\/]plugin\.json$/)
  })

  test('refuses an argument and says what the command does', async ($, on) => {
    fakeWorld(on)
    expect(await runHandily($, 'all')).toBe(
      '/handily takes no argument; it lists the handily mods and whether each loaded.',
    )
  })
})

describe('/handily colours', () => {
  for (const surface of SURFACES) {
    test(
      `draws each row in a theme colour on ${surface}`,
      { plugins: [WORKITEMS, QUIET_ITEMS, SESSION_BOARD, AGENT_BOARD, SIMPLE_VIEW] },
      async ($, on) => {
        fakeWorld(on, {
          enabledPlugins: { ...enabledWithout('task-pane'), 'item-toasts@handily': false },
        })
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.filter((row) => row.color !== undefined)).toEqual([
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'not installed. Run /plugin install task-pane@handily', color: 'error' },
          { text: 'loaded', color: 'success' },
          { text: 'disabled. Run /plugin enable item-toasts@handily', color: 'error' },
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'handily: 5 of 7 mods loaded', color: 'warning' },
        ])
      },
    )

    test(
      `draws the summary in the success colour when every mod loaded on ${surface}`,
      { plugins: HEARTBEATS },
      async ($, on) => {
        fakeWorld(on)
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.at(-1)).toEqual({ text: 'handily: 7 of 7 mods loaded', color: 'success' })
      },
    )

    test(
      `keeps drawing an earlier reply after a later one on ${surface}`,
      { plugins: [...heartbeatsWithout('simple-view'), silent('simple-view')] },
      async ($, on) => {
        const world = fakeWorld(on)
        const first = await runHandily($)
        world.enabledPlugins = { ...ALL_ENABLED, 'simple-view@handily': false }
        const second = await handily($)
        expect(second).not.toBe(first)
        const firstRows = await shownRows($, surface, engineRowText(first))
        const secondRows = await shownRows($, surface, engineRowText(second))
        expect(firstRows.at(-2)).toEqual({
          text: 'enabled, but it did not load. Run claude --debug to see why',
          color: 'warning',
        })
        expect(secondRows.at(-2)).toEqual({
          text: 'disabled. Run /plugin enable simple-view@handily',
          color: 'error',
        })
      },
    )

    test(`leaves a row it did not answer to the engine on ${surface}`, async ($, on) => {
      fakeWorld(on)
      on('ui.render', () => ({ type: 'engine', ref: 0 }))
      const ui = await $.ui.mount({
        plugin: 'handily',
        surface,
        component: 'CommandOutput',
        props: { command: 'handily', args: '', text: 'handily: an older reply', isErrored: false },
      })
      expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
      await ui.unmount()
    })
  }
})

describe('status rows', () => {
  test('treats settings without enabledPlugins as no mod installed', () => {
    const [status] = statusesOf(['task-pane'], new Map(), undefined)
    expect(status?.state).toBe('not installed')
  })

  test('shows the version beside a loaded mod and none beside a missing one', () => {
    const statuses = statusesOf(['workitems', 'task-pane'], new Map([['workitems', '0.1.0']]), {})
    expect(replyText(statuses)).toBe(
      [
        '- workitems 0.1.0: loaded',
        '- task-pane: not installed. Run /plugin install task-pane@handily',
        '',
        'handily: 1 of 2 mods loaded',
      ].join('\n'),
    )
  })
})

describe('manifests', () => {
  test('reads the dependencies of the manifest in order', () => {
    expect(bundledMods(MANIFEST)).toEqual(MODS)
  })

  test('refuses a manifest without a list of dependency names', () => {
    for (const manifest of [{}, { dependencies: [] }, { dependencies: [{ name: 'workitems' }] }]) {
      expect(() => bundledMods(JSON.stringify(manifest))).toThrow(
        'plugin.json "dependencies" must list the handily mods by name',
      )
    }
  })

  test('refuses a mod manifest without a version', () => {
    expect(() => manifestVersion('{"name":"workitems"}', 'workitems')).toThrow(
      'the plugin.json of workitems has no "version"',
    )
  })
})
