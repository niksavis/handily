import type { ConfigRow, On, RenderPropsOf } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { replyTree, type ReplyElements } from './hooks/draw'
import { tokensOf, type Token } from './hooks/highlight'
import { blocksOf } from './hooks/markdown'
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
}
const MARK_CHARACTERS = /[@%=&§^°*_~/!]/g

type Surface = (typeof SURFACES)[number]

type World = {
  copies: string[]
  debugLogs: string[]
  config: ConfigRow[]
  pluginConfigs: unknown
}

type Options = Record<string, string>

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

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
  on('config.set', (_$, e) => {
    world.config = world.config.map((row) => (row.key === e.key ? { ...row, value: e.value } : row))
    return { value: e.value }
  })
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

type Scene = { options?: Options; config?: ConfigRow[]; pluginConfigs?: unknown }

type SceneBody = (world: World, $: Engine) => Promise<void>

function sceneTest(name: string, scene: Scene, body: SceneBody): void {
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

function inline(node: unknown): string {
  if (typeof node === 'string') return node
  if (!isNode(node)) return ''
  return marked(node.props ?? {}, (node.children ?? []).map(inline).join(''))
}

function plainWidth(line: string): number {
  return displayWidth(line.replace(MARK_CHARACTERS, ''))
}

function rowLines(children: readonly unknown[], width: number, gap: number): string[] {
  const grows = (child: unknown) => isNode(child) && Number(child.props?.flexGrow ?? 0) > 0
  const fixed = (child: unknown) =>
    isNode(child) && typeof child.props?.width === 'number' ? child.props.width : 0
  const left = (child: unknown) => (isNode(child) ? Number(child.props?.marginLeft ?? 0) : 0)
  const blocks = children.map((child) => (grows(child) ? null : lines(child, width)))
  const widths = blocks.map((block, index) =>
    block === null ? 0 : Math.max(0, fixed(children[index]), ...block.map(plainWidth)),
  )
  const used =
    widths.reduce((total, value, index) => total + value + left(children[index]), 0) +
    gap * Math.max(children.length - 1, 0)
  const filled = blocks.map((block, index) => {
    if (block !== null) return { lines: block, width: widths[index] ?? 0 }
    const child = children[index]
    const least = isNode(child) ? Number(child.props?.minWidth ?? 0) : 0
    const room = Math.max(least, width - used)
    const grown = lines(child, room)
    return { lines: grown.length === 0 ? [''] : grown, width: room }
  })
  const height = Math.max(0, ...filled.map((block) => block.lines.length))
  return Array.from({ length: height }, (_, row) =>
    filled
      .map((block, index) => {
        const text = block.lines[row] ?? ''
        const pad = ' '.repeat(Math.max(block.width - plainWidth(text), 0))
        return ' '.repeat(left(children[index])) + text + pad
      })
      .join(' '.repeat(gap))
      .trimEnd(),
  )
}

function boxLines(props: Record<string, unknown>, children: unknown[], width: number): string[] {
  const indent = Number(props.paddingLeft ?? 0)
  const inner = (typeof props.width === 'number' ? props.width : width) - indent
  const gap = Number(props.gap ?? 0)
  const flowed =
    props.flexDirection === 'column'
      ? children.flatMap((child, index) => [
          ...(index > 0 ? Array<string>(gap).fill('') : []),
          ...lines(child, inner),
        ])
      : rowLines(children, inner, gap)
  return flowed.map((line) => (line === '' ? line : ' '.repeat(indent) + line))
}

function lines(node: unknown, width: number): string[] {
  if (typeof node === 'string') return [node]
  if (!isNode(node)) return []
  const props = node.props ?? {}
  switch (node.type) {
    case 'Text':
      return [inline(node)]
    case 'Button':
      return [`[ ${String(props.label)} ]`]
    case 'Markdown':
      return String(props.text).split('\n')
    case 'Code':
      return String(props.source).split('\n')
    case 'Box':
      return boxLines(props, node.children ?? [], width)
    default:
      return []
  }
}

async function sketchOf(ui: { drawn: () => Promise<unknown> }, columns = 80): Promise<string[]> {
  return lines(await ui.drawn(), columns).map((line) => line.trimEnd())
}

function nodesOf(node: unknown): Node[] {
  if (!isNode(node)) return []
  return [node, ...(node.children ?? []).flatMap(nodesOf)]
}

function textsOf(node: unknown): Node[] {
  return nodesOf(node).filter((found) => found.type === 'Text')
}

function leafText(node: Node): string {
  return (node.children ?? []).map((child) => (typeof child === 'string' ? child : '')).join('')
}

async function colourOf(ui: { drawn: () => Promise<unknown> }, text: string): Promise<unknown> {
  const found = textsOf(await ui.drawn()).find((node) => leafText(node) === text)
  return found?.props?.color
}

async function coloursIn(ui: { drawn: () => Promise<unknown> }, pattern: RegExp) {
  const found = textsOf(await ui.drawn()).filter((node) => pattern.test(leafText(node)))
  return [...new Set(found.map((node) => node.props?.color))].sort()
}

function element(type: string) {
  return (props: Record<string, unknown>) => {
    const { children, ...rest } = props
    const list: unknown[] = children === undefined ? [] : [children].flat()
    return { type, props: rest, children: list.filter((child) => child !== null) }
  }
}

const SKETCHED = {
  Box: element('Box'),
  Text: element('Text'),
  Button: element('Button'),
  Markdown: element('Markdown'),
  Code: element('Code'),
} as unknown as ReplyElements

function treeLines(text: string, columns: number, highlight: boolean): string[] {
  const tree = replyTree(
    SKETCHED,
    text,
    blocksOf(text),
    {
      columns,
      hasBullet: true,
      isFirstOfReply: true,
      surface: 'terminal',
      drawsDiagrams: true,
      tableStyle: 'box',
      highlight,
      palette: 'theme',
    },
    'folded',
    { copy: () => undefined, fold: () => undefined },
  )
  return lines(tree, columns).map((line) => line.trimEnd())
}

function withoutTokenMarks(line: string): string {
  return line
    .replace(/=([^=]+)=/g, '$1')
    .replace(/§([^§]+)§/g, '$1')
    .replace(/&([^&]+)&/g, '$1')
}

function tokenTexts(text: string): [string, Token][] {
  return tokensOf(text).map((span) => [text.slice(span.start, span.end), span.token])
}

const P1_PROSE = [
  'The gate ran `npm run check` over 9 mods in 3m 12s. handily-board 0.19.0',
  'passed 1,204 tests; docs/mocks.md gained section 14 at 14:05. p95 fell from',
  '46 ms to 2 s, and the x86_64 build kept utf8 and sha256 in ./scripts/mods.mjs.',
]

const P1_TABLE = [
  '| Mod | Tests | Gate | Next |',
  '| --- | --: | --- | --- |',
  '| handily-board | 212 | pass | frames, see design |',
  '| reply-view | 98 | fail | npm test exits 1 |',
  '| filetree | 1,024 | pass | v0.13.0 in 3m 12s |',
]

const P1 = [...P1_PROSE, '', ...P1_TABLE].join('\n')

const P1_PROSE_DRAWN = [
  '● The gate ran &npm run check& over =9= mods in =3m= =12s=. handily-board =0.19.0=',
  '  passed =1,204= tests; §docs/mocks.md§ gained section =14= at =14:05=. p95 fell from',
  '  =46= ms to =2= s, and the x86_64 build kept utf8 and sha256 in §./scripts/mods.mjs§.',
]

const P1_PROSE_PLAIN = [
  '● The gate ran npm run check over 9 mods in 3m 12s. handily-board 0.19.0',
  '  passed 1,204 tests; docs/mocks.md gained section 14 at 14:05. p95 fell from',
  '  46 ms to 2 s, and the x86_64 build kept utf8 and sha256 in ./scripts/mods.mjs.',
]

const P1_BOX = [
  '  %┌───────────────┬───────┬──────┬────────────────────┐%',
  '  %│% @*Mod*@           %│% @*Tests*@ %│% @*Gate*@ %│% @*Next*@               %│%',
  '  %╞═══════════════╪═══════╪══════╪════════════════════╡%',
  '  %│% handily-board %│%   =212= %│% pass %│% frames, see design %│%',
  '  %├───────────────┼───────┼──────┼────────────────────┤%',
  '  %│% reply-view    %│%    =98= %│% fail %│% npm test exits =1=   %│%',
  '  %├───────────────┼───────┼──────┼────────────────────┤%',
  '  %│% filetree      %│% =1,024= %│% pass %│% =v0.13.0= in =3m= =12s=  %│%',
  '  %└───────────────┴───────┴──────┴────────────────────┘%',
  `${' '.repeat(30)}[ copy ] [ copy as text ]`,
]

const P1_RULES_DESKTOP = [
  '@*Mod*@           %│% @*Tests*@ %│% @*Gate*@ %│% @*Next*@  [ copy ] [ copy as text ]',
  '%══════════════╪═══════╪══════╪═══════════════════%',
  'handily-board %│%   =212= %│% pass %│% frames, see design',
  'reply-view    %│%    =98= %│% fail %│% npm test exits =1=',
  'filetree      %│% =1,024= %│% pass %│% =v0.13.0= in =3m= =12s=',
]

const P1_TEXT_COPY = [
  'Mod: handily-board',
  'Tests: 212',
  'Gate: pass',
  'Next: frames, see design',
  '',
  'Mod: reply-view',
  'Tests: 98',
  'Gate: fail',
  'Next: npm test exits 1',
  '',
  'Mod: filetree',
  'Tests: 1,024',
  'Gate: pass',
  'Next: v0.13.0 in 3m 12s',
].join('\n')

const NEGATIVES = [
  'p95',
  'x86_64',
  'utf8',
  'sha256',
  'opus-5-5',
  '695ce64',
  '#123',
  'and/or',
  '1/2',
  'https://x.y/z',
] as const

const DIAGRAM = [
  'The flow:',
  '',
  '```mermaid',
  'flowchart LR',
  '  A([Prompt]) --> B[Reply]',
  '  B --> C{Table?}',
  '  C -->|yes| D[Columns]',
  '```',
].join('\n')

describe('the token rules of mocks 14.5', () => {
  test('the prose of mock P1 holds the numbers, durations, versions and paths that P1 colours, and no other token', () => {
    expect(tokenTexts(P1_PROSE.join('\n'))).toEqual([
      ['9', 'number'],
      ['3m', 'number'],
      ['12s', 'number'],
      ['0.19.0', 'number'],
      ['1,204', 'number'],
      ['docs/mocks.md', 'path'],
      ['14', 'number'],
      ['14:05', 'number'],
      ['46', 'number'],
      ['2', 'number'],
      ['./scripts/mods.mjs', 'path'],
    ])
  })

  for (const negative of NEGATIVES) {
    test(`${negative} is no token, while 46 and docs/a.md in the same text are`, () => {
      expect(tokenTexts(`kept ${negative} beside 46 and docs/a.md.`)).toEqual([
        ['46', 'number'],
        ['docs/a.md', 'path'],
      ])
    })
  }

  test('numbers take thousands commas, one decimal part, a sign at a boundary and a % or x suffix', () => {
    expect(tokenTexts('1,204 3.14 -3 +5 95% 2x 1,20 1.2.3.x 2nd #a6e3a1 a-3')).toEqual([
      ['1,204', 'number'],
      ['3.14', 'number'],
      ['-3', 'number'],
      ['+5', 'number'],
      ['95%', 'number'],
      ['2x', 'number'],
    ])
  })

  test('durations, clock times, versions, ranges and dates are one token each', () => {
    expect(
      tokenTexts('46ms 1h30m 3m12s 2min 14:05 0:15 v2.1 0.14.0 1.0.0-rc.1 1-5 2026-10-29 3–4 v2'),
    ).toEqual([
      ['46ms', 'number'],
      ['1h30m', 'number'],
      ['3m12s', 'number'],
      ['2min', 'number'],
      ['14:05', 'number'],
      ['0:15', 'number'],
      ['v2.1', 'number'],
      ['0.14.0', 'number'],
      ['1.0.0-rc.1', 'number'],
      ['1-5', 'number'],
      ['2026-10-29', 'number'],
      ['3–4', 'number'],
    ])
  })

  test('a path needs a leading /, ./, ../ or ~/, a trailing / or an extension, and a letter', () => {
    expect(
      tokenTexts(
        '/tmp ./a ../b ~/c src/ docs/mocks.md I/O TCP/IP 24/7 src/gen README.md 1/2.5 https://x.y/a.md http://x.y/',
      ),
    ).toEqual([
      ['/tmp', 'path'],
      ['./a', 'path'],
      ['../b', 'path'],
      ['~/c', 'path'],
      ['src/', 'path'],
      ['docs/mocks.md', 'path'],
    ])
  })

  test('a token starts after ( [ " or a quote and ends before closing marks that a space or the end follows', () => {
    expect(tokenTexts('(3m) [v2.1], "docs/a.md"; \'14:05\'! 1,204?! f(3) 3.14.')).toEqual([
      ['3m', 'number'],
      ['v2.1', 'number'],
      ['docs/a.md', 'path'],
      ['14:05', 'number'],
      ['1,204', 'number'],
      ['3.14', 'number'],
    ])
  })
})

describe('box tables by default', () => {
  for (const surface of SURFACES) {
    sceneTest(
      `when tableStyle is unset, mock P1 draws its table in box style with a rule between every row on the terminal and in rules on the desktop on ${surface}`,
      {},
      async (world, $) => {
        const ui = await mountReply($, P1, surface)
        const drawn = await sketchOf(ui)
        if (surface === 'terminal') expect(drawn).toEqual([...P1_PROSE_DRAWN, '', ...P1_BOX])
        else expect(drawn.slice(4)).toEqual(P1_RULES_DESKTOP)
        expect(world.debugLogs).toEqual([])
        await ui.unmount()
      },
    )

    sceneTest(
      `a table with no data rows draws a box as mock P2 on ${surface}`,
      {},
      async (_world, $) => {
        const ui = await mountReply(
          $,
          'The columns of the report:\n\n| Mod | Tests | Gate | Next |\n| --- | --- | --- | --- |',
          surface,
        )
        const drawn = await sketchOf(ui)
        if (surface === 'terminal') {
          expect(drawn).toEqual([
            '● The columns of the report:',
            '',
            '  %┌─────┬───────┬──────┬──────┐%',
            '  %│% @*Mod*@ %│% @*Tests*@ %│% @*Gate*@ %│% @*Next*@ %│%',
            '  %└─────┴───────┴──────┴──────┘%',
            `${' '.repeat(23)}[ copy ]`,
          ])
        } else {
          expect(drawn.slice(2)).toEqual([
            '@*Mod*@ %│% @*Tests*@ %│% @*Gate*@ %│% @*Next*@  [ copy ]',
            '%════╪═══════╪══════╪═════%',
          ])
        }
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'at 40 columns the box of mock P3 fits, and a wider table draws blocks',
    {},
    async (_world, $) => {
      const reply = [
        '3 mods passed in 3m 12s:',
        '',
        '| Mod | Tests | Gate |',
        '| --- | --: | --- |',
        '| board | 212 | pass |',
        '| filetree | 1,024 | pass |',
      ].join('\n')
      const ui = await mountReply($, reply, 'terminal', 40)
      expect(await sketchOf(ui, 40)).toEqual([
        '● =3= mods passed in =3m= =12s=:',
        '',
        '  %┌──────────┬───────┬──────┐%',
        '  %│% @*Mod*@      %│% @*Tests*@ %│% @*Gate*@ %│%',
        '  %╞══════════╪═══════╪══════╡%',
        '  %│% board    %│%   =212= %│% pass %│%',
        '  %├──────────┼───────┼──────┤%',
        '  %│% filetree %│% =1,024= %│% pass %│%',
        '  %└──────────┴───────┴──────┘%',
        '    [ copy ] [ copy as text ]',
      ])
      await ui.unmount()
    },
  )

  for (const columns of [80, 40, 30]) {
    sceneTest(
      `every line of the mock P1 table fits ${String(columns)} columns`,
      {},
      async (_world, $) => {
        const ui = await mountReply($, P1_TABLE.join('\n'), 'terminal', columns)
        const drawn = await sketchOf(ui, columns)
        expect(drawn.filter((line) => plainWidth(line) > columns)).toEqual([])
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'a stored table style outside the options draws the box and the debug log names the value',
    {
      options: { tableStyle: 'grid' },
      pluginConfigs: { 'handily-reply-view@niksavis': { options: { tableStyle: 'grid' } } },
    },
    async (world, $) => {
      const ui = await mountReply($, P1, 'terminal')
      expect((await sketchOf(ui)).slice(4)).toEqual(P1_BOX)
      expect(world.debugLogs).toEqual([
        'handily-reply-view: userConfig tableStyle is "grid"; set it to rules or box in /config. Drawing box.',
      ])
      await ui.unmount()
    },
  )
})

describe('prose highlighting', () => {
  sceneTest(
    'when highlight is on, a short reply with no table draws in reply-view with the numbers, paths and inline code of mock P1 in three colours',
    {},
    async (_world, $) => {
      const ui = await mountReply($, P1_PROSE.join('\n'), 'terminal')
      expect(await sketchOf(ui)).toEqual(P1_PROSE_DRAWN)
      expect(await ui.findAll({ type: 'Markdown' })).toEqual([])
      expect((await coloursIn(ui, /./)).filter((colour) => colour !== undefined)).toEqual([
        'merged',
        'permission',
        'planMode',
      ])
      await ui.unmount()
    },
  )

  sceneTest(
    'list items draw their marker as written and highlight their text, and a nested item keeps its indent',
    {},
    async (_world, $) => {
      const reply = [
        'Steps:',
        '',
        '- ran 9 checks in 3m 12s',
        '  - read docs/mocks.md',
        '1. bumped to v0.13.0',
        '2. **kept** p95 and *utf8* and ~~x86_64~~',
      ].join('\n')
      const ui = await mountReply($, reply, 'terminal')
      expect(await sketchOf(ui)).toEqual([
        '● Steps:',
        '',
        '  - ran =9= checks in =3m= =12s=',
        '    - read §docs/mocks.md§',
        '  1. bumped to =v0.13.0=',
        '  2. *kept* p95 and /utf8/ and !x86_64!',
      ])
      await ui.unmount()
    },
  )

  for (const [columns, continuedLead] of [
    [80, 20],
    [40, 19],
    [30, 14],
  ] as const) {
    sceneTest(
      `a nested list item at ${String(columns)} columns keeps its marker apart from its text, and a deep indent stops at half the body width`,
      {},
      async (_world, $) => {
        const reply = [
          '- top',
          '  - mid',
          '    - low',
          '      - a deeply nested item that wraps at 3 s in docs/mocks.md',
          `${' '.repeat(20)}continued for 5 s`,
        ].join('\n')
        const ui = await mountReply($, reply, 'terminal', columns)
        const nodes = nodesOf(await ui.drawn())
        const rowOf = (key: string) => nodes.find((node) => node.props?.key === key)
        const [lead, text] = (rowOf('line-3')?.children ?? []) as Node[]
        expect(lead?.props).toEqual({ width: 8, flexShrink: 0 })
        expect(text?.props).toEqual({ flexShrink: 1 })
        expect(inline((text?.children ?? [])[0])).toBe(
          'a deeply nested item that wraps at =3= s in §docs/mocks.md§',
        )
        const [continued] = (rowOf('line-4')?.children ?? []) as Node[]
        expect(continued?.props).toEqual({ width: continuedLead, flexShrink: 0 })
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'headings, quotes, links, footnotes and HTML keep the engine Markdown element, and the paragraphs around them highlight',
    {},
    async (_world, $) => {
      const reply = [
        '# Results 2026',
        '',
        'See [the run](https://ci.example/runs/4) for 3 s.',
        '',
        '> a quote of 5 lines',
        'that continues',
        '',
        'A note[^1] and <b>8</b> tags.',
        '',
        'plain 7 in src/a.ts',
      ].join('\n')
      const ui = await mountReply($, reply, 'terminal')
      const markdown = await ui.findAll({ type: 'Markdown' })
      expect(markdown.map((found) => found.props.text)).toEqual([
        [
          '# Results 2026',
          '',
          'See [the run](https://ci.example/runs/4) for 3 s.',
          '',
          '> a quote of 5 lines',
          'that continues',
          '',
          'A note[^1] and <b>8</b> tags.',
        ].join('\n'),
      ])
      expect((await sketchOf(ui)).at(-1)).toBe('  plain =7= in §src/a.ts§')
      await ui.unmount()
    },
  )

  for (const negative of NEGATIVES) {
    sceneTest(
      `${negative} draws plain in a paragraph, a list item and a cell, while 46 and docs/a.md beside it draw in their colours`,
      {},
      async (_world, $) => {
        const line = `kept ${negative} beside 46 and docs/a.md`
        const reply = [line, '', `- ${line}`, '', '| A |', '| --- |', `| ${line} |`].join('\n')
        const ui = await mountReply($, reply, 'terminal')
        const drawn = await sketchOf(ui)
        const shown = `kept ${negative} beside =46= and §docs/a.md§`
        expect(drawn.slice(0, 3)).toEqual([`● ${shown}`, '', `  - ${shown}`])
        expect(drawn.filter((line) => line.includes('beside'))).toHaveLength(3)
        expect(drawn.find((line) => line.includes('│') && line.includes('beside'))).toContain(shown)
        await ui.unmount()
      },
    )
  }
})

describe('highlight off', () => {
  for (const surface of SURFACES) {
    sceneTest(
      `when highlight is off, reply-view still draws mock P1 and leaves out only the token colours on ${surface}`,
      { options: { highlight: 'off' } },
      async (world, $) => {
        const ui = await mountReply($, P1, surface)
        const drawn = await sketchOf(ui)
        const plain = (line: string) => line.replace(/=([^=]+)=/g, '$1').replace(/§([^§]+)§/g, '$1')
        if (surface === 'terminal') {
          expect(drawn).toEqual([...P1_PROSE_PLAIN, '', ...P1_BOX.map(plain)])
        } else {
          expect(drawn.slice(4)).toEqual(P1_RULES_DESKTOP.map(plain))
        }
        expect(await coloursIn(ui, /\d|docs|npm/)).toEqual([undefined])
        expect(world.debugLogs).toEqual([])
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'when highlight is off, a short reply with no table still draws in reply-view on the terminal',
    { options: { highlight: 'off' } },
    async (_world, $) => {
      const ui = await mountReply($, P1_PROSE.join('\n'), 'terminal')
      expect(await ui.drawn()).not.toEqual(ENGINE_ROW)
      expect(await sketchOf(ui)).toEqual(P1_PROSE_PLAIN)
      await ui.unmount()
    },
  )

  for (const columns of [80, 40, 30]) {
    test(`the highlight changes no width and no line of mock P1 at ${String(columns)} columns`, () => {
      const on = treeLines(P1, columns, true)
      const off = treeLines(P1, columns, false)
      expect(on.join('\n')).toMatch(/=1,204=/)
      expect(off.join('\n')).not.toMatch(/=1,204=/)
      expect(on.map(withoutTokenMarks)).toEqual(off)
      expect(on.map(plainWidth)).toEqual(off.map(plainWidth))
    })
  }

  sceneTest(
    'a stored highlight outside the options highlights and the debug log names the value',
    {
      options: { highlight: 'loud' },
      pluginConfigs: { 'handily-reply-view': { options: { highlight: 'loud' } } },
    },
    async (world, $) => {
      const ui = await mountReply($, P1_PROSE.join('\n'), 'terminal')
      expect(await sketchOf(ui)).toEqual(P1_PROSE_DRAWN)
      expect(world.debugLogs).toEqual([
        'handily-reply-view: userConfig highlight is "loud"; set it to on or off in /config. Highlight stays on.',
      ])
      await ui.unmount()
    },
  )
})

describe('the palette', () => {
  for (const surface of SURFACES) {
    sceneTest(
      `catppuccin-mocha on a dark theme draws the hex values of mocks 14.4 on the terminal and the theme keys on the desktop on ${surface}`,
      { config: paletteRows(MOCHA, 'dark') },
      async (_world, $) => {
        const reply = [
          'Run `npm test` on docs/mocks.md for 3 s.',
          '',
          '| Mod | Tests | Link |',
          '| --- | --: | --- |',
          '| board | 212 | [design](docs/design.md) |',
        ].join('\n')
        const ui = await mountReply($, reply, surface)
        const isMocha = surface === 'terminal'
        expect({
          header: await colourOf(ui, 'Mod'),
          rule: (await coloursIn(ui, /^[│┌╞═─]+$/)).at(0),
          number: await colourOf(ui, '212'),
          code: isMocha ? await colourOf(ui, 'npm test') : 'permission',
          link: await colourOf(ui, 'design'),
          path: isMocha ? await colourOf(ui, 'docs/mocks.md') : 'merged',
        }).toEqual(
          isMocha
            ? {
                header: '#f9e2af',
                rule: '#585b70',
                number: '#a6e3a1',
                code: '#89dceb',
                link: '#89b4fa',
                path: '#cba6f7',
              }
            : {
                header: 'claude',
                rule: 'subtle',
                number: 'planMode',
                code: 'permission',
                link: 'suggestion',
                path: 'merged',
              },
        )
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'catppuccin-mocha on a dark theme draws the diagram lines, labels, heads and the three cycle colours in their hex values',
    { config: paletteRows(MOCHA, 'dark') },
    async (_world, $) => {
      const ui = await mountReply($, DIAGRAM, 'terminal')
      expect({
        line: await colourOf(ui, '──'),
        heads: await coloursIn(ui, /^▶$/),
        label: await colourOf(ui, 'yes'),
        boxes: await coloursIn(ui, /Prompt|Reply|Table|Columns/),
        all: await coloursIn(ui, /^[^\s]*[─│▶][^\s]*$/),
      }).toEqual({
        line: '#9399b2',
        heads: ['#cba6f7'],
        label: '#9399b2',
        boxes: ['#89b4fa', '#a6e3a1', '#f5c2e7'],
        all: ['#89b4fa', '#9399b2', '#a6e3a1', '#cba6f7', '#f5c2e7'],
      })
      await ui.unmount()
    },
  )

  for (const [theme, colour] of [
    ['light', 'claude'],
    ['dark-ansi', 'claude'],
    ['auto', '#f9e2af'],
  ] as const) {
    sceneTest(
      `catppuccin-mocha under the theme ${theme} draws the table header in ${colour}`,
      { config: paletteRows(MOCHA, theme) },
      async (_world, $) => {
        const ui = await mountReply($, P1, 'terminal')
        expect(await colourOf(ui, 'Mod')).toBe(colour)
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'the palette theme draws the theme keys, and a change to catppuccin-mocha draws the reply again in the hex values',
    { config: paletteRows('theme', 'dark') },
    async (_world, $) => {
      const ui = await mountReply($, P1, 'terminal')
      expect(await colourOf(ui, '212')).toBe('planMode')
      await $.config.set({
        key: 'handily.palette',
        value: MOCHA,
        previous: 'theme',
        provider: { plugin: 'handily@niksavis', tier: 'user' },
        origin: { kind: 'composer' },
      })
      expect(await colourOf(ui, '212')).toBe('#a6e3a1')
      await ui.unmount()
    },
  )

  sceneTest(
    'a stored palette outside the options draws the theme keys and the debug log names the value',
    { config: paletteRows('mocha', 'dark') },
    async (world, $) => {
      const ui = await mountReply($, P1, 'terminal')
      expect(await colourOf(ui, '212')).toBe('planMode')
      expect(world.debugLogs).toEqual([
        'handily: userConfig palette is "mocha"; set it to theme or catppuccin-mocha in /config. Drawing theme.',
      ])
      await ui.unmount()
    },
  )
})

describe('desktop tables', () => {
  for (const tableStyle of ['box', 'rules', undefined]) {
    sceneTest(
      `on the desktop a table draws in the rules style when tableStyle is ${String(tableStyle)}`,
      { options: tableStyle === undefined ? {} : { tableStyle } },
      async (_world, $) => {
        const ui = await mountReply($, P1, 'desktop')
        expect((await sketchOf(ui)).slice(4)).toEqual(P1_RULES_DESKTOP)
        expect(await ui.findAll({ type: 'Text', text: /[┌╞├└]/ })).toEqual([])
        await ui.unmount()
      },
    )
  }
})

describe('copy with the highlight on and off', () => {
  for (const surface of SURFACES) {
    for (const highlight of ['on', 'off']) {
      sceneTest(
        `copy and copy as text copy the table source and its text with the highlight ${highlight} on ${surface}`,
        { options: { highlight } },
        async (world, $) => {
          const ui = await mountReply($, P1, surface)
          await ui.press({ key: 'block-1-copy' })
          await ui.press({ key: 'block-1-text' })
          expect(world.copies).toEqual([P1_TABLE.join('\n'), P1_TEXT_COPY])
          await ui.unmount()
        },
      )
    }
  }
})
