import type { On, RenderSurface } from 'claude-code'
import { describe, expect, test, type Engine, type Plugin } from 'claude-code/testing'
import { bundledMods, replyText, statusesOf, type Admission } from './hooks/status'

const SURFACES: RenderSurface[] = ['terminal', 'desktop']
const MODS = ['workitems', 'quiet-items', 'task-pane', 'session-board', 'item-toasts']
const MANIFEST = JSON.stringify({ name: 'handily', version: '0.1.0', dependencies: MODS })
const ALL_ENABLED = Object.fromEntries(MODS.map((name) => [`${name}@handily`, true]))

function enabledWithout(name: string): Record<string, boolean> {
  return Object.fromEntries(Object.entries(ALL_ENABLED).filter(([id]) => id !== `${name}@handily`))
}

function inline(name: string): Plugin {
  return { name, register() {} }
}

type World = { enabledPlugins: unknown; reads: string[] }

function fakeWorld(on: On, world: Partial<World> = {}): World {
  const full: World = { enabledPlugins: ALL_ENABLED, reads: [], ...world }
  on('plugin.register', () => ({ allow: true }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('settings.read', () => ({ value: { enabledPlugins: full.enabledPlugins } }))
  on('fs.read', (_$, e) => {
    full.reads.push(e.path)
    return { value: MANIFEST }
  })
  return full
}

async function runHandily(engine: Engine, args = ''): Promise<string> {
  await engine.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const result = await engine.command.run({
    command: 'handily',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  return result.text ?? ''
}

async function shownRows(engine: Engine, surface: RenderSurface, reply: string) {
  const ui = await engine.ui.mount({
    plugin: 'handily',
    surface,
    component: 'CommandOutput',
    props: { command: 'handily', args: '', text: `handily: ${reply}`, isErrored: false },
  })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map((found) => ({ text: found.text.trimEnd(), color: found.props.color }))
}

describe('/handily reply', () => {
  test(
    'names every bundled mod as loaded when each one loaded',
    { plugins: MODS.map(inline) },
    async ($, on) => {
      fakeWorld(on)
      expect(await runHandily($)).toBe(
        [
          '- workitems: loaded',
          '- quiet-items: loaded',
          '- task-pane: loaded',
          '- session-board: loaded',
          '- item-toasts: loaded',
          '',
          'handily: 5 of 5 mods loaded',
        ].join('\n'),
      )
    },
  )

  test(
    'gives the install line for a mod that is not installed',
    { plugins: MODS.filter((name) => name !== 'task-pane').map(inline) },
    async ($, on) => {
      fakeWorld(on, { enabledPlugins: enabledWithout('task-pane') })
      const text = await runHandily($)
      expect(text).toContain('- task-pane: not installed. Run /plugin install task-pane@handily')
      expect(text.split('\n').at(-1)).toBe('handily: 4 of 5 mods loaded')
    },
  )

  test(
    'gives the enable line for a mod that is disabled',
    { plugins: MODS.filter((name) => name !== 'session-board').map(inline) },
    async ($, on) => {
      fakeWorld(on, { enabledPlugins: { ...ALL_ENABLED, 'session-board@handily': false } })
      const text = await runHandily($)
      expect(text).toContain('- session-board: disabled. Run /plugin enable session-board@handily')
      expect(text.split('\n').at(-1)).toBe('handily: 4 of 5 mods loaded')
    },
  )

  test(
    'says that an enabled mod which never loaded did not load',
    { plugins: MODS.filter((name) => name !== 'workitems').map(inline) },
    async ($, on) => {
      fakeWorld(on)
      const text = await runHandily($)
      expect(text).toContain(
        '- workitems: enabled, but it did not load. Run claude --debug to see why',
      )
      expect(text.split('\n').at(-1)).toBe('handily: 4 of 5 mods loaded')
    },
  )

  test('counts no mod as loaded when none loaded', async ($, on) => {
    fakeWorld(on, { enabledPlugins: {} })
    const text = await runHandily($)
    for (const name of MODS) {
      expect(text).toContain(`- ${name}: not installed. Run /plugin install ${name}@handily`)
    }
    expect(text.split('\n').at(-1)).toBe('handily: 0 of 5 mods loaded')
  })

  test('reads the list of mods from its own plugin.json', async ($, on) => {
    const world = fakeWorld(on)
    await runHandily($)
    expect(world.reads).toHaveLength(1)
    expect(world.reads[0]).toMatch(/[\\/]\.claude-plugin[\\/]plugin\.json$/)
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
      { plugins: ['workitems', 'quiet-items', 'session-board'].map(inline) },
      async ($, on) => {
        fakeWorld(on, {
          enabledPlugins: { ...enabledWithout('task-pane'), 'item-toasts@handily': false },
        })
        const text = await runHandily($)
        const rows = await shownRows($, surface, text)
        expect(rows.filter((row) => row.color !== undefined)).toEqual([
          { text: 'loaded', color: 'success' },
          { text: 'loaded', color: 'success' },
          {
            text: 'not installed. Run /plugin install task-pane@handily',
            color: 'error',
          },
          { text: 'loaded', color: 'success' },
          { text: 'disabled. Run /plugin enable item-toasts@handily', color: 'error' },
          { text: 'handily: 3 of 5 mods loaded', color: 'warning' },
        ])
      },
    )

    test(
      `draws the summary in the success colour when every mod loaded on ${surface}`,
      { plugins: MODS.map(inline) },
      async ($, on) => {
        fakeWorld(on)
        const rows = await shownRows($, surface, await runHandily($))
        expect(rows.at(-1)).toEqual({ text: 'handily: 5 of 5 mods loaded', color: 'success' })
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
  const admissions = new Map<string, Admission>([
    ['workitems', { version: '0.1.0', refusal: undefined }],
    ['quiet-items', { version: '0.2.0', refusal: undefined }],
  ])

  test('shows the version that each loaded mod declares', () => {
    const statuses = statusesOf(['workitems', 'quiet-items'], admissions, ALL_ENABLED)
    expect(replyText(statuses)).toBe(
      [
        '- workitems 0.1.0: loaded',
        '- quiet-items 0.2.0: loaded',
        '',
        'handily: 2 of 2 mods loaded',
      ].join('\n'),
    )
  })

  test('names the reason when a judge refused to load a mod', () => {
    const refused = new Map<string, Admission>([
      ['item-toasts', { version: '0.1.0', refusal: 'managed plugins only' }],
    ])
    const statuses = statusesOf(['item-toasts'], refused, ALL_ENABLED)
    expect(statuses).toEqual([
      {
        name: 'item-toasts',
        version: '0.1.0',
        state: 'refused',
        detail: 'did not load: managed plugins only',
      },
    ])
    expect(replyText(statuses).split('\n').at(-1)).toBe('handily: 0 of 1 mods loaded')
  })

  test('treats settings without enabledPlugins as no mod installed', () => {
    const [status] = statusesOf(['task-pane'], new Map(), undefined)
    expect(status?.state).toBe('not installed')
  })
})

describe('bundled mods', () => {
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
})
