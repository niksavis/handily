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

const BOARD = lines(
  'kanban',
  '  todo[Todo]',
  "    id1[Write the parser]@{ ticket: H-12, priority: 'High' }",
  '    id2[Draw the board]',
  '  doing[In progress]',
  "    id3[Pick the glyphs for the cards]@{ assigned: 'niksa' }",
  '  done[Done]',
  '    id4[Read the Mermaid page]',
)

const BOARD_ROWS = [
  'Todo                      In progress               Done',
  '╭──────────────────────╮  ╭──────────────────────╮  ╭──────────────────────╮',
  '│ Write the parser     │  │ Pick the glyphs for  │  │ Read the Mermaid     │',
  '│ High · H-12          │  │ the cards            │  │ page                 │',
  '╰──────────────────────╯  │ niksa                │  ╰──────────────────────╯',
  '╭──────────────────────╮  ╰──────────────────────╯',
  '│ Draw the board       │',
  '╰──────────────────────╯',
]

const STACKED_ROWS = [
  `┄┄ Todo ${'┄'.repeat(20)}`,
  `╭${'─'.repeat(26)}╮`,
  '│ Write the parser         │',
  '│ High · H-12              │',
  `╰${'─'.repeat(26)}╯`,
  `╭${'─'.repeat(26)}╮`,
  '│ Draw the board           │',
  `╰${'─'.repeat(26)}╯`,
  `┄┄ In progress ${'┄'.repeat(13)}`,
  `╭${'─'.repeat(26)}╮`,
  '│ Pick the glyphs for the  │',
  '│ cards                    │',
  '│ niksa                    │',
  `╰${'─'.repeat(26)}╯`,
  `┄┄ Done ${'┄'.repeat(20)}`,
  `╭${'─'.repeat(26)}╮`,
  '│ Read the Mermaid page    │',
  `╰${'─'.repeat(26)}╯`,
]

const CARDS = ['Write the parser', 'Draw the board', 'Read the Mermaid']

const CROWD = lines(
  'kanban',
  '  todo[Todo]',
  ...Array.from({ length: 41 }, (_, at) => `    t${String(at)}[Task]`),
)

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function refusedLine(line: number | null, reason: string) {
  return { kind: 'refused', reason, line, limit: null }
}

describe('a mermaid kanban', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a kanban draws its columns and cards and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, BOARD, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(CARDS.filter((card) => !rows.some((row) => row.includes(card)))).toEqual([])
          expect(rows.filter((row) => row.startsWith('╭'))).toHaveLength(columns === 80 ? 2 : 4)
          if (surface === 'terminal' && columns === 80) expect(rows).toEqual(BOARD_ROWS)
          if (surface === 'terminal' && columns === 30)
            expect(rows.slice(0, 5)).toEqual(STACKED_ROWS.slice(0, 5))
          expect(await titleOf(ui)).toStartWith('── mermaid · kanban ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn kanban copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, BOARD, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([BOARD, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the kanban source', '8 lines'],
          ['✓ Copied the kanban drawing', `${String(rows.length)} lines`],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      ['a header it does not know', lines('kanban LR', '  todo'), 'line 1 does not parse'],
      ['an unclosed bracket', lines('kanban', '  todo[Todo', '    a[A]'), 'line 2 does not parse'],
      [
        'an icon',
        lines('kanban', '  todo[Todo]', '    ::icon(fa fa-book)'),
        'icons does not draw yet',
      ],
      [
        'metadata on more than one line',
        lines('kanban', '  todo[Todo]', '    a[A]@{', '      ticket: X', '    }'),
        'metadata on more than one line does not draw yet',
      ],
      [
        'a card left of the first column',
        lines('kanban', '    todo[Todo]', '  a[A]'),
        'line 3 stands left of the first column',
      ],
      ['no column', lines('kanban', '  %% only a comment'), 'the kanban has no columns'],
      ['more than 40 cards', CROWD, '41 boxes, at most 40 draw'],
    ] as const) {
      viewTest(
        `a kanban with ${what} shows its source under a note that names the reason on ${surface}`,
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
      `a kanban on a screen narrower than a card shows its source under the width note on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, BOARD, surface, 12)
        expect(await noteOf(ui)).toBe(tooWideNote(14, surface === 'terminal' ? 10 : 12))
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a kanban draws each column name bold in its cycle colour, the cards plain and the frames and metadata dim on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, BOARD, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text.trim(), span.style])
      const [first, second, third] = CYCLE
      expect([0, 3].map(looks)).toEqual([
        [
          ['Todo', { color: first, bold: true }],
          ['In progress', { color: second, bold: true }],
          ['Done', { color: third, bold: true }],
        ],
        [
          ['│ High · H-12', { color: 'inactive' }],
          ['│', { color: 'inactive' }],
          ['│', { color: 'inactive' }],
          ['the cards', {}],
          ['│', { color: 'inactive' }],
          ['│', { color: 'inactive' }],
          ['page', {}],
          ['│', { color: 'inactive' }],
        ],
      ])
      await ui.unmount()
    },
  )

  test('a narrow screen stacks the columns under dotted rows with one card width', () => {
    expect(drawnLines(BOARD, 28)).toEqual(STACKED_ROWS)
  })

  test('every node shape on a board of two columns, a quoted label, a label in the metadata, comments and classes draw as Mermaid reads them', () => {
    const source = lines(
      'kanban',
      '  Todo %% a column with no brackets',
      '    [Bare card]',
      '    a(Round)',
      '    b((Circle))',
      '    c{{Hexagon}}',
      '    d)Cloud(',
      '    e))Bang((',
      '    f(-Odd-)',
      '    g["Quoted (with brackets)"]',
      "    h[Old]@{ label: 'New label', shape: rect }",
      '    :::urgent',
      '  done[Done]',
    )
    expect(drawnLines(source, 78).filter((row) => row.startsWith('│'))).toEqual(
      [
        'Bare card',
        'Round',
        'Circle',
        'Hexagon',
        'Cloud',
        'Bang',
        'Odd',
        'Quoted (with brackets)',
        'New label',
      ].map((text) => `│ ${text.padEnd(34)} │`),
    )
  })

  for (const [source, line, reason] of [
    [lines('kanban', '  todo[Todo]', '    a[A (b)]'), 3, 'line 3 does not parse'],
    [lines('kanban', '  todo[Todo]', '    a[]'), 3, 'line 3 does not parse'],
    [lines('kanban', '  todo[Todo]', '    a[A]@{ shape: Rect }'), 3, 'line 3 does not parse'],
    [lines('kanban', '  todo[Todo]', '    a[A]@{ ticket }'), 3, 'line 3 does not parse'],
    [lines('kanban', '  todo[Todo]', '    a[A]@{ icon: fa }'), 3, 'icons does not draw yet'],
    [lines('kanban', '  todo["`**Todo**`"]'), 2, 'markdown strings does not draw yet'],
    [lines('kanbanX'), 1, 'line 1 does not parse'],
  ] as const) {
    test(`a kanban refuses line ${String(line)} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
