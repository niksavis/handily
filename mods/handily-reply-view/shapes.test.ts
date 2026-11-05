import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { drawFlowchart } from './hooks/flowchart'
import type { InkedDrawing } from './hooks/ink'
import { parseMermaid, type Flowchart, type SequenceDiagram } from './hooks/mermaid'
import { drawSequence } from './hooks/sequence'
import { displayWidth } from './hooks/width'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [80, 40, 30] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const REMEDY = 'Widen the window or shorten the labels.'
const STYLE_PROPS = ['color', 'bold', 'italic', 'underline'] as const
const CYCLE = ['suggestion', 'planMode', 'merged'] as const

type Surface = (typeof SURFACES)[number]

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

type Style = Partial<Record<(typeof STYLE_PROPS)[number], unknown>>

type Span = { text: string; style: Style }

type World = { copies: string[] }

function lines(...rows: string[]): string {
  return rows.join('\n')
}

const FLOWCHART = lines(
  'flowchart TD',
  '  A[Ask] --> B{Fits?}',
  '  B -->|yes| C(Draw)',
  '  B -->|no| D([Note])',
  '  D --> E[[Wait]]',
)

const CORNERS = { Ask: '╭', '◇ Fits?': '┌', Draw: '╭', Note: '╭', Wait: '╭' } as const

const CALLS = lines(
  'sequenceDiagram',
  '  You->>Claude: prompt',
  '  Claude->>reply-view: reply text',
  '  reply-view-->>You: drawn reply',
  '  reply-view->>reply-view: cache by width',
  '  Note over reply-view: layout once per width',
)

const MARKED_FLOWCHART = lines(
  'flowchart LR',
  '  A[**Bold** step] --> B[_quiet_ <u>under</u>]',
  '  B --> C[snake_case_name]',
)

const MARKED_SEQUENCE = lines(
  'sequenceDiagram',
  '  participant A as <u>Ann</u>',
  '  participant B as Bo',
  '  A->>B: **ask** _now_',
)

const WIDE_FLOWCHART = lines(
  'flowchart TD',
  '  A[Start] --> B[Alpha box] & C[Bravo box] & D[Charlie box] & E[Delta box]',
)

const WIDE_SEQUENCE = lines(
  'sequenceDiagram',
  '  participant A as The first participant',
  '  participant B as The second participant',
  '  A->>B: hi',
)

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null
}

function styleOf(props: Record<string, unknown>): Style {
  return Object.fromEntries(
    STYLE_PROPS.flatMap((name) => (name in props ? [[name, props[name]]] : [])),
  )
}

function spansOf(node: unknown, style: Style = {}): Span[] {
  if (typeof node === 'string') return node === '' ? [] : [{ text: node, style }]
  if (!isNode(node)) return []
  const own = node.type === 'Text' ? { ...style, ...styleOf(node.props ?? {}) } : style
  return (node.children ?? []).flatMap((child) => spansOf(child, own))
}

function engineBeneath(on: On): World {
  const world: World = { copies: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    world.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  return world
}

function viewTest(name: string, body: (world: World, $: Engine) => unknown): void {
  test(name, async ($, on) => {
    const world = engineBeneath(on)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

async function mountDiagram($: Engine, source: string, surface: Surface, columns = 80) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: {
      text: ['The diagram:', '', '```mermaid', source, '```'].join('\n'),
      isFirstOfReply: true,
    },
    requestId: 'message-1',
    viewport: { columns, rows: 40 },
  })
}

type Mounted = Awaited<ReturnType<typeof mountDiagram>>

function bodyWidth(surface: Surface, columns: number): number {
  return surface === 'terminal' ? columns - 2 : columns
}

async function drawnRows(ui: Mounted, surface: Surface): Promise<Span[][]> {
  if (surface === 'desktop') {
    const source = (await ui.find({ type: 'Code' }))?.props.source
    if (typeof source !== 'string') throw new Error('the desktop drew no Code element')
    return source.split('\n').map((text) => [{ text, style: {} }])
  }
  const drawing = await ui.find({ key: 'block-1-drawing-lines' })
  return (drawing?.children ?? []).map((row) => spansOf(row))
}

function rowText(row: readonly Span[]): string {
  return row.map((span) => span.text).join('')
}

function cornerAbove(rows: readonly string[], label: string): string | undefined {
  const inside = `│ ${label} │`
  const at = rows.findIndex((row) => row.includes(inside))
  return rows[at - 1]?.[rows[at]?.indexOf(inside) ?? -1]
}

function boxColours(rows: readonly Span[][]): unknown[][] {
  return rows.map((row) =>
    row.filter((span) => span.text.trim() !== '').map((span) => span.style.color),
  )
}

function looksOf(rows: readonly Span[][], word: string): Span | undefined {
  return rows.flat().find((span) => span.text.includes(word))
}

function sequenceOf(source: string): SequenceDiagram {
  const diagram = parseMermaid(source)
  if (diagram.kind !== 'sequence') throw new Error(`not a sequence diagram: ${diagram.kind}`)
  return diagram
}

function sequenceLines(source: string): string[] {
  const drawn = drawSequence(sequenceOf(source), 78)
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function flowchartDrawing(source: string): InkedDrawing {
  const chart = parseMermaid(source)
  if (chart.kind !== 'flowchart') throw new Error(`not a flowchart: ${chart.kind}`)
  const drawn = drawFlowchart(chart, 78)
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn
}

function boxed(...rows: string[]): string[] {
  const inner = Math.max(...rows.map(displayWidth))
  const pad = (row: string) => row + ' '.repeat(inner - displayWidth(row))
  return [
    `╭${'─'.repeat(inner + 2)}╮`,
    ...rows.map((row) => `│ ${pad(row)} │`),
    `╰${'─'.repeat(inner + 2)}╯`,
  ]
}

function styledRuns(drawing: InkedDrawing): string[] {
  return drawing.inked
    .flat()
    .filter((run) => run.looks.isBold || run.looks.isItalic || run.looks.isUnderline)
    .map((run) => run.text)
}

function messages(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `  A->>B: m${String(index)}`)
}

describe('rounded diagram shapes', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a flowchart draws every box but a decision rounded and each line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, FLOWCHART, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(Object.keys(CORNERS).map((label) => cornerAbove(rows, label))).toEqual(
            Object.values(CORNERS),
          )
          expect(rows.filter((row) => displayWidth(row) > bodyWidth(surface, columns))).toEqual([])
          await ui.unmount()
        },
      )
    }
  }

  test('a sequence diagram repeats its participants at the bottom only when its lifelines pass 10 rows', () => {
    const ten = sequenceLines(lines('sequenceDiagram', ...messages(5)))
    expect(ten).toHaveLength(3 + 10)
    expect(ten.at(-1)).toBe('  │───────────▶│')
    const eleven = sequenceLines(lines('sequenceDiagram', ...messages(4), '  Note over A: wait'))
    expect(eleven).toHaveLength(3 + 11 + 3)
    expect([eleven.slice(0, 3), eleven.slice(-3)]).toEqual([
      ['  ╭───╮        ╭───╮', '  │ A │        │ B │', '  ╰─┬─╯        ╰─┬─╯'],
      ['  ╭─┴─╮        ╭─┴─╮', '  │ A │        │ B │', '  ╰───╯        ╰───╯'],
    ])
  })

  for (const surface of SURFACES) {
    viewTest(
      `the participants of a long sequence diagram draw again at the bottom in the same colours on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, CALLS, surface)
        const rows = await drawnRows(ui, surface)
        expect(rows.slice(-3).map(rowText)).toEqual([
          '╭──┴──╮        ╭────┴───╮        ╭──────┴─────╮',
          '│ You │        │ Claude │        │ reply-view │',
          '╰─────╯        ╰────────╯        ╰────────────╯',
        ])
        const colours = surface === 'terminal' ? [...CYCLE] : [undefined]
        expect([boxColours(rows.slice(0, 3)), boxColours(rows.slice(-3))]).toEqual([
          [colours, colours, colours],
          [colours, colours, colours],
        ])
        await ui.unmount()
      },
    )
  }
})

describe('message colours', () => {
  viewTest(
    'a message line and its head take the colour of the sender on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, CALLS, 'terminal')
      const spans = (await drawnRows(ui, 'terminal')).flat()
      expect(
        spans
          .filter((span) => /^[─╌◀▶┐┘]+$/.test(span.text))
          .map((span) => [span.text, span.style.color]),
      ).toEqual([
        ['───────────────▶', 'suggestion'],
        ['──────────────────▶', 'planMode'],
        ['◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌', 'merged'],
        ['╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌', 'merged'],
        ['──┐', 'merged'],
        ['◀─┘', 'merged'],
      ])
      expect(spans.filter((span) => span.style.color === 'claude')).toEqual([])
      await ui.unmount()
    },
  )
})

describe('label markup', () => {
  for (const surface of SURFACES) {
    viewTest(
      `a flowchart label draws bold, italic and underline, its width counts without the marks, and copy keeps the source on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, MARKED_FLOWCHART, surface)
        const rows = await drawnRows(ui, surface)
        const text = rows.map(rowText)
        expect(text).toEqual([
          '╭───────────╮   ╭─────────────╮   ╭─────────────────╮',
          '│ Bold step │──▶│ quiet under │──▶│ snake_case_name │',
          '╰───────────╯   ╰─────────────╯   ╰─────────────────╯',
        ])
        const looks = ['Bold', 'quiet', 'under', 'snake'].map((word) => looksOf(rows, word))
        expect(looks).toEqual(
          surface === 'terminal'
            ? [
                { text: 'Bold', style: { color: 'suggestion', bold: true } },
                { text: 'quiet', style: { color: 'planMode', italic: true } },
                { text: 'under', style: { color: 'planMode', underline: true } },
                { text: '│ snake_case_name │', style: { color: 'merged' } },
              ]
            : Array<Span>(4).fill({ text: text[1] ?? '', style: {} }),
        )
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([MARKED_FLOWCHART, text.join('\n')])
        await ui.unmount()
      },
    )

    for (const columns of WIDTHS) {
      viewTest(
        `a sequence label draws underline, bold and italic without the marks and fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, MARKED_SEQUENCE, surface, columns)
          const rows = await drawnRows(ui, surface)
          expect(rows.map(rowText)).toEqual([
            '╭─────╮        ╭────╮',
            '│ Ann │        │ Bo │',
            '╰──┬──╯        ╰──┬─╯',
            '   │   ask now    │',
            '   │─────────────▶│',
          ])
          expect(
            rows.map(rowText).filter((row) => displayWidth(row) > bodyWidth(surface, columns)),
          ).toEqual([])
          const style = (word: string) => looksOf(rows, word)?.style
          expect([style('Ann'), style('ask'), style('now')]).toEqual(
            surface === 'terminal'
              ? [{ color: 'suggestion', underline: true }, { bold: true }, { italic: true }]
              : [{}, {}, {}],
          )
          await ui.unmount()
        },
      )
    }
  }
})

describe('marks where markdown sees none', () => {
  for (const label of ['y = x ** 2 + z ** 3', 'f(**a, **b)', '***a***']) {
    test(`the label ${label} draws as written and its box fits the written text`, () => {
      const drawing = flowchartDrawing(lines('flowchart TD', `  A["${label}"]`))
      expect(drawing.lines).toEqual(boxed(label))
      expect(styledRuns(drawing)).toEqual([])
    })
  }

  test('an underline split by a line break draws as written and its box fits both lines', () => {
    const drawing = flowchartDrawing(lines('flowchart TD', '  A[<u>one<br>two</u>]'))
    expect(drawing.lines).toEqual(boxed('<u>one', 'two</u>'))
    expect(styledRuns(drawing)).toEqual([])
  })

  test('a bold pair with no space inside its marks still draws bold', () => {
    const drawing = flowchartDrawing(lines('flowchart TD', '  A[x **2** y]'))
    expect(drawing.lines).toEqual(boxed('x 2 y'))
    expect(styledRuns(drawing)).toEqual(['2'])
  })
})

describe('the width note', () => {
  for (const surface of SURFACES) {
    for (const [kind, source] of [
      ['flowchart', WIDE_FLOWCHART],
      ['sequence diagram', WIDE_SEQUENCE],
    ] as const) {
      viewTest(
        `a ${kind} too wide for 40 columns names its width and ends with the remedy on ${surface}`,
        async (world, $) => {
          const ui = await mountDiagram($, source, surface, 40)
          const note = await ui.find({ type: 'Text', text: /^diagram not drawn:/ })
          const screen = String(bodyWidth(surface, 40))
          expect(note?.text).toMatch(
            new RegExp(
              `^diagram not drawn: it takes \\d+ columns, the screen has ${screen}\\. ${REMEDY.replaceAll('.', '\\.')}$`,
            ),
          )
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([source])
          await ui.unmount()
        },
      )
    }
  }
})

const POINT_SOURCES = ['A', 'B', 'C', 'D'] as const
const POINT_CELLS = new Set(['◉', '━', '┃'])

function pointChart(direction: 'TD' | 'LR', entries: number): Flowchart {
  const sources = POINT_SOURCES.slice(0, entries)
  return {
    kind: 'flowchart',
    direction,
    nodes: [
      ...sources.map((id) => ({ id, shape: 'rounded' as const, label: [id] })),
      { id: 'end', shape: 'point' as const, label: ['◉'] },
    ],
    edges: sources.map((from, at) => ({
      from,
      to: 'end',
      stroke: 'solid' as const,
      arrow: true,
      label: [`e${String(at)}`],
    })),
  }
}

function pointDrawing(direction: 'TD' | 'LR', entries: number, width: number): InkedDrawing {
  const drawn = drawFlowchart(pointChart(direction, entries), width)
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn
}

type Point = { row: number; col: number }

function headEnds(rows: readonly string[], head: string, step: Point): string[] {
  const cells = rows.map((row) => Array.from(row))
  return cells.flatMap((row, at) =>
    row.flatMap((cell, col) =>
      cell === head ? [cells[at + step.row]?.[col + step.col] ?? ' '] : [],
    ),
  )
}

const ENTRY_HEADS = {
  TD: { head: '▼', step: { row: 1, col: 0 } },
  LR: { head: '▶', step: { row: 0, col: 1 } },
} as const

describe('a point with several entries', () => {
  for (const direction of ['TD', 'LR'] as const) {
    for (const entries of [3, 4]) {
      for (const columns of WIDTHS) {
        test(`each of ${String(entries)} ${direction} entries ends at the point on terminal at ${String(columns)} columns`, () => {
          const rows = pointDrawing(direction, entries, bodyWidth('terminal', columns)).lines
          const { head, step } = ENTRY_HEADS[direction]
          const ends = headEnds(rows, head, step)
          expect(ends).toHaveLength(entries)
          expect(ends.filter((cell) => !POINT_CELLS.has(cell))).toEqual([])
          expect(rows.join('\n').split('◉')).toHaveLength(2)
          expect(rows.filter((row) => displayWidth(row) > bodyWidth('terminal', columns))).toEqual(
            [],
          )
        })
      }
    }
  }

  test('three entries from above end on a bar that holds the point, both in the colour of the heads', () => {
    const drawing = pointDrawing('TD', 3, bodyWidth('terminal', 80))
    expect(drawing.lines).toEqual([
      '╭───╮  ╭───╮  ╭───╮',
      '│ A │  │ B │  │ C │',
      '╰─┬─╯  ╰─┬─╯  ╰─┬─╯',
      '  └─┐    │    ┌─┘',
      '    │ e0 │ e1 │ e2',
      '    ▼    ▼    ▼',
      '  ━━━━━━━◉━━━━━━━',
    ])
    const pointInks = drawing.inked
      .flat()
      .filter((run) => /[━◉]/.test(run.text))
      .map((run) => run.ink)
    expect([...new Set(pointInks)]).toEqual(['head'])
  })
})

const ORDERS = lines(
  'sequenceDiagram',
  '    Browser->>API: POST /orders',
  '    API->>DB: insert order',
  '    DB-->>API: id 42',
  '    API-->>Browser: 201 Created',
)

const CHECKED_ORDERS = lines(
  'sequenceDiagram',
  '    Browser->>API: POST /orders',
  '    API->>Auth: check token',
  '    Auth-->>API: ok',
  '    API->>DB: insert order',
  '    DB-->>API: id 42',
  '    API-->>Browser: 201 Created',
)

const ORDER_WORDS = [
  'Browser',
  'API',
  'DB',
  'POST',
  '/orders',
  'insert',
  'order',
  'id',
  '42',
  '201',
  'Created',
]

const CHECKED_WORDS = [...ORDER_WORDS, 'Auth', 'check', 'token', 'ok']

function missingWords(rows: readonly string[], words: readonly string[]): string[] {
  const tokens = new Set(rows.flatMap((row) => row.split(/\s+/)))
  return words.filter((word) => !tokens.has(word))
}

describe('a narrow sequence diagram', () => {
  for (const surface of SURFACES) {
    for (const [name, source, words, columns] of [
      ['three participants', ORDERS, ORDER_WORDS, 30],
      ['four participants', CHECKED_ORDERS, CHECKED_WORDS, 40],
    ] as const) {
      viewTest(
        `a sequence diagram of ${name} draws at ${String(columns)} columns on ${surface} with whole words and every line within the body`,
        async (_world, $) => {
          const ui = await mountDiagram($, source, surface, columns)
          expect(await ui.find({ type: 'Text', text: /^diagram not drawn:/ })).toBeUndefined()
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(rows.length).toBeGreaterThan(0)
          expect(rows.filter((row) => displayWidth(row) > bodyWidth(surface, columns))).toEqual([])
          expect(missingWords(rows, words)).toEqual([])
          await ui.unmount()
        },
      )
    }
  }

  test('the orders at 80 columns draw as before, with the roomy gaps and whole labels', () => {
    expect(sequenceLines(ORDERS).map((row) => row.trimEnd())).toEqual([
      '╭─────────╮        ╭─────╮          ╭────╮',
      '│ Browser │        │ API │          │ DB │',
      '╰────┬────╯        ╰──┬──╯          ╰──┬─╯',
      '     │ POST /orders   │                │',
      '     │───────────────▶│                │',
      '     │                │ insert order   │',
      '     │                │───────────────▶│',
      '     │                │     id 42      │',
      '     │                │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│',
      '     │  201 Created   │                │',
      '     │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│                │',
    ])
  })

  test('the orders at 30 columns on terminal wrap each label at its spaces between closer boxes', () => {
    const drawn = drawSequence(sequenceOf(ORDERS), bodyWidth('terminal', 30))
    expect(drawn.kind === 'drawing' ? drawn.lines.map((row) => row.trimEnd()) : drawn).toEqual([
      '╭─────────╮  ╭─────╮  ╭────╮',
      '│ Browser │  │ API │  │ DB │',
      '╰────┬────╯  ╰──┬──╯  ╰──┬─╯',
      '     │ POST     │        │',
      '     │ /orders  │        │',
      '     │─────────▶│        │',
      '     │          │ insert │',
      '     │          │ order  │',
      '     │          │───────▶│',
      '     │          │ id 42  │',
      '     │          │◀╌╌╌╌╌╌╌│',
      '     │ 201      │        │',
      '     │ Created  │        │',
      '     │◀╌╌╌╌╌╌╌╌╌│        │',
      '╭────┴────╮  ╭──┴──╮  ╭──┴─╮',
      '│ Browser │  │ API │  │ DB │',
      '╰─────────╯  ╰─────╯  ╰────╯',
    ])
  })

  test('the orders too narrow even with every label at its longest word name their narrowest width', () => {
    expect(drawSequence(sequenceOf(ORDERS), 20)).toEqual({
      kind: 'refused',
      reason: `it takes 27 columns, the screen has 20. ${REMEDY.slice(0, -1)}`,
      line: null,
      limit: null,
    })
  })
})
