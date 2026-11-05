import { describe, expect, test } from 'claude-code/testing'
import { drawFlowchart } from './hooks/flowchart'
import { parseMermaid } from './hooks/mermaid'
import { drawSequence } from './hooks/sequence'
import { displayWidth } from './hooks/width'
import {
  chartLinks,
  drawnLinks,
  drawnMessages,
  flowchartOf,
  generatedCharts,
  generatedSequences,
  groupedCharts,
  heldMessages,
  REPLY_COLUMNS,
  sequenceOf,
} from './fixtures/generated-diagrams'
import {
  componentCharts,
  drawnBoxes,
  drawnFrames,
  FRAME_BORDERS,
  frameTitle,
  NATURAL_COLUMNS,
  widthOf,
  WIDTH_FACTOR,
  withoutGroups,
} from './fixtures/component-charts'

const GENERATED_TIMEOUT_MS = 10000

describe('flowchart drawings', () => {
  test(
    '1000 generated charts draw only the links they hold',
    { timeoutMs: GENERATED_TIMEOUT_MS },
    () => {
      const drawn = generatedCharts(20261028, 1000).flatMap((source) => {
        const chart = flowchartOf(source)
        const result = drawFlowchart(chart, REPLY_COLUMNS)
        return result.kind === 'drawing' ? [[drawnLinks(result.lines), chartLinks(chart)]] : []
      })
      expect(drawn.length).toBeGreaterThan(900)
      expect(
        drawn.filter(([shown, held]) => JSON.stringify(shown) !== JSON.stringify(held)),
      ).toEqual([])
    },
  )

  test(
    '500 generated charts with subgraphs draw their frames and only the links they hold',
    { timeoutMs: GENERATED_TIMEOUT_MS },
    () => {
      const drawn = groupedCharts(20261105, 500).flatMap((source) => {
        const chart = flowchartOf(source)
        const result = drawFlowchart(chart, REPLY_COLUMNS)
        if (result.kind !== 'drawing') return []
        const framed = (chart.groups ?? []).every((group) =>
          result.lines.some((line) => line.includes(`┄ ${group.label.join(' ')} ┄`)),
        )
        return [[drawnLinks(result.lines), chartLinks(chart), framed]]
      })
      expect(drawn.length).toBeGreaterThan(450)
      expect(
        drawn.filter(
          ([shown, held, framed]) => JSON.stringify(shown) !== JSON.stringify(held) || !framed,
        ),
      ).toEqual([])
    },
  )

  test(
    '500 generated charts with subgraphs refuse only for their width or the order of their loops when they draw with no subgraph',
    { timeoutMs: GENERATED_TIMEOUT_MS },
    () => {
      const refused = groupedCharts(20261105, 500).flatMap((source) => {
        const chart = flowchartOf(source)
        const plain = { ...chart, groups: [] }
        if (drawFlowchart(plain, REPLY_COLUMNS).kind !== 'drawing') return []
        const result = drawFlowchart(chart, REPLY_COLUMNS)
        return result.kind === 'drawing' ? [] : [result.reason]
      })
      expect(
        refused.filter(
          (reason) =>
            !reason.startsWith('it takes ') &&
            reason !== 'its loops and its subgraphs cannot keep one order',
        ),
      ).toEqual([])
    },
  )
})

describe('sequence drawings', () => {
  test(
    '500 generated sequence diagrams draw each message between its own two lifelines',
    { timeoutMs: GENERATED_TIMEOUT_MS },
    () => {
      const drawn = generatedSequences(20261028, 500).flatMap((source) => {
        const diagram = sequenceOf(source)
        const result = drawSequence(diagram, REPLY_COLUMNS)
        return result.kind === 'drawing'
          ? [[drawnMessages(result.lines), heldMessages(diagram)]]
          : []
      })
      expect(drawn.length).toBeGreaterThan(400)
      expect(
        drawn.filter(([shown, held]) => JSON.stringify(shown) !== JSON.stringify(held)),
      ).toEqual([])
    },
  )
})

describe('subgraph frames', () => {
  test(
    '200 generated component diagrams draw at most 1.75 times as wide as with no subgraphs, plus 4 columns for each frame',
    { timeoutMs: GENERATED_TIMEOUT_MS },
    () => {
      const widths = componentCharts(20261105, 200).flatMap((source) => {
        const chart = parseMermaid(source)
        if (chart.kind !== 'flowchart') return []
        const framed = drawFlowchart(chart, NATURAL_COLUMNS)
        const bare = drawFlowchart(withoutGroups(chart), NATURAL_COLUMNS)
        if (bare.kind !== 'drawing') return []
        const bound =
          WIDTH_FACTOR * widthOf(bare.lines) + FRAME_BORDERS * (chart.groups ?? []).length
        const drawn = framed.kind === 'drawing' ? widthOf(framed.lines) : Infinity
        return [{ source, drawn, bound }]
      })
      expect(widths.length).toBeGreaterThan(190)
      expect(widths.filter(({ drawn, bound }) => drawn > bound)).toEqual([])
    },
  )

  test(
    'each frame of 300 generated component diagrams top down is no wider than its boxes in one row, its title and its borders',
    { timeoutMs: GENERATED_TIMEOUT_MS },
    () => {
      const frames = componentCharts(20261105, 300).flatMap((source) => {
        const chart = parseMermaid(source)
        if (chart.kind !== 'flowchart' || chart.direction !== 'TD') return []
        const drawn = drawFlowchart(chart, NATURAL_COLUMNS)
        if (drawn.kind !== 'drawing') return [{ source, width: Infinity, bound: 0 }]
        const boxes = drawnBoxes(drawn.lines)
        return drawnFrames(drawn.lines).map((frame) => {
          const inside = boxes.filter(
            (box) =>
              box.left > frame.left &&
              box.right < frame.right &&
              box.top > frame.top &&
              box.top < frame.bottom,
          )
          const row = inside.reduce((total, box) => total + box.right - box.left + 1 + 2, -2)
          const title = displayWidth(frameTitle(drawn.lines, frame)) + 2
          return { source, width: frame.right - frame.left + 1, bound: row + title + FRAME_BORDERS }
        })
      })
      expect(frames.length).toBeGreaterThan(300)
      expect(frames.filter(({ width, bound }) => width > bound)).toEqual([])
    },
  )
})
