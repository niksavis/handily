import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { added, durationOf } from './hooks/dates'
import { parseMermaid } from './hooks/mermaid'
import { displayWidth } from './hooks/width'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [80, 40, 30] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const STYLE_PROPS = ['color', 'bold'] as const
const CYCLE = ['suggestion', 'planMode', 'merged'] as const
const CRIT = 'claude'
const DONE = 'inactive'

type Surface = (typeof SURFACES)[number]

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

type Style = Partial<Record<(typeof STYLE_PROPS)[number], unknown>>

type Span = { text: string; style: Style }

type World = { copies: string[]; toasts: string[] }

function lines(...rows: string[]): string {
  return rows.join('\n')
}

const PLAN = lines(
  'gantt',
  '    title A Gantt Diagram',
  '    dateFormat YYYY-MM-DD',
  '    section Section',
  '        A task          :a1, 2014-01-01, 30d',
  '        Another task    :after a1, 20d',
  '    section Another',
  '        Task in Another :2014-01-12, 12d',
  '        another task    :24d',
)

const PLAN_DRAWN = [
  'A Gantt Diagram',
  'Section',
  '  A task          ████████████████████████████████████  ┊       ┊        ┊',
  '  Another task        ┊        ┊       ┊        ┊     ████████████████████████',
  'Another',
  '  Task in Another     ┊        ███████████████  ┊       ┊       ┊        ┊',
  '  another task        ┊        ┊       ┊     ██████████████████████████████',
  '                  ────┴────────┴───────┴────────┴───────┴───────┴────────┴────',
  '                      01-05    01-12   01-19    01-26   02-02   02-09    02-16',
]

const TAGGED = lines(
  'gantt',
  '    dateFormat  YYYY-MM-DD',
  '    title       Adding GANTT diagram functionality to mermaid',
  '    section A section',
  '    Completed task            :done,    des1, 2014-01-06,2014-01-08',
  '    Active task               :active,  des2, 2014-01-09, 3d',
  '    Future task               :         des3, after des2, 5d',
  '    Future task2              :         des4, after des3, 5d',
  '    section Critical tasks',
  '    Completed task in the critical line :crit, done, 2014-01-06,24h',
  '    Implement parser and jison          :crit, done, after des1, 2d',
  '    Create tests for parser             :crit, active, 3d',
  '    Future task in critical line        :crit, 5d',
  '    Create tests for renderer           :2d',
  '    Add to mermaid                      :until isadded',
  '    Functionality added                 :milestone, isadded, 2014-01-25, 0d',
  '    section Documentation',
  '    Describe gantt syntax               :active, a1, after des1, 3d',
  '    Add gantt diagram to demo page      :after a1  , 20h',
  '    Add another diagram to demo page    :doc1, after a1  , 48h',
  '    section Last section',
  '    Describe gantt syntax               :after doc1, 3d',
  '    Add gantt diagram to demo page      :20h',
  '    Add another diagram to demo page    :48h',
)

const TAGGED_DRAWN = [
  'Adding GANTT diagram functionality to mermaid',
  'A section',
  '  Completed task                ░░░░░         ┊                ┊',
  '  Active task                          ▓▓▓▓▓▓▓▓                ┊',
  '  Future task                                 █████████████    ┊',
  '  Future task2                                ┊           █████████████',
  'Critical tasks',
  '  Completed task in the critic… ░░░           ┊                ┊',
  '  Implement parser and jison        ░░░░░░    ┊                ┊',
  '  Create tests for parser                ▓▓▓▓▓▓▓▓              ┊',
  '  Future task in critical line                ┊ ██████████████ ┊',
  '  Create tests for renderer                   ┊              █████',
  '  Add to mermaid                              ┊                ┊ █████████████',
  '  Functionality added                         ┊                ┊             ◇',
  'Documentation',
  '  Describe gantt syntax             ▓▓▓▓▓▓▓▓▓ ┊                ┊',
  '  Add gantt diagram to demo pa…             ███                ┊',
  '  Add another diagram to demo…              █████              ┊',
  'Last section',
  '  Describe gantt syntax                       ┊ █████████      ┊',
  '  Add gantt diagram to demo pa…               ┊         ███    ┊',
  '  Add another diagram to demo…                ┊           ██████',
  '                                ──────────────┴────────────────┴──────────────',
  '                                              01-12            01-19',
  '█ task   ▓ active   ░ done   ◇ milestone   █ crit',
]

const TAGGED_NARROW = [
  'Adding GANTT diagram',
  'functionality to mermaid',
  'A section',
  '  Complete… ░░        ┊',
  '  Active t…   ▓▓▓▓    ┊',
  '  Future t…      █████┊',
  '  Future t…          █████',
  'Critical tasks',
  '  Complete… ░         ┊',
  '  Implemen…  ░░░      ┊',
  '  Create t…    ▓▓▓    ┊',
  '  Future t…      ██████',
  '  Create t…           ██',
  '  Add to m…           ┊█████',
  '  Function…           ┊    ◇',
  'Documentation',
  '  Describe…  ▓▓▓▓     ┊',
  '  Add gant…     █     ┊',
  '  Add anot…     ██    ┊',
  'Last section',
  '  Describe…      ████ ┊',
  '  Add gant…         ██┊',
  '  Add anot…          ██',
  '            ──────────┴─────',
  '                      01-19',
  '█ task   ▓ active   ░ done',
  '◇ milestone   █ crit',
]

const CLOCK = lines(
  'gantt',
  '    dateFormat HH:mm',
  '    axisFormat %H:%M',
  '    Initial milestone : milestone, m1, 17:49, 2m',
  '    Task A : 10m',
  '    Task B : 5m',
  '    Final milestone : milestone, m2, 18:08, 4m',
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
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

function fenced(source: string): string {
  return ['```mermaid', source, '```'].join('\n')
}

async function mountGantt($: Engine, source: string, surface: Surface, columns = 80) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: { text: ['The plan:', '', fenced(source)].join('\n'), isFirstOfReply: true },
    requestId: 'message-1',
    viewport: { columns, rows: 40 },
  })
}

type Mounted = Awaited<ReturnType<typeof mountGantt>>

function bodyWidth(surface: Surface, columns: number): number {
  return surface === 'terminal' ? columns - 2 : columns
}

async function openedRows(ui: Mounted, surface: Surface): Promise<Span[][]> {
  if ((await ui.find({ key: 'fold' })) !== undefined) await ui.press({ key: 'fold' })
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

async function textRows(ui: Mounted, surface: Surface): Promise<string[]> {
  return (await openedRows(ui, surface)).map(rowText)
}

function tooWide(rows: readonly string[], surface: Surface, columns: number): string[] {
  return rows.filter((row) => displayWidth(row) > bodyWidth(surface, columns))
}

function rowOf(rows: readonly Span[][], start: string): Span[] {
  return rows.find((row) => rowText(row).startsWith(start)) ?? []
}

function spanWith(row: readonly Span[], glyph: string): Span | undefined {
  return row.find((span) => span.text.includes(glyph))
}

async function noteOf(ui: Mounted): Promise<string | undefined> {
  return (await ui.find({ type: 'Text', text: /^diagram not drawn:/ }))?.text
}

function firstToastLine(toast: string): string | undefined {
  return toast.split(/\s{2,}/)[0]
}

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 16).replace('T', ' ')
}

function tasksOf(source: string): { label: string; start: string; end: string }[] {
  const diagram = parseMermaid(source)
  if (diagram.kind !== 'gantt') throw new Error(`no gantt: ${JSON.stringify(diagram)}`)
  return diagram.tasks.map((task) => ({
    label: task.label,
    start: iso(task.start),
    end: iso(task.end),
  }))
}

describe('gantt diagrams', () => {
  viewTest(
    'a gantt draws its tasks as bars across a shared date axis under their sections at 80 columns on terminal',
    async (world, $) => {
      const ui = await mountGantt($, PLAN, 'terminal')
      const rows = await textRows(ui, 'terminal')
      expect(rows).toEqual(PLAN_DRAWN)
      expect(await ui.find({ type: 'Text', text: /── mermaid · gantt ─/ })).toBeDefined()
      await ui.press({ key: 'block-1-copy' })
      await ui.press({ key: 'block-1-drawing' })
      expect(world.copies).toEqual([PLAN, PLAN_DRAWN.join('\n')])
      expect(world.toasts.map(firstToastLine)).toEqual([
        '✓ Copied the gantt source',
        '✓ Copied the gantt drawing',
      ])
      await ui.unmount()
    },
  )

  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      for (const [name, source] of [
        ['plan', PLAN],
        ['tagged plan', TAGGED],
        ['clock plan', CLOCK],
      ] as const) {
        viewTest(
          `the ${name} draws and every line fits the body on ${surface} at ${String(columns)} columns`,
          async (_world, $) => {
            const ui = await mountGantt($, source, surface, columns)
            const rows = await textRows(ui, surface)
            expect(await noteOf(ui)).toBeUndefined()
            expect(await ui.find({ key: 'block-1-drawing' })).toBeDefined()
            expect(rows.some((row) => row.includes('┴'))).toBe(true)
            expect(tooWide(rows, surface, columns)).toEqual([])
            await ui.unmount()
          },
        )
      }
    }
  }

  for (const [columns, drawn] of [
    [80, TAGGED_DRAWN],
    [30, TAGGED_NARROW],
  ] as const) {
    viewTest(
      `done, active, crit and milestone tasks differ by fill and the legend names them at ${String(columns)} columns on terminal`,
      async (_world, $) => {
        const ui = await mountGantt($, TAGGED, 'terminal', columns)
        expect(await textRows(ui, 'terminal')).toEqual([...drawn])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'crit tasks draw in claude with a bold label, done tasks in inactive, and each section in its cycle colour on terminal',
    async (_world, $) => {
      const ui = await mountGantt($, TAGGED, 'terminal')
      const rows = await openedRows(ui, 'terminal')
      expect(spanWith(rowOf(rows, '  Completed task  '), '░')?.style.color).toBe(DONE)
      expect(spanWith(rowOf(rows, '  Active task'), '▓')?.style.color).toBe(CYCLE[0])
      expect(spanWith(rowOf(rows, '  Implement parser'), '░')?.style.color).toBe(CRIT)
      expect(rowOf(rows, '  Implement parser')[0]?.style.bold).toBe(true)
      expect(spanWith(rowOf(rows, '  Future task in critical'), '█')?.style.color).toBe(CRIT)
      expect(spanWith(rowOf(rows, '  Create tests for renderer'), '█')?.style.color).toBe(CYCLE[1])
      expect(spanWith(rowOf(rows, '  Functionality added'), '◇')?.style.color).toBe(CYCLE[1])
      expect(spanWith(rowOf(rows, '  Describe gantt syntax  '), '▓')?.style.color).toBe(CYCLE[2])
      expect(
        ['A section', 'Critical tasks', 'Documentation'].map((name) => rowOf(rows, name)[0]?.style),
      ).toEqual([
        { color: CYCLE[0], bold: true },
        { color: CYCLE[1], bold: true },
        { color: CYCLE[2], bold: true },
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a gantt with clock times reads its dateFormat and axisFormat at 80 columns on terminal',
    async (_world, $) => {
      const ui = await mountGantt($, CLOCK, 'terminal')
      expect(await textRows(ui, 'terminal')).toEqual([
        'Initial milestone   ◇            ┊            ┊            ┊            ┊',
        'Task A              ┊  ███████████████████████████         ┊            ┊',
        'Task B              ┊            ┊            ┊  ██████████████         ┊',
        'Final milestone     ┊            ┊            ┊            ┊            ◇',
        '                  ──┴────────────┴────────────┴────────────┴────────────┴─────',
        '                    17:50        17:55        18:00        18:05        18:10',
        '█ task   ◇ milestone',
      ])
      await ui.unmount()
    },
  )

  test('after, until, the previous task and the durations resolve to the dates that the source names', () => {
    expect(tasksOf(TAGGED).slice(0, 11)).toEqual([
      { label: 'Completed task', start: '2014-01-06 00:00', end: '2014-01-08 00:00' },
      { label: 'Active task', start: '2014-01-09 00:00', end: '2014-01-12 00:00' },
      { label: 'Future task', start: '2014-01-12 00:00', end: '2014-01-17 00:00' },
      { label: 'Future task2', start: '2014-01-17 00:00', end: '2014-01-22 00:00' },
      {
        label: 'Completed task in the critical line',
        start: '2014-01-06 00:00',
        end: '2014-01-07 00:00',
      },
      { label: 'Implement parser and jison', start: '2014-01-08 00:00', end: '2014-01-10 00:00' },
      { label: 'Create tests for parser', start: '2014-01-10 00:00', end: '2014-01-13 00:00' },
      { label: 'Future task in critical line', start: '2014-01-13 00:00', end: '2014-01-18 00:00' },
      { label: 'Create tests for renderer', start: '2014-01-18 00:00', end: '2014-01-20 00:00' },
      { label: 'Add to mermaid', start: '2014-01-20 00:00', end: '2014-01-25 00:00' },
      { label: 'Functionality added', start: '2014-01-25 00:00', end: '2014-01-25 00:00' },
    ])
    expect(
      tasksOf(
        lines(
          'gantt',
          '  dateFormat DD.MM.YYYY HH:mm',
          '  inclusiveEndDates',
          '  apple :a, 20.07.2017 00:00, 1w',
          '  banana :crit, b, 23.07.2017 00:00, 1d',
          '  cherry :active, c, after b a, 1d',
          '  kiwi   :d, 20.07.2017 00:00, until b c',
          '  lime   :e, 31.01.2018 00:00, 1M',
          '  plum   :f, 01.02.2018 00:00, 02.02.2018 00:00',
        ),
      ),
    ).toEqual([
      { label: 'apple', start: '2017-07-20 00:00', end: '2017-07-27 00:00' },
      { label: 'banana', start: '2017-07-23 00:00', end: '2017-07-24 00:00' },
      { label: 'cherry', start: '2017-07-27 00:00', end: '2017-07-28 00:00' },
      { label: 'kiwi', start: '2017-07-20 00:00', end: '2017-07-23 00:00' },
      { label: 'lime', start: '2018-01-31 00:00', end: '2018-02-28 00:00' },
      { label: 'plum', start: '2018-02-01 00:00', end: '2018-02-03 00:00' },
    ])
  })
  test('a part of a duration resolves as Mermaid 12.3.0 adds it with dayjs', () => {
    const ends = [
      ['0.5d', '2024-02-01 00:00'],
      ['1.5d', '2024-02-02 00:00'],
      ['2.5d', '2024-02-03 00:00'],
      ['0.5w', '2024-02-04 00:00'],
      ['1.5w', '2024-02-11 00:00'],
      ['0.5M', '2024-01-31 00:00'],
      ['1.5M', '2024-02-29 00:00'],
      ['0.5y', '2024-01-31 00:00'],
      ['1.5y', '2025-01-31 00:00'],
      ['1.5h', '2024-01-31 01:30'],
      ['0.1h', '2024-01-31 00:06'],
    ] as const
    const source = lines(
      'gantt',
      ...ends.map(([duration], at) => `  t${String(at)} : 2024-01-31, ${duration}`),
    )
    expect(tasksOf(source).map((task) => [task.label, task.end])).toEqual(
      ends.map(([, end], at) => [`t${String(at)}`, end]),
    )
  })

  test('a part of a second or a millisecond drops the rest of the millisecond, as dayjs does', () => {
    const start = Date.parse('2024-01-31T00:00:00.000Z')
    const ends = [
      ['0.25m', '2024-01-31T00:00:15.000Z'],
      ['2.0015s', '2024-01-31T00:00:02.001Z'],
      ['0.0015s', '2024-01-31T00:00:00.001Z'],
      ['2.5ms', '2024-01-31T00:00:00.002Z'],
    ] as const
    expect(
      ends.map(([text]) => {
        const duration = durationOf(text)
        return duration === null ? null : new Date(added(start, duration)).toISOString()
      }),
    ).toEqual(ends.map(([, end]) => end))
  })

  viewTest(
    'a gantt whose labels are all under 4 columns draws at 80 columns',
    async (_world, $) => {
      const ui = await mountGantt($, lines('gantt', '  A: 2024-01-01, 3d', '  B: 2d'), 'terminal')
      const rows = await textRows(ui, 'terminal')
      expect(await noteOf(ui)).toBeUndefined()
      expect(rows.filter((row) => /^[AB] /.test(row)).map((row) => row.slice(0, 2))).toEqual([
        'A ',
        'B ',
      ])
      await ui.unmount()
    },
  )
})

describe('gantt diagrams that do not draw', () => {
  for (const [name, source, note] of [
    [
      'no tasks',
      lines('gantt', '  title A plan', '  section One'),
      'the gantt diagram has no tasks',
    ],
    [
      'excludes',
      lines('gantt', '  excludes weekends', '  a : 2014-01-01, 3d'),
      'excludes does not draw yet',
    ],
    [
      'a vertical marker',
      lines('gantt', '  a : vert, v1, 2014-01-01, 3d'),
      'vert does not draw yet',
    ],
    [
      'an unknown task id',
      lines('gantt', '  a : 2014-01-01, 3d', '  b : after zz, 2d'),
      'line 3: no task has the id zz',
    ],
    [
      'a date that does not match the dateFormat',
      lines('gantt', '  a : 2014/01/01, 3d'),
      'line 2: "2014/01/01" does not match the dateFormat YYYY-MM-DD',
    ],
    [
      'an end that is not a date or a duration',
      lines('gantt', '  a : 2014-01-01, 3dX'),
      'line 2: "3dX" is not a date or a duration',
    ],
    [
      'a first task with no start',
      lines('gantt', '  a : 3d'),
      'line 2: the first task has no start date',
    ],
    [
      'after references that loop',
      lines('gantt', '  a : x1, after x2, 3d', '  b : x2, after x1, 2d'),
      'line 2: the after and until references loop',
    ],
    [
      'a task that ends before it starts',
      lines('gantt', '  a : 2014-01-05, 2014-01-01'),
      'line 2: the task ends before it starts',
    ],
    [
      'a dateFormat token that does not draw',
      lines('gantt', '  dateFormat YY-MM-DD', '  a : 14-01-01, 3d'),
      'dateFormat YY-MM-DD does not draw yet',
    ],
    [
      'an axisFormat directive that does not draw',
      lines('gantt', '  axisFormat %U', '  a : 2014-01-01, 3d'),
      'axisFormat %U does not draw yet',
    ],
  ] as const) {
    viewTest(
      `a gantt with ${name} shows its source under a note that names the reason`,
      async (world, $) => {
        const ui = await mountGantt($, source, 'terminal')
        expect(await noteOf(ui)).toBe(`diagram not drawn: ${note}.`)
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        expect(await ui.find({ type: 'Code' })).toBeDefined()
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([source])
        await ui.unmount()
      },
    )
  }

  for (const surface of SURFACES) {
    viewTest(
      `a gantt that does not fit the body shows its source under the width note on ${surface}`,
      async (_world, $) => {
        const columns = surface === 'terminal' ? 16 : 14
        const ui = await mountGantt($, PLAN, surface, columns)
        expect(await noteOf(ui)).toBe(
          'diagram not drawn: it takes 15 columns, the screen has 14. Widen the window or shorten the labels.',
        )
        await ui.unmount()
      },
    )
  }

  viewTest(
    '/replies copy diagram copies the gantt source as its copy button does',
    async (world, $) => {
      await $.turn.complete({
        answer: ['The plan:', '', fenced(PLAN)].join('\n'),
        durationMs: 1000,
        isAborted: false,
        turnId: 'turn-1',
        reason: 'answer',
      })
      const result = await $.command.run({
        command: 'replies',
        args: 'copy diagram',
        origin: { kind: 'sdk' },
        presentation: { isFullscreen: false, columns: 80 },
      })
      expect(result.text ?? '').toBe('')
      expect(world.copies).toEqual([PLAN])
      expect(world.toasts.map(firstToastLine)).toEqual(['✓ Copied the gantt source'])
    },
  )
})
