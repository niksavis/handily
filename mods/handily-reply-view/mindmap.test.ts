import { describe, expect, test } from 'claude-code/testing'
import {
  CYCLE,
  bodyWidth,
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

const MINDMAP = lines(
  'mindmap',
  '  root((mindmap))',
  '    Origins',
  '      Long history',
  '      Popularisation',
  '        British popular psychology author Tony Buzan',
  '    Research',
  '      On effectiveness<br/>and features',
  '      On Automatic creation',
  '        Uses',
  '            Creative techniques',
  '            Strategic planning',
  '            Argument mapping',
  '    Tools',
  '      Pen and paper',
  '      Mermaid',
)

const MINDMAP_ROWS = [
  ' ╭───────╮',
  '( mindmap )',
  ' ╰┬──────╯',
  '  ├─ Origins',
  '  │  ├─ Long history',
  '  │  └─ Popularisation',
  '  │     └─ British popular psychology author Tony Buzan',
  '  ├─ Research',
  '  │  ├─ On effectiveness',
  '  │  │  and features',
  '  │  └─ On Automatic creation',
  '  │     └─ Uses',
  '  │        ├─ Creative techniques',
  '  │        ├─ Strategic planning',
  '  │        └─ Argument mapping',
  '  └─ Tools',
  '     ├─ Pen and paper',
  '     └─ Mermaid',
]

const TREE_GLYPHS = /[╭╮╰╯│├└┬─]/g

const ICONS = lines(
  'mindmap',
  '  root((mindmap))',
  '    Origins',
  '      Long history',
  '      ::icon(fa fa-book)',
)

const DEEP = lines(
  'mindmap',
  '  one',
  '    two',
  '      three',
  '        four',
  '          five',
  '            six',
  '              seven',
  '                eight label',
)

function wordsOf(rows: readonly string[]): string[] {
  return rows
    .slice(3)
    .join(' ')
    .replace(TREE_GLYPHS, ' ')
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

describe('a mermaid mindmap', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a mindmap draws a tree from its root and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, MINDMAP, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(rows.slice(0, 6)).toEqual(MINDMAP_ROWS.slice(0, 6))
          expect(wordsOf(rows)).toEqual(wordsOf(MINDMAP_ROWS))
          if (columns === 80) expect(rows).toEqual(MINDMAP_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · mindmap ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn mindmap copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, MINDMAP, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([MINDMAP, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the mindmap source', '16 lines'],
          ['✓ Copied the mindmap drawing', '18 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      ['an icon', ICONS, 'icons does not draw yet'],
      ['a second root', lines('mindmap', '  one', '  two'), 'line 3 starts a second root'],
      [
        'a markdown string',
        lines('mindmap', '  root["`**bold** root`"]'),
        'markdown strings does not draw yet',
      ],
    ] as const) {
      viewTest(
        `a mindmap with ${what} shows its source under a note that names the reason on ${surface}`,
        async (world, $) => {
          const ui = await mountDiagram($, source, surface)
          expect(await noteOf(ui)).toBe(`diagram not drawn: ${note}.`)
          const shown = await shownSource(ui)
          expect(source.split('\n').filter((line) => !shown.includes(line.trim()))).toEqual([])
          expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([source])
          await ui.unmount()
        },
      )
    }

    viewTest(
      `a mindmap too deep for 30 columns names its width and the remedy and shows its source on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, DEEP, surface, 30)
        expect(await noteOf(ui)).toBe(tooWideNote(33, bodyWidth(surface, 30)))
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([DEEP])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a mindmap draws its root in the head colour and each first branch in its cycle colour on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, MINDMAP, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text, span.style])
      const [origins, research, tools] = CYCLE
      expect([0, 1, 2, 3, 4, 7, 15, 16].map(looks)).toEqual([
        [[' ╭───────╮', { color: 'claude' }]],
        [['( mindmap )', { color: 'claude' }]],
        [[' ╰┬──────╯', { color: 'claude' }]],
        [
          ['  ├─ ', { color: 'inactive' }],
          ['Origins', { color: origins, bold: true }],
        ],
        [
          ['  │  ├─ ', { color: 'inactive' }],
          ['Long history', { color: origins }],
        ],
        [
          ['  ├─ ', { color: 'inactive' }],
          ['Research', { color: research, bold: true }],
        ],
        [
          ['  └─ ', { color: 'inactive' }],
          ['Tools', { color: tools, bold: true }],
        ],
        [
          ['     ├─ ', { color: 'inactive' }],
          ['Pen and paper', { color: tools }],
        ],
      ])
      await ui.unmount()
    },
  )

  test('the root keeps its shape: square and hexagon square, circle in brackets, the rest rounded', () => {
    expect(drawnLines(lines('mindmap', '  root[Square]', '    a'))).toEqual([
      '┌────────┐',
      '│ Square │',
      '└─┬──────┘',
      '  └─ a',
    ])
    expect(drawnLines(lines('mindmap', '  root{{Hexagon}}'))).toEqual([
      '┌─────────┐',
      '│ Hexagon │',
      '└─────────┘',
    ])
    expect(drawnLines(lines('mindmap', '  root((Circle))'))).toEqual([
      ' ╭──────╮',
      '( Circle )',
      ' ╰──────╯',
    ])
    for (const root of ['root(Rounded)', 'root)Rounded(', 'root))Rounded((', 'Rounded']) {
      expect(drawnLines(lines('mindmap', `  ${root}`))).toEqual([
        '╭─────────╮',
        '│ Rounded │',
        '╰─────────╯',
      ])
    }
  })

  test('a child draws its text with no shape, a class line draws nothing and a quoted label keeps its brackets', () => {
    const source = lines(
      'mindmap',
      '  Root',
      '    a(rounded)',
      '    :::urgent large',
      '    b["a (quoted) label"]',
      '    c))bang((',
      '      d)cloud(',
      '    e{{hexagon}}',
    )
    expect(drawnLines(source)).toEqual([
      '╭──────╮',
      '│ Root │',
      '╰─┬────╯',
      '  ├─ rounded',
      '  ├─ a (quoted) label',
      '  ├─ bang',
      '  │  └─ cloud',
      '  └─ hexagon',
    ])
  })

  test('a node with less indentation than its sibling takes the nearest parent with less indentation', () => {
    const source = lines('mindmap', 'Root', '    A', '        B', '      C')
    expect(drawnLines(source)).toEqual([
      '╭──────╮',
      '│ Root │',
      '╰─┬────╯',
      '  └─ A',
      '     ├─ B',
      '     └─ C',
    ])
  })

  test('a root too wide for the screen wraps inside its shape', () => {
    const source = lines('mindmap', '  root((A very long root label that wraps))', '    child')
    expect(drawnLines(source, 28)).toEqual([
      ' ╭──────────────────────╮',
      '( A very long root label )',
      '( that wraps             )',
      ' ╰┬─────────────────────╯',
      '  └─ child',
    ])
  })

  for (const [source, line, reason] of [
    [lines('mindmap', '  one', '  two'), 3, 'line 3 starts a second root'],
    [lines('mindmap', '  root', '    a(b)c'), 3, 'line 3 does not parse'],
    [lines('mindmap', '  root', '    a]b'), 3, 'line 3 does not parse'],
    [lines('mindmap', '  root', '    a[]'), 3, 'line 3 does not parse'],
    [lines('mindmap', '  root', '    ::icon(fa fa-book)'), 3, 'icons does not draw yet'],
    [lines('mindmap x', '  root'), 1, 'line 1 does not parse'],
    [lines('mindmap'), null, 'the mindmap has no nodes'],
  ] as const) {
    test(`a mindmap refuses ${line === null ? 'the block' : `line ${String(line)}`} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
