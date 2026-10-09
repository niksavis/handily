import type { On, RenderSurface, SettingsSource } from 'claude-code'
import { describe, expect, test, type Engine, type Plugin } from 'claude-code/testing'
import { bundledMods, manifestVersion, replyText, statusesOf } from './hooks/status'

const SURFACES: RenderSurface[] = ['terminal', 'desktop']
const MODS = [
  'handily-workitems',
  'handily-quiet-items',
  'handily-task-pane',
  'handily-session-board',
  'handily-item-toasts',
  'handily-agent-board',
  'handily-simple-view',
  'handily-reply-view',
]
const MANIFEST = JSON.stringify({ name: 'handily', version: '0.1.0', dependencies: MODS })
const ALL_ENABLED = Object.fromEntries(MODS.map((name) => [`${name}@handily`, true]))
const MOD_VERSIONS: Record<string, string> = {
  'handily-workitems': '0.1.0',
  'handily-quiet-items': '0.2.0',
  'handily-task-pane': '0.1.1',
  'handily-session-board': '0.3.0',
  'handily-item-toasts': '1.0.0',
  'handily-agent-board': '0.1.2',
  'handily-simple-view': '0.4.0',
  'handily-reply-view': '0.1.0',
}

const WORKITEMS: Plugin = {
  name: 'handily-workitems',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-workitems', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const QUIET_ITEMS: Plugin = {
  name: 'handily-quiet-items',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-quiet-items', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const TASK_PANE: Plugin = {
  name: 'handily-task-pane',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-task-pane', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const SESSION_BOARD: Plugin = {
  name: 'handily-session-board',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-session-board', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const ITEM_TOASTS: Plugin = {
  name: 'handily-item-toasts',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-item-toasts', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const AGENT_BOARD: Plugin = {
  name: 'handily-agent-board',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-agent-board', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const SIMPLE_VIEW: Plugin = {
  name: 'handily-simple-view',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-simple-view', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const REPLY_VIEW: Plugin = {
  name: 'handily-reply-view',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-reply-view', key: 'ready' }, { root: $.plugin.root })
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
  REPLY_VIEW,
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

type World = {
  enabledPlugins: unknown
  enabledByScope: Partial<Record<SettingsSource, unknown>>
  sourcesRead: string[]
  descriptions: string[]
  reads: string[]
  sessionStarts: number
}

function fakeWorld(on: On, world: Partial<World> = {}): World {
  const full: World = {
    enabledPlugins: ALL_ENABLED,
    enabledByScope: {},
    sourcesRead: [],
    descriptions: [],
    reads: [],
    sessionStarts: 0,
    ...world,
  }
  on('session.start', (_$, e) => {
    full.sessionStarts += 1
    return { cwd: e.cwd }
  })
  on('command.register', (_$, e) => {
    full.descriptions.push(e.description)
    return { value: { command: e.name } }
  })
  on('settings.read', (_$, e) => {
    if (e.source === undefined) return { value: { enabledPlugins: full.enabledPlugins } }
    full.sourcesRead.push(e.source)
    const scoped = full.enabledByScope[e.source]
    return { value: scoped === undefined ? {} : { enabledPlugins: scoped } }
  })
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
          '- handily-workitems 0.1.0: loaded',
          '- handily-quiet-items 0.2.0: loaded',
          '- handily-task-pane 0.1.1: loaded',
          '- handily-session-board 0.3.0: loaded',
          '- handily-item-toasts 1.0.0: loaded',
          '- handily-agent-board 0.1.2: loaded',
          '- handily-simple-view 0.4.0: loaded',
          '- handily-reply-view 0.1.0: loaded',
          '',
          'handily: 8 of 8 mods loaded',
        ].join('\n'),
      )
    },
  )

  test(
    'says that an enabled mod which never wrote its ready value did not load',
    { plugins: [...heartbeatsWithout('handily-workitems'), silent('handily-workitems')] },
    async ($, on) => {
      fakeWorld(on)
      const text = await runHandily($)
      expect(text).toContain(
        '- handily-workitems: enabled, but it did not load. Run claude --debug to see why',
      )
      expect(text.split('\n').at(-1)).toBe('handily: 7 of 8 mods loaded')
    },
  )

  test(
    'gives the install line for a mod that is not installed',
    { plugins: heartbeatsWithout('handily-task-pane') },
    async ($, on) => {
      fakeWorld(on, { enabledPlugins: enabledWithout('handily-task-pane') })
      const text = await runHandily($)
      expect(text).toContain(
        '- handily-task-pane: not installed. Run /plugin install handily-task-pane@handily',
      )
      expect(text.split('\n').at(-1)).toBe('handily: 7 of 8 mods loaded')
    },
  )

  test(
    'gives the enable line for a mod that is disabled',
    { plugins: heartbeatsWithout('handily-session-board') },
    async ($, on) => {
      fakeWorld(on, { enabledPlugins: { ...ALL_ENABLED, 'handily-session-board@handily': false } })
      const text = await runHandily($)
      expect(text).toContain(
        '- handily-session-board: disabled. Run /plugin enable handily-session-board@handily',
      )
      expect(text.split('\n').at(-1)).toBe('handily: 7 of 8 mods loaded')
    },
  )

  test('counts no mod as loaded when none wrote its ready value', async ($, on) => {
    fakeWorld(on, { enabledPlugins: {} })
    const text = await runHandily($)
    for (const name of MODS) {
      expect(text).toContain(`- ${name}: not installed. Run /plugin install ${name}@handily`)
    }
    expect(text.split('\n').at(-1)).toBe('handily: 0 of 8 mods loaded')
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
      expect(before.split('\n').at(-1)).toBe('handily: 8 of 8 mods loaded')
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

  test('registers /handily with a description that starts with the handily mark', async ($, on) => {
    const world = fakeWorld(on)
    await startSession($)
    expect(world.descriptions).toEqual([
      'handily · Show which handily mods are installed and loaded',
    ])
  })
})

describe('/handily old plugin ids', () => {
  test(
    'names each old plugin id that a scope still holds and gives the command that uninstalls it there',
    { plugins: HEARTBEATS },
    async ($, on) => {
      fakeWorld(on, {
        enabledByScope: {
          user: { 'workitems@handily': true, 'task-pane@handily': false },
          project: { 'workitems@handily': true, 'handily-agent-board@handily': true },
          local: { 'reply-view@handily': true },
        },
      })
      const text = await runHandily($)
      expect(text.split('\n').slice(8)).toEqual([
        '- workitems@handily: old id of handily-workitems, in the user settings. Run claude plugin uninstall workitems@handily --scope user',
        '- workitems@handily: old id of handily-workitems, in the project settings. Run claude plugin uninstall workitems@handily --scope project',
        '- task-pane@handily: old id of handily-task-pane, in the user settings. Run claude plugin uninstall task-pane@handily --scope user',
        '- reply-view@handily: old id of handily-reply-view, in the local settings. Run claude plugin uninstall reply-view@handily --scope local',
        '',
        'handily: 8 of 8 mods loaded. Run each uninstall command above, then restart Claude Code',
      ])
    },
  )

  test('reads the old ids from the user, project and local settings', async ($, on) => {
    const world = fakeWorld(on)
    await runHandily($)
    expect([...world.sourcesRead].sort()).toEqual(['local', 'project', 'user'])
  })

  test(
    'names no old id that only a managed policy or a flag holds',
    { plugins: HEARTBEATS },
    async ($, on) => {
      fakeWorld(on, {
        enabledPlugins: { ...ALL_ENABLED, 'quiet-items@handily': true },
        enabledByScope: {
          policy: { 'quiet-items@handily': true },
          flag: { 'quiet-items@handily': true },
        },
      })
      const text = await runHandily($)
      expect(text).not.toContain('quiet-items@handily:')
      expect(text.split('\n').at(-1)).toBe('handily: 8 of 8 mods loaded')
    },
  )

  test('names the old id of every renamed mod', async ($, on) => {
    const oldIds = MODS.map((name) => `${name.slice('handily-'.length)}@handily`)
    fakeWorld(on, {
      enabledByScope: { user: Object.fromEntries(oldIds.map((id) => [id, true])) },
    })
    const text = await runHandily($)
    for (const id of oldIds) {
      expect(text).toContain(`- ${id}: old id of handily-`)
      expect(text).toContain(`Run claude plugin uninstall ${id} --scope user`)
    }
    expect(text.split('\n').at(-1)).toBe(
      'handily: 0 of 8 mods loaded. Run each uninstall command above, then restart Claude Code',
    )
  })
})

describe('/handily colours', () => {
  for (const surface of SURFACES) {
    test(
      `draws each row in a theme colour on ${surface}`,
      { plugins: [WORKITEMS, QUIET_ITEMS, SESSION_BOARD, AGENT_BOARD, SIMPLE_VIEW, REPLY_VIEW] },
      async ($, on) => {
        fakeWorld(on, {
          enabledPlugins: {
            ...enabledWithout('handily-task-pane'),
            'handily-item-toasts@handily': false,
          },
        })
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.filter((row) => row.color !== undefined)).toEqual([
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'not installed. Run /plugin install handily-task-pane@handily', color: 'error' },
          { text: 'loaded', color: 'success' },
          { text: 'disabled. Run /plugin enable handily-item-toasts@handily', color: 'error' },
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'handily: 6 of 8 mods loaded', color: 'warning' },
        ])
      },
    )

    test(
      `draws the summary in the success colour when every mod loaded on ${surface}`,
      { plugins: HEARTBEATS },
      async ($, on) => {
        fakeWorld(on)
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.at(-1)).toEqual({ text: 'handily: 8 of 8 mods loaded', color: 'success' })
      },
    )

    test(
      `draws an old plugin id and the summary in the warning colour on ${surface}`,
      { plugins: HEARTBEATS },
      async ($, on) => {
        fakeWorld(on, { enabledByScope: { project: { 'simple-view@handily': true } } })
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.map((row) => row.text)).toContain('simple-view@handily')
        expect(rows.filter((row) => row.color !== undefined).slice(-2)).toEqual([
          {
            text: 'old id of handily-simple-view, in the project settings. Run claude plugin uninstall simple-view@handily --scope project',
            color: 'warning',
          },
          {
            text: 'handily: 8 of 8 mods loaded. Run each uninstall command above, then restart Claude Code',
            color: 'warning',
          },
        ])
      },
    )

    test(
      `keeps drawing an earlier reply after a later one on ${surface}`,
      { plugins: [...heartbeatsWithout('handily-simple-view'), silent('handily-simple-view')] },
      async ($, on) => {
        const world = fakeWorld(on)
        const first = await runHandily($)
        world.enabledPlugins = { ...ALL_ENABLED, 'handily-simple-view@handily': false }
        const second = await handily($)
        expect(second).not.toBe(first)
        const coloured = (rows: Awaited<ReturnType<typeof shownRows>>) =>
          rows.filter((row) => row.color !== undefined)
        const firstRows = coloured(await shownRows($, surface, engineRowText(first)))
        const secondRows = coloured(await shownRows($, surface, engineRowText(second)))
        expect(firstRows.at(-3)).toEqual({
          text: 'enabled, but it did not load. Run claude --debug to see why',
          color: 'warning',
        })
        expect(secondRows.at(-3)).toEqual({
          text: 'disabled. Run /plugin enable handily-simple-view@handily',
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
    const [status] = statusesOf(['handily-task-pane'], new Map(), undefined)
    expect(status?.state).toBe('not installed')
  })

  test('shows the version beside a loaded mod and none beside a missing one', () => {
    const statuses = statusesOf(
      ['handily-workitems', 'handily-task-pane'],
      new Map([['handily-workitems', '0.1.0']]),
      {},
    )
    expect(replyText({ mods: statuses, oldIds: [] })).toBe(
      [
        '- handily-workitems 0.1.0: loaded',
        '- handily-task-pane: not installed. Run /plugin install handily-task-pane@handily',
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
    for (const manifest of [
      {},
      { dependencies: [] },
      { dependencies: [{ name: 'handily-workitems' }] },
    ]) {
      expect(() => bundledMods(JSON.stringify(manifest))).toThrow(
        'plugin.json "dependencies" must list the handily mods by name',
      )
    }
  })

  test('refuses a mod manifest without a version', () => {
    expect(() => manifestVersion('{"name":"handily-workitems"}', 'handily-workitems')).toThrow(
      'the plugin.json of handily-workitems has no "version"',
    )
  })
})
