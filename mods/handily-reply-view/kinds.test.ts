import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { drawEntities } from './hooks/er'
import { parseMermaid } from './hooks/mermaid'
import { drawState } from './hooks/state'
import { displayWidth } from './hooks/width'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [80, 40, 30] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const STYLE_PROPS = ['color', 'bold', 'italic', 'underline'] as const
const CYCLE = ['suggestion', 'planMode', 'merged'] as const
const HEAD = 'claude'
const LINE = 'inactive'

type Surface = (typeof SURFACES)[number]

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

type Style = Partial<Record<(typeof STYLE_PROPS)[number], unknown>>

type Span = { text: string; style: Style }

type World = { copies: string[]; toasts: string[] }

function lines(...rows: string[]): string {
  return rows.join('\n')
}

const STATES = lines(
  'stateDiagram-v2',
  '  [*] --> Still',
  '  Still --> [*]',
  '  Still --> Moving',
  '  Moving --> Still',
  '  Moving --> Crash',
  '  Crash --> [*]',
)

const STATES_DRAWN = [
  '    ●',
  '    ▼',
  '╭───────╮',
  '│ Still │◀─────────┐',
  '╰───┬───╯          │',
  '┌───┴───┐          │',
  '▼       ▼          │',
  '◉  ╭────────╮      │',
  '   │ Moving │──────┘',
  '   ╰────┬───╯',
  '        ▼',
  '    ╭───────╮',
  '    │ Crash │',
  '    ╰───┬───╯',
  '        ▼',
  '        ◉',
]

const TASK_STATES = lines(
  'stateDiagram-v2',
  '  direction LR',
  '  [*] --> Queued',
  '  Queued --> Running : claimed',
  '  Running --> Waiting : asks you',
  '  Waiting --> Running : answered',
  '  Running --> Done : pass',
  '  Running --> Failed : fail',
  '  Done --> [*]',
)

const TASK_STATES_DRAWN = [
  '    ╭────────╮ claimed ╭─────────╮ pass       ╭──────╮',
  '●──▶│ Queued │────────▶│ Running │──┬────────▶│ Done │─────▶◉',
  '    ╰────────╯         ╰─────────╯  │         ╰──────╯',
  '                            ▲       │fail     ╭────────╮',
  '                            │       ├────────▶│ Failed │',
  '                            │       │         ╰────────╯',
  '                            │       │asks you ╭─────────╮',
  '                            │       └────────▶│ Waiting │',
  '                            │                 ╰────┬────╯',
  '                            │                      │',
  '                            └──────────────────────┘',
  '                                                   answered',
]

const WORK_STATES = lines(
  'stateDiagram-v2',
  '    [*] --> open: br create',
  '    open --> in_progress: claim',
  '    in_progress --> in_progress: comment, tick criteria',
  '    in_progress --> closed: all criteria validated',
  '    in_progress --> open: blocked, waits on external',
  '    closed --> [*]',
)

const WORK_STATES_DRAWN = [
  '      ●',
  '      │ br create',
  '      ▼',
  '  ╭──────╮',
  '  │ open │◀─────────────────────────┐',
  '  ╰───┬──╯                          │',
  '      │ claim                       │',
  '      ▼                             │',
  '╭─────────────╮                     │',
  '│ in_progress │─────────────────────┘ blocked, waits on external',
  '│             │──┐ comment, tick criteria',
  '│             │◀─┘',
  '╰─────┬───────╯',
  '      │ all criteria validated',
  '      ▼',
  ' ╭────────╮',
  ' │ closed │',
  ' ╰────┬───╯',
  '      ▼',
  '      ◉',
]

const WORK_STATES_CUT = [
  '      ●',
  '      │ br create',
  '      ▼',
  '  ╭──────╮',
  '  │ open │◀───────────────┐',
  '  ╰───┬──╯                │',
  '      │ claim             │',
  '      ▼                   │',
  '╭─────────────╮           │',
  '│ in_progress │───────────┘ blocked, wa…',
  '│             │──┐ comment, ti…',
  '│             │◀─┘',
  '╰─────┬───────╯',
  '      │ all criteri…',
  '      ▼',
  ' ╭────────╮',
  ' │ closed │',
  ' ╰────┬───╯',
  '      ▼',
  '      ◉',
]

const WORK_STATES_WRAPPED = [
  '      ●',
  '      │ br',
  '      │ create',
  '      ▼',
  '  ╭──────╮',
  '  │ open │◀────────────┐',
  '  ╰───┬──╯             │',
  '      │ claim          │',
  '      ▼                │ blocked,',
  '╭─────────────╮        │ waits on',
  '│ in_progress │────────┘ external',
  '│             │──┐ comment,',
  '│             │  │ tick',
  '│             │◀─┘ criteria',
  '╰─────┬───────╯',
  '      │ all',
  '      │ criteria',
  '      │ validated',
  '      ▼',
  ' ╭────────╮',
  ' │ closed │',
  ' ╰────┬───╯',
  '      ▼',
  '      ◉',
]

const CLASSES = lines(
  'classDiagram',
  '  class Reply {',
  '    + text: string',
  '    + blocks(): Block[]',
  '  }',
  '  class Block {',
  '    + rows(): number',
  '  }',
  '  class Table {',
  '    + header: string[]',
  '  }',
  '  class Fence {',
  '    + tag: string',
  '  }',
  '  Reply "1" *-- "0..n" Block : holds',
  '  Block <|-- Table',
  '  Block <|-- Fence',
)

const CLASSES_DRAWN = [
  '╭─────────────────────╮',
  '│ Reply               │',
  '├─────────────────────┤',
  '│ + text: string      │',
  '│ + blocks(): Block[] │',
  '╰─────────────────────╯',
  '           ◆ 1',
  '           │ holds',
  '           │ 0..n',
  '╭──────────┴──────────╮',
  '│ Block               │◁─┐',
  '├─────────────────────┤  │',
  '│ + rows(): number    │  │',
  '╰─────────────────────╯  │',
  '           △             │',
  '           │             │',
  '╭──────────┴──────────╮  │',
  '│ Table               │  │',
  '├─────────────────────┤  │',
  '│ + header: string[]  │  │',
  '╰─────────────────────╯  │',
  '                         │',
  '╭─────────────────────╮  │',
  '│ Fence               ├──┘',
  '├─────────────────────┤',
  '│ + tag: string       │',
  '╰─────────────────────╯',
]

const BOARD = lines(
  'classDiagram',
  '  class Board {',
  '    +tasks: Task[]',
  '    +open()',
  '  }',
  '  class Agent {',
  '    +id: string',
  '    +settle()',
  '  }',
  '  class Task {',
  '    +title: string',
  '  }',
  '  Board "1" --> "*" Agent : shows',
  '  Board *-- Task : keeps',
  '  Agent <|-- Explorer',
)

const BOARD_DRAWN = [
  '╭────────────────╮',
  '│ Board          ├─ 1 shows ─┐',
  '├────────────────┤           │',
  '│ +tasks: Task[] │           │',
  '│ +open()        │           │',
  '╰────────────────╯           │',
  '         ◆                   │',
  '         │ keeps             │',
  '         │                   │',
  '╭────────┴───────╮           │',
  '│ Task           │           │',
  '├────────────────┤           │',
  '│ +title: string │           │',
  '╰────────────────╯           │',
  '                             │',
  '╭────────────────╮           │',
  '│ Agent          │◀ * ───────┘',
  '├────────────────┤',
  '│ +id: string    │',
  '│ +settle()      │',
  '╰────────────────╯',
  '         △',
  '         │',
  '╭────────┴───────╮',
  '│ Explorer       │',
  '╰────────────────╯',
]

const FLEET = lines('classDiagram', '  Fleet o-- Car : owns', '  Car --> Engine : runs on')

const FLEET_DRAWN = [
  '╭────────╮',
  '│ Fleet  │',
  '╰────────╯',
  '     ◇',
  '     │ owns',
  '     │',
  '╭────┴───╮',
  '│ Car    │',
  '╰────┬───╯',
  '     │',
  '     │ runs on',
  '     ▼',
  '╭────────╮',
  '│ Engine │',
  '╰────────╯',
]

const JOINS = /[┌┐└┘├┤┬┴┼]/

const SESSION_LOG = lines(
  'erDiagram',
  '  SESSION ||--o{ PROMPT : has',
  '  PROMPT ||--|{ TOOL_CALL : runs',
  '  SESSION {',
  '    string id PK',
  '    date started',
  '  }',
  '  PROMPT {',
  '    string id PK',
  '    string session FK',
  '    string text',
  '  }',
  '  TOOL_CALL {',
  '    string id PK',
  '    string prompt FK',
  '    string name',
  '  }',
)

const SESSION_LOG_DRAWN = [
  '╭────────────────────╮',
  '│ SESSION            │',
  '├────────────────────┤',
  '│ PK id       string │',
  '│    started  date   │',
  '╰──────────┬─────────╯',
  '           │ 1',
  '           │ has',
  '           │ 0..n',
  '╭──────────┴─────────╮',
  '│ PROMPT             │',
  '├────────────────────┤',
  '│ PK id       string │',
  '│ FK session  string │',
  '│    text     string │',
  '╰──────────┬─────────╯',
  '           │ 1',
  '           │ runs',
  '           │ 1..n',
  '╭──────────┴─────────╮',
  '│ TOOL_CALL          │',
  '├────────────────────┤',
  '│ PK id       string │',
  '│ FK prompt   string │',
  '│    name     string │',
  '╰────────────────────╯',
]

const ORDERS = lines(
  'erDiagram',
  '  CUSTOMER ||--o{ ORDER : places',
  '  ORDER ||--|{ LINE-ITEM : contains',
  '  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses',
  '  PRODUCT ||--o{ LINE-ITEM : "appears in"',
)

const ORDERS_DRAWN = [
  '╭──────────────────╮',
  '│ CUSTOMER         ├╌ 1..n uses ╌╌╌╌╌╌┐',
  '╰─────────┬────────╯                  ╎',
  '          │ 1                         ╎',
  '          │ places                    ╎',
  '          │ 0..n                      ╎',
  '╭─────────┴────────╮                  ╎',
  '│ ORDER            │                  ╎',
  '╰─────────┬────────╯                  ╎',
  '          │ 1                         ╎',
  '          │ contains                  ╎',
  '          │ 1..n                      ╎',
  '╭─────────┴────────╮                  ╎',
  '│ LINE-ITEM        ├─ 0..n ─────────┐ ╎',
  '╰──────────────────╯                │ ╎',
  '                                    │ ╎',
  '╭──────────────────╮                │ ╎',
  '│ DELIVERY-ADDRESS ├╌ 1..n ╌╌╌╌╌╌╌╌╌│╌┘',
  '╰──────────────────╯                │',
  '                                    │',
  '╭──────────────────╮                │',
  '│ PRODUCT          ├─ 1 appears in ─┘',
  '╰──────────────────╯',
]

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
  const world: World = { copies: [], toasts: [] }
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
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
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

function firstToastLine(toast: string): string | undefined {
  return toast.split(/\s{2,}/)[0]
}

async function openedRows(ui: Mounted, surface: Surface): Promise<Span[][]> {
  if ((await ui.find({ key: 'fold' })) !== undefined) await ui.press({ key: 'fold' })
  return drawnRows(ui, surface)
}

function rowText(row: readonly Span[]): string {
  return row.map((span) => span.text).join('')
}

function tooWide(rows: readonly string[], surface: Surface, columns: number): string[] {
  return rows.filter((row) => displayWidth(row) > bodyWidth(surface, columns))
}

function colourOf(rows: readonly Span[][], text: string): unknown {
  return rows.flat().find((span) => span.text.includes(text))?.style.color
}

function styleAt(rows: readonly Span[][], text: string): Style | undefined {
  return rows.flat().find((span) => span.text.trim() === text)?.style
}

async function noteOf(ui: Mounted): Promise<string | undefined> {
  return (await ui.find({ type: 'Text', text: /^diagram not drawn:/ }))?.text
}

function stateLines(source: string, width: number): string[] {
  const diagram = parseMermaid(source)
  if (diagram.kind !== 'state') throw new Error(`not a state diagram: ${diagram.kind}`)
  const drawn = drawState(diagram, width)
  if (drawn.kind !== 'drawing') throw new Error(`not drawn: ${drawn.reason}`)
  return drawn.lines
}

function refusedBy(reason: string, line: number | null = null) {
  return { kind: 'refused', reason, line, limit: null }
}

function widthNote(columns: number, surface: Surface, takes: number): string {
  const screen = String(bodyWidth(surface, columns))
  return `diagram not drawn: it takes ${String(takes)} columns, the screen has ${screen}. Widen the window or shorten the labels.`
}

describe('state diagrams', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a state diagram draws with the flowchart layout, ● for a start and ◉ for an end, and fits the body on ${surface} at ${String(columns)} columns`,
        async (world, $) => {
          const ui = await mountDiagram($, STATES, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(rows).toEqual(STATES_DRAWN)
          expect(tooWide(rows, surface, columns)).toEqual([])
          expect(await ui.find({ type: 'Text', text: /── mermaid · state ─/ })).toBeDefined()
          await ui.press({ key: 'block-1-copy' })
          await ui.press({ key: 'block-1-drawing' })
          expect(world.copies).toEqual([STATES, STATES_DRAWN.join('\n')])
          expect(world.toasts.map(firstToastLine)).toEqual([
            '✓ Copied the state source',
            '✓ Copied the state drawing',
          ])
          await ui.unmount()
        },
      )
    }
  }

  viewTest(
    'the start, the end and the arrow heads of a state diagram are in claude and the states take the cycle colours in source order on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, STATES, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      expect(['●', '◉', '▼'].map((glyph) => colourOf(rows, glyph))).toEqual([HEAD, HEAD, HEAD])
      expect(['Still', 'Moving', 'Crash'].map((name) => colourOf(rows, `│ ${name} │`))).toEqual([
        ...CYCLE,
      ])
      expect(colourOf(rows, '─────────┐')).toBe(LINE)
      await ui.unmount()
    },
  )

  for (const surface of SURFACES) {
    viewTest(
      `a state diagram with direction LR draws across with its labels at 80 columns on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, TASK_STATES, surface)
        expect((await drawnRows(ui, surface)).map(rowText)).toEqual(TASK_STATES_DRAWN)
        await ui.unmount()
      },
    )

    for (const columns of [40, 30] as const) {
      viewTest(
        `a state diagram that does not fit across or down shows its source under the width note on ${surface} at ${String(columns)} columns`,
        async (world, $) => {
          const ui = await mountDiagram($, TASK_STATES, surface, columns)
          expect(await noteOf(ui)).toBe(widthNote(columns, surface, 52))
          expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([TASK_STATES])
          await ui.unmount()
        },
      )
    }
  }

  for (const surface of SURFACES) {
    viewTest(
      `a transition from a state to itself draws as a loop beside the state with its label on ${surface} at 80 columns`,
      async (world, $) => {
        const ui = await mountDiagram($, WORK_STATES, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        expect(rows).toEqual(WORK_STATES_DRAWN)
        expect(tooWide(rows, surface, 80)).toEqual([])
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([WORK_STATES_DRAWN.join('\n')])
        await ui.unmount()
      },
    )

    viewTest(
      `a state diagram with a loop on a state that does not fit shows its source under the width note on ${surface} at 30 columns`,
      async (world, $) => {
        const ui = await mountDiagram($, WORK_STATES, surface, 30)
        expect(await noteOf(ui)).toBe(widthNote(30, surface, 33))
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([WORK_STATES])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a transition from a state to itself keeps its loop and a label cut to 12 columns on desktop at 40 columns',
    async (_world, $) => {
      const ui = await mountDiagram($, WORK_STATES, 'desktop', 40)
      const rows = (await drawnRows(ui, 'desktop')).map(rowText)
      expect(rows).toEqual(WORK_STATES_CUT)
      expect(tooWide(rows, 'desktop', 40)).toEqual([])
      await ui.unmount()
    },
  )

  viewTest(
    'a state diagram with a loop on a state draws with its edge labels wrapped within the 38 column body on terminal at 40 columns',
    async (world, $) => {
      const ui = await mountDiagram($, WORK_STATES, 'terminal', 40)
      expect(await noteOf(ui)).toBeUndefined()
      const rows = (await drawnRows(ui, 'terminal')).map(rowText)
      expect(rows).toEqual(WORK_STATES_WRAPPED)
      expect(tooWide(rows, 'terminal', 40)).toEqual([])
      expect(rows.join(' ')).not.toContain('…')
      await ui.press({ key: 'block-1-drawing' })
      expect(world.copies).toEqual([rows.join('\n')])
      await ui.unmount()
    },
  )

  for (const [name, source, drawn] of [
    [
      'with no label draws a loop with no label',
      lines('stateDiagram-v2', '  [*] --> A', '  A --> A', '  A --> [*]'),
      ['  ●', '  ▼', '╭───╮', '│ A │──┐', '│   │◀─┘', '╰─┬─╯', '  ▼', '  ◉'],
    ],
    [
      'written twice draws one loop with both labels',
      lines(
        'stateDiagram-v2',
        '  [*] --> A',
        '  A --> A : retry',
        '  A --> A : wait',
        '  A --> [*]',
      ),
      ['  ●', '  ▼', '╭───╮', '│ A │──┐ retry', '│   │◀─┘ wait', '╰─┬─╯', '  ▼', '  ◉'],
    ],
    [
      'in a diagram that draws across draws above the state, as high as its label',
      lines(
        'stateDiagram-v2',
        '  direction LR',
        '  [*] --> A',
        '  A --> A : retry',
        '  A --> A : wait',
        '  A --> A : tick',
        '  A --> [*]',
      ),
      [
        '     ┌─┐ retry',
        '     │ │ wait',
        '     │ ▼ tick',
        '    ╭┴──╮',
        '●──▶│ A │───────▶◉',
        '    ╰───╯',
      ],
    ],
  ] as const) {
    test(`a transition from a state to itself ${name}`, () => {
      expect(stateLines(source, 78)).toEqual(drawn)
    })
  }

  test('a state diagram that drew with cut labels at 80 columns keeps the same rows', () => {
    const source = lines(
      'stateDiagram-v2',
      '  [*]-->S0',
      '  S0-->S2: external approved ok',
      '  S1_long_name-->S1_long_name: by',
      '  S2-->S0: x approved retry reviewer',
      '  S0-->S2: ok ok',
      '  S0-->S1_long_name: x',
      '  S2-->[*]',
    )
    expect(stateLines(source, 78)).toEqual([
      '                ●',
      '                ▼',
      '             ╭────╮',
      '             │ S0 │◀──────────────────────────┐',
      '             ╰──┬─╯                           │',
      '       ┌────────┴─────────┐                   │',
      '       │ x                │ external ap…      │',
      '       │                  │ ok ok             │',
      '       ▼                  ▼                   │',
      '╭──────────────╮       ╭────╮                 │',
      '│ S1_long_name │──┐ by │ S2 │─────────────────┘ x approved …',
      '│              │◀─┘    ╰──┬─╯',
      '╰──────────────╯          │',
      '                          ▼',
      '                          ◉',
    ])
  })

  test('a transition from a state to itself parses as a transition', () => {
    expect(parseMermaid(lines('stateDiagram-v2', '  A --> A : wait'))).toEqual({
      kind: 'state',
      direction: 'TD',
      states: [{ id: 'A', label: ['A'] }],
      transitions: [{ from: 'A', to: 'A', label: ['wait'] }],
    })
  })

  test('a state takes its description, a transition its label, and styles and comments draw nothing', () => {
    expect(
      parseMermaid(
        lines(
          'stateDiagram',
          '  state "Waits for you" as Waiting',
          '  Done : All checks passed',
          '  classDef late fill:#f00',
          '  [*] --> Waiting:::late',
          '  Waiting --> Done : answered %% the person answered',
          '  Done --> [*]',
          '  class Done late',
        ),
      ),
    ).toEqual({
      kind: 'state',
      direction: 'TD',
      states: [
        { id: 'Waiting', label: ['Waits for you'] },
        { id: 'Done', label: ['All checks passed'] },
      ],
      transitions: [
        { from: '[*]', to: 'Waiting', label: [] },
        { from: 'Waiting', to: 'Done', label: ['answered'] },
        { from: 'Done', to: '[*]', label: [] },
      ],
    })
  })

  for (const [source, reason, line] of [
    [lines('stateDiagram-v2', '  direction RL', '  A --> B'), 'direction RL does not draw yet', 2],
    [lines('stateDiagram-v2', '  A --> B', '  note right of A : hi'), 'note does not draw yet', 3],
    [lines('stateDiagram-v2', '  A -> B'), 'line 2 does not parse', 2],
    [lines('stateDiagram-v2 LR', '  A --> B'), 'line 1 does not parse', 1],
  ] as const) {
    test(`a state diagram refuses with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedBy(reason, line))
    })
  }

  test('a state diagram with no state refuses by name', () => {
    expect(parseMermaid('stateDiagram-v2')).toEqual(refusedBy('the state diagram has no states'))
  })
})

describe('nested states, fork, join and choice', () => {
  for (const [name, source, reason] of [
    [
      'nested states',
      lines('stateDiagram-v2', '  [*] --> First', '  state First {', '    [*] --> second', '  }'),
      'state First holds nested states, which do not draw yet',
    ],
    [
      'a fork',
      lines('stateDiagram-v2', '  state split <<fork>>', '  [*] --> split'),
      'fork does not draw yet',
    ],
    [
      'a join',
      lines('stateDiagram-v2', '  A --> B', '  state merge <<join>>'),
      'join does not draw yet',
    ],
    [
      'a choice',
      lines('stateDiagram-v2', '  state if_state <<choice>>', '  [*] --> if_state'),
      'choice does not draw yet',
    ],
    [
      'a choice in brackets',
      lines('stateDiagram-v2', '  state if_state [[choice]]'),
      'choice does not draw yet',
    ],
  ] as const) {
    for (const surface of SURFACES) {
      viewTest(
        `a state diagram with ${name} draws as its source under a note that names the reason on ${surface}`,
        async (world, $) => {
          const ui = await mountDiagram($, source, surface)
          expect(await noteOf(ui)).toBe(`diagram not drawn: ${reason}.`)
          expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
          expect(await ui.find({ key: 'block-1-drawing-lines' })).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([source])
          await ui.unmount()
        },
      )
    }
  }
})

describe('class diagrams', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a class diagram draws each class with its members and the relation marks and fits the body on ${surface} at ${String(columns)} columns`,
        async (world, $) => {
          const ui = await mountDiagram($, CLASSES, surface, columns)
          const rows = (await openedRows(ui, surface)).map(rowText)
          expect(rows).toEqual(CLASSES_DRAWN)
          expect(tooWide(rows, surface, columns)).toEqual([])
          expect(await ui.find({ type: 'Text', text: /── mermaid · class ─/ })).toBeDefined()
          await ui.press({ key: 'block-1-copy' })
          await ui.press({ key: 'block-1-drawing' })
          expect(world.copies).toEqual([CLASSES, rows.join('\n')])
          await ui.unmount()
        },
      )

      viewTest(
        `each class relation has its own route with its mark next to its owner and fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, BOARD, surface, columns)
          const rows = (await openedRows(ui, surface)).map(rowText)
          if (bodyWidth(surface, columns) >= 30) expect(rows).toEqual(BOARD_DRAWN)
          expect(tooWide(rows, surface, columns)).toEqual([])
          const boardEnd = rows.findIndex((row) => row.startsWith('╰')) + 1
          expect(rows[boardEnd]).toMatch(/^ +◆ +│$/)
          expect(rows[boardEnd + 1]).toMatch(/^ +│ keeps +│$/)
          const agent = rows.findIndex((row) => row.includes('│ Agent'))
          const agentEnd = rows.findIndex((row, at) => at > agent && row.startsWith('╰'))
          const explorer = rows.findIndex((row) => row.includes('│ Explorer'))
          expect(rows[agentEnd + 1]?.trim()).toBe('△')
          expect(rows.slice(agentEnd + 1, explorer - 1).filter((row) => JOINS.test(row))).toEqual(
            [],
          )
          expect(rows.find((row) => row.includes('│ Agent'))).toMatch(/│◀ \* ─+┘$/)
          expect(rows.find((row) => row.includes('│ Board'))).toMatch(/├─ 1 shows ─┐$/)
          await ui.unmount()
        },
      )
    }

    viewTest(
      `a class diagram draws ◇ next to the owner of an aggregation and an arrow head at the end of an association on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, FLEET, surface)
        expect((await drawnRows(ui, surface)).map(rowText)).toEqual(FLEET_DRAWN)
        await ui.unmount()
      },
    )
  }

  viewTest(
    'the class names take the cycle colours, the members are plain and the marks are in claude on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, CLASSES, 'terminal')
      const rows = await openedRows(ui, 'terminal')
      expect(
        ['Reply', 'Block', 'Table', 'Fence'].map((name) => colourOf(rows, `│ ${name} `)),
      ).toEqual([CYCLE[0], CYCLE[1], CYCLE[2], CYCLE[0]])
      expect([styleAt(rows, '+ text: string'), styleAt(rows, '+ tag: string')]).toEqual([{}, {}])
      expect(['◆', '△', '◁'].map((mark) => styleAt(rows, mark))).toEqual([
        { color: HEAD },
        { color: HEAD },
        { color: HEAD },
      ])
      expect(['1', 'holds', '0..n'].map((word) => styleAt(rows, word))).toEqual([
        { color: LINE },
        { color: LINE },
        { color: LINE },
      ])
      await ui.unmount()
    },
  )

  test('a class draws 10 members and refuses 11 with the class name', () => {
    const members = (count: number) =>
      Array.from({ length: count }, (_, at) => `    +field${String(at)}`)
    const ten = parseMermaid(lines('classDiagram', '  class Big {', ...members(10), '  }'))
    expect(ten.kind === 'class' ? ten.classes[0]?.members.length : ten.kind).toBe(10)
    expect(parseMermaid(lines('classDiagram', '  class Big {', ...members(11), '  }'))).toEqual(
      refusedBy('class Big has 11 members, at most 10 draw'),
    )
  })

  for (const surface of SURFACES) {
    viewTest(
      `a class with 14 members draws as its source under the note that names the class on ${surface}`,
      async (world, $) => {
        const source = lines(
          'classDiagram',
          '  class Reply {',
          ...Array.from({ length: 14 }, (_, at) => `    +part${String(at)}()`),
          '  }',
        )
        const ui = await mountDiagram($, source, surface)
        expect(await noteOf(ui)).toBe(
          'diagram not drawn: class Reply has 14 members, at most 10 draw.',
        )
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([source])
        await ui.unmount()
      },
    )
  }

  test('each relation reads its marked end, its line, its cardinalities and its label', () => {
    expect(
      parseMermaid(
        lines(
          'classDiagram',
          '  Animal <|-- Duck',
          '  Shape <|.. Circle',
          '  Engine --* Car',
          '  Pond o-- Duck : holds',
          '  Customer "1" --> "*" Order : places',
          '  Order <.. Clock',
          '  Duck -- Pond',
          '  Duck .. Ice',
        ),
      ),
    ).toMatchObject({
      kind: 'class',
      relations: [
        { from: 'Animal', to: 'Duck', kind: 'inheritance', stroke: 'solid' },
        { from: 'Shape', to: 'Circle', kind: 'inheritance', stroke: 'dashed' },
        { from: 'Car', to: 'Engine', kind: 'composition', stroke: 'solid' },
        { from: 'Pond', to: 'Duck', kind: 'aggregation', label: ['holds'] },
        { from: 'Customer', to: 'Order', kind: 'association', fromCard: '1', toCard: '*' },
        { from: 'Clock', to: 'Order', kind: 'association', stroke: 'dashed' },
        { from: 'Duck', to: 'Pond', kind: 'link', stroke: 'solid' },
        { from: 'Duck', to: 'Ice', kind: 'link', stroke: 'dashed' },
      ],
    })
  })

  test('a class takes its label, a backtick name, its annotation and its members', () => {
    expect(
      parseMermaid(
        lines(
          'classDiagram',
          '  class Animal["Animal with a label"]',
          '  class `Car Class`',
          '  class Shape <<interface>>',
          '  <<enumeration>> Color',
          '  Shape : +draw()',
          '  Animal --> `Car Class`',
          '  style Animal fill:#f9f',
          '  direction LR',
        ),
      ),
    ).toMatchObject({
      kind: 'class',
      classes: [
        { id: 'Animal', name: 'Animal with a label', annotation: null, members: [] },
        { id: 'Car Class', name: 'Car Class' },
        { id: 'Shape', annotation: 'interface', members: ['+draw()'] },
        { id: 'Color', annotation: 'enumeration' },
      ],
    })
  })

  for (const [what, statement, reason] of [
    ['a namespace', '  namespace Shapes {', 'namespace does not draw yet'],
    ['a note', '  note for A "hi"', 'note does not draw yet'],
    ['a lollipop interface', '  A ()-- B', 'a lollipop interface does not draw yet'],
    ['a two-way relation', '  A <|--|> B', 'a two-way relation does not draw yet'],
  ] as const) {
    test(`a class diagram with ${what} refuses by name on its line`, () => {
      expect(parseMermaid(lines('classDiagram', '  class A', statement))).toEqual(
        refusedBy(reason, 3),
      )
    })
  }
})

describe('ER diagrams', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `an ER diagram draws its entities top to bottom with the cardinality as words on ${surface} at ${String(columns)} columns`,
        async (world, $) => {
          const ui = await mountDiagram($, SESSION_LOG, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(rows).toEqual(SESSION_LOG_DRAWN)
          expect(tooWide(rows, surface, columns)).toEqual([])
          expect(await ui.find({ type: 'Text', text: /── mermaid · er ─/ })).toBeDefined()
          await ui.press({ key: 'block-1-copy' })
          await ui.press({ key: 'block-1-drawing' })
          expect(world.copies).toEqual([SESSION_LOG, SESSION_LOG_DRAWN.join('\n')])
          expect(world.toasts.map(firstToastLine)).toEqual([
            '✓ Copied the er source',
            '✓ Copied the er drawing',
          ])
          await ui.unmount()
        },
      )
    }

    viewTest(
      `an ER relationship between entities that do not follow each other draws beside the stack on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, ORDERS, surface)
        expect((await drawnRows(ui, surface)).map(rowText)).toEqual(ORDERS_DRAWN)
        await ui.unmount()
      },
    )

    viewTest(
      `an ER diagram too wide for 30 columns shows its source under the width note on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, ORDERS, surface, 30)
        expect(await noteOf(ui)).toBe(widthNote(30, surface, 39))
        await ui.unmount()
      },
    )
  }

  viewTest(
    'an entity takes its cycle colour, its keys are bold and its types and the words are inactive on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, SESSION_LOG, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      expect(
        ['SESSION', 'PROMPT', 'TOOL_CALL'].map((name) => colourOf(rows, `│ ${name} `)),
      ).toEqual([...CYCLE])
      expect(['PK', 'FK'].map((key) => styleAt(rows, key))).toEqual([
        { bold: true },
        { bold: true },
      ])
      expect(['string', 'date', 'has', '0..n', '1..n'].map((word) => styleAt(rows, word))).toEqual(
        Array(5).fill({ color: LINE }),
      )
      await ui.unmount()
    },
  )

  for (const [left, right, first, second] of [
    ['|o', 'o|', '0..1', '0..1'],
    ['||', '||', '1', '1'],
    ['}o', 'o{', '0..n', '0..n'],
    ['}|', '|{', '1..n', '1..n'],
  ] as const) {
    test(`the cardinalities ${left} and ${right} read as ${first} and ${second}`, () => {
      expect(parseMermaid(lines('erDiagram', `  A ${left}--${right} B : has`))).toMatchObject({
        relations: [{ from: 'A', to: 'B', fromCard: first, toCard: second, stroke: 'solid' }],
      })
    })
  }

  test('the mixed cardinality }|..|| draws as 1..n and 1 on a dashed line', () => {
    expect(parseMermaid(lines('erDiagram', '  CUSTOMER }|..|| ACCOUNT : holds'))).toMatchObject({
      relations: [{ fromCard: '1..n', toCard: '1', stroke: 'dashed', label: 'holds' }],
    })
  })

  test('the cardinality words and the optional line read as their symbols do', () => {
    expect(
      parseMermaid(
        lines(
          'erDiagram',
          '  CAR 1 to zero or more NAMED-DRIVER : allows',
          '  PERSON many(0) optionally to 0+ NAMED-DRIVER : is',
          '  PERSON only one to one or zero "Home Address" : "lives at"',
        ),
      ),
    ).toMatchObject({
      relations: [
        { from: 'CAR', to: 'NAMED-DRIVER', fromCard: '1', toCard: '0..n', stroke: 'solid' },
        { from: 'PERSON', to: 'NAMED-DRIVER', fromCard: '0..n', toCard: '0..n', stroke: 'dashed' },
        { from: 'PERSON', to: 'Home Address', fromCard: '1', toCard: '0..1', label: 'lives at' },
      ],
    })
  })

  test('an entity takes its alias and its attributes with keys and comments', () => {
    expect(
      parseMermaid(
        lines(
          'erDiagram',
          '  p[Person] {',
          '    string driversLicense PK "The license #"',
          '    string(99) firstName',
          '    string carRegistrationNumber PK, FK',
          '  }',
        ),
      ),
    ).toEqual({
      kind: 'er',
      entities: [
        {
          id: 'p',
          label: 'Person',
          attributes: [
            { type: 'string', name: 'driversLicense', keys: 'PK', comment: 'The license #' },
            { type: 'string(99)', name: 'firstName', keys: '', comment: '' },
            { type: 'string', name: 'carRegistrationNumber', keys: 'PK, FK', comment: '' },
          ],
        },
      ],
      relations: [],
    })
  })

  for (const [what, source, reason] of [
    [
      'a cardinality that does not parse',
      lines('erDiagram', '  A ||--o{ B : has', '  A }|..|x C : uses'),
      refusedBy('line 3: the cardinality }|..|x does not parse', 3),
    ],
    [
      'a subgraph',
      lines('erDiagram', '  subgraph one', '  A', '  end'),
      refusedBy('subgraph does not draw yet', 2),
    ],
    [
      '13 attributes',
      lines(
        'erDiagram',
        '  A {',
        ...Array.from({ length: 13 }, (_, at) => `    string f${String(at)}`),
        '  }',
      ),
      refusedBy('entity A has 13 attributes, at most 12 draw'),
    ],
  ] as const) {
    test(`an ER diagram with ${what} refuses with the reason`, () => {
      expect(parseMermaid(source)).toEqual(reason)
    })
  }
})

const SELF_RELATION_CRITERION =
  'When an erDiagram has a relationship from an entity to itself, reply-view draws a loop on the right of that box with both cardinalities and the label'

const MANAGES = lines('erDiagram', '  USER ||--o{ USER : manages')

const MANAGES_DRAWN = ['╭──────╮', '│ USER ├─ 1 manages ─┐', '│      ├─ 0..n ──────┘', '╰──────╯']

const LOOP_AND_LINKS = lines(
  'erDiagram',
  '  EMPLOYEE ||--o{ TASK : owns',
  '  EMPLOYEE |o--o{ EMPLOYEE : manages',
  '  TEAM ||--|{ EMPLOYEE : has',
  '  EMPLOYEE {',
  '    string id PK',
  '    string team FK',
  '  }',
)

function erLines(source: string, width: number): string[] {
  const diagram = parseMermaid(source)
  if (diagram.kind !== 'er') throw new Error(`not an ER diagram: ${diagram.kind}`)
  const drawn = drawEntities(diagram, width)
  if (drawn.kind !== 'drawing') throw new Error(`not drawn: ${drawn.reason}`)
  return drawn.lines
}

describe(SELF_RELATION_CRITERION, () => {
  for (const surface of SURFACES) {
    for (const columns of [80, 30]) {
      viewTest(
        `a relationship from an entity to itself draws as a loop on the right of its box with both cardinalities and the label on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, MANAGES, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(rows).toEqual(MANAGES_DRAWN)
          expect(tooWide(rows, surface, columns)).toEqual([])
          await ui.unmount()
        },
      )
    }
  }

  test('a loop on an entity with attributes and two other relationships draws beside the box and crosses no line', () => {
    const drawn = erLines(LOOP_AND_LINKS, 78)
    const loopTop = drawn.findIndex((row) => row.includes('├─ 0..1 manages ─'))
    expect(loopTop).toBeGreaterThan(-1)
    const column = drawn[loopTop]?.indexOf('┐') ?? -1
    expect(column).toBeGreaterThan(-1)
    const loopEnd = drawn.findIndex((row, at) => at > loopTop && row.charAt(column) === '┘')
    expect(drawn[loopEnd]).toContain('├─ 0..n ─')
    for (const row of drawn.slice(loopTop + 1, loopEnd)) expect(row.charAt(column)).toBe('│')
    expect(drawn.join('\n')).toContain('owns')
    expect(drawn.join('\n')).toContain('has')
    expect(drawn.join('\n')).not.toMatch(/┼/)
  })

  test('two loops on one entity nest, the first one inside the later one, and cross no line', () => {
    expect(
      erLines(lines('erDiagram', '  USER ||--o{ USER : manages', '  USER |o--o| USER : pairs'), 78),
    ).toEqual([
      '╭──────╮',
      '│ USER ├─ 0..1 pairs ───┐',
      '│      ├─ 1 manages ──┐ │',
      '│      ├─ 0..n ───────┘ │',
      '│      ├─ 0..1 ─────────┘',
      '╰──────╯',
    ])
  })
})
