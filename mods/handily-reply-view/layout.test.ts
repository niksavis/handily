import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { diagramOf, replyTree, type ReplyElements, type ReplyLayout } from './hooks/draw'
import { blocksOf } from './hooks/markdown'
import { displayWidth } from './hooks/width'
import {
  isDrawnNode,
  nodesOf,
  padded,
  sketchOf,
  textStrings,
  type DrawnNode,
} from './fixtures/sketch'

const COLUMNS = 120
const GAP = '   '
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const FORBIDDEN_CONTROLS = /[\p{Cc}\p{Cf}]/u
const ALLOWED_CONTROLS = /[\t\n]/gu
const TABLE_SIDES = '│  │'.length
const DIAGRAM_BUTTONS = '[ copy ] [ copy drawing ]'
const BUTTONS_GAP = 2
const FLOW_HEAD = '── mermaid · flowchart '
const FLOW_SOURCE = 'flowchart LR\n  A[ingest] --> B[store]'
const REFUSED_SOURCE = 'flowchart RL\n  A --> B'
const CHART_SOURCE = 'pie title Pets\n  "Dogs" : 3\n  "Cats" : 2'
const CODE_SOURCE = 'const total = rows.length\nprint(total)'
const SETTING_LOG =
  'handily-reply-view: userConfig sideBySide is "wide"; set it to on or off in /config. Side by side stays on.'

type Surface = 'terminal' | 'desktop'

type Scene = { name: string; room: number; options: Record<string, string>; isFramed: boolean }

const SCENES: readonly Scene[] = [
  { name: 'without the frame', room: COLUMNS - 2, options: {}, isFramed: false },
  {
    name: 'with the frame',
    room: COLUMNS - 4,
    options: { replyStyle: 'frame' },
    isFramed: true,
  },
]

type World = { copies: string[]; debugLogs: string[] }

type Start = { pluginConfigs?: unknown; surface?: Surface }

type Drawn = { lines: string[]; width: number }

function engineBeneath(on: On, start: Start): World {
  const world: World = { copies: [], debugLogs: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.messages', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: [start.surface ?? 'terminal'] }))
  on('config.list', () => ({ value: [] }))
  on('settings.read', () => ({
    value: start.pluginConfigs === undefined ? {} : { pluginConfigs: start.pluginConfigs },
  }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
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

async function started($: Engine, on: On, start: Start = {}): Promise<World> {
  const world = engineBeneath(on, start)
  await $.session.start({
    cwd: '/work/app',
    surface: start.surface ?? 'terminal',
    isInteractive: true,
  })
  return world
}

function reply(text: string): RenderPropsOf['AssistantMessage'] {
  return { text, isFirstOfReply: true }
}

async function mountReply($: Engine, text: string, surface: Surface = 'terminal') {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: reply(text),
    requestId: 'message-1',
    viewport: { columns: COLUMNS, rows: 40 },
  })
}

async function drawnTree($: Engine, text: string, surface: Surface = 'terminal') {
  const ui = await mountReply($, text, surface)
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

function bodyOf(lines: readonly string[], scene: Scene): string[] {
  const body = scene.isFramed
    ? lines.slice(1, -1).map((line) => line.slice(2, -2).trimEnd())
    : lines.map((line) => line.slice(2).trimEnd())
  return body
}

async function bodyLines($: Engine, text: string, scene: Scene): Promise<string[]> {
  return bodyOf(sketchOf(await drawnTree($, text), COLUMNS), scene)
}

async function stackedBlock($: Engine, text: string, scene: Scene): Promise<Drawn> {
  const lines = await bodyLines($, text, scene)
  return { lines, width: Math.max(...lines.map(displayWidth)) }
}

async function stackedBlocks($: Engine, texts: readonly string[], scene: Scene) {
  const shown: Drawn[] = []
  for (const text of texts) shown.push(await stackedBlock($, text, scene))
  return shown
}

function tableOf(cell: string, rows = 1): string {
  return [
    '| Name |',
    '| --- |',
    ...Array.from({ length: rows }, (_, index) => `| ${index === 0 ? cell : 'x'} |`),
  ].join('\n')
}

function tableWide(width: number, letter: string): string {
  return tableOf(letter.repeat(width - TABLE_SIDES))
}

function fenced(tag: string, source: string): string {
  return ['```' + tag, source, '```'].join('\n')
}

function together(...blocks: string[]): string {
  return blocks.join('\n\n')
}

function rowOf(blocks: readonly Drawn[]): string[] {
  const height = Math.max(...blocks.map((block) => block.lines.length))
  return Array.from({ length: height }, (_, row) =>
    blocks
      .map((block, index) =>
        index === blocks.length - 1
          ? (block.lines[row] ?? '')
          : padded(block.lines[row] ?? '', block.width),
      )
      .join(GAP)
      .trimEnd(),
  )
}

function stackOf(blocks: readonly Drawn[]): string[] {
  return blocks.flatMap((block, index) => (index === 0 ? block.lines : ['', ...block.lines]))
}

function flowDrawing(room: number): string[] {
  const outcome = diagramOf(FLOW_SOURCE, room, 'terminal')
  if (outcome.kind !== 'drawing') throw new Error('the flowchart did not draw')
  return outcome.lines.map((line) => line.trimEnd())
}

function flowBlock(room: number): Drawn {
  const drawing = flowDrawing(room)
  const titleLeast = displayWidth(`${FLOW_HEAD}──`) + BUTTONS_GAP + displayWidth(DIAGRAM_BUTTONS)
  const width = Math.max(titleLeast, ...drawing.map(displayWidth))
  const rule = '─'.repeat(
    width - BUTTONS_GAP - displayWidth(DIAGRAM_BUTTONS) - displayWidth(FLOW_HEAD),
  )
  const title = `${FLOW_HEAD}${rule}${' '.repeat(BUTTONS_GAP)}${DIAGRAM_BUTTONS}`
  return { lines: [title, ...drawing], width }
}

function sharedRowsOf(tree: unknown): DrawnNode[] {
  return nodesOf(tree).filter(
    (node) => node.type === 'Box' && node.props?.flexDirection === 'row' && node.props.gap === 3,
  )
}

function cellWidths(row: DrawnNode): unknown[] {
  return (row.children ?? []).map((cell) => (isDrawnNode(cell) ? cell.props?.width : undefined))
}

function cellShrinks(row: DrawnNode): unknown[] {
  return (row.children ?? []).map((cell) =>
    isDrawnNode(cell) ? cell.props?.flexShrink : undefined,
  )
}

function controlsIn(tree: unknown): string[] {
  return textStrings(tree).filter((shown) =>
    FORBIDDEN_CONTROLS.test(shown.replaceAll(ALLOWED_CONTROLS, '')),
  )
}

async function replyEnds($: Engine, answer: string): Promise<void> {
  await $.turn.complete({
    answer,
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
}

async function commandText($: Engine, args: string): Promise<string> {
  const result = await $.command.run({
    command: 'replies',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: COLUMNS },
  })
  return result.text ?? ''
}

function fakeElement(type: string) {
  return (props: Record<string, unknown>) => {
    const { children, ...rest } = props
    return { type, props: rest, children: children === undefined ? [] : [children].flat() }
  }
}

const FAKE_ELEMENTS = {
  Box: fakeElement('Box'),
  Text: fakeElement('Text'),
  Button: fakeElement('Button'),
  Markdown: fakeElement('Markdown'),
  Code: fakeElement('Code'),
  Link: fakeElement('Link'),
} as unknown as ReplyElements

function treeOf(text: string, layout: Partial<ReplyLayout>): string {
  return JSON.stringify(
    replyTree(
      FAKE_ELEMENTS,
      text,
      blocksOf(text),
      {
        columns: COLUMNS,
        hasBullet: true,
        isFirstOfReply: true,
        surface: 'terminal',
        drawsDiagrams: true,
        tableStyle: 'box',
        headingStyle: 'banner',
        doneGlyph: '✓',
        highlight: true,
        palette: 'theme',
        ...layout,
      },
      'folded',
      { copy: () => undefined, fold: () => undefined },
    ),
  )
}

describe('blocks that fit share a row', () => {
  for (const scene of SCENES) {
    test(
      `two tables whose widths and 3 columns fill the room of ${String(scene.room)} share a row with tops aligned, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const left = tableWide(50, 'a')
        const right = tableWide(scene.room - 50 - GAP.length, 'b')
        const shownLeft = await stackedBlock($, left, scene)
        const shownRight = await stackedBlock($, right, scene)
        expect(shownLeft.width + GAP.length + shownRight.width).toBe(scene.room)
        expect(await bodyLines($, together(left, right), scene)).toEqual(
          rowOf([shownLeft, shownRight]),
        )
        const rows = sharedRowsOf(await drawnTree($, together(left, right)))
        expect(rows).toHaveLength(1)
        const [row] = rows
        if (row === undefined) return
        expect(cellWidths(row)).toEqual([shownLeft.width, shownRight.width])
        expect(cellShrinks(row)).toEqual([0, 0])
      },
    )

    test(
      `two tables one column wider than the room of ${String(scene.room)} draw the second on a new row, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const left = tableWide(50, 'a')
        const right = tableWide(scene.room - 50 - GAP.length + 1, 'b')
        const shownLeft = await stackedBlock($, left, scene)
        const shownRight = await stackedBlock($, right, scene)
        expect(shownLeft.width + GAP.length + shownRight.width).toBe(scene.room + 1)
        expect(await bodyLines($, together(left, right), scene)).toEqual(
          stackOf([shownLeft, shownRight]),
        )
        expect(sharedRowsOf(await drawnTree($, together(left, right)))).toEqual([])
      },
    )

    test(
      `a table and a drawn diagram that fill the room of ${String(scene.room)} share a row and one column more stacks them, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const diagram = flowBlock(scene.room)
        const fence = fenced('mermaid', FLOW_SOURCE)
        const fits = tableWide(scene.room - GAP.length - diagram.width, 'a')
        const shownTable = await stackedBlock($, fits, scene)
        expect(shownTable.width + GAP.length + diagram.width).toBe(scene.room)
        expect(await bodyLines($, together(fits, fence), scene)).toEqual(
          rowOf([shownTable, diagram]),
        )
        const over = tableWide(scene.room - GAP.length - diagram.width + 1, 'a')
        const shownOver = await stackedBlock($, over, scene)
        expect(await bodyLines($, together(over, fence), scene)).toEqual([
          ...shownOver.lines,
          '',
          ...(await bodyLines($, fence, scene)),
        ])
      },
    )

    test(
      `three tables of which only two fit draw the third on a new row, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const first = tableWide(40, 'a')
        const second = tableWide(scene.room - 40 - GAP.length, 'b')
        const third = tableWide(30, 'c')
        const shown = await stackedBlocks($, [first, second, third], scene)
        const [one, two, three] = shown
        if (one === undefined || two === undefined || three === undefined) return
        expect(await bodyLines($, together(first, second, third), scene)).toEqual([
          ...rowOf([one, two]),
          '',
          ...three.lines,
        ])
      },
    )
  }

  test('three tables that fit together share one row', async ($, on) => {
    const scene = SCENES[0]
    if (scene === undefined) return
    await started($, on)
    const texts = [tableWide(30, 'a'), tableWide(30, 'b'), tableWide(30, 'c')]
    const shown = await stackedBlocks($, texts, scene)
    expect(await bodyLines($, together(...texts), scene)).toEqual(rowOf(shown))
  })

  test(
    'tables with rules between their columns share a row as box tables do',
    { options: { tableStyle: 'rules' } },
    async ($, on) => {
      const scene = SCENES[0]
      if (scene === undefined) return
      await started($, on)
      const texts = [
        '| Hour | p95 | Errs |\n| --- | --- | --- |\n| 11:00 | 45 | 0 |',
        '| Mod | Gate |\n| --- | --- |\n| board | green |',
      ]
      const shown = await stackedBlocks($, texts, scene)
      expect(await bodyLines($, together(...texts), scene)).toEqual(rowOf(shown))
    },
  )
})

describe('blocks that stay stacked', () => {
  const scene = SCENES[0] as Scene
  const table = tableWide(30, 'a')

  test('one word of prose between two tables that fit stacks them', async ($, on) => {
    await started($, on)
    const other = tableWide(30, 'b')
    const text = [table, '', 'then', '', other].join('\n')
    const shownTable = await stackedBlock($, table, scene)
    const shownOther = await stackedBlock($, other, scene)
    expect(await bodyLines($, text, scene)).toEqual([
      ...shownTable.lines,
      '',
      'then',
      '',
      ...shownOther.lines,
    ])
  })

  for (const [name, block] of [
    ['a code fence', fenced('ts', CODE_SOURCE)],
    ['a refused diagram', fenced('mermaid', REFUSED_SOURCE)],
    ['a chart', fenced('mermaid', CHART_SOURCE)],
  ] as const) {
    test(`${name} next to a table stacks`, async ($, on) => {
      await started($, on)
      expect(diagramOf(REFUSED_SOURCE, scene.room, 'terminal').kind).toBe('refused')
      const shownTable = await stackedBlock($, table, scene)
      const shownBlock = await bodyLines($, block, scene)
      expect(await bodyLines($, together(table, block), scene)).toEqual([
        ...shownTable.lines,
        '',
        ...shownBlock,
      ])
      expect(sharedRowsOf(await drawnTree($, together(block, table)))).toEqual([])
    })
  }

  test(
    'a diagram with drawing off next to a table stacks',
    { options: { diagrams: 'off' } },
    async ($, on) => {
      await started($, on)
      const fence = fenced('mermaid', FLOW_SOURCE)
      const shownTable = await stackedBlock($, table, scene)
      expect(await bodyLines($, together(table, fence), scene)).toEqual([
        ...shownTable.lines,
        '',
        ...(await bodyLines($, fence, scene)),
      ])
    },
  )
})

describe('the sideBySide setting', () => {
  const scene = SCENES[0] as Scene
  const pair = together(tableWide(40, 'a'), fenced('mermaid', FLOW_SOURCE))

  test(
    'sideBySide off draws two tables that fit one under the other',
    { options: { sideBySide: 'off' } },
    async ($, on) => {
      await started($, on)
      const left = tableWide(50, 'a')
      const right = tableWide(30, 'b')
      const shownLeft = await stackedBlock($, left, scene)
      const shownRight = await stackedBlock($, right, scene)
      expect(await bodyLines($, together(left, right), scene)).toEqual(
        stackOf([shownLeft, shownRight]),
      )
      expect(sharedRowsOf(await drawnTree($, pair))).toEqual([])
    },
  )

  test('with no sideBySide setting two blocks that fit share a row', async ($, on) => {
    await started($, on)
    expect(sharedRowsOf(await drawnTree($, pair))).toHaveLength(1)
  })

  test(
    'sideBySide on draws the same tree as no sideBySide setting',
    { options: { sideBySide: 'on' } },
    async ($, on) => {
      await started($, on)
      expect(sharedRowsOf(await drawnTree($, pair))).toHaveLength(1)
      expect(treeOf(pair, { sideBySide: 'on' })).toBe(treeOf(pair, {}))
      expect(treeOf(pair, { sideBySide: 'off' })).not.toBe(treeOf(pair, {}))
    },
  )

  test('on the desktop the tree with sideBySide on equals the tree with it off', () => {
    const desktop = { hasBullet: false, surface: 'desktop' } as const
    expect(treeOf(pair, { ...desktop, sideBySide: 'on' })).toBe(
      treeOf(pair, { ...desktop, sideBySide: 'off' }),
    )
  })

  test(
    'on the desktop two blocks that fit draw no shared row',
    { options: { sideBySide: 'on' } },
    async ($, on) => {
      await started($, on, { surface: 'desktop' })
      expect(sharedRowsOf(await drawnTree($, pair, 'desktop'))).toEqual([])
    },
  )

  test(
    'a stored sideBySide outside the options shares a row as on does and the debug log names the value and the options',
    { options: { sideBySide: 'wide' } },
    async ($, on) => {
      const world = await started($, on, {
        pluginConfigs: { 'handily-reply-view': { options: { sideBySide: 'wide' } } },
      })
      expect(world.debugLogs).toContain(SETTING_LOG)
      expect(sharedRowsOf(await drawnTree($, pair))).toHaveLength(1)
    },
  )
})

describe('a shared row in a folded reply', () => {
  const scene = SCENES[0] as Scene

  test('the fold counts a shared row as its tallest block', async ($, on) => {
    await started($, on)
    const short = tableOf('x')
    const tall = tableOf('y', 3)
    const list = Array.from({ length: 30 }, (_, index) => `- Line ${String(index + 1)}`)
    const text = ['Intro.', '', short, '', tall, '', ...list].join('\n')
    const shortRows = (await stackedBlock($, short, scene)).lines.length
    const tallRows = (await stackedBlock($, tall, scene)).lines.length
    expect(tallRows).toBeGreaterThan(shortRows)
    const total = 1 + 1 + tallRows + 1 + list.length
    const lines = await bodyLines($, text, scene)
    expect(lines.some((line) => line.startsWith(`… ${String(total - 30)} more lines`))).toBe(true)
    expect(sharedRowsOf(await drawnTree($, text))).toHaveLength(1)
  })
})

describe('copy of a shared row', () => {
  test('the buttons and /replies copy give each block of a shared row as its own markdown in reading order', async ($, on) => {
    const world = await started($, on)
    const table = tableWide(40, 'a')
    const text = together('The numbers, then the shape:', table, fenced('mermaid', FLOW_SOURCE))
    const ui = await mountReply($, text)
    expect(sharedRowsOf(await ui.drawn())).toHaveLength(1)
    await ui.press({ key: 'block-1-copy' })
    await ui.press({ key: 'block-2-copy' })
    await ui.unmount()
    await replyEnds($, text)
    expect(await commandText($, 'copy table')).toBe('')
    expect(await commandText($, 'copy diagram')).toBe('')
    expect(await commandText($, 'copy reply')).toBe('')
    expect(world.copies).toEqual([table, FLOW_SOURCE, table, FLOW_SOURCE, text])
    expect(text.indexOf(table)).toBeLessThan(text.indexOf(FLOW_SOURCE))
    expect(world.copies.filter((copy) => copy.includes(GAP + '│'))).toEqual([])
  })
})

describe('the text of a shared row', () => {
  for (const scene of SCENES) {
    test(
      `no Text of a shared row holds a control character other than tab or newline, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const texts = [
          together(tableWide(40, 'a'), fenced('mermaid', FLOW_SOURCE)),
          together(tableWide(30, 'a'), tableWide(30, 'b'), tableWide(30, 'c')),
        ]
        for (const text of texts) {
          const tree = await drawnTree($, text)
          expect(sharedRowsOf(tree)).toHaveLength(1)
          expect(controlsIn(tree)).toEqual([])
        }
      },
    )
  }
})
