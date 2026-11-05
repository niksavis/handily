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

const TCP = lines(
  'packet',
  'title TCP Packet',
  '0-15: "Source Port"',
  '16-31: "Destination Port"',
  '32-63: "Sequence Number"',
  '64-95: "Acknowledgment Number"',
  '96-99: "Data Offset"',
  '100-105: "Reserved"',
  '106: "URG"',
  '107: "ACK"',
  '108: "PSH"',
  '109: "RST"',
  '110: "SYN"',
  '111: "FIN"',
  '112-127: "Window"',
  '128-143: "Checksum"',
  '144-159: "Urgent Pointer"',
  '160-191: "(Options and Padding)"',
  '192-255: "Data (variable length)"',
)

const TCP_ROWS = [
  'TCP Packet',
  `┌0${'─'.repeat(28)}15┬16${'─'.repeat(27)}31┐`,
  `│${' '.repeat(10)}Source Port${' '.repeat(10)}│${' '.repeat(7)}Destination Port${' '.repeat(8)}│`,
  `├32${'─'.repeat(29)}┴${'─'.repeat(29)}63┤`,
  `│${' '.repeat(24)}Sequence Number${' '.repeat(24)}│`,
  `├64${'─'.repeat(59)}95┤`,
  `│${' '.repeat(21)}Acknowledgment Number${' '.repeat(21)}│`,
  `├96───99┬100─────105┬─┬─┬─┬─┬─┬─┬112${'─'.repeat(25)}127┤`,
  `│   1   │ Reserved  │2│3│4│5│6│7│${' '.repeat(12)}Window${' '.repeat(13)}│`,
  `├128────┴───────────┴─┴─┴─┴─┴─┴─┼144${'─'.repeat(25)}159┤`,
  `│${' '.repeat(11)}Checksum${' '.repeat(12)}│${' '.repeat(8)}Urgent Pointer${' '.repeat(9)}│`,
  `├160${'─'.repeat(28)}┴${'─'.repeat(28)}191┤`,
  `│${' '.repeat(21)}(Options and Padding)${' '.repeat(21)}│`,
  `├192${'─'.repeat(57)}223┤`,
  `│${' '.repeat(20)}Data (variable length)${' '.repeat(21)}│`,
  `├224${'─'.repeat(57)}255┤`,
  `│${' '.repeat(20)}Data (variable length)${' '.repeat(21)}│`,
  `└${'─'.repeat(63)}┘`,
  '1 Data Offset  bits 96-99',
  '2 URG  bit 106',
  '3 ACK  bit 107',
  '4 PSH  bit 108',
  '5 RST  bit 109',
  '6 SYN  bit 110',
  '7 FIN  bit 111',
]

const UDP = lines(
  'packet-beta',
  'title UDP Packet',
  '+16: "Source Port"',
  '+16: "Destination Port"',
  '32-47: "Length"',
  '48-63: "Checksum"',
  '64-95: "Data (variable length)"',
)

const UDP_FIELDS = [
  'Source Port',
  'Destination Port',
  'Length',
  'Checksum',
  'Data (variable length)',
]

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function refusedLine(line: number | null, reason: string) {
  return { kind: 'refused', reason, line, limit: null }
}

describe('a mermaid packet diagram', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a packet diagram draws its fields in rows of bits and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, UDP, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(UDP_FIELDS.filter((field) => !rows.some((row) => row.includes(field)))).toEqual([])
          const bits = columns === 80 ? 32 : columns === 40 ? 16 : 8
          const note = `${String(bits)} bits a row: 32 bits take 65 columns, the screen has`
          expect(rows.join(' ').includes(note)).toBe(bits !== 32)
          expect([rows[1]?.slice(0, 2), rows[1]?.length]).toEqual(['┌0', bits * 2 + 1])
          expect(await titleOf(ui)).toStartWith('── mermaid · packet ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `the TCP packet of the Mermaid page draws its bit numbers on the rules and keys for narrow fields on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, TCP, surface)
        expect((await drawnRows(ui, surface)).map(rowText)).toEqual(TCP_ROWS)
        await ui.unmount()
      },
    )

    viewTest(
      `copy on a drawn packet diagram copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, UDP, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([UDP, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the packet source', '7 lines'],
          ['✓ Copied the packet drawing', '8 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      ['a header it does not know', lines('packet LR', '0: "a"'), 'line 1 does not parse'],
      ['a name with no quotes', lines('packet', '0-15: Source'), 'line 2 does not parse'],
      [
        'a gap between two fields',
        lines('packet', '0-7: "a"', '9-15: "b"'),
        'line 3: the field starts at bit 9, not at bit 8',
      ],
      [
        'a field that ends before it starts',
        lines('packet', '5-3: "a"'),
        'line 2: the field ends at bit 3, before its start',
      ],
      ['a field of no bits', lines('packet', '+0: "a"'), 'line 2: a field has at least 1 bit'],
      ['no field', lines('packet', 'title Empty'), 'the packet has no fields'],
      ['more than 120 rows', lines('packet', '0-9999: "Payload"'), '627 rows, at most 120 draw'],
    ] as const) {
      viewTest(
        `a packet diagram with ${what} shows its source under a note that names the reason on ${surface}`,
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
      `a packet diagram on a screen narrower than 8 bits shows its source under the width note on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, UDP, surface, 14)
        expect(await noteOf(ui)).toBe(tooWideNote(17, surface === 'terminal' ? 12 : 14))
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a packet diagram draws each field in its cycle colour, a key bold, the bit numbers plain and the frame dim on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, TCP, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text.trim(), span.style])
      const [first, second, third] = CYCLE
      expect([1, 2].map(looks)).toEqual([
        [
          ['┌', { color: 'inactive' }],
          ['0', {}],
          ['────────────────────────────', { color: 'inactive' }],
          ['15', {}],
          ['┬', { color: 'inactive' }],
          ['16', {}],
          ['───────────────────────────', { color: 'inactive' }],
          ['31', {}],
          ['┐', { color: 'inactive' }],
        ],
        [
          ['│', { color: 'inactive' }],
          ['Source Port', { color: first }],
          ['│', { color: 'inactive' }],
          ['Destination Port', { color: second }],
          ['│', { color: 'inactive' }],
        ],
      ])
      expect(looks(8).slice(0, 4)).toEqual([
        ['│', { color: 'inactive' }],
        ['1', { color: second, bold: true }],
        ['│', { color: 'inactive' }],
        ['Reserved', { color: third }],
      ])
      await ui.unmount()
    },
  )

  test('fields by bit count, single quotes, an escaped quote, a comment and accessibility lines draw as Mermaid reads them', () => {
    const source = lines(
      'packet',
      'accTitle: Flags',
      'accDescr: Two flags and a byte',
      "+1: 'A' %% the first flag",
      '+1: "B \\" quoted"',
      '2-7: "Rest"',
    )
    expect(drawnLines(source)).toEqual([
      '┌0┬1┬2─────────7┐',
      '│A│1│   Rest    │',
      '└─┴─┴───────────┘',
      '1 B " quoted  bit 1',
    ])
  })

  for (const [source, line, reason] of [
    [lines('packet', '01-15: "a"'), 2, 'line 2 does not parse'],
    [lines('packet', '0-15 "a"'), 2, 'line 2 does not parse'],
    [lines('packet', '0-15: "a" extra'), 2, 'line 2 does not parse'],
    [lines('packet', '1-15: "a"'), 2, 'line 2: the field starts at bit 1, not at bit 0'],
    [lines('packetX'), 1, 'line 1 does not parse'],
  ] as const) {
    test(`a packet diagram refuses line ${String(line)} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
