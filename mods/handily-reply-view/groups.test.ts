import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { diagramOf } from './hooks/draw'
import { drawFlowchart } from './hooks/flowchart'
import { parseMermaid, type FlowGroup, type Refusal } from './hooks/mermaid'
import { displayWidth } from './hooks/width'
import { withoutGroups } from './fixtures/component-charts'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [80, 40, 30] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const REMEDY = 'Widen the window or shorten the labels.'
const STYLE_PROPS = ['color', 'bold', 'italic', 'underline'] as const

type Surface = (typeof SURFACES)[number]

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

type Style = Partial<Record<(typeof STYLE_PROPS)[number], unknown>>

type Span = { text: string; style: Style }

type World = { copies: string[] }

function lines(...rows: string[]): string {
  return rows.join('\n')
}

const COMPONENTS = lines(
  'flowchart LR',
  '  subgraph Engine',
  '    H[Hooks]',
  '    T[Telemetry]',
  '  end',
  '  subgraph Mods',
  '    W[workitems] --> BD[board]',
  '    W --> Q[quiet-items]',
  '    R[reply-view]',
  '    F[filetree]',
  '  end',
  '  H --> BD',
  '  H --> R',
  '  H --> F',
  '  T --> BD',
)

const COMPONENTS_DRAWING = [
  '┌┄ Engine ┄┄┄┄┄┄┐',
  '┆ ╭───────╮     ┆',
  '┆ │ Hooks │────────────┐',
  '┆ ╰───────╯     ┆      │',
  '┆ ╭───────────╮ ┆      │',
  '┆ │ Telemetry │────┐   │',
  '┆ ╰───────────╯ ┆  │   │',
  '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘  │   │',
  '┌┄ Mods ┄┄┄┄┄┄┄┄┄┄┄│┄┄┄│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐',
  '┆ ╭───────────╮    │   │   ╭────────────╮  ┆',
  '┆ │ workitems │────│─┐ ├──▶│ reply-view │  ┆',
  '┆ ╰───────────╯    │ │ │   ╰────────────╯  ┆',
  '┆                  │ │ │   ╭──────────╮    ┆',
  '┆                  │ │ ├──▶│ filetree │    ┆',
  '┆                  │ │ │   ╰──────────╯    ┆',
  '┆                  │ │ │   ╭───────╮       ┆',
  '┆                  │ │ │   │ board │       ┆',
  '┆                  │ │ └──▶│       │       ┆',
  '┆                  └─│────▶│       │       ┆',
  '┆                    ├────▶│       │       ┆',
  '┆                    │     ╰───────╯       ┆',
  '┆                    │     ╭─────────────╮ ┆',
  '┆                    └────▶│ quiet-items │ ┆',
  '┆                          ╰─────────────╯ ┆',
  '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
]

const PIPELINE = lines(
  'flowchart LR',
  '  subgraph In [Input]',
  '    A[read] --> B[parse]',
  '  end',
  '  subgraph Out [Output]',
  '    C[draw]',
  '  end',
  '  B --> C',
)

const PIPELINE_ACROSS = [
  '┌┄ Input ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐   ┌┄ Output ┄┐',
  '┆ ╭──────╮   ╭───────╮ ┆   ┆ ╭──────╮ ┆',
  '┆ │ read │──▶│ parse │──────▶│ draw │ ┆',
  '┆ ╰──────╯   ╰───────╯ ┆   ┆ ╰──────╯ ┆',
  '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘   └┄┄┄┄┄┄┄┄┄┄┘',
]

const PIPELINE_DOWN = [
  '┌┄ Input ┄┄┄┐',
  '┆           ┆',
  '┆ ╭──────╮  ┆',
  '┆ │ read │  ┆',
  '┆ ╰───┬──╯  ┆',
  '┆     ▼     ┆',
  '┆ ╭───────╮ ┆',
  '┆ │ parse │ ┆',
  '┆ ╰───┬───╯ ┆',
  '└┄┄┄┄┄│┄┄┄┄┄┘',
  '┌┄┄┄┄┄│┄ Output ┄┐',
  '┆     ▼          ┆',
  '┆ ╭──────╮       ┆',
  '┆ │ draw │       ┆',
  '┆ ╰──────╯       ┆',
  '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
]

const PIPELINE_ACROSS_COLUMNS = Math.max(...PIPELINE_ACROSS.map(displayWidth))

const NESTED = lines(
  'flowchart TD',
  '  subgraph Outer',
  '    subgraph Inner',
  '      A --> B',
  '    end',
  '  end',
)

const CROSSED_LOOP = lines(
  'flowchart TD',
  '  subgraph one',
  '    A & D',
  '  end',
  '  subgraph two',
  '    B & E',
  '  end',
  '  A --> F',
  '  F --> D & E',
  '  E --> A',
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

async function mountDiagram($: Engine, source: string, surface: Surface, columns: number) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: {
      text: ['The parts:', '', '```mermaid', source, '```'].join('\n'),
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

function groupsOf(source: string): FlowGroup[] | undefined {
  const chart = parseMermaid(source)
  if (chart.kind !== 'flowchart') throw new Error(`not a flowchart: ${JSON.stringify(chart)}`)
  return chart.groups
}

function refusedLine(line: number, reason: string): Refusal {
  return { kind: 'refused', reason, line, limit: null }
}

function drawnLines(source: string, width: number): string[] {
  const chart = parseMermaid(source)
  if (chart.kind !== 'flowchart') throw new Error(`not a flowchart: ${JSON.stringify(chart)}`)
  const drawn = drawFlowchart(chart, width)
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

describe('subgraph groups in the source', () => {
  test('a box belongs to the first subgraph that names it, also when a line outside names it first', () => {
    const source = lines(
      'flowchart TB',
      '  c1-->a2',
      '  subgraph one',
      '    a1-->a2',
      '  end',
      '  subgraph two',
      '    b1-->b2',
      '    a1-->b2',
      '  end',
      '  subgraph three',
      '    c1-->c2',
      '  end',
    )
    expect(groupsOf(source)).toEqual([
      { id: 'one', label: ['one'], nodes: ['a1', 'a2'] },
      { id: 'two', label: ['two'], nodes: ['b1', 'b2'] },
      { id: 'three', label: ['three'], nodes: ['c1', 'c2'] },
    ])
  })

  test('a subgraph takes its title from brackets, quotes or its words, and a repeated id joins the first', () => {
    const source = lines(
      'flowchart TD',
      '  subgraph ide1 [One title]',
      '    A',
      '  end',
      '  subgraph "Two words"',
      '    B',
      '  end',
      '  subgraph Three words',
      '    C',
      '  end',
      '  subgraph',
      '    D',
      '  end',
      '  subgraph ide1',
      '    E',
      '  end',
    )
    expect(groupsOf(source)).toEqual([
      { id: 'ide1', label: ['One title'], nodes: ['A', 'E'] },
      { id: 'subGraph1', label: ['Two words'], nodes: ['B'] },
      { id: 'subGraph2', label: ['Three words'], nodes: ['C'] },
      { id: 'subGraph3', label: [], nodes: ['D'] },
    ])
  })

  test('a flowchart with no subgraph holds no groups', () => {
    expect(groupsOf(lines('flowchart TD', '  A --> B'))).toBeUndefined()
  })

  test('direction inside a subgraph is kept when it names the flowchart direction or the subgraph links outside', () => {
    const same = lines('flowchart LR', '  subgraph one', '    direction LR', '    A --> B', '  end')
    const linked = lines(
      'flowchart LR',
      '  subgraph one',
      '    direction TB',
      '    A --> B',
      '  end',
      '  C --> A',
    )
    expect([groupsOf(same), groupsOf(linked)]).toEqual([
      [{ id: 'one', label: ['one'], nodes: ['A', 'B'] }],
      [{ id: 'one', label: ['one'], nodes: ['A', 'B'] }],
    ])
  })

  for (const [source, line, reason] of [
    [NESTED, 3, 'a subgraph inside a subgraph does not draw yet'],
    [
      lines('flowchart TD', '  subgraph one', '    A', '  end', '  B --> one'),
      5,
      'an edge to the subgraph one does not draw yet',
    ],
    [lines('flowchart TD', '  subgraph one', '    A'), 2, 'line 2 opens a subgraph with no end'],
    [
      lines('flowchart TD', '  A', '  subgraph one', '  end'),
      3,
      'an empty subgraph does not draw yet',
    ],
    [
      lines('flowchart TD', '  subgraph one', '    direction LR', '    A --> B', '  end'),
      3,
      'direction LR inside a subgraph does not draw yet',
    ],
    [lines('flowchart TD', '  A', '  end'), 3, 'line 3 does not parse'],
    [
      lines('flowchart TD', '  subgraph "`**Two**`"', '    A', '  end'),
      2,
      'markdown strings does not draw yet',
    ],
  ] as const) {
    test(`a subgraph source that does not draw names line ${String(line)}: ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})

describe('subgraph frames', () => {
  for (const surface of SURFACES) {
    viewTest(
      `the component example draws each subgraph as a titled frame with its edges through the frames at 100 columns on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, COMPONENTS, surface, 100)
        const rows = await drawnRows(ui, surface)
        const text = rows.map(rowText)
        expect(text).toEqual(COMPONENTS_DRAWING)
        const title = rows.flat().find((span) => span.text.includes('Engine'))
        const border = rows.flat().find((span) => span.text.startsWith('┌┄'))
        expect([title?.style, border?.style]).toEqual(
          surface === 'terminal' ? [{ bold: true }, { color: 'inactive' }] : [{}, {}],
        )
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([COMPONENTS, text.join('\n')])
        await ui.unmount()
      },
    )

    for (const columns of WIDTHS) {
      viewTest(
        `two subgraphs draw as frames left to right when they fit the body, else top down, and keep copy and copy drawing on ${surface} at ${String(columns)} columns`,
        async (world, $) => {
          const ui = await mountDiagram($, PIPELINE, surface, columns)
          const text = (await drawnRows(ui, surface)).map(rowText)
          const body = bodyWidth(surface, columns)
          expect(text).toEqual(body >= PIPELINE_ACROSS_COLUMNS ? PIPELINE_ACROSS : PIPELINE_DOWN)
          expect(text.filter((row) => displayWidth(row) > body)).toEqual([])
          await ui.press({ key: 'block-1-copy' })
          await ui.press({ key: 'block-1-drawing' })
          expect(world.copies).toEqual([PIPELINE, text.join('\n')])
          await ui.unmount()
        },
      )
    }

    for (const columns of [40, 30] as const) {
      viewTest(
        `the component example draws as its source under the width note on ${surface} at ${String(columns)} columns`,
        async (world, $) => {
          const ui = await mountDiagram($, COMPONENTS, surface, columns)
          const note = await ui.find({ type: 'Text', text: /^diagram not drawn:/ })
          const screen = String(bodyWidth(surface, columns))
          expect(note?.text).toBe(
            `diagram not drawn: it takes 44 columns, the screen has ${screen}. ${REMEDY}`,
          )
          expect(await ui.find({ key: 'block-1-drawing-lines' })).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([COMPONENTS])
          await ui.unmount()
        },
      )
    }

    viewTest(
      `a subgraph inside a subgraph draws as its source under a note that names the reason on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, NESTED, surface, 80)
        const note = await ui.find({ type: 'Text', text: /^diagram not drawn:/ })
        expect(note?.text).toBe(
          'diagram not drawn: a subgraph inside a subgraph does not draw yet.',
        )
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([NESTED])
        await ui.unmount()
      },
    )
  }

  test('a frame title moves past a line that enters the frame, with a dash on each side', () => {
    const source = lines(
      'flowchart TD',
      '  A[Start] --> B[Go]',
      '  subgraph Work [Long work title]',
      '    B --> C[Done]',
      '  end',
    )
    expect(drawnLines(source, 78)).toEqual([
      '  ╭───────╮',
      '  │ Start │',
      '  ╰───┬───╯',
      '┌┄┄┄┄┄│┄ Long work title ┄┐',
      '┆     ▼                   ┆',
      '┆  ╭────╮                 ┆',
      '┆  │ Go │                 ┆',
      '┆  ╰──┬─╯                 ┆',
      '┆     ▼                   ┆',
      '┆ ╭──────╮                ┆',
      '┆ │ Done │                ┆',
      '┆ ╰──────╯                ┆',
      '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
    ])
  })

  test('a box label longer than the wrap widens its box into free room and keeps every character', () => {
    const latin = drawnLines(
      lines(
        'flowchart TD',
        '  A[OrderService.processPayment] --> B[PaymentGatewayAdapter]',
        '  A --> C[LedgerWriterService]',
      ),
      38,
    )
    expect(latin).toContain('   │ OrderService.processPayment │')
    expect(latin).toContain('│ PaymentGateway │ │ LedgerWriterSe │')
    expect(latin).toContain('│ Adapter        │ │ rvice          │')
    const cjk = drawnLines(
      lines(
        'flowchart TD',
        '  A[用户提交订单并完成支付流程] --> B[订单完成并通知用户]',
        '  A --> C[支付失败并重试]',
      ),
      38,
    )
    expect(cjk).toContain('   │ 用户提交订单并完成支付流程 │')
    expect(cjk).toContain('│ 订单完成并通知 │ │ 支付失败并重试 │')
    expect(cjk).toContain('│ 用户           │ ╰────────────────╯')
    expect([...latin, ...cjk].filter((row) => row.includes('…'))).toEqual([])
  })

  test('a state name too long for the box breaks inside the word with no character lost', () => {
    const drawn = diagramOf(
      lines(
        'stateDiagram-v2',
        '  [*] --> AwaitingPaymentConfirmation',
        '  AwaitingPaymentConfirmation --> Paid',
      ),
      28,
      'terminal',
    )
    const text = drawn.kind === 'drawing' ? drawn.lines.join('') : drawn.reason
    expect(text).not.toContain('…')
    expect(text.replace(/[│ ]/g, '')).toContain('AwaitingPaymentConfirmation')
  })

  test('when the labels wrap, a frame title is cut only where the top edge of its own frame ends', () => {
    const source = lines(
      'flowchart TD',
      '  subgraph pay [Payment services of the shop]',
      '    A[Card payment service] --> B[Refund service handler]',
      '    A --> C[Invoice service writer]',
      '  end',
    )
    expect(drawnLines(source, 38).slice(0, 3)).toEqual([
      '┌┄ Payment services of t… ┄┐',
      '┆                          ┆',
      '┆    ╭──────────────╮      ┆',
    ])
  })

  test('a frame of one narrow box left to right widens to hold its whole title', () => {
    const source = lines(
      'flowchart LR',
      '  subgraph S [A long group title]',
      '    A[a]',
      '  end',
      '  A --> B[b]',
    )
    expect(drawnLines(source, 78)).toEqual([
      '┌┄ A long group title ┄┐',
      '┆ ╭───╮                ┆   ╭───╮',
      '┆ │ a │───────────────────▶│ b │',
      '┆ ╰───╯                ┆   ╰───╯',
      '└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘',
    ])
  })

  test('a free box beside a frame keeps out of the frame, the frame hugs its boxes, and the edge crosses the border', () => {
    const source = lines(
      'flowchart TD',
      '  subgraph Store',
      '    A[cache] --> B[disk]',
      '  end',
      '  C[client] --> B',
    )
    expect(drawnLines(source, 78)).toEqual([
      '┌┄ Store ┄┄┄┐',
      '┆           ┆',
      '┆ ╭───────╮ ┆ ╭────────╮',
      '┆ │ cache │ ┆ │ client │',
      '┆ ╰───┬───╯ ┆ ╰────┬───╯',
      '┆     └┬───────────┘',
      '┆      ▼    ┆',
      '┆  ╭──────╮ ┆',
      '┆  │ disk │ ┆',
      '┆  ╰──────╯ ┆',
      '└┄┄┄┄┄┄┄┄┄┄┄┘',
    ])
  })

  test('a loop whose boxes must end levels where the subgraphs keep the other order names that cause', () => {
    const chart = parseMermaid(CROSSED_LOOP)
    if (chart.kind !== 'flowchart') throw new Error('not a flowchart')
    expect(drawFlowchart(chart, 78)).toEqual({
      kind: 'refused',
      reason: 'its loops and its subgraphs cannot keep one order',
      line: null,
      limit: null,
    })
    expect(drawFlowchart(withoutGroups(chart), 28).kind).toBe('drawing')
  })
})
