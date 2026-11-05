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

const SALES = lines(
  'treemap-beta',
  '  title Sales',
  '  "Products"',
  '    "Electronics"',
  '      "Phones": 50',
  '      "Computers": 30',
  '      "Accessories": 20',
  '    "Clothing"',
  `      "Men's": 40`,
  `      "Women's": 40`,
)

const SALES_ROWS = [
  'Sales',
  'Products          ████████████████████████████████████████████████████████ 180',
  '├─ Electronics    ███████████████████████████████▏                         100',
  '│  ├─ Phones      ███████████████▌                                          50',
  '│  ├─ Computers   █████████▍                                                30',
  '│  └─ Accessories ██████▎                                                   20',
  '└─ Clothing       ████████████████████████▉                                 80',
  `   ├─ Men's       ████████████▌                                             40`,
  `   └─ Women's     ████████████▌                                             40`,
]

const SALES_VALUES = ['Sales', '180', '100', '50', '30', '20', '80', '40', '40']

const DEEP = lines(
  'treemap-beta',
  '"abc"',
  '  "abc"',
  '    "abc"',
  '      "abc"',
  '        "abc"',
  '          "abc"',
  '            "abc": 1',
)

const MANY = lines(
  'treemap-beta',
  ...Array.from({ length: 80 }, (_, at) => `"Item ${String(at)}": 1`),
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

describe('a mermaid treemap diagram', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a treemap draws each item in a tree with a bar for its share of the whole and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, SALES, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(rows.map(lastWord)).toEqual(SALES_VALUES)
          expect(rows.filter((row) => /[├└]─ /.test(row))).toHaveLength(7)
          if (columns === 80 && surface === 'terminal') expect(rows).toEqual(SALES_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · treemap ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn treemap copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, SALES, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([SALES, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the treemap source', '10 lines'],
          ['✓ Copied the treemap drawing', '9 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      [
        'a value with an underscore',
        lines('treemap-beta', '  "A": 1_000'),
        'line 2: "1_000" is not a number',
      ],
      ['a name with no quotes', lines('treemap-beta', '  A: 1'), 'line 2 does not parse'],
      ['no item', lines('treemap-beta', '  title Empty'), 'the treemap has no items'],
      ['more than 80 lines', MANY, '81 lines, at most 80 draw'],
    ] as const) {
      viewTest(
        `a treemap with ${what} shows its source under a note that names the reason on ${surface}`,
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
      `a treemap too deep for the body names its width and the remedy on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, DEEP, surface, surface === 'terminal' ? 30 : 28)
        expect(await noteOf(ui)).toBe(
          `diagram not drawn: it takes 30 columns, the screen has 28. ${REMEDY}`,
        )
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([DEEP])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a treemap draws each section in its cycle colour and each leaf bar in the colour of its section on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, SALES, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text.trim(), span.style])
      const [clothing, products, electronics] = CYCLE
      expect([0, 1, 2, 3, 7].map(looks)).toEqual([
        [['Sales', { bold: true }]],
        [
          ['Products', { color: products, bold: true }],
          ['█'.repeat(56), { color: products }],
          ['180', { color: products }],
        ],
        [
          ['├─', { color: 'inactive' }],
          ['Electronics', { color: electronics, bold: true }],
          [`${'█'.repeat(31)}▏`, { color: electronics }],
          ['100', { color: products }],
        ],
        [
          ['│  ├─', { color: 'inactive' }],
          ['Phones', {}],
          [`${'█'.repeat(15)}▌`, { color: electronics }],
          ['50', { color: products }],
        ],
        [
          ['├─', { color: 'inactive' }],
          ["Men's", {}],
          [`${'█'.repeat(12)}▌`, { color: clothing }],
          ['40', { color: products }],
        ],
      ])
      await ui.unmount()
    },
  )

  test('a treemap on a narrow screen cuts a long name with … and keeps every value', () => {
    expect(drawnLines(SALES, 28)).toEqual([
      'Sales',
      'Products       █████████ 180',
      '├─ Electronics █████     100',
      '│  ├─ Phones   ██▌        50',
      '│  ├─ Compute… █▌         30',
      '│  └─ Accesso… █          20',
      '└─ Clothing    ████       80',
      `   ├─ Men's    ██         40`,
      `   └─ Women's  ██         40`,
    ])
  })

  test('a treemap draws the largest item first in each level, as the Mermaid layout does, and ignores classDef and :::class', () => {
    const source = lines(
      'treemap-beta',
      '"Section 1"',
      '    "Leaf 1.1": 12',
      '    "Section 1.2":::class1',
      '      "Leaf 1.2.1": 12',
      '"Section 2"',
      '    "Leaf 2.1": 20:::class1',
      '    "Leaf 2.2": 25',
      '    "Leaf 2.3": 12',
      '',
      'classDef class1 fill:red,color:blue,stroke:#FFD600;',
    )
    expect(drawnLines(source, 40)).toEqual([
      'Section 2        ██████████████▏      57',
      '├─ Leaf 2.2      ██████▏              25',
      '├─ Leaf 2.1      █████                20',
      '└─ Leaf 2.3      ███                  12',
      'Section 1        █████▉               24',
      '├─ Leaf 1.1      ███                  12',
      '└─ Section 1.2   ███                  12',
      '   └─ Leaf 1.2.1 ███                  12',
    ])
  })

  test('the header treemap, a comma before a value, thousands, a leading point and a trailing comment draw as Mermaid reads them', () => {
    const source = lines(
      'treemap',
      '"Budget"',
      '    "Salaries": 700000',
      '    "Equipment", 1,250.5',
      '    "Supplies":.5 %% note',
    )
    expect(drawnLines(source, 40)).toEqual([
      'Budget       ███████████████████ 701,251',
      '├─ Salaries  ███████████████████ 700,000',
      '├─ Equipment ▏                   1,250.5',
      '└─ Supplies  ▏                       0.5',
    ])
  })

  test('an item indented under a leaf joins the section of the leaf, and a name in single quotes draws, as in Mermaid', () => {
    const source = lines(
      'treemap-beta',
      `'Top': 3`,
      '"Group"',
      '    "Leaf": 1',
      '        "Under a leaf": 2',
    )
    expect(drawnLines(source, 40)).toEqual([
      'Top             ███████████            3',
      'Group           ███████████            3',
      '├─ Under a leaf ███████▍               2',
      '└─ Leaf         ███▋                   1',
    ])
  })

  for (const [what, source, line, reason] of [
    ['a header it does not know', lines('treemap-betas', '"A": 1'), 1, 'line 1 does not parse'],
    ['a word after the header', lines('treemap-beta x', '"A": 1'), 1, 'line 1 does not parse'],
    ['a value below 0', lines('treemap-beta', '"A": -1'), 2, 'line 2 does not parse'],
    [
      'a value with two points',
      lines('treemap-beta', '"A": 1.2.3'),
      2,
      'line 2: "1.2.3" is not a number',
    ],
    ['a value of commas only', lines('treemap-beta', '"A": ,'), 2, 'line 2: "," is not a number'],
    ['a space before a class', lines('treemap-beta', '"A" :::x'), 2, 'line 2 does not parse'],
    ['two items on one line', lines('treemap-beta', '"A": 1 "B": 2'), 2, 'line 2 does not parse'],
    [
      'a section with no leaf',
      lines('treemap-beta', '"A"'),
      null,
      'the treemap values add up to 0',
    ],
    ['no item', 'treemap-beta', null, 'the treemap has no items'],
  ] as const) {
    test(`a treemap with ${what} is refused with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
