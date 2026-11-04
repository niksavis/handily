import type { ConfigRow, On, RenderPropsOf } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { displayWidth } from './hooks/width'

const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const MOCHA = 'catppuccin-mocha'
const MARKS: Readonly<Record<string, string>> = {
  claude: '@',
  subtle: '%',
  planMode: '=',
  permission: '&',
  merged: '§',
  suggestion: '^',
  inactive: '°',
  success: '+',
  warning: '#',
  error: '$',
}

type Surface = (typeof SURFACES)[number]

type World = { copies: string[]; debugLogs: string[]; config: ConfigRow[]; pluginConfigs: unknown }

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

type Ui = { drawn: () => Promise<unknown> }

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

function paletteRows(palette: string, theme: string): ConfigRow[] {
  return [
    configRow('theme', theme, 'engine'),
    configRow('handily.palette', palette, 'handily@niksavis'),
  ]
}

function engineBeneath(on: On): World {
  const world: World = { copies: [], debugLogs: [], config: [], pluginConfigs: undefined }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('config.list', () => ({ value: world.config }))
  on('settings.read', () => ({
    value: world.pluginConfigs === undefined ? {} : { pluginConfigs: world.pluginConfigs },
  }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    world.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLogs.push(e.text)
    return { value: undefined }
  })
  return world
}

type Scene = { options?: Record<string, string>; config?: ConfigRow[]; pluginConfigs?: unknown }

function sceneTest(name: string, scene: Scene, body: (world: World, $: Engine) => Promise<void>) {
  test(name, { options: scene.options ?? {} }, async ($, on) => {
    const world = engineBeneath(on)
    world.config = scene.config ?? []
    world.pluginConfigs = scene.pluginConfigs
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

async function mountReply($: Engine, text: string, surface: Surface, columns = 80) {
  const props: RenderPropsOf['AssistantMessage'] = { text, isFirstOfReply: true }
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props,
    requestId: 'message-1',
    viewport: { columns, rows: 40 },
  })
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null
}

function marked(props: Record<string, unknown>, text: string): string {
  if (text.trim() === '') return text
  let shown = props.underline === true ? `_${text}_` : text
  if (props.italic === true) shown = `/${shown}/`
  if (props.strikethrough === true) shown = `!${shown}!`
  if (props.bold === true) shown = `*${shown}*`
  if (props.dimColor === true) shown = `~${shown}~`
  const mark = typeof props.color === 'string' ? MARKS[props.color] : undefined
  return mark === undefined ? shown : `${mark}${shown}${mark}`
}

function inline(node: unknown, isMarked = true): string {
  if (typeof node === 'string') return node
  if (!isNode(node)) return ''
  const text = (node.children ?? []).map((child) => inline(child, isMarked)).join('')
  return isMarked ? marked(node.props ?? {}, text) : text
}

type Render = { lines: string[]; widths: number[] }

function rowLines(children: readonly unknown[], width: number, isMarked: boolean): Render {
  const fixed = (child: unknown) =>
    isNode(child) && typeof child.props?.width === 'number' ? child.props.width : 0
  const grows = (child: unknown) => isNode(child) && Number(child.props?.flexGrow ?? 0) > 0
  const blocks = children.map((child) => (grows(child) ? null : render(child, width, isMarked)))
  const widths = blocks.map((block, index) =>
    block === null ? 0 : Math.max(0, fixed(children[index]), ...block.widths),
  )
  const used = widths.reduce((total, value) => total + value, 0)
  const filled = blocks.map((block, index) => {
    if (block !== null) return { ...block, width: widths[index] ?? 0 }
    const room = Math.max(0, width - used)
    return { ...render(children[index], room, isMarked), width: room }
  })
  const height = Math.max(0, ...filled.map((block) => block.lines.length))
  const rows = Array.from({ length: height }, (_, row) =>
    filled.map((block) => {
      const shown = block.widths[row] ?? 0
      const pad = ' '.repeat(Math.max(block.width - shown, 0))
      return { text: (block.lines[row] ?? '') + pad, width: shown + pad.length }
    }),
  )
  return {
    lines: rows.map((row) => row.map((part) => part.text).join('')),
    widths: rows.map((row) => row.reduce((total, part) => total + part.width, 0)),
  }
}

function boxLines(
  props: Record<string, unknown>,
  children: unknown[],
  width: number,
  isMarked: boolean,
): Render {
  const indent = Number(props.paddingLeft ?? 0)
  const inner = (typeof props.width === 'number' ? props.width : width) - indent
  const gap = Number(props.gap ?? 0)
  const blank: Render = { lines: Array<string>(gap).fill(''), widths: Array<number>(gap).fill(0) }
  const parts =
    props.flexDirection === 'column'
      ? children.flatMap((child, index) => [
          ...(index > 0 ? [blank] : []),
          render(child, inner, isMarked),
        ])
      : [rowLines(children, inner, isMarked)]
  const top = Number(props.marginTop ?? 0)
  const lead = (line: string) => (line === '' ? line : ' '.repeat(indent) + line)
  return {
    lines: [...Array<string>(top).fill(''), ...parts.flatMap((part) => part.lines.map(lead))],
    widths: [
      ...Array<number>(top).fill(0),
      ...parts.flatMap((part) => part.widths.map((value) => (value === 0 ? 0 : value + indent))),
    ],
  }
}

function single(text: string, plainText: string): Render {
  return { lines: [text], widths: [displayWidth(plainText)] }
}

function render(node: unknown, width: number, isMarked: boolean): Render {
  if (typeof node === 'string') return single(node, node)
  if (!isNode(node)) return { lines: [], widths: [] }
  const props = node.props ?? {}
  switch (node.type) {
    case 'Text':
      return single(inline(node, isMarked), inline(node, false))
    case 'Button':
      return single(`[ ${String(props.label)} ]`, `[ ${String(props.label)} ]`)
    case 'Markdown':
    case 'Code': {
      const text = String(node.type === 'Markdown' ? props.text : props.source).split('\n')
      return { lines: text, widths: text.map(displayWidth) }
    }
    case 'Box':
      return boxLines(props, node.children ?? [], width, isMarked)
    default:
      return { lines: [], widths: [] }
  }
}

async function sketchOf(ui: Ui, columns = 80): Promise<string[]> {
  return render(await ui.drawn(), columns, true).lines.map((line) => line.trimEnd())
}

async function shapeOf(ui: Ui, columns = 80): Promise<string[]> {
  return render(await ui.drawn(), columns, false).lines.map((line) => line.trimEnd())
}

function nodesOf(node: unknown): Node[] {
  if (!isNode(node)) return []
  return [node, ...(node.children ?? []).flatMap(nodesOf)]
}

function leafText(node: Node): string {
  return (node.children ?? []).map((child) => (typeof child === 'string' ? child : '')).join('')
}

async function textNodes(ui: Ui, pattern: RegExp): Promise<Node[]> {
  return nodesOf(await ui.drawn()).filter(
    (node) => node.type === 'Text' && pattern.test(leafText(node)),
  )
}

async function looksOf(ui: Ui, pattern: RegExp): Promise<Record<string, unknown>[]> {
  return (await textNodes(ui, pattern)).map((node) => node.props ?? {})
}

async function markdownTexts(ui: Ui): Promise<string[]> {
  return nodesOf(await ui.drawn())
    .filter((node) => node.type === 'Markdown')
    .map((node) => String(node.props?.text))
}

function wider(drawn: readonly string[], columns: number): string[] {
  return drawn.filter((line) => displayWidth(line) > columns)
}

const HEADINGS = [
  '# Ingest timeouts after v2.3.1',
  '',
  '## Impact',
  'p95 rose to 2 s.',
  '',
  '### Why 4 is too few',
  '',
  '#### Level four ####',
  '',
  '##### Level five',
  '',
  '###### Level six',
].join('\n')

const BANNER_80 = [
  '● ╭──────────────────────────────╮',
  '  │ Ingest timeouts after v2.3.1 │',
  '  ╰──────────────────────────────╯',
  '',
  '  Impact',
  '  ━━━━━━',
  '',
  '  p95 rose to 2 s.',
  '',
  '  Why 4 is too few',
  '',
  '  Level four',
  '',
  '  Level five',
  '',
  '  Level six',
]

describe('headings in the headingStyle of mocks 15.10 (handily-36bsx.2)', () => {
  sceneTest(
    'headings of level 1 to 6 draw in the banner style by default: a box around H1, a rule under H2, no # marks and a blank line after each',
    {},
    async (world, $) => {
      const ui = await mountReply($, HEADINGS, 'terminal')
      expect(await shapeOf(ui)).toEqual(BANNER_80)
      expect(await markdownTexts(ui)).toEqual([])
      expect(await looksOf(ui, /^(?:╭─+╮|│ |━+)$/)).toEqual([
        { color: 'claude', bold: true },
        { color: 'claude', bold: true },
        { color: 'claude', bold: true },
      ])
      expect(await looksOf(ui, /^(?:Ingest|Impact|Why|Level)/)).toEqual([
        { color: 'claude', bold: true },
        { color: 'claude', bold: true },
        { color: 'merged', bold: true },
        { bold: true },
        { bold: true },
        { bold: true },
      ])
      expect(world.debugLogs).toEqual([])
      await ui.unmount()
    },
  )

  for (const [style, h1, look] of [
    ['bold', 'Ingest timeouts after v2.3.1', {}],
    ['underline', 'Ingest timeouts after v2.3.1', { underline: true }],
    ['uppercase', 'INGEST TIMEOUTS AFTER V2.3.1', {}],
  ] as const) {
    sceneTest(
      `the headingStyle ${style} draws no box and no rule, H1 as ${h1}`,
      { options: { headingStyle: style } },
      async (_world, $) => {
        const ui = await mountReply($, HEADINGS, 'terminal')
        expect((await shapeOf(ui)).slice(0, 5)).toEqual([
          `● ${h1}`,
          '',
          '  Impact',
          '',
          '  p95 rose to 2 s.',
        ])
        expect(await looksOf(ui, /^(?:INGEST|Ingest|Impact|Why|Level six)/)).toEqual([
          { color: 'claude', bold: true, ...look },
          { color: 'claude', bold: true, ...look },
          { color: 'merged', bold: true },
          { bold: true },
        ])
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'a stored headingStyle outside the options draws banner and the debug log names the value',
    {
      options: { headingStyle: 'loud' },
      pluginConfigs: { 'handily-reply-view': { options: { headingStyle: 'loud' } } },
    },
    async (world, $) => {
      const ui = await mountReply($, HEADINGS, 'terminal')
      expect(await shapeOf(ui)).toEqual(BANNER_80)
      expect(world.debugLogs).toEqual([
        'handily-reply-view: userConfig headingStyle is "loud"; set it to banner or bold or underline or uppercase in /config. Drawing banner.',
      ])
      await ui.unmount()
    },
  )

  sceneTest(
    'under 40 columns the H1 box gives way: H1 draws as H2, a long heading wraps and its rule spans its widest line',
    {},
    async (_world, $) => {
      const ui = await mountReply(
        $,
        '# Ingest timeouts after the v2.3.1 deploy\n\nText.',
        'terminal',
        30,
      )
      expect(await shapeOf(ui, 30)).toEqual([
        '● Ingest timeouts after the',
        '  v2.3.1 deploy',
        '  ━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '  Text.',
      ])
      await ui.unmount()
    },
  )

  sceneTest('at 40 columns a long H1 wraps inside a box that hugs it', {}, async (_world, $) => {
    const ui = await mountReply($, '# Ingest timeouts after the deploy of v2.3.1', 'terminal', 40)
    expect(await shapeOf(ui, 40)).toEqual([
      '● ╭──────────────────────────────────╮',
      '  │ Ingest timeouts after the deploy │',
      '  │ of v2.3.1                        │',
      '  ╰──────────────────────────────────╯',
    ])
    await ui.unmount()
  })

  sceneTest(
    'a heading with a construct that reply-view cannot prove simple goes to the engine Markdown',
    {},
    async (_world, $) => {
      const ui = await mountReply($, '# A <b>bold</b> title\n\nText 3.', 'terminal')
      expect(await markdownTexts(ui)).toEqual(['# A <b>bold</b> title'])
      await ui.unmount()
    },
  )
})

const NESTED_LIST = [
  '- Level 1',
  '  - Level 2',
  '    - Level 3',
  '      - Level 4 and deeper keep ▪ and stop indenting here',
  '        - Level 5',
  '          - Level 6',
  '-',
  '1. First',
  '2. At 430 writes a second',
  '   1. A slow query blocks the queue.',
].join('\n')

describe('nested lists (handily-36bsx.2)', () => {
  sceneTest(
    'the bullets are • ◦ ▪, each level indents 2, level 4 or deeper keeps the indent of level 4, and a numbered list keeps its numbers',
    {},
    async (_world, $) => {
      const ui = await mountReply($, NESTED_LIST, 'terminal')
      expect(await shapeOf(ui)).toEqual([
        '● • Level 1',
        '    ◦ Level 2',
        '      ▪ Level 3',
        '        ▪ Level 4 and deeper keep ▪ and stop indenting here',
        '        ▪ Level 5',
        '        ▪ Level 6',
        '  •',
        '  1. First',
        '  2. At 430 writes a second',
        '     1. A slow query blocks the queue.',
      ])
      expect(new Set((await looksOf(ui, /^(?:[•◦▪]|\d\.)$/)).map((look) => look.color))).toEqual(
        new Set(['inactive']),
      )
      await ui.unmount()
    },
  )

  sceneTest('a continuation line keeps the text column of its item', {}, async (_world, $) => {
    const ui = await mountReply($, '- top\n  - inner item\n    continues here', 'terminal')
    expect(await shapeOf(ui)).toEqual(['● • top', '    ◦ inner item', '      continues here'])
    await ui.unmount()
  })

  sceneTest(
    'a numbered line after text that does not start at 1 continues the paragraph, as CommonMark reads it',
    {},
    async (_world, $) => {
      const ui = await mountReply($, 'Text here\n2. two', 'terminal')
      expect(await shapeOf(ui)).toEqual(['● Text here', '  2. two'])
      expect(await looksOf(ui, /^2\.$/)).toEqual([])
      expect(await markdownTexts(ui)).toEqual([])
      await ui.unmount()
    },
  )

  for (const [what, text] of [
    ['a nested ordered list that does not start at 1', '1. one\n   2. two'],
    ['a heading inside a list item', '- item\n  # heading'],
    ['a list item that holds a nested list marker', '- - inner'],
  ] as const) {
    sceneTest(`${what} goes to the engine Markdown`, {}, async (_world, $) => {
      const ui = await mountReply($, text, 'terminal')
      expect(await markdownTexts(ui)).toEqual([text])
      await ui.unmount()
    })
  }
})

const TASKS = [
  'Follow-up:',
  '',
  '- [x] Restore pool_size to 32',
  '- [X] Confirm p95 returns to 45 ms',
  '- [ ] Check that tanks-db can take 32 connections',
  '  - [ ] Ask the DB owner for max_connections',
  '- [ ] Add an alert on acquire timeouts',
].join('\n')

describe('task lists (handily-36bsx.2)', () => {
  sceneTest(
    'done tasks draw [✓] in success with the text dim and struck through, open tasks [ ] in inactive, and a dim N of M done line follows',
    {},
    async (_world, $) => {
      const ui = await mountReply($, TASKS, 'terminal')
      expect(await shapeOf(ui)).toEqual([
        '● Follow-up:',
        '',
        '  [✓] Restore pool_size to 32',
        '  [✓] Confirm p95 returns to 45 ms',
        '  [ ] Check that tanks-db can take 32 connections',
        '      [ ] Ask the DB owner for max_connections',
        '  [ ] Add an alert on acquire timeouts',
        '  2 of 5 done',
      ])
      expect(await looksOf(ui, /^\[[✓ ]\]$/)).toEqual([
        { color: 'success' },
        { color: 'success' },
        { color: 'inactive' },
        { color: 'inactive' },
        { color: 'inactive' },
      ])
      expect(await looksOf(ui, /^(?:Restore|Confirm)/)).toEqual([
        { dimColor: true, strikethrough: true },
        { dimColor: true, strikethrough: true },
      ])
      expect(await looksOf(ui, /^(?:Check|Ask)/)).toEqual([{}, {}])
      expect(await looksOf(ui, /done$/)).toEqual([{ dimColor: true }])
      await ui.unmount()
    },
  )

  sceneTest(
    'with the nerd glyph set a done task draws the Done glyph nf-cod-check in its box',
    { config: [configRow('handily.glyphs', 'nerd', 'handily@niksavis')] },
    async (_world, $) => {
      const ui = await mountReply($, '- [x] one\n- [ ] two', 'terminal')
      expect(await shapeOf(ui)).toEqual(['● [\u{EAB2}] one', '  [ ] two'])
      await ui.unmount()
    },
  )

  sceneTest('a task list of 2 tasks has no N of M done line', {}, async (_world, $) => {
    const ui = await mountReply($, '- [x] one\n- [ ] two', 'terminal')
    expect(await shapeOf(ui)).toEqual(['● [✓] one', '  [ ] two'])
    await ui.unmount()
  })
})

const QUOTES = [
  '> Rolling ingest back to v2.3.0: v2.3.1 cut the DB pool from 32 to 4, and',
  '> writes time out (pool 4/4 busy, up to 87 waiting).',
  '>',
  '> > A nested quote keeps its own bar.',
  '> > > And a third level.',
].join('\n')

describe('quotes (handily-36bsx.2)', () => {
  sceneTest(
    'each level of a nested quote draws its own ▌ in inactive, and the quote text is italic',
    {},
    async (_world, $) => {
      const ui = await mountReply($, QUOTES, 'terminal')
      expect(await shapeOf(ui)).toEqual([
        '● ▌ Rolling ingest back to v2.3.0: v2.3.1 cut the DB pool from 32 to 4, and',
        '  ▌ writes time out (pool 4/4 busy, up to 87 waiting).',
        '  ▌',
        '  ▌ ▌ A nested quote keeps its own bar.',
        '  ▌ ▌ ▌ And a third level.',
      ])
      expect(new Set((await looksOf(ui, /▌/)).map((look) => look.color))).toEqual(
        new Set(['inactive']),
      )
      expect(await looksOf(ui, /^A nested/)).toEqual([{ italic: true }])
      expect(await markdownTexts(ui)).toEqual([])
      await ui.unmount()
    },
  )

  sceneTest(
    'a long quote line wraps with a bar on each row at 30 columns',
    {},
    async (_world, $) => {
      const ui = await mountReply($, '> > Rolling ingest back to v2.3.0 now', 'terminal', 30)
      expect(await shapeOf(ui, 30)).toEqual(['● ▌ ▌ Rolling ingest back to', '  ▌ ▌ v2.3.0 now'])
      await ui.unmount()
    },
  )

  for (const [what, text] of [
    ['a lazy line that continues a quote', '> a quote\nthat continues'],
    ['a shallower line right after a nested quote', '> > inner\n> outer'],
    ['a list inside a quote', '> - item'],
    ['an unknown alert kind', '> [!TODO] An unknown kind'],
  ] as const) {
    sceneTest(`${what} goes to the engine Markdown`, {}, async (_world, $) => {
      const ui = await mountReply($, text, 'terminal')
      expect(await markdownTexts(ui)).toEqual([text])
      await ui.unmount()
    })
  }
})

const ALERTS = [
  ['NOTE', 'Note', 'suggestion', 'Useful to know.'],
  ['TIP', 'Tip', 'success', 'A better way.'],
  ['IMPORTANT', 'Important', 'merged', 'Needed to succeed.'],
  ['WARNING', 'Warning', 'warning', 'Needs your attention now.'],
  ['CAUTION', 'Caution', 'error', 'Could lose data.'],
] as const

function edgeLine(left: string, word: string, columns: number): string {
  return `${left}─ ${word} ${'─'.repeat(columns - 5 - word.length)}╮`
}

describe('alerts (handily-36bsx.2)', () => {
  for (const [kind, word, key, body] of ALERTS) {
    sceneTest(
      `[!${kind}] draws as a box with ${word} on its top edge in ${key} at 40 columns`,
      {},
      async (_world, $) => {
        const ui = await mountReply($, `> [!${kind}]\n> ${body}`, 'terminal', 40)
        const drawn = await shapeOf(ui, 40)
        expect(drawn).toEqual([
          `● ${edgeLine('╭', word, 38)}`,
          `  │ ${body.padEnd(34)} │`,
          `  ╰${'─'.repeat(36)}╯`,
        ])
        expect(wider(drawn, 40)).toEqual([])
        expect(await looksOf(ui, /^(?:╭|│ $| +│$|╰)/)).toEqual([
          { color: key },
          { color: key },
          { color: key },
          { color: key },
        ])
        expect(await looksOf(ui, new RegExp(`^${body}$`))).toEqual([{ wrap: 'truncate-end' }])
        await ui.unmount()
      },
    )

    sceneTest(
      `[!${kind}] draws as a bar with ${word} on its first line under 40 columns`,
      {},
      async (_world, $) => {
        const ui = await mountReply($, `> [!${kind}]\n> ${body}`, 'terminal', 30)
        expect(await shapeOf(ui, 30)).toEqual([`● ▌ ${word}`, `  ▌ ${body}`])
        expect(new Set((await looksOf(ui, /▌/)).map((look) => look.color))).toEqual(new Set([key]))
        expect(await looksOf(ui, new RegExp(`^${word}$`))).toEqual([{ color: key }])
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'the Warning alert of mock 15.1d wraps its body inside a box of 38 at 40 columns',
    {},
    async (_world, $) => {
      const reply = '> [!WARNING]\n> Do not raise pool_size above max_connections on tanks-db.'
      const ui = await mountReply($, reply, 'terminal', 40)
      expect(await shapeOf(ui, 40)).toEqual([
        '● ╭─ Warning ──────────────────────────╮',
        '  │ Do not raise pool_size above       │',
        '  │ max_connections on tanks-db.       │',
        '  ╰────────────────────────────────────╯',
      ])
      await ui.unmount()
    },
  )

  sceneTest(
    'a long alert body wraps inside the box at 80 columns, and an alert with no body draws its edges and its word',
    {},
    async (_world, $) => {
      const reply = [
        '> [!WARNING]',
        '> Do not raise pool_size above max_connections on tanks-db, because every new connection takes memory.',
        '',
        '> [!NOTE]',
      ].join('\n')
      const ui = await mountReply($, reply, 'terminal')
      const drawn = await shapeOf(ui)
      expect(drawn).toEqual([
        `● ${edgeLine('╭', 'Warning', 78)}`,
        `  │ ${'Do not raise pool_size above max_connections on tanks-db, because every'.padEnd(74)} │`,
        `  │ ${'new connection takes memory.'.padEnd(74)} │`,
        `  ╰${'─'.repeat(76)}╯`,
        '',
        `  ${edgeLine('╭', 'Note', 78)}`,
        `  ╰${'─'.repeat(76)}╯`,
      ])
      expect(wider(drawn, 80)).toEqual([])
      await ui.unmount()
    },
  )
})

describe('links (handily-36bsx.2)', () => {
  sceneTest(
    'a link whose text differs from its address is a Link with its host after it in dim, and the host drops a user and a password',
    {},
    async (_world, $) => {
      const reply = [
        'See [the deploy run](https://ci.example.com/runs/812) now.',
        'Mail [the owner](mailto:db@example.com) or [x](https://user:pass@x.example/a).',
        'Open [https://ci.example.com](https://ci.example.com) too.',
      ].join('\n')
      const ui = await mountReply($, reply, 'terminal')
      expect(await shapeOf(ui)).toEqual([
        '● See the deploy run (ci.example.com) now.',
        '  Mail the owner (db@example.com) or x (x.example).',
        '  Open https://ci.example.com too.',
      ])
      const links = nodesOf(await ui.drawn()).filter((node) => node.type === 'Link')
      expect(links.map((node) => [node.props?.href, inline(node)])).toEqual([
        ['https://ci.example.com/runs/812', '^_the deploy run_^'],
        ['mailto:db@example.com', '^_the owner_^'],
        ['https://user:pass@x.example/a', '^_x_^'],
        ['https://ci.example.com', '^_https://ci.example.com_^'],
      ])
      expect(await looksOf(ui, /^ \(/)).toEqual([
        { dimColor: true },
        { dimColor: true },
        { dimColor: true },
      ])
      await ui.unmount()
    },
  )

  sceneTest(
    'a javascript: or data: address draws as text and then the address, and is not a Link',
    {},
    async (_world, $) => {
      const reply = 'The link [x](javascript:alert(1)) and [y](data:text/html,hi) draw as text.'
      const ui = await mountReply($, reply, 'terminal')
      expect(await shapeOf(ui)).toEqual([
        '● The link x (javascript:alert(1)) and y (data:text/html,hi) draw as text.',
      ])
      expect(nodesOf(await ui.drawn()).filter((node) => node.type === 'Link')).toEqual([])
      expect(await markdownTexts(ui)).toEqual([])
      await ui.unmount()
    },
  )

  sceneTest(
    'a link with a title, an image and a reference link go to the engine Markdown',
    {},
    async (_world, $) => {
      const text = 'A [t](https://x.example "title") and ![i](a.png) and [r][ref].'
      const ui = await mountReply($, text, 'terminal')
      expect(await markdownTexts(ui)).toEqual([text])
      await ui.unmount()
    },
  )
})

const EVERY_BLOCK = [
  '# Ingest timeouts',
  '',
  'At v2.3.1 a/b.md took 2 s.',
  '',
  '- 3 timeouts',
  '  - [x] fixed it',
  '  - [ ] check 5 more',
  '  - [ ] add 1 alert',
  '',
  '> quoted 7 times',
  '',
  '> [!NOTE]',
  '> Read docs/a.md for 9 steps.',
].join('\n')

function withoutTokens(line: string): string {
  return line.replace(/=([^=]+)=/g, '$1').replace(/§([^§]+)§/g, '$1')
}

describe('highlight off (handily-36bsx.2)', () => {
  for (const columns of [80, 40, 30]) {
    sceneTest(
      `when highlight is off, headings, lists, task lists, quotes and alerts still draw as with it on at ${String(columns)} columns, and every line fits`,
      { options: { highlight: 'off' } },
      async (_world, $) => {
        const ui = await mountReply($, EVERY_BLOCK, 'terminal', columns)
        const off = await sketchOf(ui, columns)
        const shape = await shapeOf(ui, columns)
        expect(shape).toContain('    [✓] fixed it')
        expect(shape).toContain('  1 of 3 done')
        expect(shape.some((line) => line.includes('▌ quoted 7 times'))).toBe(true)
        expect(shape.filter((line) => /[╭▌] ?Note|─ Note/.test(line))).toHaveLength(1)
        expect(shape.filter((line) => line.includes('Ingest timeouts'))).toHaveLength(1)
        expect(off.join('\n')).not.toMatch(/=\d/)
        expect(await markdownTexts(ui)).toEqual([])
        expect(wider(shape, columns)).toEqual([])
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'the drawing with highlight off equals the drawing with it on, without the token colours',
    { options: { highlight: 'off' } },
    async (_world, $) => {
      const ui = await mountReply($, EVERY_BLOCK, 'terminal')
      const off = await sketchOf(ui)
      expect(off).toEqual(ON_EVERY_BLOCK.map(withoutTokens))
      await ui.unmount()
    },
  )

  sceneTest('the same drawing with highlight on', {}, async (_world, $) => {
    const ui = await mountReply($, EVERY_BLOCK, 'terminal')
    expect(await sketchOf(ui)).toEqual(ON_EVERY_BLOCK)
    await ui.unmount()
  })
})

const ON_EVERY_BLOCK = [
  '● @*╭─────────────────╮*@',
  '  @*│ *@@*Ingest timeouts*@@* │*@',
  '  @*╰─────────────────╯*@',
  '',
  '  At =v2.3.1= §a/b.md§ took =2= s.',
  '',
  '  °•° =3= timeouts',
  '    +[✓]+ ~!fixed it!~',
  '    °[ ]° check =5= more',
  '    °[ ]° add =1= alert',
  '  ~1 of 3 done~',
  '',
  '  °▌ °/quoted 7 times/',
  '',
  `  ^╭─ Note ${'─'.repeat(69)}╮^`,
  `  ^│ ^Read docs/a.md for 9 steps.^${' '.repeat(74 - 27)} │^`,
  `  ^╰${'─'.repeat(76)}╯^`,
]

const SIX_BOXES = [
  'The flow:',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[One] --> B[Two]',
  '  B --> C[Three]',
  '  C --> D[Four]',
  '  D --> E[Five]',
  '  E --> F[Six]',
  '  F --> G[Seven]',
  '```',
].join('\n')

describe('the diagram cycle (handily-36bsx.2)', () => {
  for (const [palette, theme, colours] of [
    [MOCHA, 'dark', ['#89b4fa', '#a6e3a1', '#f5c2e7', '#fab387', '#94e2d5', '#f9e2af', '#89b4fa']],
    [
      'theme',
      'dark',
      ['suggestion', 'planMode', 'merged', 'suggestion', 'planMode', 'merged', 'suggestion'],
    ],
    [
      MOCHA,
      'light',
      ['suggestion', 'planMode', 'merged', 'suggestion', 'planMode', 'merged', 'suggestion'],
    ],
  ] as const) {
    sceneTest(
      `with the palette ${palette} on a ${theme} theme the boxes of a diagram cycle ${String(new Set(colours).size)} colours`,
      { config: paletteRows(palette, theme) },
      async (_world, $) => {
        const ui = await mountReply($, SIX_BOXES, 'terminal', 120)
        const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
        const found = await Promise.all(
          names.map(async (name) => (await looksOf(ui, new RegExp(`\\b${name}\\b`))).at(0)?.color),
        )
        expect(found).toEqual(colours)
        await ui.unmount()
      },
    )
  }
})

const LONG_REPLY = [
  '# Report',
  '',
  ...Array.from({ length: 30 }, (_, index) => `- step ${String(index + 1)} ran`),
  '',
  '> [!NOTE]',
  '> All 30 steps ran.',
].join('\n')

describe('the desktop and copy (handily-36bsx.2)', () => {
  sceneTest(
    'on the desktop a short reply with headings, lists, quotes and alerts stays as Claude Code draws it',
    {},
    async (_world, $) => {
      const ui = await mountReply($, EVERY_BLOCK, 'desktop')
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      await ui.unmount()
    },
  )

  sceneTest(
    'on the desktop the prose blocks of a reply with a table go whole to the engine Markdown element',
    {},
    async (_world, $) => {
      const ui = await mountReply($, `${EVERY_BLOCK}\n\n| A |\n| --- |\n| 1 |`, 'desktop')
      expect(await markdownTexts(ui)).toEqual([EVERY_BLOCK])
      expect(nodesOf(await ui.drawn()).filter((node) => node.type === 'Link')).toEqual([])
      await ui.unmount()
    },
  )

  for (const surface of SURFACES) {
    sceneTest(
      `copy reply copies the reply as Claude wrote it on ${surface}`,
      {},
      async (world, $) => {
        const ui = await mountReply($, LONG_REPLY, surface)
        await ui.press({ key: 'copy-reply' })
        expect(world.copies).toEqual([LONG_REPLY])
        await ui.unmount()
      },
    )
  }
})
