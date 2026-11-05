import { describe, expect, test } from 'claude-code/testing'
import {
  CYCLE,
  drawnRows,
  lines,
  mountDiagram,
  noteOf,
  rowText,
  shownSource,
  SURFACES,
  titleOf,
  tooWideNote,
  tooWideRows,
  viewTest,
  WIDTHS,
} from './fixtures/diagram-view'
import { diagramOf } from './hooks/draw'
import { parseMermaid } from './hooks/mermaid'

const CAMPAIGNS = lines(
  'quadrantChart',
  '    title Reach and engagement of campaigns',
  '    x-axis Low Reach --> High Reach',
  '    y-axis Low Engagement --> High Engagement',
  '    quadrant-1 We should expand',
  '    quadrant-2 Need to promote',
  '    quadrant-3 Re-evaluate',
  '    quadrant-4 May be improved',
  '    Campaign A: [0.3, 0.6]',
  '    Campaign B: [0.45, 0.23]',
  '    Campaign C: [0.57, 0.69]',
  '    Campaign D: [0.78, 0.34]',
  '    Campaign E: [0.40, 0.34]',
  '    Campaign F: [0.35, 0.78]',
)

const EMPTY_ROW = `│${' '.repeat(37)}│${' '.repeat(37)}│`

const CAMPAIGN_ROWS = [
  'Reach and engagement of campaigns',
  '▲ High Engagement',
  `┌${'─'.repeat(10)} Need to promote ${'─'.repeat(10)}┬${'─'.repeat(9)} We should expand ${'─'.repeat(10)}┐`,
  EMPTY_ROW,
  EMPTY_ROW,
  `│              Campaign F ●           │${' '.repeat(37)}│`,
  `│${' '.repeat(37)}│     ● Campaign C                    │`,
  `│                      ● Campaign A   │${' '.repeat(37)}│`,
  EMPTY_ROW,
  `├${'─'.repeat(12)} Re-evaluate ${'─'.repeat(12)}┼${'─'.repeat(10)} May be improved ${'─'.repeat(10)}┤`,
  EMPTY_ROW,
  '│                  Campaign E ●       │                    ● Campaign D     │',
  EMPTY_ROW,
  `│                      Campaign B ●   │${' '.repeat(37)}│`,
  EMPTY_ROW,
  EMPTY_ROW,
  `└${'─'.repeat(37)}┴${'─'.repeat(37)}┘`,
  '▼ Low Engagement',
  `◀ Low Reach${' '.repeat(54)}High Reach ▶`,
]

const NAMES = ['Campaign A', 'Campaign B', 'Campaign C', 'Campaign D', 'Campaign E', 'Campaign F']

const MATRIX = lines(
  'quadrantChart',
  '  x-axis Urgent --> Not Urgent',
  '  y-axis Not Important --> "Important ❤"',
  '  quadrant-1 Plan',
  '  quadrant-2 Do',
  '  quadrant-3 Delegate',
  '  quadrant-4 Delete',
)

const CROWD = lines(
  'quadrantChart',
  ...Array.from({ length: 36 }, (_, at) => `  P${String(at)}: [0.5, 0.5]`),
)

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function refusedLine(line: number | null, reason: string) {
  return { kind: 'refused', reason, line, limit: null }
}

describe('a mermaid quadrant chart', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a quadrant chart draws its points in four framed quadrants and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, CAMPAIGNS, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(NAMES.filter((name) => !rows.some((row) => row.includes(name)))).toEqual([])
          expect(rows.slice(0, 2)).toEqual(
            columns === 30
              ? ['Reach and engagement of', 'campaigns']
              : ['Reach and engagement of campaigns', '▲ High Engagement'],
          )
          expect(rows.filter((row) => /^[┌├└]/.test(row))).toHaveLength(3)
          if (surface === 'terminal' && columns === 80) expect(rows).toEqual(CAMPAIGN_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · quadrant ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn quadrant chart copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, MATRIX, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([MATRIX, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the quadrant source', '7 lines'],
          ['✓ Copied the quadrant drawing', '18 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      ['a header it does not know', lines('quadrantChart LR'), 'line 1 does not parse'],
      [
        'a point outside 0 to 1',
        lines('quadrantChart', '  Late: [1.5, 0.2]'),
        'line 2: 1.5 is not from 0 to 1',
      ],
      [
        'a point name with a bracket',
        lines('quadrantChart', '  Task (A): [0.5, 0.2]'),
        'line 2 does not parse',
      ],
      [
        'a style that Mermaid does not know',
        lines('quadrantChart', '  A: [0.5, 0.2] size: 3'),
        'line 2 does not parse',
      ],
      [
        'a markdown string',
        lines('quadrantChart', '  quadrant-1 "`**Plan**`"'),
        'markdown strings does not draw yet',
      ],
      ['more than 35 points', CROWD, '36 points, at most 35 draw'],
    ] as const) {
      viewTest(
        `a quadrant chart with ${what} shows its source under a note that names the reason on ${surface}`,
        async (world, $) => {
          const ui = await mountDiagram($, source, surface)
          expect(await noteOf(ui)).toBe(`diagram not drawn: ${note}.`)
          const shown = await shownSource(ui)
          const lines = source.split('\n').slice(0, 20)
          expect(lines.filter((line) => !shown.includes(line.trim()))).toEqual([])
          expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([source])
          await ui.unmount()
        },
      )
    }

    viewTest(
      `a quadrant chart on a screen narrower than four quadrants shows its source under the width note on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, CAMPAIGNS, surface, 18)
        expect(await noteOf(ui)).toBe(tooWideNote(19, surface === 'terminal' ? 16 : 18))
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a quadrant chart draws each quadrant name and its points in the colour of the quadrant and the frame and the axes dim on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, CAMPAIGNS, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const coloured = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text.trim(), span.style])
      const [first, second, third] = CYCLE
      expect([2, 5, 9, 11, 17].map(coloured)).toEqual([
        [
          ['┌──────────', { color: 'inactive' }],
          ['Need to promote', { color: first, bold: true }],
          ['──────────┬─────────', { color: 'inactive' }],
          ['We should expand', { color: second, bold: true }],
          ['──────────┐', { color: 'inactive' }],
        ],
        [
          ['│', { color: 'inactive' }],
          ['Campaign F', {}],
          ['●', { color: first }],
          ['│', { color: 'inactive' }],
          ['│', { color: 'inactive' }],
        ],
        [
          ['├────────────', { color: 'inactive' }],
          ['Re-evaluate', { color: third, bold: true }],
          ['────────────┼──────────', { color: 'inactive' }],
          ['May be improved', { color: first, bold: true }],
          ['──────────┤', { color: 'inactive' }],
        ],
        [
          ['│', { color: 'inactive' }],
          ['Campaign E', {}],
          ['●', { color: third }],
          ['│', { color: 'inactive' }],
          ['●', { color: first }],
          ['Campaign D', {}],
          ['│', { color: 'inactive' }],
        ],
        [['▼ Low Engagement', { color: 'inactive' }]],
      ])
      await ui.unmount()
    },
  )

  test('a quadrant chart with no point draws each quadrant name in the middle of its quadrant', () => {
    expect(drawnLines(MATRIX, 28)).toEqual([
      '▲ Important ❤',
      `┌${'─'.repeat(12)}┬${'─'.repeat(12)}┐`,
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      '│     Do     │    Plan    │',
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      `├${'─'.repeat(12)}┼${'─'.repeat(12)}┤`,
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      '│  Delegate  │   Delete   │',
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      `│${' '.repeat(12)}│${' '.repeat(12)}│`,
      `└${'─'.repeat(12)}┴${'─'.repeat(12)}┘`,
      '▼ Not Important',
      '◀ Urgent       Not Urgent ▶',
    ])
  })

  test('a point whose name does not fit beside it draws a key and the name under the chart', () => {
    const drawn = drawnLines(CAMPAIGNS, 38)
    expect(drawn.slice(2, 8)).toEqual([
      '┌ Need to promote ┬ We should expa… ┐',
      `│${' '.repeat(17)}│${' '.repeat(17)}│`,
      `│${' '.repeat(17)}│${' '.repeat(17)}│`,
      `│           3     │${' '.repeat(17)}│`,
      '│                 │  ● Campaign C   │',
      `│          1      │${' '.repeat(17)}│`,
    ])
    expect(drawn.slice(-3)).toEqual(['1 Campaign A', '2 Campaign D', '3 Campaign F'])
  })

  test('two points in one cell share one marker and one label, and styles, classes and accessibility lines draw nothing', () => {
    const source = lines(
      'quadrantChart',
      '  accTitle: Two',
      '  accDescr: Two points in one cell',
      '  Point A:::hot: [0.5, 0.5] radius: 12, color: #ff3300',
      '  Point B: [0.51, 0.5] stroke-color: #10f0f0 ,stroke-width: 5px',
      '  classDef hot color: #109060',
    )
    expect(drawnLines(source, 28).filter((row) => row.includes('●'))).toEqual([])
    expect(drawnLines(source, 28).at(-1)).toBe('1 Point A, Point B')
    expect(drawnLines(source).filter((row) => row.includes('●'))).toEqual([
      `│${' '.repeat(37)}│● Point A, Point B${' '.repeat(19)}│`,
    ])
  })

  test('an axis with an arrow and no high end draws its text with an arrow, and quoted text keeps its colon', () => {
    const source = lines(
      'quadrantChart',
      '  x-axis Reach -->',
      '  y-axis Engagement --->',
      '  "Point: one": [0.1, 0.9]',
    )
    const drawn = drawnLines(source)
    expect(drawn[0]).toBe('▲ Engagement')
    expect(drawn.at(-1)).toBe('Reach →')
    expect(drawn[3]).toBe(`│       ● Point: one${' '.repeat(18)}│${' '.repeat(37)}│`)
  })

  for (const [source, line, reason] of [
    [lines('quadrantChart', '  A: [1.0, 0.2]'), 2, 'line 2 does not parse'],
    [lines('quadrantChart', '  A: [.5, 0.2]'), 2, 'line 2 does not parse'],
    [lines('quadrantChart', '  A: [-0.5, 0.2]'), 2, 'line 2: -0.5 is not from 0 to 1'],
    [lines('quadrantChart', '  A: [0.5]'), 2, 'line 2 does not parse'],
    [lines('quadrantChart', '  A: B: [0.5, 0.2]'), 2, 'line 2 does not parse'],
    [lines('quadrantChart', '  -A: [0.5, 0.2]'), 2, 'line 2 does not parse'],
    [lines('quadrantChart', '  x-axis a --> b --> c'), 2, 'line 2 does not parse'],
    [lines('quadrantChart', '  quadrant-5 Five'), 2, 'line 2 does not parse'],
    [lines('quadrantChart', '  just text'), 2, 'line 2 does not parse'],
    [lines('quadrantChartX'), 1, 'line 1 does not parse'],
  ] as const) {
    test(`a quadrant chart refuses line ${String(line)} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
