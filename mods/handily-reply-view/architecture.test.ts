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
  type Span,
} from './fixtures/diagram-view'
import { diagramOf } from './hooks/draw'
import { parseMermaid } from './hooks/mermaid'

const HEAD = 'claude'
const LINE = 'inactive'

const SHOP = lines(
  'architecture-beta',
  '  title Shop',
  '  group cloud(cloud)[Cloud]',
  '  group data(database)[Data] in cloud',
  '  service cdn(internet)[CDN]',
  '  service web(internet)[Web] in cloud',
  '  service api(server)[API] in cloud',
  '  service db(database)[Orders] in data',
  '  cdn:B --> T:web',
  '  web:B -[calls]-> T:api',
  '  api{group}:B <--> T:db{group}',
)

const SHOP_ROWS = [
  'Shop',
  '    ╭─────╮',
  '    │ CDN │',
  '    ╰──┬──╯',
  '  ┌┄┄┄┄│┄ Cloud ┄┐',
  '  ┆    ▼         ┆',
  '  ┆ ╭─────╮      ┆',
  '  ┆ │ Web │      ┆',
  '  ┆ ╰──┬──╯      ┆',
  '  ┆    │ calls   ┆',
  '  ┆    ▼         ┆',
  '  ┆ ╭─────╮      ┆',
  '  ┆ │ API │      ┆',
  '  ┆ ╰──┬──╯      ┆',
  '  └┄┄┄┄│┄┄┄┄┄┄┄┄┄┘',
  '       │ ⇄',
  '┌┄┄┄┄┄┄│┄ Data in Cloud ┄┐',
  '┆      │                 ┆',
  '┆ ╭────┴───╮             ┆',
  '┆ │ Orders │             ┆',
  '┆ ╰────────╯             ┆',
  '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
]

const ACROSS = lines(
  'architecture-beta',
  '  service users(internet)[Users]',
  '  service gateway(server)[Gateway]',
  '  service queue(disk)["Job queue"]',
  '  users:R --> L:gateway',
  '  queue:L <-[jobs]- R:gateway',
)

const ACROSS_ROWS = [
  '╭───────╮   ╭─────────╮ jobs ╭───────────╮',
  '│ Users │──▶│ Gateway │─────▶│ Job queue │',
  '╰───────╯   ╰─────────╯      ╰───────────╯',
]

const JUNCTIONS = lines(
  'architecture-beta',
  '    service left_disk(disk)[Disk]',
  '    service top_disk(disk)[Disk]',
  '    service bottom_disk(disk)[Disk]',
  '    service top_gateway(internet)[Gateway]',
  '    service bottom_gateway(internet)[Gateway]',
  '    junction junctionCenter',
  '    junction junctionRight',
  '',
  '    left_disk:R -- L:junctionCenter',
  '    top_disk:B -- T:junctionCenter',
  '    bottom_disk:T -- B:junctionCenter',
  '    junctionCenter:R -- L:junctionRight',
  '    top_gateway:B -- T:junctionRight',
  '    bottom_gateway:T -- B:junctionRight',
)

const JUNCTIONS_ROWS = [
  '╭──────╮ ╭──────╮  ╭─────────╮',
  '│ Disk │ │ Disk │  │ Gateway │',
  '╰──┬───╯ ╰───┬──╯  ╰────┬────╯',
  '   └────┬────┘          │',
  '        │               │',
  '      ╭─┴─╮             │',
  '      │ ● │             │',
  '      ╰─┬─╯             │',
  '        ├───────┐ ┌─────┘',
  '        │       │ │',
  '    ╭───┴──╮  ╭─┴─┴─╮',
  '    │ Disk │  │ ●   │',
  '    ╰──────╯  ╰──┬──╯',
  '                 │',
  '            ╭────┴────╮',
  '            │ Gateway │',
  '            ╰─────────╯',
]

function refusedBy(reason: string, line: number | null = null) {
  return { kind: 'refused', reason, line, limit: null }
}

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function styleAt(rows: readonly Span[][], text: string) {
  return rows.flat().find((span) => span.text.trim() === text)?.style
}

describe('a mermaid architecture diagram', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `an architecture diagram draws its title, its services, its edges and a frame for each group and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, SHOP, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(rows).toEqual(SHOP_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · architecture ──')
          await ui.unmount()
        },
      )

      viewTest(
        `an architecture diagram with edges across draws left to right when it fits and top down when it does not on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, ACROSS, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          if (columns === 80) expect(rows).toEqual(ACROSS_ROWS)
          else expect(rows.filter((row) => row.includes('▼'))).toHaveLength(2)
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn architecture diagram copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, SHOP, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([SHOP, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/)[0])).toEqual([
          '✓ Copied the architecture source',
          '✓ Copied the architecture drawing',
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      [
        'an edge to a group',
        lines(
          'architecture-beta',
          '  group api[API]',
          '  service db[Database] in api',
          '  service web[Web]',
          '  web:R --> L:api',
        ),
        'line 5: an edge cannot end at the group api',
      ],
      [
        'an edge to an id that it does not declare',
        lines('architecture-beta', '  service web[Web]', '  web:R --> L:ghost'),
        'line 3: no service or junction has the id ghost',
      ],
      [
        'a service in a group that it does not declare',
        lines('architecture-beta', '  service web[Web] in cloud'),
        'line 2: no group has the id cloud',
      ],
    ] as const) {
      viewTest(
        `an architecture diagram with ${what} shows its source under a note that names the reason on ${surface}`,
        async (world, $) => {
          const ui = await mountDiagram($, source, surface)
          expect(await noteOf(ui)).toBe(`diagram not drawn: ${note}.`)
          const shown = await shownSource(ui)
          expect(source.split('\n').filter((line) => !shown.includes(line.trim()))).toEqual([])
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([source])
          await ui.unmount()
        },
      )
    }
  }

  viewTest(
    'the title is bold, the services take the cycle colours, the arrow heads are in claude and the edge titles in inactive on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, SHOP, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      expect(styleAt(rows, 'Shop')).toEqual({ bold: true })
      expect(
        ['│ CDN │', '│ Web │', '│ API │', '│ Orders │'].map(
          (name) => rows.flat().find((span) => span.text.includes(name))?.style,
        ),
      ).toEqual([
        { color: CYCLE[0] },
        { color: CYCLE[1] },
        { color: CYCLE[2] },
        { color: CYCLE[0] },
      ])
      expect(styleAt(rows, '▼')).toEqual({ color: HEAD })
      expect(['calls', '⇄'].map((word) => styleAt(rows, word))).toEqual([
        { color: LINE },
        { color: LINE },
      ])
      await ui.unmount()
    },
  )

  test('a junction draws as a small box with ●, and an edge with no arrow runs from the side that its ports name', () => {
    expect(drawnLines(JUNCTIONS)).toEqual(JUNCTIONS_ROWS)
  })

  test('a service keeps its title, a quoted title with an escaped quote, a text icon and no title, and align and accessibility lines draw nothing', () => {
    const parsed = parseMermaid(
      lines(
        'architecture-beta',
        '  accTitle: Shop',
        '  service a(logos:aws-ec2)[Server]',
        '  service b "icon text" ["Say \\"hi\\""]',
        '  service c',
        '  junction j in g',
        '  group g',
        '  a:R -- L:b',
        '  align row a b c',
      ),
    )
    expect(parsed.kind === 'architecture' ? [parsed.nodes, parsed.groups] : parsed).toEqual([
      [
        { id: 'a', isJunction: false, title: 'Server', parent: null },
        { id: 'b', isJunction: false, title: 'Say "hi"', parent: null },
        { id: 'c', isJunction: false, title: null, parent: null },
        { id: 'j', isJunction: true, title: null, parent: 'g' },
      ],
      [{ id: 'g', title: null, parent: null }],
    ])
  })

  for (const [source, line, reason] of [
    [lines('architecture', '  service a[A]'), 1, 'line 1 does not parse'],
    [lines('architecture-beta LR', '  service a[A]'), 1, 'line 1 does not parse'],
    [lines('architecture-beta', '  service a[A]', '  a:X -- L:a'), 3, 'line 3 does not parse'],
    [
      lines('architecture-beta', '  service a[A]', '  service a[B]'),
      3,
      'line 3: the id a is in use already',
    ],
    [
      lines(
        'architecture-beta',
        '  group inner[I] in outer',
        '  group outer[O]',
        '  service a in inner',
      ),
      2,
      'line 2: no group has the id outer',
    ],
    [
      lines('architecture-beta', '  service a[A]', '  service b[B] in a'),
      3,
      'line 3: a is not a group',
    ],
    [
      lines('architecture-beta', '  service a[A]', '  a:R -- L:a'),
      3,
      'an edge from a service to itself does not draw yet',
    ],
    [
      lines(
        'architecture-beta',
        '  group g[G]',
        '  service a[A] in g',
        '  service b[B] in g',
        '  a{group}:R -- L:b',
      ),
      5,
      'line 5: the edge does not pass between two groups',
    ],
    [lines('architecture-beta', '  service a[A]', '  align row a'), 3, 'line 3 does not parse'],
    [
      lines('architecture-beta', '  service a[A]', '  service b[B]', '  align column a b a'),
      4,
      'line 4: align names a twice',
    ],
    [
      lines('architecture-beta', '  group g[G]', '  service a[A]', '  align row a g'),
      4,
      'line 4: no service or junction has the id g',
    ],
    [lines('architecture-beta', '  group g[G]'), null, 'the architecture diagram has no services'],
  ] as const) {
    test(`an architecture diagram refuses ${line === null ? 'the block' : `line ${String(line)}`} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedBy(reason, line))
    })
  }
})
