import type { ConfigRow, ConfigValue, On, RenderSurface, SettingsSource } from 'claude-code'
import { describe, expect, test, type Engine, type Plugin } from 'claude-code/testing'
import type { WorkitemsSnapshot } from './.claude-plugin/types/handily-workitems'
import { GLYPH_SETS, glyphSettingOf, NERD_NAMES } from './hooks/glyphs'
import {
  bundledMods,
  manifestDescription,
  manifestVersion,
  replyText,
  shortened,
  statusesOf,
} from './hooks/status'

const SURFACES: RenderSurface[] = ['terminal', 'desktop']
const MODS = [
  'handily-workitems',
  'handily-quiet-items',
  'handily-board',
  'handily-item-toasts',
  'handily-simple-view',
  'handily-reply-view',
  'handily-filetree',
  'handily-tests',
]
const MANIFEST = JSON.stringify({ name: 'handily', version: '0.1.0', dependencies: MODS })
const ALL_ENABLED = Object.fromEntries(MODS.map((name) => [`${name}@niksavis`, true]))
const MODE_SETTINGS: Readonly<Record<string, ConfigValue>> = {
  'handily-quiet-items': 'on',
  'handily-board': 'toggle',
  'handily-item-toasts': 'on',
  'handily-simple-view': 'on',
  'handily-reply-view': 'on',
}
const MOD_MANIFESTS: Record<string, { version: string; description: string }> = {
  'handily-workitems': {
    version: '0.1.0',
    description: 'Provider of one typed work item list over any tracker, for other handily mods.',
  },
  'handily-quiet-items': {
    version: '0.2.0',
    description: 'One short row in place of each tracker write in the transcript.',
  },
  'handily-board': { version: '0.1.1', description: 'A board with two tabs.' },
  'handily-item-toasts': { version: '1.0.0', description: 'A toast when a work item changes.' },
  'handily-simple-view': { version: '0.4.0', description: 'One short row for each tool call.' },
  'handily-reply-view': {
    version: '0.1.0',
    description: 'Long replies fold to their first lines.',
  },
  'handily-filetree': { version: '0.2.0', description: 'A files tab beside the board.' },
  'handily-tests': { version: '0.1.0', description: 'A tests tab with failures by name.' },
}
const OLD_IDS: Record<string, string> = {
  'workitems@handily': 'handily-workitems',
  'quiet-items@handily': 'handily-quiet-items',
  'task-pane@handily': 'handily-board',
  'session-board@handily': 'handily-board',
  'item-toasts@handily': 'handily-item-toasts',
  'agent-board@handily': 'handily-board',
  'simple-view@handily': 'handily-simple-view',
  'reply-view@handily': 'handily-reply-view',
  'handily-task-pane@handily': 'handily-board',
  'handily-session-board@handily': 'handily-board',
  'handily-agent-board@handily': 'handily-board',
}
const ALL_LOADED_REPLY = [
  'handily-workitems    0.1.0  loaded  polling  Provider of one typed work item…',
  'handily-quiet-items  0.2.0  loaded  on       One short row in place of each…',
  'handily-board        0.1.1  loaded  -        A board with two tabs',
  'handily-item-toasts  1.0.0  loaded  on       A toast when a work item changes',
  'handily-simple-view  0.4.0  loaded  on       One short row for each tool call',
  'handily-reply-view   0.1.0  loaded  on       Long replies fold to their first…',
  'handily-filetree     0.2.0  loaded  -        A files tab beside the board',
  'handily-tests        0.1.0  loaded  -        A tests tab with failures by name',
  '',
  'handily: 8 of 8 mods loaded, 0 off or paused',
]

const WORKITEMS: Plugin = {
  name: 'handily-workitems',
  register(on) {
    on('session.start', async ($, e, next) => {
      const snapshot: WorkitemsSnapshot = {
        at: 0,
        root: '/work/app',
        items: [],
        ignored: [],
        version: 1,
        checkedAt: 0,
        source: 'tracker',
        sourceLabel: 'tracker',
        caveat: null,
        state: 'ok',
        reason: null,
      }
      await $.state.set({ plugin: 'handily-workitems', key: 'snapshot' }, snapshot)
      await $.state.set({ plugin: 'handily-workitems', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const QUIET_ITEMS: Plugin = {
  name: 'handily-quiet-items',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-quiet-items', key: 'mode' }, 'on')
      await $.state.set({ plugin: 'handily-quiet-items', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const BOARD: Plugin = {
  name: 'handily-board',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-board', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const ITEM_TOASTS: Plugin = {
  name: 'handily-item-toasts',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-item-toasts', key: 'mode' }, 'on')
      await $.state.set({ plugin: 'handily-item-toasts', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const SIMPLE_VIEW: Plugin = {
  name: 'handily-simple-view',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-simple-view', key: 'mode' }, 'on')
      await $.state.set({ plugin: 'handily-simple-view', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const REPLY_VIEW: Plugin = {
  name: 'handily-reply-view',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-reply-view', key: 'mode' }, 'on')
      await $.state.set({ plugin: 'handily-reply-view', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const FILETREE: Plugin = {
  name: 'handily-filetree',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-filetree', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const TESTS: Plugin = {
  name: 'handily-tests',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-tests', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const PAUSED_WORKITEMS: Plugin = {
  name: 'handily-workitems',
  register(on) {
    on('session.start', async ($, e, next) => {
      const snapshot: WorkitemsSnapshot = {
        at: 0,
        root: '/work/app',
        items: [],
        ignored: [],
        version: 1,
        checkedAt: 0,
        source: 'tracker',
        sourceLabel: 'tracker',
        caveat: null,
        state: 'paused',
        reason: null,
      }
      await $.state.set({ plugin: 'handily-workitems', key: 'snapshot' }, snapshot)
      await $.state.set({ plugin: 'handily-workitems', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const OFF_ITEM_TOASTS: Plugin = {
  name: 'handily-item-toasts',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-item-toasts', key: 'mode' }, 'off')
      await $.state.set({ plugin: 'handily-item-toasts', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const MODELESS_REPLY_VIEW: Plugin = {
  name: 'handily-reply-view',
  register(on) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'handily-reply-view', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const SIDEWAYS_SIMPLE_VIEW: Plugin = {
  name: 'handily-simple-view',
  register(on) {
    on('session.start', async ($, e, next) => {
      const stored: unknown = 'sideways'
      await $.state.set({ plugin: 'handily-simple-view', key: 'mode' }, stored as 'on')
      await $.state.set({ plugin: 'handily-simple-view', key: 'ready' }, { root: $.plugin.root })
      return next(e)
    })
  },
}

const HEARTBEATS = [
  WORKITEMS,
  QUIET_ITEMS,
  BOARD,
  ITEM_TOASTS,
  SIMPLE_VIEW,
  REPLY_VIEW,
  FILETREE,
  TESTS,
]

function heartbeatsWithout(...names: string[]): Plugin[] {
  return HEARTBEATS.filter((plugin) => !names.includes(plugin.name))
}

function silent(name: string): Plugin {
  return { name, register() {} }
}

function enabledWithout(name: string): Record<string, boolean> {
  return Object.fromEntries(Object.entries(ALL_ENABLED).filter(([id]) => id !== `${name}@niksavis`))
}

type World = {
  modeSettings: Readonly<Record<string, ConfigValue>>
  glyphs: ConfigValue | undefined
  otherRows: ConfigRow[]
  pluginConfigs: unknown
  enabledPlugins: unknown
  enabledByScope: Partial<Record<SettingsSource, unknown>>
  sourcesRead: string[]
  descriptions: string[]
  reads: string[]
  debugLines: string[]
  sessionStarts: number
}

function fakeWorld(on: On, world: Partial<World> = {}): World {
  const full: World = {
    modeSettings: MODE_SETTINGS,
    glyphs: undefined,
    otherRows: [],
    pluginConfigs: undefined,
    enabledPlugins: ALL_ENABLED,
    enabledByScope: {},
    sourcesRead: [],
    descriptions: [],
    reads: [],
    debugLines: [],
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
    if (e.source === undefined) {
      const stored = full.pluginConfigs === undefined ? {} : { pluginConfigs: full.pluginConfigs }
      return { value: { enabledPlugins: full.enabledPlugins, ...stored } }
    }
    full.sourcesRead.push(e.source)
    const scoped = full.enabledByScope[e.source]
    return { value: scoped === undefined ? {} : { enabledPlugins: scoped } }
  })
  on('config.list', () => ({
    value: [...configRows(full.modeSettings, full.glyphs), ...full.otherRows],
  }))
  on('fs.read', (_$, e) => {
    full.reads.push(e.path)
    const folder = e.path.split(/[\\/]/).at(-3) ?? ''
    if (folder === 'handily') return { value: MANIFEST }
    const manifest = MOD_MANIFESTS[folder]
    if (manifest === undefined) throw new Error(`no fixture for ${e.path}`)
    return { value: JSON.stringify({ name: folder, ...manifest }) }
  })
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') full.debugLines.push(e.text)
    return { value: undefined }
  })
  return full
}

function glyphsRow(value: ConfigValue, plugin = 'handily@niksavis'): ConfigRow {
  return {
    key: `${plugin.replace(/@.*$/, '')}.glyphs`,
    label: 'Glyphs',
    kind: 'choice',
    value,
    options: ['plain', 'nerd'],
    provider: { plugin, tier: 'user' },
    isLocked: false,
  }
}

function configRows(
  modeSettings: Readonly<Record<string, ConfigValue>>,
  glyphs?: ConfigValue,
): ConfigRow[] {
  const theme: ConfigRow = {
    key: 'theme',
    label: 'Theme',
    kind: 'choice',
    value: 'dark',
    provider: { plugin: 'engine', tier: 'core' },
    isLocked: false,
  }
  return [
    theme,
    ...(glyphs === undefined ? [] : [glyphsRow(glyphs)]),
    ...Object.entries(modeSettings).map(([plugin, value]) => ({
      key: `${plugin}.mode`,
      label: 'Mode',
      kind: 'choice' as const,
      value,
      provider: { plugin: `${plugin}@niksavis`, tier: 'user' as const },
      isLocked: false,
    })),
  ]
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

function cellsOf(text: string, name: string): string[] {
  const line = text.split('\n').find((row) => row.startsWith(`${name} `) || row === name)
  if (line === undefined) throw new Error(`no line for ${name} in:\n${text}`)
  return line.split(/ {2,}/)
}

function lineAfter(text: string, name: string): string | undefined {
  const lines = text.split('\n')
  return lines[lines.findIndex((row) => row.startsWith(`${name} `)) + 1]
}

function lastLine(text: string): string | undefined {
  return text.split('\n').at(-1)
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
    'shows each loaded mod with its version, its mode and its description cut to fit 80 columns',
    { plugins: HEARTBEATS },
    async ($, on) => {
      fakeWorld(on)
      expect(await runHandily($)).toBe(ALL_LOADED_REPLY.join('\n'))
    },
  )

  test(
    'shows paused and off modes and counts them in the summary',
    {
      plugins: [
        PAUSED_WORKITEMS,
        OFF_ITEM_TOASTS,
        ...heartbeatsWithout('handily-workitems', 'handily-item-toasts'),
      ],
    },
    async ($, on) => {
      fakeWorld(on, { modeSettings: { ...MODE_SETTINGS, 'handily-item-toasts': 'off' } })
      const text = await runHandily($)
      expect(cellsOf(text, 'handily-workitems').slice(0, 4)).toEqual([
        'handily-workitems',
        '0.1.0',
        'loaded',
        'paused',
      ])
      expect(cellsOf(text, 'handily-item-toasts').slice(0, 4)).toEqual([
        'handily-item-toasts',
        '1.0.0',
        'loaded',
        'off',
      ])
      expect(lastLine(text)).toBe('handily: 8 of 8 mods loaded, 2 off or paused')
    },
  )

  test(
    'shows a dash as the mode of a mod that stores no mode',
    { plugins: [MODELESS_REPLY_VIEW, ...heartbeatsWithout('handily-reply-view')] },
    async ($, on) => {
      fakeWorld(on)
      const text = await runHandily($)
      expect(cellsOf(text, 'handily-board')[3]).toBe('-')
      expect(cellsOf(text, 'handily-reply-view')[3]).toBe('-')
    },
  )

  test(
    'shows a question mark as a mode it cannot read and writes the reason to the debug log',
    { plugins: [SIDEWAYS_SIMPLE_VIEW, ...heartbeatsWithout('handily-simple-view')] },
    async ($, on) => {
      const world = fakeWorld(on)
      const text = await runHandily($)
      expect(cellsOf(text, 'handily-simple-view').slice(0, 4)).toEqual([
        'handily-simple-view',
        '0.4.0',
        'loaded',
        '?',
      ])
      expect(world.debugLines).toEqual([
        'handily: cannot read the mode of handily-simple-view: the stored mode "sideways" is neither on nor off',
      ])
      expect(lastLine(text)).toBe('handily: 8 of 8 mods loaded, 0 off or paused')
    },
  )

  test(
    'shows the mode setting beside a session mode that differs from it',
    { plugins: [OFF_ITEM_TOASTS, ...heartbeatsWithout('handily-item-toasts')] },
    async ($, on) => {
      fakeWorld(on, { modeSettings: { ...MODE_SETTINGS, 'handily-simple-view': 'off' } })
      expect(await runHandily($)).toBe(
        [
          'handily-workitems    0.1.0  loaded  polling           Provider of one typed…',
          'handily-quiet-items  0.2.0  loaded  on                One short row in place…',
          'handily-board        0.1.1  loaded  -                 A board with two tabs',
          'handily-item-toasts  1.0.0  loaded  off (default on)  A toast when a work item…',
          'handily-simple-view  0.4.0  loaded  on (default off)  One short row for each…',
          'handily-reply-view   0.1.0  loaded  on                Long replies fold to…',
          'handily-filetree     0.2.0  loaded  -                 A files tab beside the…',
          'handily-tests        0.1.0  loaded  -                 A tests tab with…',
          '',
          'handily: 8 of 8 mods loaded, 1 off or paused',
        ].join('\n'),
      )
    },
  )

  test(
    'shows no default beside a mode whose setting is neither on nor off and writes the reason to the debug log',
    { plugins: HEARTBEATS },
    async ($, on) => {
      const world = fakeWorld(on, {
        modeSettings: { ...MODE_SETTINGS, 'handily-reply-view': 'sideways' },
      })
      expect(await runHandily($)).toBe(ALL_LOADED_REPLY.join('\n'))
      expect(world.debugLines).toEqual([
        'handily: cannot read the default mode of handily-reply-view: the mode setting "sideways" is neither on nor off',
      ])
    },
  )

  test(
    'says that handily-board did not load when it never wrote its ready key',
    { plugins: [...heartbeatsWithout('handily-board'), silent('handily-board')] },
    async ($, on) => {
      fakeWorld(on)
      const text = await runHandily($)
      expect(cellsOf(text, 'handily-board')).toEqual(['handily-board', '-', 'not loaded', '-'])
      expect(lineAfter(text, 'handily-board')).toBe('  Run claude --debug to see why')
      expect(lastLine(text)).toBe('handily: 7 of 8 mods loaded, 0 off or paused')
    },
  )

  test(
    'says that an enabled mod which never wrote its ready value did not load',
    { plugins: [...heartbeatsWithout('handily-workitems'), silent('handily-workitems')] },
    async ($, on) => {
      fakeWorld(on)
      const text = await runHandily($)
      expect(cellsOf(text, 'handily-workitems')).toEqual([
        'handily-workitems',
        '-',
        'not loaded',
        '-',
      ])
      expect(lineAfter(text, 'handily-workitems')).toBe('  Run claude --debug to see why')
      expect(lastLine(text)).toBe('handily: 7 of 8 mods loaded, 0 off or paused')
    },
  )

  test(
    'gives the install line for a mod that is not installed',
    { plugins: heartbeatsWithout('handily-board') },
    async ($, on) => {
      fakeWorld(on, { enabledPlugins: enabledWithout('handily-board') })
      const text = await runHandily($)
      expect(cellsOf(text, 'handily-board')).toEqual(['handily-board', '-', 'not installed', '-'])
      expect(lineAfter(text, 'handily-board')).toBe('  Run /plugin install handily-board@niksavis')
      expect(lastLine(text)).toBe('handily: 7 of 8 mods loaded, 0 off or paused')
    },
  )

  test(
    'gives the enable line for a mod that is disabled',
    { plugins: heartbeatsWithout('handily-item-toasts') },
    async ($, on) => {
      fakeWorld(on, { enabledPlugins: { ...ALL_ENABLED, 'handily-item-toasts@niksavis': false } })
      const text = await runHandily($)
      expect(cellsOf(text, 'handily-item-toasts')).toEqual([
        'handily-item-toasts',
        '-',
        'disabled',
        '-',
      ])
      expect(lineAfter(text, 'handily-item-toasts')).toBe(
        '  Run /plugin enable handily-item-toasts@niksavis',
      )
      expect(lastLine(text)).toBe('handily: 7 of 8 mods loaded, 0 off or paused')
    },
  )

  test('counts no mod as loaded when none wrote its ready value', async ($, on) => {
    fakeWorld(on, { enabledPlugins: {} })
    const text = await runHandily($)
    for (const name of MODS) {
      expect(lineAfter(text, name)).toBe(`  Run /plugin install ${name}@niksavis`)
    }
    expect(lastLine(text)).toBe('handily: 0 of 8 mods loaded, 0 off or paused')
  })

  test(
    'keeps every line within 80 columns with a missing mod, a disabled mod and every old id',
    { plugins: heartbeatsWithout('handily-board', 'handily-item-toasts') },
    async ($, on) => {
      fakeWorld(on, {
        enabledPlugins: {
          ...enabledWithout('handily-board'),
          'handily-item-toasts@niksavis': false,
        },
        enabledByScope: {
          project: Object.fromEntries(Object.keys(OLD_IDS).map((id) => [id, true])),
        },
      })
      const text = await runHandily($)
      expect(text.split('\n').filter((line) => line.length > 80)).toEqual([])
    },
  )

  test(
    'keeps every line within 80 columns with a missing mod, every old id and a mode that differs from its setting',
    { plugins: [OFF_ITEM_TOASTS, ...heartbeatsWithout('handily-board', 'handily-item-toasts')] },
    async ($, on) => {
      fakeWorld(on, {
        enabledPlugins: enabledWithout('handily-board'),
        enabledByScope: {
          project: Object.fromEntries(Object.keys(OLD_IDS).map((id) => [id, true])),
        },
      })
      const text = await runHandily($)
      expect(cellsOf(text, 'handily-item-toasts')[3]).toBe('off (default on)')
      expect(text.split('\n').filter((line) => line.length > 80)).toEqual([])
    },
  )

  test(
    'keeps every mod loaded when a reload starts the sessions again',
    { plugins: HEARTBEATS },
    async ($, on) => {
      const world = fakeWorld(on)
      const before = await runHandily($)
      await startSession($)
      expect(world.sessionStarts).toBe(2)
      expect(await handily($)).toBe(before)
      expect(lastLine(before)).toBe('handily: 8 of 8 mods loaded, 0 off or paused')
    },
  )

  test('reads the list of mods from its own plugin.json', async ($, on) => {
    const world = fakeWorld(on, { enabledPlugins: {} })
    await runHandily($)
    expect(world.reads).toHaveLength(1)
    expect(world.reads[0]).toMatch(/[\\/]handily[\\/]\.claude-plugin[\\/]plugin\.json$/)
  })

  test('refuses another argument, names it and gives the accepted forms', async ($, on) => {
    fakeWorld(on)
    expect(await runHandily($, 'all')).toBe(
      '/handily takes no argument or glyphs; "all" is neither.',
    )
    expect(await handily($, ' glyph ')).toBe(
      '/handily takes no argument or glyphs; "glyph" is neither.',
    )
  })

  test('registers /handily with a description that starts with the handily mark', async ($, on) => {
    const world = fakeWorld(on)
    await startSession($)
    expect(world.descriptions).toEqual([
      'handily · Show the version, state, mode and purpose of each handily mod',
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
          project: { 'workitems@handily': true, 'handily-board@niksavis': true },
          local: { 'reply-view@handily': true },
        },
      })
      const text = await runHandily($)
      expect(text.split('\n').slice(8)).toEqual([
        'workitems@handily    old id of handily-workitems, user settings',
        '  Run claude plugin uninstall workitems@handily --scope user',
        'workitems@handily    old id of handily-workitems, project settings',
        '  Run claude plugin uninstall workitems@handily --scope project',
        'task-pane@handily    old id of handily-board, user settings',
        '  Run claude plugin uninstall task-pane@handily --scope user',
        'reply-view@handily   old id of handily-reply-view, local settings',
        '  Run claude plugin uninstall reply-view@handily --scope local',
        'handily marketplace  old marketplace of these ids',
        '  Run claude plugin marketplace remove handily',
        '',
        'handily: 8 of 8 mods loaded, 0 off or paused',
        'Run each command above, then type /reload-plugins',
      ])
    },
  )

  test(
    'names the bundle and each mod installed from the handily marketplace as old ids, and the marketplace to remove',
    { plugins: HEARTBEATS },
    async ($, on) => {
      fakeWorld(on, {
        enabledByScope: {
          user: {
            'handily@handily': true,
            'handily-board@handily': true,
            'handily@niksavis': true,
          },
        },
      })
      const text = await runHandily($)
      expect(text.split('\n').slice(8)).toEqual([
        'handily@handily        old id of handily, user settings',
        '  Run claude plugin uninstall handily@handily --scope user',
        'handily-board@handily  old id of handily-board, user settings',
        '  Run claude plugin uninstall handily-board@handily --scope user',
        'handily marketplace    old marketplace of these ids',
        '  Run claude plugin marketplace remove handily',
        '',
        'handily: 8 of 8 mods loaded, 0 off or paused',
        'Run each command above, then type /reload-plugins',
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
      expect(await runHandily($)).toBe(ALL_LOADED_REPLY.join('\n'))
    },
  )

  test('names the old id of every renamed or removed mod with the mod that replaces it', async ($, on) => {
    const oldIds = Object.keys(OLD_IDS)
    fakeWorld(on, {
      enabledByScope: { user: Object.fromEntries(oldIds.map((id) => [id, true])) },
    })
    const text = await runHandily($)
    for (const [id, replacement] of Object.entries(OLD_IDS)) {
      expect(cellsOf(text, id)).toEqual([id, `old id of ${replacement}, user settings`])
      expect(lineAfter(text, id)).toBe(`  Run claude plugin uninstall ${id} --scope user`)
    }
    expect(text.split('\n')).toHaveLength(MODS.length * 2 + oldIds.length * 2 + 2 + 3)
    expect(text.split('\n').slice(-2)).toEqual([
      'handily: 0 of 8 mods loaded, 0 off or paused',
      'Run each command above, then type /reload-plugins',
    ])
  })
})

describe('/handily colours', () => {
  for (const surface of SURFACES) {
    test(
      `draws the state, the action and the summary in a theme colour on ${surface}`,
      { plugins: [WORKITEMS, QUIET_ITEMS, SIMPLE_VIEW, REPLY_VIEW, FILETREE, TESTS] },
      async ($, on) => {
        fakeWorld(on, {
          enabledPlugins: {
            ...enabledWithout('handily-board'),
            'handily-item-toasts@niksavis': false,
          },
        })
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.filter((row) => row.color !== undefined)).toEqual([
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'not installed', color: 'error' },
          { text: '  Run /plugin install handily-board@niksavis', color: 'error' },
          { text: 'disabled', color: 'error' },
          { text: '  Run /plugin enable handily-item-toasts@niksavis', color: 'error' },
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          { text: 'handily: 6 of 8 mods loaded, 0 off or paused', color: 'warning' },
        ])
      },
    )

    test(
      `draws the same columns as the reply text on ${surface}`,
      { plugins: HEARTBEATS },
      async ($, on) => {
        fakeWorld(on)
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.slice(0, 5).map((row) => row.text)).toEqual([
          'handily-workitems',
          '0.1.0',
          'loaded',
          'polling',
          'Provider of one typed work item…',
        ])
      },
    )

    test(
      `draws the mode setting beside a session mode that differs from it on ${surface}`,
      { plugins: [OFF_ITEM_TOASTS, ...heartbeatsWithout('handily-item-toasts')] },
      async ($, on) => {
        fakeWorld(on)
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.map((row) => row.text)).toContain('off (default on)')
        expect(rows.map((row) => row.text)).not.toContain('on (default on)')
      },
    )

    test(
      `draws the summary in the success colour when every mod loaded on ${surface}`,
      { plugins: HEARTBEATS },
      async ($, on) => {
        fakeWorld(on)
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.at(-1)).toEqual({
          text: 'handily: 8 of 8 mods loaded, 0 off or paused',
          color: 'success',
        })
      },
    )

    test(
      `draws an old plugin id, its command and the summary in the warning colour on ${surface}`,
      { plugins: HEARTBEATS },
      async ($, on) => {
        fakeWorld(on, { enabledByScope: { project: { 'simple-view@handily': true } } })
        const rows = await shownRows($, surface, engineRowText(await runHandily($)))
        expect(rows.map((row) => row.text)).toContain('simple-view@handily')
        expect(rows.filter((row) => row.color !== undefined).slice(-6)).toEqual([
          { text: 'old id of handily-simple-view, project settings', color: 'warning' },
          {
            text: '  Run claude plugin uninstall simple-view@handily --scope project',
            color: 'warning',
          },
          { text: 'old marketplace of these ids', color: 'warning' },
          { text: '  Run claude plugin marketplace remove handily', color: 'warning' },
          { text: 'handily: 8 of 8 mods loaded, 0 off or paused', color: 'warning' },
          { text: 'Run each command above, then type /reload-plugins', color: 'warning' },
        ])
      },
    )

    test(
      `keeps drawing an earlier reply after a later one on ${surface}`,
      { plugins: [...heartbeatsWithout('handily-simple-view'), silent('handily-simple-view')] },
      async ($, on) => {
        const world = fakeWorld(on)
        const first = await runHandily($)
        world.enabledPlugins = { ...ALL_ENABLED, 'handily-simple-view@niksavis': false }
        const second = await handily($)
        expect(second).not.toBe(first)
        const coloured = (rows: Awaited<ReturnType<typeof shownRows>>) =>
          rows.filter((row) => row.color !== undefined)
        const firstRows = coloured(await shownRows($, surface, engineRowText(first)))
        const secondRows = coloured(await shownRows($, surface, engineRowText(second)))
        expect(firstRows.slice(4, 6)).toEqual([
          { text: 'not loaded', color: 'warning' },
          { text: '  Run claude --debug to see why', color: 'warning' },
        ])
        expect(secondRows.slice(4, 6)).toEqual([
          { text: 'disabled', color: 'error' },
          { text: '  Run /plugin enable handily-simple-view@niksavis', color: 'error' },
        ])
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

const GLYPH_ROWS = [
  'role      plain nerd',
  'doing     |▶|   |\u{EB2C}| nf-cod-play',
  'done      |✓|   |\u{EAB2}| nf-cod-check',
  'to do     |○|   |\u{EBB5}| nf-cod-circle_large',
  'blocked   |■|   |\u{EA87}| nf-cod-error',
  'needs you |◆|   |\u{EAA2}| nf-cod-bell',
  'edited    |✎|   |\u{EA73}| nf-cod-edit',
  'read      |◦|   |\u{EA70}| nf-cod-eye',
  'folder    |▸|   |\u{F07B}| nf-fa-folder',
  'open      |▾|   |\u{F07C}| nf-fa-folder_open',
  'branch    |·|   |\u{F418}| nf-oct-git_branch',
]
const PLAIN_TEST_LINE =
  'The nerd column is a test: when each icon fills one cell between its bars, Glyphs nerd is safe in this terminal.'
const NERD_TEST_LINES = [
  'Each mark fills one cell between bars.',
  'A box, a ? or a moved bar: this terminal has no Nerd Font Mono. Set Glyphs to plain in /config.',
]

function refusedLine(stored: string): string {
  return `Glyphs plain · the stored value ${stored} is not plain or nerd, so plain draws. Set Glyphs in /config › handily.`
}

describe('the glyph sets', () => {
  test('keeps the plain marks and the nerd icons of the ten roles', () => {
    expect(GLYPH_SETS.plain).toEqual({
      doing: '\u{25B6}',
      done: '\u{2713}',
      toDo: '\u{25CB}',
      blocked: '\u{25A0}',
      waitsForYou: '\u{25C6}',
      edited: '\u{270E}',
      read: '\u{25E6}',
      folderClosed: '\u{25B8}',
      folderOpen: '\u{25BE}',
      branch: '\u{00B7}',
    })
    const codePoints = Object.fromEntries(
      Object.entries(GLYPH_SETS.nerd).map(([role, glyph]) => [role, glyph.codePointAt(0)]),
    )
    expect(codePoints).toEqual({
      doing: 0xeb2c,
      done: 0xeab2,
      toDo: 0xebb5,
      blocked: 0xea87,
      waitsForYou: 0xeaa2,
      edited: 0xea73,
      read: 0xea70,
      folderClosed: 0xf07b,
      folderOpen: 0xf07c,
      branch: 0xf418,
    })
    expect(Object.values(GLYPH_SETS.nerd).map((glyph) => Array.from(glyph).length)).toEqual(
      Array.from({ length: 10 }, () => 1),
    )
    expect(Object.keys(NERD_NAMES)).toEqual(Object.keys(GLYPH_SETS.plain))
  })
})

describe('glyphSettingOf', () => {
  test('returns plain when no glyphs row of handily is listed', () => {
    expect(glyphSettingOf([])).toBe('plain')
    expect(glyphSettingOf(configRows(MODE_SETTINGS))).toBe('plain')
    expect(glyphSettingOf([glyphsRow('nerd', 'handily-board@niksavis')])).toBe('plain')
  })

  test('returns the setting of the glyphs row of handily from any marketplace', () => {
    expect(glyphSettingOf(configRows(MODE_SETTINGS, 'nerd'))).toBe('nerd')
    expect(glyphSettingOf(configRows(MODE_SETTINGS, 'plain'))).toBe('plain')
    expect(glyphSettingOf([glyphsRow('nerd', 'handily')])).toBe('nerd')
    expect(glyphSettingOf([glyphsRow('nerd', 'handily@inline')])).toBe('nerd')
  })

  test('throws an error that names the stored value and the words plain and nerd', () => {
    expect(() => glyphSettingOf(configRows(MODE_SETTINGS, 'nerdfont'))).toThrow(
      'handily: userConfig glyphs is "nerdfont"; set it to plain or nerd in /config.',
    )
    expect(() => glyphSettingOf([glyphsRow(true)])).toThrow(
      'handily: userConfig glyphs is true; set it to plain or nerd in /config.',
    )
  })
})

describe('/handily glyphs', () => {
  test('shows the nerd setting and each role with both marks between bars', async ($, on) => {
    fakeWorld(on, { glyphs: 'nerd' })
    expect(await runHandily($, 'glyphs')).toBe(
      ['Glyphs nerd · set in /config › handily', ...GLYPH_ROWS, ...NERD_TEST_LINES].join('\n'),
    )
  })

  test('shows the plain default and still draws the nerd column as a test', async ($, on) => {
    fakeWorld(on, { glyphs: 'plain' })
    expect(await runHandily($, 'glyphs')).toBe(
      [
        'Glyphs plain (the default) · set in /config › handily',
        ...GLYPH_ROWS,
        PLAIN_TEST_LINE,
      ].join('\n'),
    )
  })

  test('draws plain when the bundle lists no glyphs row', async ($, on) => {
    fakeWorld(on)
    expect((await runHandily($, ' glyphs ')).split('\n')[0]).toBe(
      'Glyphs plain (the default) · set in /config › handily',
    )
  })

  test('names a stored value outside plain and nerd that the engine reads as plain', async ($, on) => {
    fakeWorld(on, {
      glyphs: 'plain',
      pluginConfigs: { 'handily@niksavis': { options: { glyphs: 'nerdfont' } } },
    })
    expect(await runHandily($, 'glyphs')).toBe(
      [refusedLine('"nerdfont"'), ...GLYPH_ROWS, PLAIN_TEST_LINE].join('\n'),
    )
  })

  test('names a stored value outside plain and nerd that the glyphs row shows', async ($, on) => {
    const world = fakeWorld(on, { glyphs: 'nerdfont' })
    expect(await runHandily($, 'glyphs')).toBe(
      [refusedLine('"nerdfont"'), ...GLYPH_ROWS, PLAIN_TEST_LINE].join('\n'),
    )
    expect(world.debugLines).toEqual([
      'handily: userConfig glyphs is "nerdfont"; set it to plain or nerd in /config.',
    ])
  })

  test('names no stored value when the settings hold plain, nerd or another plugin', async ($, on) => {
    const world = fakeWorld(on, {
      glyphs: 'nerd',
      pluginConfigs: {
        'handily-board@niksavis': { options: { glyphs: 'nerdfont', mode: 'off' } },
        'handily@niksavis': { options: { glyphs: 'nerd' } },
      },
    })
    expect((await runHandily($, 'glyphs')).split('\n')[0]).toBe(
      'Glyphs nerd · set in /config › handily',
    )
    world.pluginConfigs = { 'handily@niksavis': 'not an object' }
    expect((await handily($, 'glyphs')).split('\n')[0]).toBe(
      'Glyphs nerd · set in /config › handily',
    )
    world.glyphs = 'plain'
    world.pluginConfigs = { 'handily@niksavis': { options: { glyphs: 'wide' } } }
    expect((await handily($, 'glyphs')).split('\n')[0]).toBe(refusedLine('"wide"'))
  })

  test('with two installs, names only the stored value of the install whose row sets the glyphs', async ($, on) => {
    const world = fakeWorld(on, {
      glyphs: 'nerd',
      otherRows: [glyphsRow('plain', 'handily@inline')],
      pluginConfigs: {
        'handily@inline': { options: { glyphs: 'nerdfont' } },
        'handily@niksavis': { options: { glyphs: 'nerd' } },
      },
    })
    expect((await runHandily($, 'glyphs')).split('\n')[0]).toBe(
      'Glyphs nerd · set in /config › handily',
    )
    world.glyphs = 'plain'
    world.pluginConfigs = {
      'handily@inline': { options: { glyphs: 'nerd' } },
      'handily@niksavis': { options: { glyphs: 'wide' } },
    }
    expect((await handily($, 'glyphs')).split('\n')[0]).toBe(refusedLine('"wide"'))
  })

  for (const surface of SURFACES) {
    test(`leaves the glyphs reply to the engine row on ${surface}`, async ($, on) => {
      fakeWorld(on, { glyphs: 'nerd' })
      on('ui.render', () => ({ type: 'engine', ref: 0 }))
      const text = await runHandily($, 'glyphs')
      const ui = await $.ui.mount({
        plugin: 'handily',
        surface,
        component: 'CommandOutput',
        props: { command: 'handily', args: 'glyphs', text: engineRowText(text), isErrored: false },
      })
      expect(await ui.drawn()).toEqual({ type: 'engine', ref: 0 })
      await ui.unmount()
    })
  }
})

describe('status rows', () => {
  test('treats settings without enabledPlugins as no mod installed', () => {
    const [status] = statusesOf(['handily-board'], new Map(), undefined)
    expect(status?.state).toBe('not installed')
  })

  test('shows the version and mode beside a loaded mod and dashes beside a missing one', () => {
    const statuses = statusesOf(
      ['handily-workitems', 'handily-board'],
      new Map([
        [
          'handily-workitems',
          { version: '0.1.0', description: 'Work items.', mode: 'polling', defaultMode: null },
        ],
      ]),
      {},
    )
    expect(replyText({ mods: statuses, oldIds: [] })).toBe(
      [
        'handily-workitems  0.1.0  loaded         polling  Work items',
        'handily-board      -      not installed  -',
        '  Run /plugin install handily-board@niksavis',
        '',
        'handily: 1 of 2 mods loaded, 0 off or paused',
      ].join('\n'),
    )
  })

  test('keeps the first sentence of a description and cuts it at a word with an ellipsis', () => {
    expect(shortened('One short row in place of each tracker write.', 20)).toBe('One short row in…')
    expect(shortened('Short.', 20)).toBe('Short')
    expect(shortened('A board with two tabs: this session and this machine.', 40)).toBe(
      'A board with two tabs',
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

  test('refuses a mod manifest without a description', () => {
    expect(() => manifestDescription('{"name":"handily-workitems"}', 'handily-workitems')).toThrow(
      'the plugin.json of handily-workitems has no "description"',
    )
  })
})
