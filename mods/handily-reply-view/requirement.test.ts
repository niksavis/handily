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
  type Span,
} from './fixtures/diagram-view'
import { parseMermaid } from './hooks/mermaid'

const HEAD = 'claude'
const LINE = 'inactive'

const CHECKOUT = lines(
  'requirementDiagram',
  '  requirement checkout {',
  '    id: 1',
  '    text: Orders are payable online.',
  '    risk: high',
  '    verifymethod: test',
  '  }',
  '  functionalRequirement card {',
  '    id: 1.1',
  '    text: Card payments are authorised.',
  '    risk: medium',
  '    verifymethod: inspection',
  '  }',
  '  element gateway {',
  '    type: payment service',
  '  }',
  '  gateway - satisfies -> checkout',
  '  checkout - contains -> card',
)

const CHECKOUT_ROWS = [
  '╭─────────────────────────────────────╮',
  '│ «Element»                           │',
  '│ gateway                             │',
  '├─────────────────────────────────────┤',
  '│ Type: payment service               │',
  '╰──────────────────┬──────────────────╯',
  '                   ╎',
  '                   ╎ «satisfies»',
  '                   ▼',
  '╭─────────────────────────────────────╮',
  '│ «Requirement»                       │',
  '│ checkout                            │',
  '├─────────────────────────────────────┤',
  '│ ID: 1                               │',
  '│ Text: Orders are payable online.    │',
  '│ Risk: High                          │',
  '│ Verification: Test                  │',
  '╰─────────────────────────────────────╯',
  '                   ⊕',
  '                   │ «contains»',
  '                   │',
  '╭──────────────────┴──────────────────╮',
  '│ «Functional Requirement»            │',
  '│ card                                │',
  '├─────────────────────────────────────┤',
  '│ ID: 1.1                             │',
  '│ Text: Card payments are authorised. │',
  '│ Risk: Medium                        │',
  '│ Verification: Inspection            │',
  '╰─────────────────────────────────────╯',
]

const PAYMENT = lines(
  'requirementDiagram',
  '  requirement checkout_req {',
  '    id: 1',
  '    text: Orders must be payable online.',
  '  }',
  '  functionalRequirement payment_req {',
  '    id: 1.1',
  '  }',
  '  element checkout_service {',
  '    type: service',
  '  }',
  '  checkout_req - contains -> payment_req',
  '  checkout_service - satisfies -> payment_req',
)

const PAYMENT_ROWS = [
  '╭──────────────────────────────────────╮',
  '│ «Requirement»                        │',
  '│ checkout_req                         │',
  '├──────────────────────────────────────┤',
  '│ ID: 1                                │',
  '│ Text: Orders must be payable online. │',
  '╰──────────────────────────────────────╯',
  '                    ⊕',
  '                    │ «contains»',
  '                    │',
  '╭───────────────────┴──────────────────╮',
  '│ «Functional Requirement»             │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐',
  '│ payment_req                          │               ╎',
  '├──────────────────────────────────────┤               ╎',
  '│ ID: 1.1                              │               ╎',
  '╰──────────────────────────────────────╯               ╎',
  '                                                       ╎',
  '╭──────────────────────────────────────╮               ╎',
  '│ «Element»                            ├╌ «satisfies» ╌┘',
  '│ checkout_service                     │',
  '├──────────────────────────────────────┤',
  '│ Type: service                        │',
  '╰──────────────────────────────────────╯',
]

function refusedBy(reason: string, line: number | null = null) {
  return { kind: 'refused', reason, line, limit: null }
}

function styleAt(rows: readonly Span[][], text: string) {
  return rows.flat().find((span) => span.text.trim() === text)?.style
}

function colourOf(rows: readonly Span[][], text: string) {
  return rows.flat().find((span) => span.text.includes(text))?.style.color
}

describe('a mermaid requirement diagram', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a requirement diagram draws each box with its type, its name and its fields and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, CHECKOUT, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(rows.filter((row) => row.startsWith('╭'))).toHaveLength(3)
          expect(rows.filter((row) => row.includes('«satisfies»'))).toHaveLength(1)
          expect(rows.filter((row) => row.trim() === '⊕')).toHaveLength(1)
          if (columns === 80) expect(rows).toEqual(CHECKOUT_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · requirement ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn requirement diagram copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, CHECKOUT, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([CHECKOUT, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/)[0])).toEqual([
          '✓ Copied the requirement source',
          '✓ Copied the requirement drawing',
        ])
        await ui.unmount()
      },
    )

    viewTest(
      `a relation that skips a box runs on the right with its arrow head beside its target on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, PAYMENT, surface)
        expect((await drawnRows(ui, surface)).map(rowText)).toEqual(PAYMENT_ROWS)
        await ui.unmount()
      },
    )

    viewTest(
      `a requirement diagram with a relation on the right shows its source under the width note at 30 columns on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, PAYMENT, surface, 30)
        expect(await noteOf(ui)).toBe(tooWideNote(32, bodyWidth(surface, 30)))
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([PAYMENT])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      [
        'a relation to a name that it does not define',
        lines('requirementDiagram', '  element a {', '  }', '  a - traces -> ghost'),
        'line 4: no requirement or element has the name ghost',
      ],
      [
        'a value that starts with a keyword',
        lines('requirementDiagram', '  requirement a {', '    text: test the login', '  }'),
        'line 3 does not parse',
      ],
      [
        'a box with no closing brace',
        lines('requirementDiagram', '  requirement a {', '    id: 1'),
        'requirement a has no closing brace',
      ],
    ] as const) {
      viewTest(
        `a requirement diagram with ${what} shows its source under a note that names the reason on ${surface}`,
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
    'the boxes take the cycle colours, the names are bold, the field names and the relations are in inactive and the marks in claude on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, CHECKOUT, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      expect(
        ['«Element»', '«Requirement»', '«Functional Requirement»'].map((type) =>
          colourOf(rows, type),
        ),
      ).toEqual([CYCLE[0], CYCLE[1], CYCLE[2]])
      expect(['gateway', 'checkout', 'card'].map((name) => styleAt(rows, name))).toEqual([
        { color: CYCLE[0], bold: true },
        { color: CYCLE[1], bold: true },
        { color: CYCLE[2], bold: true },
      ])
      expect(
        ['ID:', 'Text:', 'Risk:', 'Verification:', 'Type:'].map((key) => styleAt(rows, key)),
      ).toEqual([
        { color: LINE },
        { color: LINE },
        { color: LINE },
        { color: LINE },
        { color: LINE },
      ])
      expect(styleAt(rows, 'Orders are payable online.')).toEqual({})
      expect(['⊕', '▼'].map((mark) => styleAt(rows, mark))).toEqual([
        { color: HEAD },
        { color: HEAD },
      ])
      expect(['«satisfies»', '«contains»'].map((word) => styleAt(rows, word))).toEqual([
        { color: LINE },
        { color: LINE },
      ])
      await ui.unmount()
    },
  )

  test('keywords read in any case, quoted values keep their text, the first value of a field wins, and a backward relation reads from its right side', () => {
    expect(
      parseMermaid(
        lines(
          'requirementDiagram',
          '  REQUIREMENT "Login works" {',
          '    ID: "A-1"',
          '    Text: "must log in: fast"',
          '    id: 2',
          '    RISK: Low',
          '    VerifyMethod: Analysis',
          '  }',
          '  element "Test suite" {',
          '    docRef: tests/login',
          '  }',
          '  "Login works" <- Verifies - "Test suite"',
        ),
      ),
    ).toEqual({
      kind: 'requirement',
      boxes: [
        {
          name: 'Login works',
          type: 'Requirement',
          isElement: false,
          fields: [
            { key: 'ID', value: ['A-1'] },
            { key: 'Text', value: ['must log in: fast'] },
            { key: 'Risk', value: ['Low'] },
            { key: 'Verification', value: ['Analysis'] },
          ],
        },
        {
          name: 'Test suite',
          type: 'Element',
          isElement: true,
          fields: [{ key: 'Doc Ref', value: ['tests/login'] }],
        },
      ],
      relations: [{ from: 'Test suite', to: 'Login works', type: 'verifies' }],
    })
  })

  test('each requirement type keyword names its type, and a second definition of a name keeps the first', () => {
    const types = [
      'requirement',
      'functionalRequirement',
      'interfaceRequirement',
      'performanceRequirement',
      'physicalRequirement',
      'designConstraint',
    ]
    const parsed = parseMermaid(
      lines(
        'requirementDiagram',
        ...types.flatMap((type, at) => [`  ${type} r${String(at)} {`, '  }']),
        '  designConstraint r0 {',
        '    id: 9',
        '  }',
      ),
    )
    expect(
      parsed.kind === 'requirement'
        ? parsed.boxes.map((box) => [box.name, box.type, box.fields])
        : parsed,
    ).toEqual([
      ['r0', 'Requirement', []],
      ['r1', 'Functional Requirement', []],
      ['r2', 'Interface Requirement', []],
      ['r3', 'Performance Requirement', []],
      ['r4', 'Physical Requirement', []],
      ['r5', 'Design Constraint', []],
    ])
  })

  test('direction, styles, classes, accessibility lines and comments draw nothing', () => {
    const parsed = parseMermaid(
      lines(
        'requirementDiagram',
        '  direction LR',
        '  accTitle: Login',
        '  accDescr {',
        '    The login requirement',
        '  }',
        '  %% a comment',
        '  # another comment',
        '  requirement login:::important {',
        '    id: 1',
        '  }',
        '  classDef important fill:#f96',
        '  class login important',
        '  style login fill:#ffa',
        '  login:::other',
      ),
    )
    expect(parsed.kind === 'requirement' ? parsed.boxes.map((box) => box.name) : parsed).toEqual([
      'login',
    ])
  })

  for (const [source, line, reason] of [
    [lines('requirementDiagram LR', '  element a {', '  }'), 1, 'line 1 does not parse'],
    [
      lines('requirementDiagram', '  title Login', '  element a {', '  }'),
      2,
      'line 2 does not parse',
    ],
    [
      lines('requirementDiagram', '  element a {', '  }', '  a - needs -> a'),
      4,
      'line 4 does not parse',
    ],
    [
      lines('requirementDiagram', '  requirement a {', '    text: log-in', '  }'),
      3,
      'line 3 does not parse',
    ],
    [
      lines('requirementDiagram', '  requirement a {', '    risk: severe', '  }'),
      3,
      'line 3 does not parse',
    ],
    [
      lines('requirementDiagram', '  requirement a {', '    owner: me', '  }'),
      3,
      'line 3 does not parse',
    ],
    [lines('requirementDiagram', '  element a {', '    id: 1', '  }'), 3, 'line 3 does not parse'],
    [lines('requirementDiagram', '  requirement a', '  {', '  }'), 2, 'line 2 does not parse'],
    [
      lines('requirementDiagram', '  requirement a {', '  }', '  a - traces -> a'),
      4,
      'a relationship from a box to itself does not draw yet',
    ],
    [
      lines('requirementDiagram', '  requirement a {', '  }', '  element a {', '  }'),
      4,
      'line 4: the name a is in use already',
    ],
    [
      lines('requirementDiagram', '  direction TB'),
      null,
      'the requirement diagram has no requirements or elements',
    ],
  ] as const) {
    test(`a requirement diagram refuses ${line === null ? 'the block' : `line ${String(line)}`} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedBy(reason, line))
    })
  }
})
