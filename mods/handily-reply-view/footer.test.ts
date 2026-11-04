import type { ConfigRow, ConfigValue, On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import { displayWidth } from './hooks/width'

const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const COLUMNS = 80
const ENDED_AT = new Date(2026, 9, 9, 14, 32).getTime()
const LINE_ID = 'turn-line-1'
const SIX_MINUTES = 6 * 60_000 + 20_000
const OVER_AN_HOUR = 3_600_000 + 4 * 60_000 + 12_000
const MARKS: Readonly<Record<string, string>> = { planMode: '=', '#a6e3a1': '=' }
const BAKED = { word: 'Baked', durationMs: SIX_MINUTES } as const
const DRAWN_BAKED = ['', '~✻~ ~Baked for ~=6m 20s=~ · done ~=14:32=']

type Surface = (typeof SURFACES)[number]

type World = { config: ConfigRow[]; debugLogs: string[] }

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

function configRow(key: string, value: ConfigValue, plugin = 'engine'): ConfigRow {
  return {
    key,
    label: key,
    kind: typeof value === 'boolean' ? 'boolean' : 'choice',
    value,
    provider: { plugin, tier: plugin === 'engine' ? 'core' : 'user' },
    isLocked: false,
  }
}

function engineBeneath(on: On, config: ConfigRow[]): World {
  const world: World = { config, debugLogs: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('config.list', () => ({ value: world.config }))
  on('config.set', (_$, e) => {
    world.config = world.config.map((row) => (row.key === e.key ? { ...row, value: e.value } : row))
    return { value: e.value }
  })
  on('settings.read', () => ({ value: {} }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', () => ENGINE_ROW)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLogs.push(e.text)
    return { value: undefined }
  })
  return world
}

type Scene = { options?: Record<string, string>; config?: ConfigRow[] }

type SceneBody = (world: World, $: Engine) => Promise<void>

function footerTest(name: string, scene: Scene, body: SceneBody): void {
  test(name, { options: scene.options ?? {} }, async ($, on) => {
    const world = engineBeneath(on, scene.config ?? [configRow('turnDuration', true)])
    mock.clock(on, { now: ENDED_AT })
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

async function appendTurnLine($: Engine, uuid = LINE_ID, name = 'turn_duration') {
  await $.session.append({
    message: { type: 'system', name, content: [] },
    door: 'notice',
    origin: { kind: 'engine' },
    uuid,
  })
}

async function mountLine(
  $: Engine,
  props: RenderPropsOf['TurnDuration'],
  surface: Surface = 'terminal',
  columns = COLUMNS,
) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'TurnDuration',
    props,
    requestId: LINE_ID,
    viewport: { columns, rows: 40 },
  })
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null
}

function marked(props: Record<string, unknown>, text: string): string {
  const mark = typeof props.color === 'string' ? MARKS[props.color] : undefined
  const coloured = mark === undefined ? text : `${mark}${text}${mark}`
  return props.dimColor === true ? `~${coloured}~` : coloured
}

function inline(node: unknown): string {
  if (typeof node === 'string') return node
  if (!isNode(node)) return ''
  return marked(node.props ?? {}, (node.children ?? []).map(inline).join(''))
}

function sketch(node: unknown): string[] {
  if (!isNode(node) || node.type !== 'Box') return [inline(node)]
  const props = node.props ?? {}
  const children = node.children ?? []
  const margin = Array<string>(Number(props.marginTop ?? 0)).fill('')
  if (props.flexDirection === 'column') return [...margin, ...children.flatMap(sketch)]
  const line = children.map((child) => sketch(child).join('')).join('')
  const least = typeof props.minWidth === 'number' ? props.minWidth : 0
  const pad = ' '.repeat(Math.max(least - displayWidth(unmarked(line)), 0))
  return [...margin, line + pad]
}

async function sketchOf(ui: { drawn: () => Promise<unknown> }): Promise<string[]> {
  return sketch(await ui.drawn())
}

function unmarked(line: string): string {
  return line.replace(/[~=]/g, '')
}

async function toggleReplies($: Engine): Promise<void> {
  await $.command.run({
    command: 'replies',
    args: '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: COLUMNS },
  })
}

describe('the turn footer', () => {
  footerTest(
    'a turn that ends on the terminal draws the word of the engine, then the duration and the end time in the number colour',
    {},
    async (_world, $) => {
      await appendTurnLine($)
      const ui = await mountLine($, { ...BAKED, isExpanded: false })
      expect(await sketchOf(ui)).toEqual(DRAWN_BAKED)
      await ui.unmount()
    },
  )

  footerTest(
    'a turn over an hour keeps the duration format of the engine, hours, minutes and seconds',
    {},
    async (_world, $) => {
      await appendTurnLine($)
      const ui = await mountLine($, { word: 'Cogitated', durationMs: OVER_AN_HOUR })
      expect(await sketchOf(ui)).toEqual(['', '~✻~ ~Cogitated for ~=1h 4m 12s=~ · done ~=14:32='])
      await ui.unmount()
    },
  )

  for (const [durationMs, shown] of [
    [3_000, '3s'],
    [59_999, '59s'],
    [64_000, '1m 4s'],
    [119_600, '2m 0s'],
    [90_061_000, '1d 1h 1m'],
  ] as const) {
    footerTest(
      `a turn of ${String(durationMs)} ms draws ${shown} as the engine does`,
      {},
      async (_world, $) => {
        const ui = await mountLine($, { word: 'Baked', durationMs })
        expect(await sketchOf(ui)).toEqual(['', `~✻~ ~Baked for ~=${shown}=`])
        await ui.unmount()
      },
    )
  }

  footerTest(
    'with the catppuccin-mocha palette on a dark theme the duration and the end time draw in the mocha number colour',
    {
      config: [
        configRow('turnDuration', true),
        configRow('theme', 'dark'),
        configRow('handily.palette', 'catppuccin-mocha', 'handily@niksavis'),
      ],
    },
    async (_world, $) => {
      await appendTurnLine($)
      const ui = await mountLine($, BAKED)
      const colours = JSON.stringify(await ui.drawn()).match(/"color":"[^"]+"/g)
      expect(colours).toEqual(['"color":"#a6e3a1"', '"color":"#a6e3a1"'])
      await ui.unmount()
    },
  )

  footerTest(
    'a line whose end time is not known leaves the end time out and never guesses it',
    {},
    async (_world, $) => {
      await appendTurnLine($, 'another-line')
      const ui = await mountLine($, BAKED)
      expect(await sketchOf(ui)).toEqual(['', '~✻~ ~Baked for ~=6m 20s='])
      await ui.unmount()
    },
  )

  footerTest(
    'a notice row that is not a turn line keeps no end time for the line',
    {},
    async (_world, $) => {
      await appendTurnLine($, LINE_ID, 'compact_boundary')
      const ui = await mountLine($, BAKED)
      expect(await sketchOf(ui)).toEqual(['', '~✻~ ~Baked for ~=6m 20s='])
      await ui.unmount()
    },
  )

  for (const [what, extra] of [
    [
      'a line that waits for background agents',
      { waitingFor: { agents: [{ id: 'agent-1', agentType: 'general-purpose' }], workflows: 0 } },
    ],
    ['a line in the ctrl+o view', { isExpanded: true }],
  ] as const) {
    footerTest(
      `${what} is drawn by the engine, and the same line without it is drawn by the mod`,
      {},
      async (_world, $) => {
        await appendTurnLine($)
        const own = await mountLine($, BAKED)
        expect(await sketchOf(own)).toEqual(DRAWN_BAKED)
        await own.unmount()
        const engine = await mountLine($, { ...BAKED, ...extra })
        expect(await engine.drawn()).toEqual(ENGINE_ROW)
        await engine.unmount()
      },
    )
  }

  for (const [columns, shown] of [
    [31, '~✻~ ~Baked for ~=6m 20s=~ · done ~=14:32='],
    [30, '~✻~ ~Baked for ~=6m 20s=~ · ~=14:32='],
    [26, '~✻~ ~Baked for ~=6m 20s=~ · ~=14:32='],
    [25, '~✻~ ~Baked for ~=6m 20s='],
    [18, '~✻~ ~Baked for ~=6m 20s='],
  ] as const) {
    footerTest(
      `at ${String(columns)} columns a line wider than the screen drops done first, then the end time`,
      {},
      async (_world, $) => {
        await appendTurnLine($)
        const ui = await mountLine($, BAKED, 'terminal', columns)
        const drawn = await sketchOf(ui)
        expect(drawn).toEqual(['', shown])
        expect(displayWidth(unmarked(shown))).toBeLessThanOrEqual(columns)
        await ui.unmount()
      },
    )
  }

  footerTest(
    'the desktop keeps the engine line, and the terminal draws its own',
    {},
    async (_world, $) => {
      await appendTurnLine($)
      for (const surface of SURFACES) {
        const ui = await mountLine($, BAKED, surface)
        if (surface === 'desktop') expect(await ui.drawn()).toEqual(ENGINE_ROW)
        else expect(await sketchOf(ui)).toEqual(DRAWN_BAKED)
        await ui.unmount()
      }
    },
  )

  footerTest(
    'with the mode setting off the engine draws the line, and /replies turns the own line on',
    { options: { mode: 'off' } },
    async (_world, $) => {
      await appendTurnLine($)
      const engine = await mountLine($, BAKED)
      expect(await engine.drawn()).toEqual(ENGINE_ROW)
      await engine.unmount()
      await toggleReplies($)
      const own = await mountLine($, BAKED)
      expect(await sketchOf(own)).toEqual(DRAWN_BAKED)
      await own.unmount()
    },
  )

  footerTest(
    '/replies off hands the line back to the engine, and /replies on draws it again',
    {},
    async (_world, $) => {
      await appendTurnLine($)
      await toggleReplies($)
      const off = await mountLine($, BAKED)
      expect(await off.drawn()).toEqual(ENGINE_ROW)
      await off.unmount()
      await toggleReplies($)
      const on = await mountLine($, BAKED)
      expect(await sketchOf(on)).toEqual(DRAWN_BAKED)
      await on.unmount()
    },
  )

  for (const [what, config] of [
    ['is off', [configRow('turnDuration', false)]],
    ['is not a yes or no', [configRow('turnDuration', 'on')]],
    ['is not in the config list', []],
  ] as const) {
    footerTest(
      `when the Show turn duration setting ${what} the engine draws the line, and the mod draws it once the setting is on`,
      { config: [...config] },
      async (world, $) => {
        await appendTurnLine($)
        const engine = await mountLine($, BAKED)
        expect(await engine.drawn()).toEqual(ENGINE_ROW)
        await engine.unmount()
        world.config = [
          ...world.config.filter((row) => row.key !== 'turnDuration'),
          configRow('turnDuration', false),
        ]
        await $.config.set({
          key: 'turnDuration',
          value: true,
          previous: false,
          provider: { plugin: 'engine', tier: 'core' },
          origin: { kind: 'composer' },
        })
        const own = await mountLine($, BAKED)
        expect(await sketchOf(own)).toEqual(DRAWN_BAKED)
        await own.unmount()
      },
    )
  }

  for (const durationMs of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    footerTest(
      `a duration of ${String(durationMs)} ms is drawn by the engine, and a readable one by the mod`,
      {},
      async (_world, $) => {
        const engine = await mountLine($, { word: 'Baked', durationMs })
        expect(await engine.drawn()).toEqual(ENGINE_ROW)
        await engine.unmount()
        const own = await mountLine($, { word: 'Baked', durationMs: 3_000 })
        expect(await sketchOf(own)).toEqual(['', '~✻~ ~Baked for ~=3s='])
        await own.unmount()
      },
    )
  }
})
