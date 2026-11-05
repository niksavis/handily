import type { On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { parseMermaid } from './hooks/mermaid'
import { displayWidth } from './hooks/width'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [80, 40, 30] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const STYLE_PROPS = ['color', 'bold'] as const
const VALUE = 'planMode'
const AXIS = 'inactive'
const TALLEST = 'claude'
const FIRST = 'suggestion'
const SECOND = 'planMode'

type Surface = (typeof SURFACES)[number]

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

type Style = Partial<Record<(typeof STYLE_PROPS)[number], unknown>>

type Span = { text: string; style: Style }

type World = { copies: string[]; toasts: string[] }

function lines(...rows: string[]): string {
  return rows.join('\n')
}

const BARS = lines(
  'xychart-beta',
  '  title "Ingest p95 by hour (ms)"',
  '  x-axis [11:00, 12:00, 13:00, 14:00, 15:00, 16:00]',
  '  bar [45, 47, 46, 2029, 2032, 2007]',
)

const BARS_UPRIGHT = [
  'Ingest p95 by hour (ms)',
  '',
  '2500 ┤                      2029   2032',
  '     │                      ▁▁▁▁▁  ▁▁▁▁▁  2007',
  '2000 ┤                      █████  █████  █████',
  '     │                      █████  █████  █████',
  '1500 ┤                      █████  █████  █████',
  '     │                      █████  █████  █████',
  '1000 ┤                      █████  █████  █████',
  '     │                      █████  █████  █████',
  ' 500 ┤  45     47     46    █████  █████  █████',
  '     │ ▁▁▁▁▁  ▂▂▂▂▂  ▁▁▁▁▁  █████  █████  █████',
  '   0 └─────────────────────────────────────────',
  '       11:00  12:00  13:00  14:00  15:00  16:00',
]

const BARS_ACROSS = [
  'Ingest p95 by hour (ms)',
  '11:00 ▌                             45',
  '12:00 ▌                             47',
  '13:00 ▌                             46',
  '14:00 █████████████████████▉      2029',
  '15:00 ██████████████████████      2032',
  '16:00 █████████████████████▋      2007',
  '      0                      2500',
]

const BARS_NARROW = [
  'Ingest p95 by hour (ms)',
  '11:00 ▎                   45',
  '12:00 ▍                   47',
  '13:00 ▍                   46',
  '14:00 █████████████▊    2029',
  '15:00 █████████████▉    2032',
  '16:00 █████████████▋    2007',
  '      0            2500',
]

const LINE = BARS.replace('  bar [', '  line [')

const LINE_UPRIGHT = [
  'Ingest p95 by hour (ms)',
  '',
  '2500 ┤',
  '     │',
  '2000 ┤                        ●──────●──────●',
  '     │                        │',
  '1500 ┤                        │',
  '     │                        │',
  '1000 ┤                        │',
  '     │                        │',
  ' 500 ┤                        │',
  '     │                        │',
  '   0 ┤   ●──────●──────●──────╯',
  '     └─────────────────────────────────────────',
  '       11:00  12:00  13:00  14:00  15:00  16:00',
  '     ●   45     47     46    2029   2032   2007',
]

const TWO_BARS = lines(
  'xychart-beta',
  '  title "Latency by hour (ms)"',
  '  x-axis [11:00, 14:00, 16:00]',
  '  bar "p95" [45, 2029, 2007]',
  '  bar "p99" [80, 2400, 2310]',
)

const TWO_BARS_DRAWN = [
  'Latency by hour (ms)                                             █ p95   ▒ p99',
  '',
  '                       2400',
  '2500 ┤            2029 ▒▒▒▒       2310',
  '     │            ▁▁▁▁ ▒▒▒▒  2007 ▒▒▒▒',
  '2000 ┤            ████ ▒▒▒▒  ████ ▒▒▒▒',
  '     │            ████ ▒▒▒▒  ████ ▒▒▒▒',
  '1500 ┤            ████ ▒▒▒▒  ████ ▒▒▒▒',
  '     │            ████ ▒▒▒▒  ████ ▒▒▒▒',
  '1000 ┤            ████ ▒▒▒▒  ████ ▒▒▒▒',
  '     │            ████ ▒▒▒▒  ████ ▒▒▒▒',
  ' 500 ┤  45   80   ████ ▒▒▒▒  ████ ▒▒▒▒',
  '     │ ▁▁▁▁ ▒▒▒▒  ████ ▒▒▒▒  ████ ▒▒▒▒',
  '   0 └────────────────────────────────',
  '         11:00      14:00      16:00',
]

const TWO_LINES = lines(
  'xychart-beta',
  '  title "Latency by hour (ms)"',
  '  x-axis [11:00, 12:00, 14:00, 16:00]',
  '  y-axis "Latency" 0 --> 3000',
  '  line "p95" [45, 900, 2029, 2007]',
  '  line "p99" [80, 1200, 2400, 1310]',
)

const TWO_LINES_DRAWN = [
  'Latency by hour (ms)                                             ● p95   ◇ p99',
  '',
  '3000 ┤',
  '     │',
  '2400 ┤                 ◇──────╮',
  '     │                 ●──────●',
  '1800 ┤                 │      │',
  '     │                 │      │',
  '1200 ┤          ◇──────│      ◇',
  '     │          ●──────╯',
  ' 600 ┤          │',
  '     │          │',
  '   0 ┤   ●──────╯',
  '     └───────────────────────────',
  '       11:00  12:00  14:00  16:00',
  '     ●   45    900    2029   2007',
  '     ◇   80    1200   2400   1310',
  'y-axis Latency',
]

const PIE = lines(
  'pie title Time per reply stage (ms, 400 in all)',
  '  "Draw" : 212',
  '  "Parse" : 72',
  '  "Paint" : 116',
)

const PIE_DRAWN = [
  'Time per reply stage (ms, 400 in all)',
  'Draw  ████████████████████████████████▉                              53% · 212',
  'Paint ██████████████████                                             29% · 116',
  'Parse ███████████▏                                                   18% ·  72',
]

const SIGNED = lines(
  'xychart-beta',
  '  title "Change against last week (ms)"',
  '  x-axis [Tue, Wed, Thu]',
  '  bar [120, -84, 6]',
)

const SIGNED_DRAWN = [
  'Change against last week (ms)',
  'Tue               ┃███████████▎   +120',
  'Wed       ████████┃                -84',
  'Thu               ┃▌                +6',
  '    -150          0          +150',
]

const FLOW = lines('flowchart LR', '  A --> B')

const FITTED = [
  ['bar chart', BARS],
  ['line chart', LINE],
  ['chart of two bar series', TWO_BARS],
  ['chart of two line series', TWO_LINES],
  ['pie chart', PIE],
  ['bar chart below 0', SIGNED],
] as const

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

function copyTest(name: string, body: (world: World, $: Engine) => unknown): void {
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

async function mountChart($: Engine, source: string, surface: Surface, columns = 80) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: { text: ['The chart:', '', fenced(source)].join('\n'), isFirstOfReply: true },
    requestId: 'message-1',
    viewport: { columns, rows: 40 },
  })
}

type Mounted = Awaited<ReturnType<typeof mountChart>>

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

async function textRows(ui: Mounted, surface: Surface): Promise<string[]> {
  return (await drawnRows(ui, surface)).map((row) => rowText(row).trimEnd())
}

function tooWide(rows: readonly string[], surface: Surface, columns: number): string[] {
  return rows.filter((row) => displayWidth(row) > bodyWidth(surface, columns))
}

function colourOf(rows: readonly Span[][], text: string): unknown {
  return rows.flat().find((span) => span.text.includes(text))?.style.color
}

async function noteOf(ui: Mounted): Promise<string | undefined> {
  return (await ui.find({ type: 'Text', text: /^(chart|diagram) not drawn:/ }))?.text
}

function firstToastLine(toast: string): string | undefined {
  return toast.split(/\s{2,}/)[0]
}

async function replyEnds($: Engine, answer: string): Promise<void> {
  await $.turn.complete({
    answer,
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
}

async function copyCommand($: Engine, args: string): Promise<string> {
  const result = await $.command.run({
    command: 'replies',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return result.text ?? ''
}

describe('bar charts', () => {
  viewTest(
    'an xychart-beta bar chart with at most 12 bars that fit draws upright with each value above its bar at 80 columns on terminal',
    async (world, $) => {
      const ui = await mountChart($, BARS, 'terminal')
      expect(await textRows(ui, 'terminal')).toEqual(BARS_UPRIGHT)
      expect(await ui.find({ type: 'Text', text: /── mermaid · bar chart ─/ })).toBeDefined()
      await ui.press({ key: 'block-1-copy' })
      await ui.press({ key: 'block-1-drawing' })
      expect(world.copies).toEqual([BARS, BARS_UPRIGHT.join('\n')])
      expect(world.toasts.map(firstToastLine)).toEqual([
        '✓ Copied the bar chart source',
        '✓ Copied the bar chart drawing',
      ])
      await ui.unmount()
    },
  )

  for (const [columns, drawn] of [
    [40, BARS_ACROSS],
    [30, BARS_NARROW],
  ] as const) {
    viewTest(
      `a bar chart that does not fit upright draws across with each value at the right edge at ${String(columns)} columns on terminal`,
      async (_world, $) => {
        const ui = await mountChart($, BARS, 'terminal', columns)
        expect(await textRows(ui, 'terminal')).toEqual([...drawn])
        await ui.unmount()
      },
    )
  }

  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      for (const [name, source] of FITTED) {
        viewTest(
          `the ${name} fits the body on ${surface} at ${String(columns)} columns`,
          async (_world, $) => {
            const ui = await mountChart($, source, surface, columns)
            const rows = await textRows(ui, surface)
            expect(await noteOf(ui)).toBeUndefined()
            expect(await ui.find({ key: 'block-1-drawing' })).toBeDefined()
            expect(rows.length).toBeGreaterThan(2)
            expect(tooWide(rows, surface, columns)).toEqual([])
            await ui.unmount()
          },
        )
      }
    }
  }

  for (const [name, source] of [
    [
      '13 bars',
      lines(
        'xychart-beta',
        `  bar [${Array.from({ length: 13 }, (_, at) => String(at + 1)).join(', ')}]`,
      ),
    ],
    [
      'a label wider than 8 columns',
      lines('xychart-beta', '  x-axis [a, "a long label"]', '  bar [1, 2]'),
    ],
  ] as const) {
    viewTest(
      `a bar chart with ${name} draws across at 80 columns on terminal`,
      async (_world, $) => {
        const ui = await mountChart($, source, 'terminal')
        const rows = await textRows(ui, 'terminal')
        expect(rows.length).toBeGreaterThan(2)
        expect(rows.some((row) => row.includes('└'))).toBe(false)
        expect(rows.at(-1)?.trim().startsWith('0')).toBe(true)
        await ui.unmount()
      },
    )
  }

  viewTest(
    'the tallest bar draws in claude, the other bars in suggestion, and the values and the axis numbers in planMode on terminal',
    async (_world, $) => {
      const ui = await mountChart($, BARS, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const tallest = rows[3]?.find((span) => span.text.includes('▁'))
      expect(tallest?.style.color).toBe(FIRST)
      expect(rows[2]?.find((span) => span.text === '2032')?.style.color).toBe(VALUE)
      expect(colourOf(rows, '2500')).toBe(VALUE)
      expect(colourOf(rows, '┤')).toBe(AXIS)
      const bars = rows[4]?.filter((span) => span.text.includes('█')) ?? []
      expect(bars.map((span) => span.style.color)).toEqual([FIRST, TALLEST, FIRST])
      expect(colourOf(rows, 'Ingest')).toBeUndefined()
      expect(rows[0]?.[0]?.style.bold).toBe(true)
      await ui.unmount()
    },
  )

  viewTest(
    'a bar chart with a value below 0 draws across around a 0 line with signed values at 40 columns on terminal',
    async (_world, $) => {
      const ui = await mountChart($, SIGNED, 'terminal', 40)
      expect(await textRows(ui, 'terminal')).toEqual(SIGNED_DRAWN)
      await ui.unmount()
    },
  )

  viewTest(
    'the desktop gets the chart in a Code element with no colour, as the other diagrams',
    async (world, $) => {
      const ui = await mountChart($, BARS, 'desktop')
      const source = (await ui.find({ type: 'Code' }))?.props.source
      expect(typeof source).toBe('string')
      await ui.press({ key: 'block-1-drawing' })
      expect(world.copies).toEqual([source])
      expect(await ui.find({ key: 'block-1-drawing-lines' })).toBeUndefined()
      await ui.unmount()
    },
  )
})

describe('two series', () => {
  viewTest(
    'the second bar series draws ▒ in planMode and the legend names both series by shape on terminal',
    async (_world, $) => {
      const ui = await mountChart($, TWO_BARS, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      expect(rows.map((row) => rowText(row).trimEnd())).toEqual(TWO_BARS_DRAWN)
      expect(colourOf(rows, '▒▒▒▒')).toBe(SECOND)
      expect(colourOf(rows, '████')).toBe(FIRST)
      await ui.unmount()
    },
  )

  viewTest(
    'the second line series draws ◇ in planMode, the first ●, and the legend names both by shape on terminal',
    async (_world, $) => {
      const ui = await mountChart($, TWO_LINES, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      expect(rows.map((row) => rowText(row).trimEnd())).toEqual(TWO_LINES_DRAWN)
      expect(colourOf(rows, '◇')).toBe(SECOND)
      expect(colourOf(rows, '●')).toBe(FIRST)
      await ui.unmount()
    },
  )

  viewTest(
    'two series drawn across keep their fill shapes and the legend at 30 columns on terminal',
    async (_world, $) => {
      const ui = await mountChart($, TWO_BARS, 'terminal', 30)
      expect(await textRows(ui, 'terminal')).toEqual([
        'Latency by hour (ms)',
        '█ p95   ▒ p99',
        '11:00 ▎                   45',
        '      ▒                   80',
        '14:00 █████████████▊    2029',
        '      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  2400',
        '16:00 █████████████▋    2007',
        '      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  2310',
        '      0            2500',
      ])
      await ui.unmount()
    },
  )
})

describe('line charts', () => {
  viewTest(
    'a line chart draws as steps with ● at each value at 80 columns on terminal',
    async (_world, $) => {
      const ui = await mountChart($, LINE, 'terminal')
      expect(await textRows(ui, 'terminal')).toEqual(LINE_UPRIGHT)
      expect(await ui.find({ type: 'Text', text: /── mermaid · line chart ─/ })).toBeDefined()
      await ui.unmount()
    },
  )

  for (const surface of SURFACES) {
    for (const columns of [40, 30] as const) {
      viewTest(
        `a line chart on a screen of ${String(columns)} columns draws as horizontal bars with a note on ${surface}`,
        async (_world, $) => {
          const ui = await mountChart($, LINE, surface, columns)
          const rows = await textRows(ui, surface)
          const width = bodyWidth(surface, columns)
          const bars = rows.slice(1, 7)
          expect(rows[0]).toBe('Ingest p95 by hour (ms)')
          expect(bars.map((row) => row.slice(0, 6))).toEqual([
            '11:00 ',
            '12:00 ',
            '13:00 ',
            '14:00 ',
            '15:00 ',
            '16:00 ',
          ])
          expect(bars.every((row) => /[▏▎▍▌▋▊▉█]/.test(row))).toBe(true)
          expect(rows.some((row) => row.includes('●'))).toBe(false)
          expect(rows.slice(8).join(' ')).toBe(
            `line chart drawn as bars: the screen has ${String(width)} columns.`,
          )
          expect(tooWide(rows, surface, columns)).toEqual([])
          await ui.unmount()
        },
      )
    }
  }
})

describe('pie charts', () => {
  viewTest(
    'a pie draws one bar per slice, largest first, with share and value at 80 columns on terminal',
    async (world, $) => {
      const ui = await mountChart($, PIE, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      expect(rows.map(rowText)).toEqual(PIE_DRAWN)
      expect(
        rows.slice(1).map((row) => row.find((span) => span.text.includes('█'))?.style.color),
      ).toEqual([FIRST, SECOND, 'merged'])
      expect(colourOf(rows, '53% · 212')).toBe(VALUE)
      expect(await ui.find({ type: 'Text', text: /── mermaid · pie chart ─/ })).toBeDefined()
      await ui.press({ key: 'block-1-copy' })
      expect(world.copies).toEqual([PIE])
      await ui.unmount()
    },
  )

  viewTest(
    'a narrow pie keeps the share and drops the value when the bars need the room',
    async (_world, $) => {
      const ui = await mountChart(
        $,
        lines('pie', '  "Network latency" : 1234567', '  "Other" : 7654321'),
        'terminal',
        30,
      )
      const rows = await textRows(ui, 'terminal')
      expect(rows).toEqual(['Other     ████████████   86%', 'Network…  ██             14%'])
      await ui.unmount()
    },
  )
})

describe('charts that do not draw', () => {
  for (const [name, source, note] of [
    ['no values', lines('xychart-beta', '  title "Empty"', '  bar []'), 'the chart has no values'],
    [
      'a value that is not a number',
      lines('xychart-beta', '  x-axis [a, b]', '  bar [1, 2]', '  bar [n/a, 3]'),
      'line 4: "n/a" is not a number',
    ],
    [
      'a pie slice below 0',
      lines('pie', '  "A" : 3', '  "B" : -1'),
      'line 3: the pie slice "B" is below 0',
    ],
    [
      'over 40 bars',
      lines(
        'xychart-beta',
        `  bar [${Array.from({ length: 41 }, (_, at) => String(at)).join(', ')}]`,
      ),
      '41 bars, at most 40 draw',
    ],
    ['a pie with no slices', lines('pie title Nothing'), 'the chart has no values'],
    [
      'bar and line series together',
      lines('xychart-beta', '  bar [1, 2]', '  line [3, 4]'),
      'a chart with bar and line series does not draw yet',
    ],
    [
      'a numeric x-axis',
      lines('xychart-beta', '  x-axis "Day" 1 --> 5', '  bar [1, 2]'),
      'a numeric x-axis does not draw yet',
    ],
  ] as const) {
    viewTest(
      `a chart with ${name} draws as its source under a note that names the reason`,
      async (world, $) => {
        const ui = await mountChart($, source, 'terminal')
        expect(await noteOf(ui)).toBe(`chart not drawn: ${note}.`)
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        expect(await ui.find({ type: 'Code' })).toBeDefined()
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([source])
        await ui.unmount()
      },
    )
  }

  test('a chart header with other words does not parse, and both chart keywords and showData read', () => {
    expect(parseMermaid('pie foo')).toEqual({
      kind: 'refused',
      reason: 'line 1 does not parse',
      line: 1,
      limit: null,
    })
    expect(parseMermaid(lines('xychart', '  bar [1]'))).toMatchObject({
      kind: 'chart',
      plot: 'bar',
    })
    expect(parseMermaid(lines('xychart-beta horizontal', '  bar [1]'))).toMatchObject({
      isHorizontal: true,
    })
    expect(parseMermaid(lines('pie showData', '  title Key', "  'Iron' : 5"))).toEqual({
      kind: 'chart',
      plot: 'pie',
      title: 'Key',
      slices: [{ label: 'Iron', value: 5 }],
    })
  })
})

describe('/replies copy chart', () => {
  copyTest(
    'copies the source of the last chart of the last reply, drawn or not',
    async (world, $) => {
      const refused = lines('pie', '  "A" : -1')
      await replyEnds(
        $,
        ['Two charts:', fenced(BARS), fenced(FLOW), fenced(PIE), 'The end.'].join('\n\n'),
      )
      expect(await copyCommand($, 'copy chart')).toBe('')
      expect(await copyCommand($, 'copy diagram')).toBe('')
      await replyEnds($, ['One chart:', fenced(refused)].join('\n\n'))
      expect(await copyCommand($, 'copy chart')).toBe('')
      expect(world.copies).toEqual([PIE, FLOW, refused])
      expect(world.toasts.map(firstToastLine)).toEqual([
        '✓ Copied the pie chart source',
        '✓ Copied the flowchart source',
        '✓ Copied the mermaid block',
      ])
    },
  )

  copyTest('names the missing chart when the last reply has none', async (world, $) => {
    await replyEnds($, ['A flow:', fenced(FLOW)].join('\n\n'))
    expect(await copyCommand($, 'copy chart')).toBe(
      'The last reply has no chart. /replies copy reply copies the whole reply.',
    )
    expect(world.copies).toEqual([])
  })
})
