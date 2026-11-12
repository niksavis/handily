import { describe, expect, test, type Engine } from 'claude-code/testing'
import { displayWidth } from './hooks/width'
import {
  bodyLines,
  bodyOf,
  COLUMNS,
  diagramBlock,
  drawnTree,
  fenced,
  mountReply,
  rowOf,
  SCENES,
  sharedRowsOf,
  started,
  tableOf,
  together,
  treeOf,
  type Drawn,
  type Scene,
} from './fixtures/layout'
import { sketchOf } from './fixtures/sketch'

const FOLD_AFTER = 30
const NODES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const TALL_FLOW = flowchartOf(NODES)
const SHORT_FLOW = flowchartOf(NODES.slice(0, 3))
const TALL_SEQUENCE = [
  'sequenceDiagram',
  ...Array.from({ length: 20 }, (_, index) => `  A->>B: ping ${String(index + 1)}`),
].join('\n')
const TALL_TABLE = tableOf('x', 20)
const FORTY_ROW_TABLE = tableOf('x', 18)
const PROSE = proseOf(10)
const LONG_PROSE = proseOf(24)
const AFTER = '- After 1\n- After 2'

function proseOf(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `- Line ${String(index + 1)}`).join('\n')
}

function flowchartOf(nodes: readonly string[]): string {
  return [
    'flowchart TD',
    ...nodes
      .slice(1)
      .map(
        (node, index) =>
          `  N${String(index)}[${nodes[index] ?? ''}] --> N${String(index + 1)}[${node}]`,
      ),
  ].join('\n')
}

function drawnOf(lines: readonly string[]): Drawn {
  return { lines: [...lines], width: Math.max(...lines.map(displayWidth)) }
}

function folded(lines: readonly string[]): { preview: string[]; fold: string } {
  return { preview: lines.slice(0, -1), fold: lines.at(-1) ?? '' }
}

async function openedLines($: Engine, text: string, scene: Scene): Promise<string[]> {
  const ui = await mountReply($, text)
  await ui.press({ key: 'fold' })
  const lines = bodyOf(sketchOf(await ui.drawn(), COLUMNS), scene)
  await ui.press({ key: 'fold' })
  await ui.unmount()
  return lines.slice(1, -2)
}

async function wholeTable($: Engine, table: string, scene: Scene): Promise<Drawn> {
  return drawnOf(await openedLines($, table, scene))
}

async function cutAlone($: Engine, text: string, scene: Scene): Promise<string[]> {
  return folded(await bodyLines($, text, scene)).preview
}

describe('a folded reply cuts a shared row like a stack', () => {
  for (const scene of SCENES) {
    test(
      `a reply that starts with a shared row taller than 30 rows shows each block cut at row 30, not an empty preview, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await wholeTable($, TALL_TABLE, scene)
        const diagram = diagramBlock(TALL_FLOW, scene.room)
        expect(table.lines.length).toBeGreaterThan(FOLD_AFTER)
        expect(diagram.lines.length).toBeGreaterThan(FOLD_AFTER)
        const text = together(TALL_TABLE, fenced('mermaid', TALL_FLOW))
        expect(sharedRowsOf(await drawnTree($, text))).toHaveLength(1)
        const tableCut = await cutAlone($, TALL_TABLE, scene)
        const shown = folded(await bodyLines($, text, scene))
        expect(shown.preview).toEqual(
          rowOf([
            { lines: tableCut, width: table.width },
            { lines: diagram.lines.slice(0, FOLD_AFTER), width: diagram.width },
          ]),
        )
        expect(shown.preview).toHaveLength(FOLD_AFTER)
        const hidden = table.lines.length - FOLD_AFTER
        expect(shown.fold.startsWith(`… flowchart, ${String(hidden)} more rows`)).toBe(true)
      },
    )

    test(
      `a shared row that crosses row 30 shows the blocks before it and each block of the row cut at the same row, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await wholeTable($, TALL_TABLE, scene)
        const diagram = diagramBlock(TALL_FLOW, scene.room)
        const stacked = await cutAlone($, together(PROSE, TALL_TABLE), scene)
        const before = stacked.slice(0, 11)
        expect(before.at(-1)).toBe('')
        const budget = FOLD_AFTER - before.length
        expect(diagram.lines.length).toBeGreaterThan(budget)
        expect(table.lines.length).toBeGreaterThan(budget)
        const text = together(PROSE, TALL_TABLE, fenced('mermaid', TALL_FLOW))
        expect(sharedRowsOf(await drawnTree($, text))).toHaveLength(1)
        const shown = folded(await bodyLines($, text, scene))
        expect(shown.preview).toEqual([
          ...before,
          ...rowOf([
            { lines: stacked.slice(before.length), width: table.width },
            { lines: diagram.lines.slice(0, budget), width: diagram.width },
          ]),
        ])
        expect(shown.preview).toHaveLength(FOLD_AFTER)
      },
    )

    test(
      `a 40-row table beside a 12-row flowchart after 10 rows of prose folds with 21 more lines counted from the table, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await wholeTable($, FORTY_ROW_TABLE, scene)
        const diagram = diagramBlock(SHORT_FLOW, scene.room)
        expect(table.lines).toHaveLength(40)
        expect(diagram.lines).toHaveLength(12)
        const stacked = await cutAlone($, together(PROSE, FORTY_ROW_TABLE), scene)
        const before = stacked.slice(0, 11)
        const text = together(PROSE, FORTY_ROW_TABLE, fenced('mermaid', SHORT_FLOW))
        expect(sharedRowsOf(await drawnTree($, text))).toHaveLength(1)
        const shown = folded(await bodyLines($, text, scene))
        expect(shown.preview).toEqual([
          ...before,
          ...rowOf([{ lines: stacked.slice(before.length), width: table.width }, diagram]),
        ])
        const hidden = before.length + table.lines.length - FOLD_AFTER
        expect(hidden).toBe(21)
        expect(shown.fold.startsWith(`… ${String(hidden)} more lines`)).toBe(true)
      },
    )

    test(
      `the fold row names a cut diagram of a shared row and counts its rows from the tallest block, then the lines after the row, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await wholeTable($, TALL_TABLE, scene)
        const diagram = diagramBlock(TALL_FLOW, scene.room)
        expect(table.lines.length).toBeGreaterThan(diagram.lines.length)
        const text = together(TALL_TABLE, fenced('mermaid', TALL_FLOW), AFTER)
        expect(sharedRowsOf(await drawnTree($, text))).toHaveLength(1)
        const shown = folded(await bodyLines($, text, scene))
        const rowRows = table.lines.length - FOLD_AFTER
        expect(
          shown.fold.startsWith(`… flowchart, ${String(rowRows)} more rows, then 3 more lines`),
        ).toBe(true)
      },
    )

    test(
      `of two cut diagrams in a shared row the fold row names the first in reading order, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const flow = diagramBlock(TALL_FLOW, scene.room)
        const sequence = diagramBlock(TALL_SEQUENCE, scene.room)
        expect(flow.lines.length).toBeGreaterThan(FOLD_AFTER)
        expect(sequence.lines.length).toBeGreaterThan(flow.lines.length)
        const hidden = sequence.lines.length - FOLD_AFTER
        const flowFirst = together(fenced('mermaid', TALL_FLOW), fenced('mermaid', TALL_SEQUENCE))
        const sequenceFirst = together(
          fenced('mermaid', TALL_SEQUENCE),
          fenced('mermaid', TALL_FLOW),
        )
        expect(sharedRowsOf(await drawnTree($, flowFirst))).toHaveLength(1)
        expect(sharedRowsOf(await drawnTree($, sequenceFirst))).toHaveLength(1)
        expect(
          folded(await bodyLines($, flowFirst, scene)).fold.startsWith(
            `… flowchart, ${String(hidden)} more rows`,
          ),
        ).toBe(true)
        expect(
          folded(await bodyLines($, sequenceFirst, scene)).fold.startsWith(
            `… sequence diagram, ${String(hidden)} more rows`,
          ),
        ).toBe(true)
      },
    )

    test(
      `when a diagram of a shared row cannot be cut that short the preview ends above the row, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await wholeTable($, TALL_TABLE, scene)
        const stacked = await cutAlone($, together(LONG_PROSE, TALL_TABLE), scene)
        const above = stacked.slice(0, 24)
        expect(stacked[24]).toBe('')
        expect(stacked).toHaveLength(FOLD_AFTER)
        const text = together(LONG_PROSE, TALL_TABLE, fenced('mermaid', TALL_FLOW))
        const shown = folded(await bodyLines($, text, scene))
        expect(shown.preview).toEqual(above)
        expect(sharedRowsOf(await drawnTree($, text))).toEqual([])
        const hidden = 1 + table.lines.length
        expect(shown.fold.startsWith(`… ${String(hidden)} more lines`)).toBe(true)
      },
    )

    test(
      `the unfolded view shows the whole shared row, ${scene.name}`,
      { options: scene.options },
      async ($, on) => {
        await started($, on)
        const table = await wholeTable($, TALL_TABLE, scene)
        const diagram = diagramBlock(TALL_FLOW, scene.room)
        const text = together(TALL_TABLE, fenced('mermaid', TALL_FLOW))
        expect(await openedLines($, text, scene)).toEqual(rowOf([table, diagram]))
      },
    )
  }

  test('on the desktop a folded reply with a tall pair draws the same tree with sideBySide on and off', () => {
    const desktop = { hasBullet: false, surface: 'desktop' } as const
    for (const text of [
      together(TALL_TABLE, fenced('mermaid', TALL_FLOW)),
      together(PROSE, FORTY_ROW_TABLE, fenced('mermaid', SHORT_FLOW)),
    ]) {
      expect(treeOf(text, { ...desktop, sideBySide: 'on' })).toBe(
        treeOf(text, { ...desktop, sideBySide: 'off' }),
      )
    }
  })

  test('on the desktop a folded reply with a tall pair draws no shared row', async ($, on) => {
    await started($, on, { surface: 'desktop' })
    const text = together(TALL_TABLE, fenced('mermaid', TALL_FLOW))
    expect(sharedRowsOf(await drawnTree($, text, 'desktop'))).toEqual([])
  })
})
