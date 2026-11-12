import { describe, expect, test, type Engine } from 'claude-code/testing'
import { diagramOf } from './hooks/draw'
import {
  bodyLines,
  COLUMNS,
  diagramBlock,
  drawnTree,
  fenced,
  GAP,
  mountReply,
  rowOf,
  SCENES,
  sharedRowsOf,
  stackedBlock,
  started,
  tableOf,
  together,
  treeOf,
  type Drawn,
  type Scene,
} from './fixtures/layout'
import { isDrawnNode, textStrings, type DrawnNode } from './fixtures/sketch'

const FORBIDDEN_CONTROLS = /[\p{Cc}\p{Cf}]/u
const ALLOWED_CONTROLS = /[\t\n]/gu
const TABLE_SIDES = '│  │'.length
const FLOW_SOURCE = 'flowchart LR\n  A[ingest] --> B[store]'
const REFUSED_SOURCE = 'flowchart RL\n  A --> B'
const CODE_SOURCE = 'const total = rows.length\nprint(total)'
const SETTING_LOG =
  'handily-reply-view: userConfig sideBySide is "wide"; set it to on or off in /config. Side by side stays on.'

async function stackedBlocks($: Engine, texts: readonly string[], scene: Scene) {
  const shown: Drawn[] = []
  for (const text of texts) shown.push(await stackedBlock($, text, scene))
  return shown
}

function tableWide(width: number, letter: string): string {
  return tableOf(letter.repeat(width - TABLE_SIDES))
}

function stackOf(blocks: readonly Drawn[]): string[] {
  return blocks.flatMap((block, index) => (index === 0 ? block.lines : ['', ...block.lines]))
}

function flowBlock(room: number): Drawn {
  return diagramBlock(FLOW_SOURCE, 'flowchart', room)
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
