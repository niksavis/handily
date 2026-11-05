import { describe, expect, test } from 'claude-code/testing'
import {
  bodyWidth,
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
  type Mounted,
  type Span,
  type Surface,
} from './fixtures/diagram-view'
import { C4_DOCS_EXAMPLES } from './fixtures/c4-examples'
import { diagramOf } from './hooks/draw'
import { wordWrapped } from './hooks/flowchart'
import { plainLabel } from './hooks/ink'
import { parseMermaid } from './hooks/mermaid'

const HEAD = 'claude'
const LINE = 'inactive'

const CHECKOUT = lines(
  'C4Container',
  '  title Checkout',
  '  Person(shopper, "Shopper", "Buys online")',
  '  Container_Boundary(shop, "Shop") {',
  '    Container(web, "Web App", "TypeScript", "Takes the orders")',
  '    ContainerDb(orders, "Orders", "Postgres")',
  '  }',
  '  Rel(shopper, web, "Orders", "HTTPS")',
  '  Rel(web, orders, "Stores")',
)

const CHECKOUT_ROWS = [
  'Checkout',
  '            ╭─────────────╮',
  '            │ Shopper     │',
  '            │ [Person]    │',
  '            │ Buys online │',
  '            ╰──────┬──────╯',
  '                   │ Orders',
  '                   │ [HTTPS]',
  '┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│┄ Shop [CONTAINER] ┄┐',
  '┆                  ▼                    ┆',
  '┆     ╭─────────────────────────╮       ┆',
  '┆     │ Web App                 │       ┆',
  '┆     │ [Container: TypeScript] │       ┆',
  '┆     │ Takes the orders        │       ┆',
  '┆     ╰────────────┬────────────╯       ┆',
  '┆                  │ Stores             ┆',
  '┆                  ▼                    ┆',
  '┆ ╭────────────────────────────────╮    ┆',
  '┆ │ Orders                         │    ┆',
  '┆ │ [Database Container: Postgres] │    ┆',
  '┆ ╰────────────────────────────────╯    ┆',
  '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
]

const PAYING = lines(
  'C4Container',
  '  title Checkout',
  '  Person(shopper, "Shopper", "Buys online")',
  '  Container_Boundary(shop, "Shop") {',
  '    Container(web, "Web App", "TypeScript", "Takes the orders")',
  '    ContainerDb(orders, "Orders", "Postgres")',
  '  }',
  '  System_Ext(cards, "Card Provider")',
  '  Rel(shopper, web, "Orders", "HTTPS")',
  '  Rel(web, orders, "Stores")',
  '  BiRel(web, cards, "Pays")',
)

const PAYING_ROWS = [
  'Checkout',
  '                             ╭─────────────╮',
  '                             │ Shopper     │',
  '                             │ [Person]    │',
  '                             │ Buys online │',
  '                             ╰──────┬──────╯',
  '                      ┌─────────────┘',
  '                      │ Orders',
  '                      │ [HTTPS]',
  '┌┄ Shop [CONTAINER] ┄┄│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐',
  '┆                     ▼              ┆',
  '┆        ╭─────────────────────────╮ ┆',
  '┆        │ Web App                 │ ┆',
  '┆        │ [Container: TypeScript] │ ┆',
  '┆        │ Takes the orders        │ ┆',
  '┆        ╰────────────┬────────────╯ ┆',
  '┆                  ┌──┴───────────────────────────────┐',
  '┆                  │ Stores          ┆                │ ⇄ Pays',
  '┆                  ▼                 ┆                │',
  '┆ ╭────────────────────────────────╮ ┆ ╭──────────────┴─────────────╮',
  '┆ │ Orders                         │ ┆ │ Card Provider              │',
  '┆ │ [Database Container: Postgres] │ ┆ │ [External Software System] │',
  '┆ ╰────────────────────────────────╯ ┆ ╰────────────────────────────╯',
  '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
]

const DYNAMIC = lines(
  'C4Dynamic',
  '  Person(user, "User")',
  '  Container(web, "Web")',
  '  ContainerQueue_Ext(jobs, "Jobs")',
  '  RelIndex(7, user, web, "Opens")',
  '  Rel_Back(jobs, web, "Queues")',
)

const DYNAMIC_ROWS = [
  '        ╭──────────╮',
  '        │ User     │',
  '        │ [Person] │',
  '        ╰─────┬────╯',
  '              │ 1: Opens',
  '              ▼',
  '       ╭─────────────╮',
  '       │ Web         │',
  '       │ [Container] │',
  '       ╰──────┬──────╯',
  '              │ 2: Queues',
  '              ▼',
  '╭────────────────────────────╮',
  '│ Jobs                       │',
  '│ [External Queue Container] │',
  '╰────────────────────────────╯',
]

const NESTED = lines(
  'C4Deployment',
  '  Deployment_Node(dc, "Data Centre", "Linux")',
  '  {',
  '    Node(vm, "App Server") {',
  '      Container(api, "API", "Go")',
  '    }',
  '    ContainerDb(db, "Store")',
  '  }',
  '  Rel(api, db, "Reads")',
)

const NESTED_ROWS = [
  ' ┌┄ App Server [node] in Data Centre ┄┐',
  ' ┆                                    ┆',
  ' ┆ ╭─────────────────╮                ┆',
  ' ┆ │ API             │                ┆',
  ' ┆ │ [Container: Go] │                ┆',
  ' ┆ ╰────────┬────────╯                ┆',
  ' └┄┄┄┄┄┄┄┄┄┄│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
  '            └─┐',
  '              │ Reads',
  '┌┄┄┄┄┄┄┄┄┄┄┄┄┄│┄ Data Centre [Linux] ┄┐',
  '┆             ▼                       ┆',
  '┆ ╭──────────────────────╮            ┆',
  '┆ │ Store                │            ┆',
  '┆ │ [Database Container] │            ┆',
  '┆ ╰──────────────────────╯            ┆',
  '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
]

const STEREOTYPE_WORDS = ['Person', 'Software', 'System', 'External', 'Database', 'Queue']

const TITLES: Readonly<Record<string, string>> = {
  C4Context: 'System Context diagram for Internet Banking System',
  C4Container: 'Container diagram for Internet Banking System',
  C4Component: 'Component diagram for Internet Banking System',
  C4Dynamic: 'Dynamic diagram for Internet Banking System',
  C4Deployment: 'Deployment Diagram for Internet Banking System',
}

async function openedRows(ui: Mounted, surface: Surface): Promise<Span[][]> {
  if ((await ui.find({ key: 'fold' })) !== undefined) await ui.press({ key: 'fold' })
  return drawnRows(ui, surface)
}

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

function colourOf(rows: readonly Span[][], text: string) {
  return rows.flat().find((span) => span.text.includes(text))?.style.color
}

describe('a mermaid C4 diagram', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a C4 diagram draws its title, its elements, its relations and a frame for its boundary and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, CHECKOUT, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(rows[0]).toBe('Checkout')
          expect(rows.filter((row) => row.includes('╭'))).toHaveLength(3)
          expect(rows.filter((row) => row.includes('▼'))).toHaveLength(2)
          expect(rows.filter((row) => /^┌┄+│┄ Shop \[CONTA/.test(row))).toHaveLength(1)
          if (columns === 80) expect(rows).toEqual(CHECKOUT_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · c4 ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn C4 diagram copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, CHECKOUT, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([CHECKOUT, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/)[0])).toEqual([
          '✓ Copied the c4 source',
          '✓ Copied the c4 drawing',
        ])
        await ui.unmount()
      },
    )

    viewTest(
      `a BiRel draws a line with no arrow head and ⇄ before its label, and an external system says so on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, PAYING, surface)
        expect((await drawnRows(ui, surface)).map(rowText)).toEqual(PAYING_ROWS)
        await ui.unmount()
      },
    )

    viewTest(
      `two elements side by side move onto their own rows at 40 columns, and every line fits, on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, PAYING, surface, 40)
        const rows = (await openedRows(ui, surface)).map(rowText)
        expect(tooWideRows(rows, surface, 40)).toEqual([])
        const orders = rows.findIndex((row) => row.includes('│ Orders '))
        const cards = rows.findIndex((row) => row.includes('│ Card '))
        expect(orders).toBeGreaterThan(0)
        expect(cards).toBeGreaterThan(orders)
        expect(rows.filter((row) => row.includes('⇄ Pays'))).toHaveLength(1)
        await ui.unmount()
      },
    )

    viewTest(
      `a C4 diagram too wide for 30 columns shows its source under the width note on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, PAYING, surface, 30)
        expect(await noteOf(ui)).toBe(tooWideNote(36, bodyWidth(surface, 30)))
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([PAYING])
        await ui.unmount()
      },
    )

    for (const [name, source] of Object.entries(C4_DOCS_EXAMPLES)) {
      viewTest(
        `the ${name} example of the Mermaid page draws at 80 columns and every line fits on ${surface}`,
        async (_world, $) => {
          const ui = await mountDiagram($, source, surface, 80)
          expect(await noteOf(ui)).toBeUndefined()
          const rows = (await openedRows(ui, surface)).map(rowText)
          expect(rows.length).toBeGreaterThan(10)
          expect(tooWideRows(rows, surface, 80)).toEqual([])
          expect(rows[0]).toStartWith(TITLES[name] ?? '')
          await ui.unmount()
        },
      )
    }

    for (const [what, source, note] of [
      [
        'a relation to a boundary',
        lines(
          'C4Context',
          '  System_Boundary(b, "Bank") {',
          '    System(core, "Core")',
          '  }',
          '  Person(p, "P")',
          '  Rel(p, b, "Uses")',
        ),
        'a relation to the boundary b does not draw yet',
      ],
      [
        'a relation to an alias that it does not declare',
        lines('C4Context', '  Person(p, "P")', '  Rel(p, ghost, "Uses")'),
        'line 3: no element has the alias ghost',
      ],
      [
        'an unquoted last argument, which Mermaid reads past the end of the line',
        lines('C4Context', '  Person(p, "P")', '  System(s, "S")', '  Rel(p, s, Uses)'),
        'line 4 does not parse',
      ],
    ] as const) {
      viewTest(
        `a C4 diagram with ${what} shows its source under a note that names the reason on ${surface}`,
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
    'the title and the names are bold, the elements take the cycle colours, the arrow heads are in claude and the relation words in inactive on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, CHECKOUT, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      expect(styleAt(rows, 'Checkout')).toEqual({ bold: true })
      expect(['Shopper', 'Web App'].map((name) => styleAt(rows, name))).toEqual([
        { color: CYCLE[0], bold: true },
        { color: CYCLE[1], bold: true },
      ])
      expect(
        rows
          .flat()
          .filter((span) => span.text.trim() === 'Orders')
          .map((span) => span.style),
      ).toEqual([{ color: LINE }, { color: CYCLE[2], bold: true }])
      expect(colourOf(rows, '[Container: TypeScript]')).toBe(CYCLE[1])
      expect(styleAt(rows, '▼')).toEqual({ color: HEAD })
      expect(['[HTTPS]', 'Stores'].map((word) => styleAt(rows, word))).toEqual([
        { color: LINE },
        { color: LINE },
      ])
      await ui.unmount()
    },
  )

  test('a label wraps at word boundaries, and only a word longer than the box is cut with …', () => {
    expect(
      wordWrapped(plainLabel('Provides functionality to customers via their browser'), 12).map(
        (line) => line.text,
      ),
    ).toEqual(['Provides', 'functionali…', 'to customers', 'via their', 'browser'])
  })

  test('no word of the Component example breaks across two lines at 80 columns', () => {
    const drawn = drawnLines(C4_DOCS_EXAMPLES.C4Component ?? '')
    const words = new Set([
      ...(C4_DOCS_EXAMPLES.C4Component ?? '').split(/[^\p{L}\p{N}]+/u),
      ...STEREOTYPE_WORDS,
    ])
    const pieces = drawn
      .join(' ')
      .split(/[^\p{L}\p{N}…]+/u)
      .filter((piece) => piece !== '' && !piece.endsWith('…'))
    expect(pieces.filter((piece) => !words.has(piece))).toEqual([])
  })

  test('C4Dynamic numbers its relations in order, RelIndex drops its index, and Rel_Back points at its first element', () => {
    expect(drawnLines(DYNAMIC)).toEqual(DYNAMIC_ROWS)
  })

  test('a nested boundary draws as its own frame named by its boundaries from the inside out, with the brace on the next line', () => {
    expect(drawnLines(NESTED)).toEqual(NESTED_ROWS)
  })

  test('each element keyword reads its kind, its technology and its description, by place or by name', () => {
    const parsed = parseMermaid(
      lines(
        'C4Component',
        '  accTitle: Parts',
        '  accDescr {',
        '    The parts',
        '  }',
        '  Person_Ext(p, "Partner", $descr="Sends files", $tags="v1")',
        '  SystemDb_Ext(s, "Ledger", , $sprite="db")',
        '  Component(c, "Parser", "Rust", "Reads files")',
        '  ComponentQueue(q, "Inbox", $techn="Kafka")',
        '  Container(c, "Parser two")',
        '  UpdateElementStyle(c, $fontColor="red")',
        '  UpdateRelStyle(p, c, $textColor="blue")',
        '  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")',
      ),
    )
    expect(parsed.kind === 'c4' ? parsed.elements : parsed).toEqual([
      {
        alias: 'p',
        shape: { base: 'Person', isExternal: true, store: '' },
        label: 'Partner',
        techn: '',
        descr: 'Sends files',
        boundary: null,
      },
      {
        alias: 's',
        shape: { base: 'Software System', isExternal: true, store: 'Database ' },
        label: 'Ledger',
        techn: '',
        descr: '',
        boundary: null,
      },
      {
        alias: 'c',
        shape: { base: 'Container', isExternal: false, store: '' },
        label: 'Parser two',
        techn: 'Rust',
        descr: 'Reads files',
        boundary: null,
      },
      {
        alias: 'q',
        shape: { base: 'Component', isExternal: false, store: 'Queue ' },
        label: 'Inbox',
        techn: 'Kafka',
        descr: '',
        boundary: null,
      },
    ])
  })

  test('the boundary keywords give their types, and a second relation between two elements replaces the first', () => {
    const parsed = parseMermaid(
      lines(
        'C4Context',
        '  Enterprise_Boundary(e, "Bank", "ignored") {',
        '    System_Boundary(s, "Core") {',
        '      System(a, "A")',
        '    }',
        '    Boundary(b, "Edge") {',
        '      System(c, "C")',
        '    }',
        '  }',
        '  Rel(a, c, "Calls", "HTTP")',
        '  Rel_D(a, c, "Asks")',
      ),
    )
    expect(parsed.kind === 'c4' ? [parsed.boundaries, parsed.relations] : parsed).toEqual([
      [
        { alias: 'e', label: 'Bank', type: 'ENTERPRISE', parent: null },
        { alias: 's', label: 'Core', type: 'SYSTEM', parent: 'e' },
        { alias: 'b', label: 'Edge', type: 'system', parent: 'e' },
      ],
      [{ from: 'a', to: 'c', heads: 'forward', label: 'Asks', techn: 'HTTP' }],
    ])
  })

  for (const [source, line, reason] of [
    [lines('C4Context LR', '  Person(p, "P")'), 1, 'line 1 does not parse'],
    [lines('C4Context', '  direction LR', '  Person(p, "P")'), 2, 'line 2 does not parse'],
    [lines('C4Context', '  Person (p, "P")'), 2, 'line 2 does not parse'],
    [lines('C4Context', '  Person(p, "P") extra'), 2, 'line 2 does not parse'],
    [lines('C4Context', '  Person(p, P)'), 2, 'line 2 does not parse'],
    [lines('C4Context', '  title A # B', '  Person(p, "P")'), 2, 'line 2 does not parse'],
    [lines('C4Context', '  UpdateBoundaryStyle(b, $bgColor="red")'), 2, 'line 2 does not parse'],
    [lines('C4Context', '  Lay_D(a, b)'), 2, 'line 2 does not parse'],
    [lines('C4Context', '  Boundary(b, "B") {', '  }'), 3, 'line 3 does not parse'],
    [lines('C4Context', '  Boundary(b, "B")', '  Person(p, "P")'), 3, 'line 3 does not parse'],
    [lines('C4Context', '  Person(p, "P")', '  }'), 3, 'line 3 does not parse'],
    [
      lines('C4Context', '  Boundary(b, "B") {', '    Person(p, "P")'),
      2,
      'line 2 opens a boundary with no end',
    ],
    [
      lines('C4Context', '  Person(p, "P")', '  Rel(p, p, "Thinks")'),
      3,
      'a relation from an element to itself does not draw yet',
    ],
    [
      lines('C4Context', '  Boundary(p, "B") {', '    Person(p, "P")', '  }'),
      3,
      'line 3: the alias p is in use already',
    ],
    [lines('C4Context', '  title Empty'), null, 'the C4 diagram has no elements'],
  ] as const) {
    test(`a C4 diagram refuses ${line === null ? 'the block' : `line ${String(line)}`} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedBy(reason, line))
    })
  }
})
