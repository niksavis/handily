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

const ENERGY = lines(
  'sankey',
  '  %% source,target,value',
  '  Solar,Grid,60',
  '  Wind,Grid,40',
  '  Grid,Homes,70',
  '  Grid,"Industry, heavy",25',
  '  Grid,Losses,5',
)

const ENERGY_ROWS = [
  'Solar                                                                       60',
  '└─ Grid            ████████████████████████████████████████████████         60',
  'Wind                                                                        40',
  '└─ Grid            ████████████████████████████████                         40',
  'Grid                                                                       100',
  '├─ Homes           ████████████████████████████████████████████████████████ 70',
  '├─ Industry, heavy ████████████████████                                     25',
  '└─ Losses          ████                                                      5',
  'Homes                                                                       70',
  'Industry, heavy                                                             25',
  'Losses                                                                       5',
]

const ENERGY_VALUES = ['60', '60', '40', '40', '100', '70', '25', '5', '70', '25', '5']

const HUGE = lines('sankey', 'A,Big,1234567890123.25')

const MANY = lines(
  'sankey',
  ...Array.from({ length: 70 }, (_, at) => `Source ${String(at)},Target ${String(at)},1`),
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

describe('a mermaid sankey diagram', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a sankey diagram draws each node with its total and a bar for each link and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, ENERGY, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(rows.map(lastWord)).toEqual(ENERGY_VALUES)
          expect(rows.filter((row) => /^[├└]─ /.test(row))).toHaveLength(5)
          if (columns === 80 && surface === 'terminal') expect(rows).toEqual(ENERGY_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · sankey ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn sankey diagram copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, ENERGY, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([ENERGY, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the sankey source', '7 lines'],
          ['✓ Copied the sankey drawing', '11 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      ['a cycle', lines('sankey', 'A,B,1', 'B,A,1'), 'line 3 closes a cycle'],
      [
        'a value that is not a number',
        lines('sankey', 'A,B,many'),
        'line 2: "many" is not a number',
      ],
      ['four fields', lines('sankey', 'A,B,1,2'), 'line 2 does not parse'],
      ['no link', 'sankey', 'the sankey diagram has no links'],
      ['more than 120 rows', MANY, '210 rows, at most 120 draw'],
    ] as const) {
      viewTest(
        `a sankey diagram with ${what} shows its source under a note that names the reason on ${surface}`,
        async (world, $) => {
          const ui = await mountDiagram($, source, surface)
          expect(await noteOf(ui)).toBe(`diagram not drawn: ${note}.`)
          const shown = await shownSource(ui)
          const lines = source.split('\n').slice(0, 15)
          expect(lines.filter((line) => !shown.includes(line.trim()))).toEqual([])
          expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([source])
          await ui.unmount()
        },
      )
    }

    viewTest(
      `a sankey diagram that needs more columns than the body names its width and the remedy on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, HUGE, surface, surface === 'terminal' ? 30 : 28)
        expect(await noteOf(ui)).toBe(
          `diagram not drawn: it takes 30 columns, the screen has 28. ${REMEDY}`,
        )
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([HUGE])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a sankey diagram draws each node in its cycle colour and each link in the colour of its target on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, ENERGY, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text.trim(), span.style])
      const [solar, wind, grid] = CYCLE
      expect([0, 1, 4, 5].map(looks)).toEqual([
        [
          ['Solar', { color: solar, bold: true }],
          ['60', { color: wind }],
        ],
        [
          ['└─', { color: 'inactive' }],
          ['Grid', { color: grid }],
          ['█'.repeat(48), { color: grid }],
          ['60', { color: wind }],
        ],
        [
          ['Grid', { color: grid, bold: true }],
          ['100', { color: wind }],
        ],
        [
          ['├─', { color: 'inactive' }],
          ['Homes', { color: solar }],
          ['█'.repeat(56), { color: solar }],
          ['70', { color: wind }],
        ],
      ])
      await ui.unmount()
    },
  )

  test('a sankey diagram on a narrow screen cuts a long target with … and keeps every value', () => {
    expect(drawnLines(ENERGY, 28)).toEqual([
      'Solar                     60',
      '└─ Grid           ██████  60',
      'Wind                      40',
      '└─ Grid           ████    40',
      'Grid                     100',
      '├─ Homes          ███████ 70',
      '├─ Industry, hea… ██▌     25',
      '└─ Losses         ▌        5',
      'Homes                     70',
      'Industry, heavy           25',
      'Losses                     5',
    ])
  })

  test('the header sankey-beta, blank lines, quoted fields with commas and doubled quotes and a value of 0 draw as Mermaid reads them', () => {
    const source = lines(
      'sankey-beta',
      '',
      'Pumped heat,"Heating, ""homes""",193.026',
      '',
      'Pumped heat,Idle,0',
    )
    expect(drawnLines(source, 40)).toEqual([
      'Pumped heat                       193.03',
      '├─ Heating, "homes" █████████████ 193.03',
      '└─ Idle                                0',
      'Heating, "homes"                  193.03',
      'Idle                                   0',
    ])
  })

  test('a sankey node takes the larger of its inflow and its outflow, and a node with no outflow stands last', () => {
    const source = lines('sankey', 'A,B,10', 'B,C,4', 'A,D,1')
    expect(drawnLines(source, 30)).toEqual([
      'A                           11',
      '├─ B ██████████████████████ 10',
      '└─ D ██▎                     1',
      'B                           10',
      '└─ C ████████▊               4',
      'C                            4',
      'D                            1',
    ])
  })

  for (const [what, source, line, reason] of [
    ['a link to itself', lines('sankey', 'A,A,1'), 2, 'line 2 closes a cycle'],
    [
      'a link back to its start',
      lines('sankey', 'A,B,1', 'B,C,1', 'C,A,1'),
      4,
      'line 4 closes a cycle',
    ],
    [
      'a value below 0',
      lines('sankey', 'A,B,-1'),
      2,
      'line 2: the link from "A" to "B" is below 0',
    ],
    ['a value that is a word', lines('sankey', 'A,B,x'), 2, 'line 2: "x" is not a number'],
    ['two fields', lines('sankey', 'A,B'), 2, 'line 2 does not parse'],
    ['an empty source', lines('sankey', ',B,1'), 2, 'line 2 does not parse'],
    ['a space before a quote', lines('sankey', 'A, "B",1'), 2, 'line 2 does not parse'],
    ['an indented quote', lines('sankey', '  "A",B,1'), 2, 'line 2 does not parse'],
    ['a space after a quote', lines('sankey', '"A" ,B,1'), 2, 'line 2 does not parse'],
    ['a quote with no end', lines('sankey', '"A,B,1'), 2, 'line 2 does not parse'],
    ['a letter outside ASCII', lines('sankey', 'Zürich,B,1'), 2, 'line 2 does not parse'],
    ['a word after the header', lines('sankey title', 'A,B,1'), 1, 'line 1 does not parse'],
    ['a header it does not know', lines('sankey-betas', 'A,B,1'), 1, 'line 1 does not parse'],
    ['no link', 'sankey', null, 'the sankey diagram has no links'],
  ] as const) {
    test(`a sankey diagram with ${what} is refused with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
