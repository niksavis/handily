import { describe, expect, test } from 'claude-code/testing'
import {
  CYCLE,
  drawnRows,
  lines,
  mountDiagram,
  noteOf,
  REMEDY,
  rowText,
  shownSource,
  SURFACES,
  titleOf,
  tooWideRows,
  viewTest,
  WIDTHS,
} from './fixtures/diagram-view'
import { diagramOf } from './hooks/draw'
import { parseMermaid } from './hooks/mermaid'

const RESTAURANTS = lines(
  'radar-beta',
  '  title Restaurant Comparison',
  '  axis food["Food Quality"], service["Service"], price["Price"]',
  '  curve a["Restaurant A"]{4, 3, 2}',
  '  curve b["Restaurant B"]{3, 4, 3}',
  '  max 5',
)

const RESTAURANT_ROWS = [
  'Restaurant Comparison',
  'Food Quality  Restaurant A ███████████████████████████████████████▎          4',
  '              Restaurant B █████████████████████████████▍                    3',
  'Service       Restaurant A █████████████████████████████▍                    3',
  '              Restaurant B ███████████████████████████████████████▎          4',
  'Price         Restaurant A ███████████████████▋                              2',
  '              Restaurant B █████████████████████████████▍                    3',
  '                           0                                               5',
]

const RESTAURANT_VALUES = ['Comparison', '4', '3', '3', '4', '2', '3', '5']

const STACKED_ROWS = [
  'Restaurant Comparison',
  'Food Quality',
  '  Restaurant A ████████▊   4',
  '  Restaurant B ██████▋     3',
  'Service',
  '  Restaurant A ██████▋     3',
  '  Restaurant B ████████▊   4',
  'Price',
  '  Restaurant A ████▍       2',
  '  Restaurant B ██████▋     3',
  '               0         5',
]

const PRECISE = lines('radar-beta', '  axis abc, b', '  curve x{1.2345678901234567, 1}, y{1, 1}')

const WIDE = lines(
  'radar-beta',
  ...Array.from({ length: 30 }, (_, at) => `  axis a${String(at)}`),
  '  curve x{' + Array.from({ length: 30 }, () => '1').join(', ') + '}',
  '  curve y{' + Array.from({ length: 30 }, () => '2').join(', ') + '}',
  '  curve z{' + Array.from({ length: 30 }, () => '3').join(', ') + '}',
  '  curve w{' + Array.from({ length: 30 }, () => '4').join(', ') + '}',
)

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function refusedLine(line: number | null, reason: string) {
  return { kind: 'refused', reason, line, limit: null }
}

function lastWord(row: string): string {
  return row.trim().split(' ').at(-1) ?? ''
}

describe('a mermaid radar diagram', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a radar diagram draws a bar for each axis and curve against the max and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, RESTAURANTS, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(rows.map(lastWord).filter((word) => /^\d/.test(word))).toEqual(
            RESTAURANT_VALUES.filter((word) => /^\d/.test(word)),
          )
          expect(rows.filter((row) => row.includes('Restaurant A'))).toHaveLength(3)
          if (columns === 80 && surface === 'terminal') expect(rows).toEqual(RESTAURANT_ROWS)
          if (columns === 30 && surface === 'terminal') expect(rows).toEqual(STACKED_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · radar ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn radar diagram copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, RESTAURANTS, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([RESTAURANTS, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the radar source', '6 lines'],
          ['✓ Copied the radar drawing', '8 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      [
        'a curve with too few values',
        lines('radar-beta', '  axis a, b, c', '  curve x{1, 2}'),
        'the curve x has 2 values for 3 axes',
      ],
      [
        'a negative value',
        lines('radar-beta', '  axis a, b', '  curve x{1, -2}'),
        'line 3 does not parse',
      ],
      ['no curve', lines('radar-beta', '  axis a, b'), 'the radar diagram has no curves'],
      ['more than 120 rows', WIDE, '121 rows, at most 120 draw'],
    ] as const) {
      viewTest(
        `a radar diagram with ${what} shows its source under a note that names the reason on ${surface}`,
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
      `a radar diagram that needs more columns than the body names its width and the remedy on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, PRECISE, surface, surface === 'terminal' ? 30 : 28)
        expect(await noteOf(ui)).toBe(
          `diagram not drawn: it takes 29 columns, the screen has 28. ${REMEDY}`,
        )
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([PRECISE])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a radar diagram draws each curve and its bars in its cycle colour and the axes in bold on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, RESTAURANTS, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text.trim(), span.style])
      const [first, second] = CYCLE
      expect([0, 1, 2, 7].map(looks)).toEqual([
        [['Restaurant Comparison', { bold: true }]],
        [
          ['Food Quality', { bold: true }],
          ['Restaurant A', { color: first }],
          [`${'█'.repeat(39)}▎`, { color: first }],
          ['4', { color: second }],
        ],
        [
          ['Restaurant B', { color: second }],
          [`${'█'.repeat(29)}▍`, { color: second }],
          ['3', { color: second }],
        ],
        [
          ['0', { color: second }],
          ['5', { color: second }],
        ],
      ])
      await ui.unmount()
    },
  )

  test('a radar diagram with one curve names it in a legend and puts its axes beside the bars', () => {
    const source = lines(
      'radar-beta',
      '  axis m["Math"], s["Science"], e["English"]',
      '  curve a["Alice"]{85, 90, 80}',
      '  max 100',
      '  min 0',
    )
    expect(drawnLines(source, 40)).toEqual([
      '█ Alice',
      'Math    ████████████████████████▋     85',
      'Science ██████████████████████████▏   90',
      'English ███████████████████████▎      80',
      '        0                         100',
    ])
    expect(drawnLines(`${source}\n  showLegend false`, 40)[0]).toBe(
      'Math    ████████████████████████▋     85',
    )
  })

  test('a radar diagram reads entries by axis, curves on one line, a curve over several lines and options on one line as Mermaid does', () => {
    const source = lines(
      'radar-beta:',
      '  axis x1, x2',
      '  curve p{ x2: 2, x1 1 }, q["Q"]{',
      '    3,',
      '    4',
      '  }',
      '  graticule polygon, ticks 3, max 4',
    )
    expect(drawnLines(source, 40)).toEqual([
      'x1  p ████████                         1',
      '    Q ████████████████████████         3',
      'x2  p ████████████████                 2',
      '    Q ████████████████████████████████ 4',
      '      0                              4',
    ])
  })

  test('a value outside the min and the max draws its bar at the edge and keeps its number, as Mermaid clips it', () => {
    const source = lines('radar-beta', '  axis a, b', '  curve x{5, 20}', '  min 6', '  max 10')
    expect(drawnLines(source, 30)).toEqual([
      '█ x',
      'a                            5',
      'b █████████████████████████ 20',
      '  6                      10',
    ])
  })

  for (const [what, line] of [
    ['a title', '  title Scores {draft'],
    ['an accessibility title', '  accTitle: Scores {draft'],
    ['a comment after a curve', '  curve y{3, 4} %% {todo'],
    ['a curve label', '  curve z["x{"]{5, 6}'],
  ] as const) {
    test(`a brace in ${what} does not hold the next lines as part of a curve`, () => {
      const source = lines('radar-beta', '  axis a, b', '  curve x{1, 2}', line, '  max 9')
      expect(parseMermaid(source).kind).toBe('radar')
    })
  }

  test('a curve over several lines reads past a brace in a comment and keeps a brace in its label', () => {
    const source = lines(
      'radar-beta',
      '  title Scores {draft',
      '  axis a, b',
      '  curve x["x{"]{ %% {',
      '    1, 2',
      '  }',
      '  curve y{3, 4}',
    )
    expect(drawnLines(source, 40).slice(0, 3)).toEqual([
      'Scores {draft',
      'a  x{ ████████                         1',
      '   y  ████████████████████████         3',
    ])
  })

  test('a title, accessibility lines, a description block and a trailing comment draw nothing of their own', () => {
    const source = lines(
      'radar-beta',
      '  title  Two   words %% a comment',
      '  accTitle: Skills',
      '  accDescr {',
      '    long text',
      '  }',
      '  axis a, b %% the axes',
      '  curve x{1, 2}',
      '  showLegend false',
    )
    expect(drawnLines(source, 30)).toEqual([
      'Two words',
      'a █████████████              1',
      'b ██████████████████████████ 2',
      '  0                        2',
    ])
  })

  for (const [what, source, line, reason] of [
    ['a header it does not know', lines('radar-betas', '  axis a'), 1, 'line 1 does not parse'],
    ['a word after the header', lines('radar-beta x', '  axis a'), 1, 'line 1 does not parse'],
    ['a keyword as an axis', lines('radar-beta', '  axis a, max'), 2, 'line 2 does not parse'],
    [
      'an axis that starts with a digit',
      lines('radar-beta', '  axis 1a'),
      2,
      'line 2 does not parse',
    ],
    [
      'a curve with no values',
      lines('radar-beta', '  axis a', '  curve x{}'),
      3,
      'line 3 does not parse',
    ],
    [
      'a curve with no end',
      lines('radar-beta', '  axis a', '  curve x{1'),
      3,
      'line 3 does not parse',
    ],
    [
      'a graticule it does not know',
      lines('radar-beta', '  graticule square'),
      2,
      'line 2 does not parse',
    ],
    ['a statement it does not know', lines('radar-beta', '  axes a'), 2, 'line 2 does not parse'],
    [
      'a curve with too many values',
      lines('radar-beta', '  axis a', '  curve x{1, 2}'),
      3,
      'the curve x has 2 values for 1 axis',
    ],
    [
      'a curve with no value for an axis',
      lines('radar-beta', '  axis a, b["Bee"]', '  curve x{a: 1}'),
      3,
      'the curve x has no value for the axis Bee',
    ],
    ['no axis', lines('radar-beta', '  curve x{1}'), null, 'the radar diagram has no axes'],
    [
      'a max that is not above the min',
      lines('radar-beta', '  axis a', '  curve x{0}'),
      null,
      'the max 0 is not above the min 0',
    ],
  ] as const) {
    test(`a radar diagram with ${what} is refused with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
