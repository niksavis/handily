import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { drawFlowchart } from './hooks/flowchart'
import { parseMermaid, type FlowGroup, type Flowchart, type Refusal } from './hooks/mermaid'
import { displayWidth, graphemesOf } from './hooks/width'

const GENERATED_TIMEOUT_MS = 10000

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

const NATURAL_COLUMNS = 400
const FRAME_BORDERS = 4
const WIDTH_FACTOR = 1.75

type DrawnFrame = { top: number; left: number; bottom: number; right: number }

type DrawnBox = { name: string; top: number; left: number; right: number }

function componentCharts(seed: number, count: number): string[] {
  let state = seed
  const next = (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor((state / 2147483648) * below)
  }
  return Array.from({ length: count }, () => {
    const direction = next(2) === 0 ? 'TD' : 'LR'
    const groups = 2 + next(6)
    const declared: string[] = []
    const edges: string[] = []
    let box = 0
    for (let group = 0; group < groups; group++) {
      const size = 1 + next(4)
      const first = box + 1
      declared.push(`  subgraph G${String(group)}`)
      for (let member = 0; member < size; member++) {
        box += 1
        declared.push(`    N${String(box)}`)
        if (member > 0) edges.push(`  N${String(first + next(member))} --> N${String(box)}`)
      }
      declared.push('  end')
    }
    for (let edge = 0; edge < groups; edge++) {
      const from = 1 + next(box)
      const to = 1 + next(box)
      if (from < to) edges.push(`  N${String(from)} --> N${String(to)}`)
    }
    return lines(`flowchart ${direction}`, ...declared, ...edges)
  })
}

function withoutGroups(chart: Flowchart): Flowchart {
  return { kind: 'flowchart', direction: chart.direction, nodes: chart.nodes, edges: chart.edges }
}

function widthOf(drawing: readonly string[]): number {
  return Math.max(...drawing.map(displayWidth))
}

function drawnFrames(drawing: readonly string[]): DrawnFrame[] {
  const grid = drawing.map((line) => [...graphemesOf(line)])
  const at = (row: number, col: number) => grid[row]?.[col] ?? ' '
  return grid.flatMap((cells, top) =>
    cells.flatMap((cell, left) => {
      if (cell !== '┌' || !'┄ '.includes(at(top, left + 1))) return []
      let bottom = top + 1
      while (bottom < grid.length && at(bottom, left) !== '└') bottom += 1
      let right = left + 1
      while (right < (grid[bottom]?.length ?? 0) && at(bottom, right) !== '┘') right += 1
      return at(bottom, right) === '┘' ? [{ top, left, bottom, right }] : []
    }),
  )
}

function drawnBoxes(drawing: readonly string[]): DrawnBox[] {
  return drawing.flatMap((line, top) => {
    const cells = [...graphemesOf(line)]
    return cells.flatMap((cell, left) => {
      if (cell !== '╭') return []
      let right = left + 1
      while ('─┬┴'.includes(cells[right] ?? ' ')) right += 1
      const name = [...graphemesOf(drawing[top + 1] ?? '')]
        .slice(left + 1, right)
        .join('')
        .trim()
      return [{ name, top, left, right }]
    })
  })
}

function frameTitle(drawing: readonly string[], frame: DrawnFrame): string {
  return [...graphemesOf(drawing[frame.top] ?? '')]
    .slice(frame.left, frame.right + 1)
    .join('')
    .replace(/[┌┐┄│╎]/g, '')
    .trim()
}

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

  test(
    '200 generated component diagrams draw at most 1.75 times as wide as with no subgraphs, plus 4 columns for each frame',
    { timeoutMs: GENERATED_TIMEOUT_MS },
    () => {
      const widths = componentCharts(20261105, 200).flatMap((source) => {
        const chart = parseMermaid(source)
        if (chart.kind !== 'flowchart') return []
        const framed = drawFlowchart(chart, NATURAL_COLUMNS)
        const bare = drawFlowchart(withoutGroups(chart), NATURAL_COLUMNS)
        if (bare.kind !== 'drawing') return []
        const bound =
          WIDTH_FACTOR * widthOf(bare.lines) + FRAME_BORDERS * (chart.groups ?? []).length
        const drawn = framed.kind === 'drawing' ? widthOf(framed.lines) : Infinity
        return [{ source, drawn, bound }]
      })
      expect(widths.length).toBeGreaterThan(190)
      expect(widths.filter(({ drawn, bound }) => drawn > bound)).toEqual([])
    },
  )

  test(
    'each frame of 300 generated component diagrams top down is no wider than its boxes in one row, its title and its borders',
    { timeoutMs: GENERATED_TIMEOUT_MS },
    () => {
      const frames = componentCharts(20261105, 300).flatMap((source) => {
        const chart = parseMermaid(source)
        if (chart.kind !== 'flowchart' || chart.direction !== 'TD') return []
        const drawn = drawFlowchart(chart, NATURAL_COLUMNS)
        if (drawn.kind !== 'drawing') return [{ source, width: Infinity, bound: 0 }]
        const boxes = drawnBoxes(drawn.lines)
        return drawnFrames(drawn.lines).map((frame) => {
          const inside = boxes.filter(
            (box) =>
              box.left > frame.left &&
              box.right < frame.right &&
              box.top > frame.top &&
              box.top < frame.bottom,
          )
          const row = inside.reduce((total, box) => total + box.right - box.left + 1 + 2, -2)
          const title = displayWidth(frameTitle(drawn.lines, frame)) + 2
          return { source, width: frame.right - frame.left + 1, bound: row + title + FRAME_BORDERS }
        })
      })
      expect(frames.length).toBeGreaterThan(300)
      expect(frames.filter(({ width, bound }) => width > bound)).toEqual([])
    },
  )
})
