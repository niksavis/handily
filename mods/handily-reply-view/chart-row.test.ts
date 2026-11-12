import { describe, expect, test, type Engine } from 'claude-code/testing'
import { diagramOf } from './hooks/draw'
import { displayWidth } from './hooks/width'
import {
  bodyLines,
  bodyOf,
  COLUMNS,
  diagramBlock,
  drawnTree,
  fenced,
  GAP,
  mountReply,
  rowOf,
  SCENES,
  scenesAt,
  sharedRowsOf,
  stackedBlock,
  started,
  tableOf,
  together,
  treeOf,
  type Drawn,
  type Scene,
} from './fixtures/layout'
import { isDrawnNode, nodesOf, sketchOf, type DrawnNode } from './fixtures/sketch'

const FOLD_AFTER = 30
const TITLE_WIDTH = 52
const TITLE_LINE = '── mermaid · bar chart ──  [ copy ] [ copy drawing ]'
const INTRO = 'The numbers, then the shape:'
const TABLE_SIDES = '│  │'.length
const HOURS_TABLE = [
  '| Hour | p95 | Errs |',
  '| --- | ---: | ---: |',
  '| 11:00 | 45 | 0 |',
  '| 14:00 | 2,029 | 14 |',
  '| 15:00 | 2,032 | 18 |',
].join('\n')
const BAR_CHART = [
  'xychart-beta horizontal',
  '  title "p95 by hour (ms)"',
  '  x-axis [11:00, 14:00, 15:00]',
  '  bar [45, 2029, 2032]',
].join('\n')
const HOURS = Array.from({ length: 40 }, (_, index) => `h${String(index + 10)}`)
const TALL_CHART = [
  'xychart-beta horizontal',
  '  title "p95 by hour (ms)"',
  `  x-axis [${HOURS.join(', ')}]`,
  `  bar [${HOURS.map((_, index) => String(index + 1)).join(', ')}]`,
].join('\n')
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'one', 'two', 'six']
const WIDE_LINE = [
  'xychart-beta',
  `  x-axis [${DAYS.join(', ')}]`,
  '  line [45, 47, 46, 2029, 2032, 2007, 1500, 1200, 900, 700]',
].join('\n')
const FLOW_SOURCE = 'flowchart LR\n  A[ingest] --> B[store]'
const TALL_TABLE = tableOf('x', 16)
const MOCK_REPLY = together(INTRO, HOURS_TABLE, fenced('mermaid', BAR_CHART))

function chartBlock(source: string, width: number): Drawn {
  return diagramBlock(source, 'bar chart', width)
}

function tableWide(width: number, letter: string): string {
  return tableOf(letter.repeat(width - TABLE_SIDES))
}

function cellWidths(row: DrawnNode): unknown[] {
  return (row.children ?? []).map((cell) => (isDrawnNode(cell) ? cell.props?.width : undefined))
}

function folded(lines: readonly string[]): { preview: string[]; fold: string } {
  return { preview: lines.slice(0, -1), fold: lines.at(-1) ?? '' }
}

async function wholeTable($: Engine, table: string, scene: Scene): Promise<Drawn> {
  const ui = await mountReply($, table)
  await ui.press({ key: 'fold' })
  const lines = bodyOf(sketchOf(await ui.drawn(), COLUMNS), scene).slice(1, -2)
  await ui.press({ key: 'fold' })
  await ui.unmount()
  return { lines, width: Math.max(...lines.map(displayWidth)) }
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

describe('a chart shares a row at its title width', () => {
  for (const scene of SCENES) {
    test(
      `a bar chart after a table at 120 columns draws beside the table at its title width of 52 columns with its buttons, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await stackedBlock($, HOURS_TABLE, scene)
        const chart = chartBlock(BAR_CHART, TITLE_WIDTH)
        expect(chart.width).toBe(TITLE_WIDTH)
        expect(chart.lines[0]).toBe(TITLE_LINE)
        expect(await bodyLines($, MOCK_REPLY, scene)).toEqual([INTRO, '', ...rowOf([table, chart])])
        const rows = sharedRowsOf(await drawnTree($, MOCK_REPLY))
        expect(rows).toHaveLength(1)
        const [row] = rows
        if (row === undefined) return
        expect(cellWidths(row)).toEqual([table.width, TITLE_WIDTH])
      },
    )

    test(
      `a bar chart beside a flowchart shares a row at its title width, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const flow = diagramBlock(FLOW_SOURCE, 'flowchart', scene.room)
        const chart = chartBlock(BAR_CHART, TITLE_WIDTH)
        const text = together(fenced('mermaid', FLOW_SOURCE), fenced('mermaid', BAR_CHART))
        expect(await bodyLines($, text, scene)).toEqual(rowOf([flow, chart]))
      },
    )

    test(
      `a table and a chart that fill the room of ${String(scene.room)} share a row and one column more draws the chart stacked on a new row, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const fence = fenced('mermaid', BAR_CHART)
        const chart = chartBlock(BAR_CHART, TITLE_WIDTH)
        const fits = tableWide(scene.room - GAP.length - TITLE_WIDTH, 'a')
        const shownFits = await stackedBlock($, fits, scene)
        expect(shownFits.width + GAP.length + TITLE_WIDTH).toBe(scene.room)
        expect(await bodyLines($, together(fits, fence), scene)).toEqual(rowOf([shownFits, chart]))
        const over = tableWide(scene.room - GAP.length - TITLE_WIDTH + 1, 'a')
        const shownOver = await stackedBlock($, over, scene)
        const stackedChart = await bodyLines($, fence, scene)
        expect(stackedChart).toEqual(chartBlock(BAR_CHART, scene.room).lines)
        expect(await bodyLines($, together(over, fence), scene)).toEqual([
          ...shownOver.lines,
          '',
          ...stackedChart,
        ])
        expect(sharedRowsOf(await drawnTree($, together(over, fence)))).toEqual([])
      },
    )

    test(
      `a tall chart beside a tall table in a folded reply is cut at row 30 with the table and the fold row names the chart, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await wholeTable($, TALL_TABLE, scene)
        const chart = chartBlock(TALL_CHART, TITLE_WIDTH)
        expect(table.lines.length).toBeGreaterThan(FOLD_AFTER)
        expect(chart.lines.length).toBeGreaterThan(table.lines.length)
        const tableCut = folded(await bodyLines($, TALL_TABLE, scene)).preview
        const text = together(TALL_TABLE, fenced('mermaid', TALL_CHART))
        expect(sharedRowsOf(await drawnTree($, text))).toHaveLength(1)
        const shown = folded(await bodyLines($, text, scene))
        expect(shown.preview).toEqual(
          rowOf([
            { lines: tableCut, width: table.width },
            { lines: chart.lines.slice(0, FOLD_AFTER), width: chart.width },
          ]),
        )
        const hidden = chart.lines.length - FOLD_AFTER
        expect(shown.fold.startsWith(`… bar chart, ${String(hidden)} more rows`)).toBe(true)
      },
    )
  }

  for (const scene of scenesAt(80)) {
    test(
      `the same reply at 80 columns draws the chart under the table at the full room as mock 15.8b, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await stackedBlock($, HOURS_TABLE, scene)
        const chart = chartBlock(BAR_CHART, scene.room)
        expect(chart.width).toBe(scene.room)
        expect(table.width + GAP.length + TITLE_WIDTH).toBeGreaterThan(scene.room)
        expect(await bodyLines($, MOCK_REPLY, scene)).toEqual([
          INTRO,
          '',
          ...table.lines,
          '',
          ...chart.lines,
        ])
        expect(sharedRowsOf(await drawnTree($, MOCK_REPLY, 'terminal', scene.columns))).toEqual([])
      },
    )
  }

  test('a line chart that draws as lines when stacked and as bars at its title width stays stacked', async ($, on) => {
    const scene = SCENES[0] as Scene
    await started($, on)
    const stacked = diagramOf(WIDE_LINE, scene.room, 'terminal')
    const narrow = diagramOf(WIDE_LINE, TITLE_WIDTH, 'terminal')
    expect(stacked.kind === 'drawing' ? stacked.shape : null).toBe('upright')
    expect(narrow.kind === 'drawing' ? narrow.shape : null).toBe('across')
    const table = tableWide(20, 'a')
    const fence = fenced('mermaid', WIDE_LINE)
    expect(await bodyLines($, together(table, fence), scene)).toEqual([
      ...(await bodyLines($, table, scene)),
      '',
      ...(await bodyLines($, fence, scene)),
    ])
    expect(sharedRowsOf(await drawnTree($, together(table, fence)))).toEqual([])
  })
})

describe('a chart in a shared row on the desktop and in copy', () => {
  test('on the desktop a table and a chart draw the same tree with sideBySide on and off, and the chart is the stacked code element', async ($, on) => {
    const desktop = { hasBullet: false, surface: 'desktop' } as const
    expect(treeOf(MOCK_REPLY, { sideBySide: 'on' })).not.toBe(
      treeOf(MOCK_REPLY, { sideBySide: 'off' }),
    )
    expect(treeOf(MOCK_REPLY, { ...desktop, sideBySide: 'on' })).toBe(
      treeOf(MOCK_REPLY, { ...desktop, sideBySide: 'off' }),
    )
    await started($, on, { surface: 'desktop' })
    const tree = await drawnTree($, MOCK_REPLY, 'desktop')
    expect(sharedRowsOf(tree)).toEqual([])
    const codes = nodesOf(tree).filter(
      (node) =>
        node.type === 'Code' &&
        typeof node.props?.source === 'string' &&
        node.props.source.startsWith('p95 by hour (ms)'),
    )
    expect(codes).toHaveLength(1)
  })

  test('the copy button and /replies copy chart of a chart in a shared row give the chart source', async ($, on) => {
    const world = await started($, on)
    const narrow = diagramOf(BAR_CHART, TITLE_WIDTH, 'terminal')
    if (narrow.kind !== 'drawing') throw new Error('the chart did not draw at its title width')
    const ui = await mountReply($, MOCK_REPLY)
    expect(sharedRowsOf(await ui.drawn())).toHaveLength(1)
    await ui.press({ key: 'block-2-copy' })
    await ui.press({ key: 'block-2-drawing' })
    await ui.unmount()
    await replyEnds($, MOCK_REPLY)
    expect(await commandText($, 'copy chart')).toBe('')
    expect(world.copies).toEqual([BAR_CHART, narrow.lines.join('\n'), BAR_CHART])
  })
})
