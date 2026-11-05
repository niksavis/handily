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
  tooWideRows,
  viewTest,
  WIDTHS,
} from './fixtures/diagram-view'
import { diagramOf } from './hooks/draw'
import { parseMermaid } from './hooks/mermaid'

const INDUSTRY = lines(
  'timeline',
  '    title Timeline of Industrial Revolution',
  '    section 17th-20th century',
  '        Industry 1.0 : Machinery, Water power, Steam <br>power',
  '        Industry 2.0 : Electricity, Internal combustion engine, Mass production',
  '        Industry 3.0 : Electronics, Computers, Automation',
  '    section 21st century',
  '        Industry 4.0 : Internet, Robotics, Internet of Things',
  '        Industry 5.0 : Artificial intelligence, Big data, 3D printing',
)

const INDUSTRY_ROWS = [
  'Timeline of Industrial Revolution',
  `┄┄ 17th-20th century ${'┄'.repeat(53)}`,
  '● Industry 1.0  • Machinery, Water power, Steam',
  '│                 power',
  '● Industry 2.0  • Electricity, Internal combustion engine, Mass production',
  '● Industry 3.0  • Electronics, Computers, Automation',
  `┄┄ 21st century ${'┄'.repeat(58)}`,
  '● Industry 4.0  • Internet, Robotics, Internet of Things',
  '● Industry 5.0  • Artificial intelligence, Big data, 3D printing',
]

const SOCIAL = lines(
  'timeline',
  '    title History of Social Media Platform',
  '    2002 : LinkedIn',
  '    2004 : Facebook',
  '         : Google',
  '    2005 : YouTube',
)

const RULE_GLYPHS = /[┄│●•]/g

const LONG = lines(
  'timeline',
  ...Array.from({ length: 45 }, (_, at) => `  p${String(at)} : a : b : c`),
)

function wordsOf(rows: readonly string[]): string[] {
  return rows
    .join(' ')
    .replace(RULE_GLYPHS, ' ')
    .split(' ')
    .filter((word) => word !== '')
}

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function refusedLine(line: number | null, reason: string) {
  return { kind: 'refused', reason, line, limit: null }
}

describe('a mermaid timeline', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a timeline draws its periods down an axis under their sections and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, INDUSTRY, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(wordsOf(rows)).toEqual(wordsOf(INDUSTRY_ROWS))
          expect(rows.filter((row) => row.startsWith('┄┄ '))).toHaveLength(2)
          expect(rows.filter((row) => row.startsWith('● '))).toHaveLength(5)
          if (columns === 80) expect(rows).toEqual(INDUSTRY_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · timeline ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn timeline copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, SOCIAL, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([SOCIAL, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the timeline source', '6 lines'],
          ['✓ Copied the timeline drawing', '5 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      ['a direction it does not know', lines('timeline XY', '  2002 : a'), 'line 1 does not parse'],
      ['an event before any period', lines('timeline', '  : orphan'), 'line 2 does not parse'],
      [
        'no time period',
        lines('timeline', '  title Only a title'),
        'the timeline has no time periods',
      ],
      ['more than 120 rows', LONG, '135 rows, at most 120 draw'],
    ] as const) {
      viewTest(
        `a timeline with ${what} shows its source under a note that names the reason on ${surface}`,
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
  }

  viewTest(
    'a timeline draws each section in its cycle colour and its events plain on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, INDUSTRY, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text, span.style])
      const [first, second] = CYCLE
      expect([0, 1, 2, 3, 6, 7].map(looks)).toEqual([
        [['Timeline of Industrial Revolution', { bold: true }]],
        [
          ['┄┄ ', { color: 'inactive' }],
          ['17th-20th century', { color: first, bold: true }],
          [` ${'┄'.repeat(53)}`, { color: 'inactive' }],
        ],
        [
          ['● ', { color: first }],
          ['Industry 1.0', { color: first, bold: true }],
          ['• ', { color: 'inactive' }],
          ['Machinery, Water power, Steam', {}],
        ],
        [
          ['│ ', { color: 'inactive' }],
          ['power', {}],
        ],
        [
          ['┄┄ ', { color: 'inactive' }],
          ['21st century', { color: second, bold: true }],
          [` ${'┄'.repeat(58)}`, { color: 'inactive' }],
        ],
        [
          ['● ', { color: second }],
          ['Industry 4.0', { color: second, bold: true }],
          ['• ', { color: 'inactive' }],
          ['Internet, Robotics, Internet of Things', {}],
        ],
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a timeline with no section draws each period in its own cycle colour on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, SOCIAL, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const points = rows
        .flat()
        .filter((span) => span.text === '● ')
        .map((span) => span.style.color)
      expect(points).toEqual([...CYCLE])
      await ui.unmount()
    },
  )

  test('a narrow screen puts the events under their period', () => {
    expect(drawnLines(INDUSTRY, 28).slice(0, 7)).toEqual([
      'Timeline of Industrial',
      'Revolution',
      `┄┄ 17th-20th century ${'┄'.repeat(7)}`,
      '● Industry 1.0',
      '│ • Machinery, Water power,',
      '│   Steam',
      '│   power',
    ])
  })

  test('a period wider than a third of the screen puts its events under it', () => {
    const source = lines(
      'timeline',
      '  title A long period name',
      '  The year that everything changed : one event',
    )
    expect(drawnLines(source)).toEqual([
      'A long period name',
      '● The year that everything changed',
      '  • one event',
    ])
  })

  test('the directions LR and TD, accessibility lines, a comment and a colon inside an event draw as written', () => {
    const source = lines(
      'timeline LR',
      '  accTitle: Platforms',
      '  accDescr: The years each platform began',
      '  2002 # the first one : not an event',
      '  2003 : C# 1.0 : a:b',
      '       : Skype',
    )
    const drawn = ['● 2002', '● 2003  • C# 1.0', '        • a:b', '        • Skype']
    expect(drawnLines(source)).toEqual(drawn)
    expect(drawnLines(source.replace('timeline LR', 'timeline TD'))).toEqual(drawn)
  })

  for (const [source, line, reason] of [
    [lines('timeline', '  2002 :x'), 2, 'line 2 does not parse'],
    [lines('timeline', '  2002 :'), 2, 'line 2 does not parse'],
    [lines('timeline', '  section Age : one'), 2, 'line 2 does not parse'],
    [lines('timeline', '  : orphan'), 2, 'line 2 does not parse'],
    [lines('timeline XY', '  2002 : a'), 1, 'line 1 does not parse'],
    [lines('timeline', '  title Only a title'), null, 'the timeline has no time periods'],
  ] as const) {
    test(`a timeline refuses ${line === null ? 'the block' : `line ${String(line)}`} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
