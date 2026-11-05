import { describe, expect, test } from 'claude-code/testing'
import {
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

const PIPELINE = lines(
  'block',
  '  columns 2',
  '  Prompt Reply',
  '  space Draw',
  '  Prompt --> Reply',
  '  Reply --> Draw',
)

const PIPELINE_ROWS = [
  '╭────────╮  ╭────────╮',
  '│ Prompt │─▶│ Reply  │',
  '╰────────╯  ╰───┬────╯',
  '                ▼',
  '            ╭────────╮',
  '            │  Draw  │',
  '            ╰────────╯',
]

const ARCHITECTURE = lines(
  'block-beta',
  '  columns 3',
  '  Frontend blockArrowId6<[" "]>(right) Backend',
  '  space:2 down<[" "]>(down)',
  '  Disk left<[" "]>(left) Database[("Database")]',
  '',
  '  classDef front fill:#696,stroke:#333;',
  '  classDef back fill:#969,stroke:#333;',
  '  class Frontend front',
  '  class Backend,Database back',
)

const ARCHITECTURE_ROWS = [
  '╭──────────╮                ╭──────────╮',
  '│ Frontend │  ───────────▶  │ Backend  │',
  '╰──────────╯                ╰──────────╯',
  '',
  '                                 ▼',
  '',
  '╭──────────╮                ╭──────────╮',
  '│   Disk   │  ◀───────────  │ Database │',
  '╰──────────╯                ╰──────────╯',
]

const ARCHITECTURE_COMPACT_ROWS = [
  '╭──────────╮              ╭──────────╮',
  '│ Frontend │ ───────────▶ │ Backend  │',
  '╰──────────╯              ╰──────────╯',
  '',
  '                               ▼',
  '',
  '╭──────────╮              ╭──────────╮',
  '│   Disk   │ ◀─────────── │ Database │',
  '╰──────────╯              ╰──────────╯',
]

const COMPOSITE = lines(
  'block',
  'columns 1',
  '  db(("DB"))',
  '  blockArrowId6<["&nbsp;&nbsp;&nbsp;"]>(down)',
  '  block:ID',
  '    A',
  '    B["A wide one in the middle"]',
  '    C',
  '  end',
  '  space',
  '  D',
  '  ID --> D',
  '  C --> D',
  '  style B fill:#969,stroke:#333,stroke-width:4px',
)

const COMPOSITE_LEAST = 36
const ARCHITECTURE_LEAST = 38

const GROUPED = lines(
  'block',
  '  columns 2',
  '  block:left',
  '    columns 1',
  '    a b',
  '  end',
  '  c',
  '  a --> c',
)

const GROUPED_ROWS = [
  '┌┄┄┄┄┄┄┄┐  ╭───────╮',
  '┆ ╭───╮ ┆  │       │',
  '┆ │ a │───▶│       │',
  '┆ ╰───╯ ┆  │       │',
  '┆       ┆  │   c   │',
  '┆ ╭───╮ ┆  │       │',
  '┆ │ b │ ┆  │       │',
  '┆ ╰───╯ ┆  │       │',
  '└┄┄┄┄┄┄┄┘  ╰───────╯',
]

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function refused(line: number | null, reason: string) {
  return { kind: 'refused', reason, line, limit: null }
}

function noted(reason: string) {
  return { kind: 'refused', reason, line: null, limit: null }
}

describe('a mermaid block diagram', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a block diagram draws its grid and its links and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, PIPELINE, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(rows).toEqual(PIPELINE_ROWS)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(await titleOf(ui)).toStartWith('── mermaid · block ──')
          await ui.unmount()
        },
      )

      for (const [name, source, least] of [
        ['the composite example of the Mermaid page', COMPOSITE, COMPOSITE_LEAST],
        ['the architecture example of the Mermaid page', ARCHITECTURE, ARCHITECTURE_LEAST],
      ] as const) {
        const width = bodyWidth(surface, columns)
        viewTest(
          `${name} ${width >= least ? 'draws and every line fits the body' : 'shows its source under the width note'} on ${surface} at ${String(columns)} columns`,
          async (world, $) => {
            const ui = await mountDiagram($, source, surface, columns)
            if (width >= least) {
              const rows = (await drawnRows(ui, surface)).map(rowText)
              expect(tooWideRows(rows, surface, columns)).toEqual([])
              expect(rows.length).toBeGreaterThan(0)
            } else {
              expect(await noteOf(ui)).toBe(tooWideNote(least, width))
              expect(await shownSource(ui)).toContain('blockArrowId6')
              await ui.press({ key: 'block-1-copy' })
              expect(world.copies).toEqual([source])
            }
            await ui.unmount()
          },
        )
      }
    }

    viewTest(
      `copy on a drawn block diagram copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, PIPELINE, surface)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([PIPELINE, PIPELINE_ROWS.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the block source', '6 lines'],
          ['✓ Copied the block drawing', '7 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      ['a link with no arrow', lines('block', '  A - B'), 'line 2 does not parse'],
      [
        'a link that needs a bend',
        lines('block', '  columns 2', '  A space', '  space B', '  A --> B'),
        'the link from A to B needs a bend',
      ],
      [
        'a link that crosses a block',
        lines('block', '  A B C', '  A --> C'),
        'the link from A to C crosses B',
      ],
      [
        'a block arrow with two directions',
        lines('block', '  x<["Label"]>(x, down)'),
        'a block arrow with two directions does not draw yet',
      ],
    ] as const) {
      viewTest(
        `a block diagram with ${what} shows its source under a note that names the reason on ${surface}`,
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
  }

  test('the architecture example draws its block arrows between the blocks, and narrows its gaps on a narrow screen', () => {
    expect(drawnLines(ARCHITECTURE)).toEqual(ARCHITECTURE_ROWS)
    expect(drawnLines(ARCHITECTURE, 38)).toEqual(ARCHITECTURE_COMPACT_ROWS)
  })

  test('the composite example draws its group as a frame, and both links reach D through the space row', () => {
    const rows = drawnLines(COMPOSITE)
    expect(rows.filter((row) => row.startsWith('┌┄') || row.startsWith('└┄'))).toHaveLength(2)
    expect(rows.filter((row) => row.includes('┆ ╭'))).toHaveLength(1)
    expect(rows.filter((row) => (row.match(/▼/g) ?? []).length === 2)).toHaveLength(1)
    expect(rows.some((row) => row.includes('A wide one in the'))).toBe(true)
    expect(rows.some((row) => row.includes('&nbsp;'))).toBe(false)
  })

  test('a block inside a group links out through the frame', () => {
    expect(drawnLines(GROUPED)).toEqual(GROUPED_ROWS)
  })

  test('columns wrap the blocks into rows, a span widens a block, and the gaps keep one width', () => {
    expect(drawnLines(lines('block', '  columns 3', '  a["A label"] b:2 c:2 d'))).toEqual([
      '╭─────────╮  ╭──────────────────────╮',
      '│ A label │  │          b           │',
      '╰─────────╯  ╰──────────────────────╯',
      '',
      '╭──────────────────────╮  ╭─────────╮',
      '│          c           │  │    d    │',
      '╰──────────────────────╯  ╰─────────╯',
    ])
  })

  test('the shapes draw rounded boxes, and a rhombus keeps square corners and the decision mark', () => {
    expect(drawnLines(lines('block', '  columns 3', '  a("Round") b[("Data")] c{"Ask"}'))).toEqual([
      '╭───────╮  ╭───────╮  ┌───────┐',
      '│ Round │  │ Data  │  │ ◇ Ask │',
      '╰───────╯  ╰───────╯  └───────┘',
    ])
  })

  test('a link label stands on the line, a vertical label beside it, and a link with no arrow meets a port', () => {
    expect(drawnLines(lines('block', '  A space:2 B', '  A-- "X" -->B'))).toEqual([
      '╭───╮                ╭───╮',
      '│ A │────── X ──────▶│ B │',
      '╰───╯                ╰───╯',
    ])
    expect(
      drawnLines(lines('block', '  columns 1', '  A', '  space', '  B', '  A -- "yes" --> B')),
    ).toEqual(['╭───╮', '│ A │', '╰─┬─╯', '  │', '  │ yes', '  ▼', '╭───╮', '│ B │', '╰───╯'])
    expect(
      drawnLines(
        lines('block', '  columns 2', '  A B', '  C D', '  A --> C', '  B --- D', '  D -.-> C'),
      ),
    ).toEqual([
      '╭───╮  ╭───╮',
      '│ A │  │ B │',
      '╰─┬─╯  ╰─┬─╯',
      '  ▼      │',
      '╭───╮  ╭─┴─╮',
      '│ C │◀╌│ D │',
      '╰───╯  ╰───╯',
    ])
  })

  test('a block diagram draws each box in its cycle colour and the links in the line and head colours', () => {
    const drawn = diagramOf(PIPELINE, 78, 'terminal')
    if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
    const inks = (row: number) =>
      (drawn.inked[row] ?? [])
        .filter((run) => run.text.trim() !== '')
        .map((run) => [run.text.trim(), run.ink])
    expect(inks(1)).toEqual([
      ['│', 0],
      ['Prompt', 'plain'],
      ['│', 0],
      ['─', 'line'],
      ['▶', 'head'],
      ['│', 1],
      ['Reply', 'plain'],
      ['│', 1],
    ])
  })

  for (const [source, line, reason] of [
    [lines('block-alpha', '  a'), 1, 'line 1 does not parse'],
    [lines('block', '  a', '  end'), 3, 'line 3 does not parse'],
    [lines('block', '  block:G', '  a'), 2, 'line 2 opens a block with no end'],
    [lines('block', '  columns three'), 2, 'line 2 does not parse'],
    [lines('block', '  a b', '  block:a', '  end'), 3, 'line 3 does not parse'],
    [lines('block', '  x<["L"]>(sideways)'), 2, 'line 2 does not parse'],
  ] as const) {
    test(`a block diagram refuses line ${String(line)} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refused(line, reason))
    })
  }

  for (const [source, reason] of [
    [lines('block', '  columns 3'), 'the block diagram has no blocks'],
    [lines('block', '  columns 3', '  a:4'), 'block a spans 4 columns, its row has 3'],
    [
      lines('block', '  A B', '  A-- "a long label" -->B'),
      'the label of the link from A to B does not fit',
    ],
    [
      lines(
        'block',
        '  columns 3',
        '  space X space',
        '  A space B',
        '  space Y space',
        '  A --> B',
        '  X --> Y',
      ),
      'the link from X to Y crosses another link',
    ],
  ] as const) {
    test(`a block diagram draws as its source with the reason ${reason}`, () => {
      expect(diagramOf(source, 78, 'terminal')).toEqual(noted(reason))
    })
  }

  test('block and block-beta read the same, and a style, a class and a comment change no line', () => {
    const plain = lines('block', '  a b', '  a --> b')
    const beta = lines(
      'block-beta',
      '  a b',
      '  %% a comment',
      '  a --> b',
      '  style a fill:#969',
      '  classDef x fill:#696',
      '  class b x',
    )
    expect(drawnLines(beta)).toEqual(drawnLines(plain))
  })

  test('a block named in a link before its row takes its place at its first mention', () => {
    expect(drawnLines(lines('block', '  id1("Start")-->id2("Stop")'))).toEqual(
      drawnLines(lines('block', '  id1("Start") id2("Stop")', '  id1 --> id2')),
    )
  })
})
