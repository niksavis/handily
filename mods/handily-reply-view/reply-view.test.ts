import type { On, RenderPropsOf, UiCopyResult } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { displayWidth } from './hooks/width'

const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const COLUMNS = 80
const COLOR_MARKS: Readonly<Record<string, string>> = { error: '#', success: '+', warning: '!' }

type Surface = (typeof SURFACES)[number]

type World = {
  copies: string[]
  toasts: string[]
  logs: string[]
  copyResult: UiCopyResult
  commandDescriptions: string[]
}

function engineBeneath(on: On): World {
  const world: World = {
    copies: [],
    toasts: [],
    logs: [],
    copyResult: { isCopied: true },
    commandDescriptions: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    world.commandDescriptions.push(e.description)
    return { value: { command: e.name } }
  })
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    if (world.copyResult.isCopied) world.copies.push(e.text)
    return { value: world.copyResult }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  return world
}

type ViewBody = (world: World, $: Engine) => unknown

function viewTest(name: string, body: ViewBody): void {
  test(name, async ($, on) => {
    const world = engineBeneath(on)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

function reply(text: string, extra: Partial<RenderPropsOf['AssistantMessage']> = {}) {
  return { text, isFirstOfReply: true, ...extra }
}

async function mountReply(
  $: Engine,
  props: RenderPropsOf['AssistantMessage'],
  surface: Surface = 'terminal',
  columns = COLUMNS,
  requestId = 'message-1',
) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props,
    requestId,
    viewport: { columns, rows: 40 },
  })
}

async function commandText($: Engine, args = ''): Promise<string> {
  const result = await $.command.run({
    command: 'replies',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: COLUMNS },
  })
  return result.text ?? ''
}

type DrawnNode = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

function isDrawnNode(value: unknown): value is DrawnNode {
  return typeof value === 'object' && value !== null
}

function marked(props: Record<string, unknown>, text: string): string {
  if (text.trim() === '') return text
  let shown = props.underline === true ? `_${text}_` : text
  if (props.bold === true) shown = `*${shown}*`
  if (props.dimColor === true) shown = `~${shown}~`
  const mark = typeof props.color === 'string' ? COLOR_MARKS[props.color] : undefined
  return mark === undefined ? shown : `${mark}${shown}${mark}`
}

function inlineText(node: unknown): string {
  if (typeof node === 'string') return node
  if (!isDrawnNode(node)) return ''
  return marked(node.props ?? {}, (node.children ?? []).map(inlineText).join(''))
}

function cellsIn(line: string): number {
  return Array.from(line).length
}

function blockWidth(lines: readonly string[]): number {
  return Math.max(0, ...lines.map(cellsIn))
}

function fixedWidth(node: unknown): number {
  return isDrawnNode(node) && typeof node.props?.width === 'number' ? node.props.width : 0
}

function isGrower(node: unknown): boolean {
  return isDrawnNode(node) && Number(node.props?.flexGrow ?? 0) > 0
}

function margins(node: unknown): [number, number] {
  if (!isDrawnNode(node)) return [0, 0]
  return [Number(node.props?.marginLeft ?? 0), Number(node.props?.marginRight ?? 0)]
}

function rowLines(children: readonly unknown[], width: number, gap: number): string[] {
  const blocks = children.map((child) => (isGrower(child) ? null : sketchLines(child, width)))
  const widths = blocks.map((block, index) =>
    block === null ? 0 : Math.max(blockWidth(block), fixedWidth(children[index])),
  )
  const used =
    widths.reduce((sum, value, index) => sum + value + sum2(margins(children[index])), 0) +
    gap * Math.max(children.length - 1, 0)
  const filled = blocks.map((block, index) => {
    if (block !== null) return { lines: block, width: widths[index] ?? 0 }
    const child = children[index]
    const least = isDrawnNode(child) ? Number(child.props?.minWidth ?? 0) : 0
    const room = Math.max(least, width - used)
    const grown = sketchLines(child, room)
    return { lines: grown.length === 0 ? [''] : grown, width: room }
  })
  const height = Math.max(0, ...filled.map((block) => block.lines.length))
  return Array.from({ length: height }, (_, row) =>
    filled
      .map((block, index) => {
        const [left, right] = margins(children[index])
        const text = block.lines[row] ?? ''
        const padded = text + ' '.repeat(Math.max(block.width - cellsIn(text), 0))
        return ' '.repeat(left) + padded + ' '.repeat(right)
      })
      .join(' '.repeat(gap))
      .trimEnd(),
  )
}

function sum2([left, right]: [number, number]): number {
  return left + right
}

function boxLines(props: Record<string, unknown>, children: readonly unknown[], width: number) {
  const indent = Number(props.paddingLeft ?? 0)
  const inner = (typeof props.width === 'number' ? props.width : width) - indent
  const gap = Number(props.gap ?? 0)
  const lines =
    props.flexDirection === 'column'
      ? children.flatMap((child, index) => [
          ...(index > 0 ? Array<string>(gap).fill('') : []),
          ...sketchLines(child, inner),
        ])
      : rowLines(children, inner, gap)
  const placed =
    props.justifyContent === 'flex-end'
      ? lines.map((line) => ' '.repeat(Math.max(inner - cellsIn(line), 0)) + line)
      : lines
  return [
    ...Array<string>(Number(props.marginTop ?? 0)).fill(''),
    ...placed.map((line) => (line === '' ? line : ' '.repeat(indent) + line)),
  ]
}

function sketchLines(node: unknown, width: number): string[] {
  if (typeof node === 'string') return [node]
  if (!isDrawnNode(node)) return []
  const props = node.props ?? {}
  switch (node.type) {
    case 'Text':
      return [inlineText(node)]
    case 'Button':
      return [`[ ${String(props.label)} ]`]
    case 'Markdown':
      return String(props.text).split('\n')
    case 'Code':
      return String(props.source).split('\n')
    case 'Box':
      return boxLines(props, node.children ?? [], width)
    case 'engine':
      return ['(engine)']
    default:
      return []
  }
}

async function sketchOf(ui: { drawn: () => Promise<unknown> }, columns = COLUMNS) {
  return sketchLines(await ui.drawn(), columns).map((line) => line.trimEnd())
}

function edges(left: string, right: string, columns = COLUMNS): string {
  return left + ' '.repeat(columns - cellsIn(left) - cellsIn(right)) + right
}

const LONG_REPLY = Array.from({ length: 54 }, (_, index) => `Line ${String(index + 1)}`).join('\n')

function shownLines(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => `  Line ${String(from + index)}`)
}

const TABLE = [
  'The state of the mods:',
  '',
  '| Mod | State | Next |',
  '| --- | --- | --- |',
  '| task-pane | released | follows the work |',
  '| **simple-view** | `released` | click to expand |',
].join('\n')

const LONG_TABLE = [
  '| Mod | Change | Risk | Owner |',
  '| --- | --- | --- | --- |',
  '| reply-view | Tables wrap their long cells inside their columns and keep the rows aligned | A wide table can still take many lines on a narrow screen | Ana |',
  '| task-pane | Each task tool call draws as one row | Low | Bo |',
].join('\n')

const CHANGES_TABLE = [
  '| Change | Why | Effect |',
  '| --- | --- | --- |',
  '| Buttons on the header row | The buttons took a line of their own under every table, so a short table took one line more than it needed | A table that fits draws its buttons after the headings, and the reply is one line shorter |',
  '| Wrapped cells | A wide table drew one block for each row, so the reader lost the columns | Long cells wrap inside their columns and the rows stay aligned on a normal screen |',
].join('\n')

const RULE_CHARACTERS = ['─', '│', '┼', '┄'] as const

function ruled(line: string): string {
  return line.split('│').join('~│~')
}

function headed(line: string): string {
  return line
    .split('│')
    .map((cell) => (cell.trim() === '' ? cell : cell.replace(cell.trim(), `*${cell.trim()}*`)))
    .join('~│~')
}

function dim(line: string): string {
  return `~${line}~`
}

const FAMILY = '👨\u200d👩\u200d👧'

const FENCE = [
  'Here is the plan:',
  '',
  '```plan',
  '1. Write the mocks',
  '2. Ask the person',
  '```',
].join('\n')

describe('long reply', () => {
  for (const surface of SURFACES) {
    viewTest(
      `a reply of 30 lines or fewer draws as the engine draws it on ${surface}`,
      async (_world, $) => {
        const ui = await mountReply($, reply(shownLines(1, 30).join('\n')), surface)
        expect(await ui.drawn()).toEqual(ENGINE_ROW)
        await ui.unmount()
      },
    )

    viewTest(
      `a reply longer than 30 lines draws its first lines, the hidden count, more and copy on ${surface}`,
      async (_world, $) => {
        const ui = await mountReply($, reply(LONG_REPLY), surface)
        const folded = await sketchOf(ui)
        if (surface === 'terminal') {
          expect(folded).toEqual([
            '● Line 1',
            ...shownLines(2, 30),
            edges('  ~… 24 more lines~', '[ more ] [ copy ]'),
          ])
        } else {
          expect(folded).toEqual([
            ...shownLines(1, 30).map((line) => line.trim()),
            edges('~… 24 more lines~', '[ more ] [ copy ]'),
          ])
        }
        await ui.unmount()
      },
    )
  }

  viewTest('more shows the whole reply and less folds it again', async (_world, $) => {
    const ui = await mountReply($, reply(LONG_REPLY))
    await ui.press({ key: 'fold' })
    expect(await sketchOf(ui)).toEqual([
      '● Line 1',
      ...shownLines(2, 54),
      edges('', '[ less ] [ copy ]'),
    ])
    await ui.press({ key: 'fold' })
    expect((await sketchOf(ui)).at(-1)).toBe(edges('  ~… 24 more lines~', '[ more ] [ copy ]'))
    await ui.unmount()
  })

  viewTest('copy copies the whole reply as markdown', async (world, $) => {
    const ui = await mountReply($, reply(LONG_REPLY))
    await ui.press({ key: 'copy-reply' })
    expect(world.copies).toEqual([LONG_REPLY])
    expect(world.toasts).toEqual(['Copied the reply as markdown.'])
    await ui.unmount()
  })

  viewTest('says why a copy failed', async (world, $) => {
    world.copyResult = { isCopied: false, reason: 'no-surface' }
    const ui = await mountReply($, reply(LONG_REPLY))
    await ui.press({ key: 'copy-reply' })
    expect(world.toasts).toEqual(['Not copied: no screen is attached to this session.'])
    await ui.unmount()
  })

  viewTest(
    'counts a long line by the rows it wraps to and cuts it at a word',
    async (_world, $) => {
      const long = Array.from({ length: 60 }, (_, index) => `word${String(index)}`).join(' ')
      const text = [long, '', long, '', long, '', long, '', long, '', long].join('\n')
      const ui = await mountReply($, reply(text))
      const folded = await sketchOf(ui)
      const rowsOfLong = Math.ceil(long.length / (COLUMNS - 2))
      expect(rowsOfLong).toBe(6)
      expect(folded).toHaveLength(10)
      expect(folded.slice(0, 8)).toEqual([
        `● ${long}`,
        '',
        `  ${long}`,
        '',
        `  ${long}`,
        '',
        `  ${long}`,
        '',
      ])
      const cut = folded[8] ?? ''
      expect(cut).toMatch(/^ {2}word0 word1( word\d+)* word\d+…$/)
      expect(cut.length - 2).toBeLessThanOrEqual(2 * (COLUMNS - 2))
      expect(long.startsWith(cut.slice(2, -1))).toBe(true)
      expect(folded[9]).toBe(edges('  ~… 11 more lines~', '[ more ] [ copy ]'))
      await ui.unmount()
    },
  )

  viewTest(
    'a reply that grows while it streams keeps its first lines in place',
    async (_world, $) => {
      const lines = LONG_REPLY.split('\n')
      const ui = await mountReply($, reply(lines.slice(0, 40).join('\n')))
      const early = await sketchOf(ui)
      await ui.redraw(reply(LONG_REPLY))
      const later = await sketchOf(ui)
      expect(later.slice(0, 30)).toEqual(early.slice(0, 30))
      expect(early.at(-1)).toBe(edges('  ~… 10 more lines~', '[ more ] [ copy ]'))
      expect(later.at(-1)).toBe(edges('  ~… 24 more lines~', '[ more ] [ copy ]'))
      await ui.unmount()
    },
  )

  viewTest('a summary block draws as the engine draws it', async (_world, $) => {
    const ui = await mountReply($, reply(LONG_REPLY, { isSummary: true }))
    expect(await ui.drawn()).toEqual(ENGINE_ROW)
    await ui.unmount()
  })

  viewTest('a block after the first of a reply draws no bullet', async (_world, $) => {
    const ui = await mountReply($, reply(LONG_REPLY, { isFirstOfReply: false }))
    expect((await sketchOf(ui))[0]).toBe('  Line 1')
    await ui.unmount()
  })

  viewTest('shows hidden characters in the reply as escapes', async (_world, $) => {
    const ui = await mountReply($, reply(`${LONG_REPLY}\u200b\u0007`))
    await ui.press({ key: 'fold' })
    expect((await sketchOf(ui)).at(-2)).toBe('  Line 54\\u200b\\u0007')
    await ui.unmount()
  })
})

describe('tables', () => {
  viewTest(
    'a table that fits draws dim column rules and a dim header rule under a bold header, and no row rules',
    async (_world, $) => {
      const ui = await mountReply($, reply(TABLE))
      expect(await sketchOf(ui)).toEqual([
        '● The state of the mods:',
        '',
        `  ${headed('Mod         │ State    │ Next')}  [ copy ] [ copy as text ]`,
        `  ${dim('────────────┼──────────┼─────────────────')}`,
        `  ${ruled('task-pane   │ released │ follows the work')}`,
        `  ${ruled('simple-view │ released │ click to expand')}`,
      ])
      const header = await ui.find({ key: 'header' })
      expect(header?.text).toBe('Mod         │ State    │ Next')
      const heading = await ui.find({ type: 'Text', text: /^Mod$/ })
      expect(heading?.props.bold).toBe(true)
      expect(heading?.props.underline).toBeUndefined()
      await ui.unmount()
    },
  )

  test('every rule character of a table measures one column', () => {
    expect(RULE_CHARACTERS.map((rule) => displayWidth(rule))).toEqual([1, 1, 1, 1])
  })

  viewTest(
    'a table that does not fit 39 columns draws one block per row with the buttons on the first title',
    async (_world, $) => {
      const ui = await mountReply($, reply(TABLE), 'terminal', 39)
      expect(await sketchOf(ui, 39)).toEqual([
        '● The state of the mods:',
        '',
        '  *task-pane*  [ copy ] [ copy as text ]',
        '    State: released',
        '    Next:  follows the work',
        '',
        '  *simple-view*',
        '    State: released',
        '    Next:  click to expand',
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a block title too long to sit beside the buttons keeps its place and the buttons go under the blocks',
    async (_world, $) => {
      const ui = await mountReply($, reply(TABLE), 'terminal', 36)
      expect((await sketchOf(ui, 36)).slice(2)).toEqual([
        '  *task-pane*',
        '    State: released',
        '    Next:  follows the work',
        '',
        '  *simple-view*',
        '    State: released',
        '    Next:  click to expand',
        `  ${' '.repeat(34 - 25)}[ copy ] [ copy as text ]`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a wrapped table with no room on its header line or its last row puts the buttons on a line under it',
    async (_world, $) => {
      const ui = await mountReply($, reply(TABLE), 'terminal', 40)
      expect((await sketchOf(ui, 40)).slice(2)).toEqual([
        `  ${headed('Mod         │ State    │ Next')}`,
        `  ${dim('────────────┼──────────┼──────────────')}`,
        `  ${ruled('task-pane   │ released │ follows the')}`,
        `  ${ruled('            │          │ work')}`,
        `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄')}`,
        `  ${ruled('simple-view │ released │ click to')}`,
        `  ${ruled('            │          │ expand')}`,
        `  ${' '.repeat(38 - 25)}[ copy ] [ copy as text ]`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a wrapped table at 80 columns separates its rows by a dotted rule and copies no rule characters',
    async (world, $) => {
      const ui = await mountReply($, reply(LONG_TABLE))
      const drawn = await sketchOf(ui)
      expect(drawn).toEqual([
        `● ${headed('Mod        │ Change                          │ Risk                    │ Owner')}`,
        `  ${dim('───────────┼─────────────────────────────────┼─────────────────────────┼──────')}`,
        `  ${ruled('reply-view │ Tables wrap their long cells    │ A wide table can still  │ Ana')}`,
        `  ${ruled('           │ inside their columns and keep   │ take many lines on a    │')}`,
        `  ${ruled('           │ the rows aligned                │ narrow screen           │')}`,
        `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄')}`,
        `  ${ruled('task-pane  │ Each task tool call draws as    │ Low                     │ Bo')}`,
        `  ${ruled('           │ one row                         │                         │')}`,
        `  ${' '.repeat(78 - 25)}[ copy ] [ copy as text ]`,
      ])
      expect(RULE_CHARACTERS.filter((rule) => drawn.join('').includes(rule))).toEqual([
        ...RULE_CHARACTERS,
      ])
      await ui.press({ key: 'block-0-copy' })
      await ui.press({ key: 'block-0-text' })
      expect(
        world.copies.filter((text) => RULE_CHARACTERS.some((rule) => text.includes(rule))),
      ).toEqual([])
      expect(world.copies).toEqual([
        LONG_TABLE,
        [
          'Mod: reply-view',
          'Change: Tables wrap their long cells inside their columns and keep the rows aligned',
          'Risk: A wide table can still take many lines on a narrow screen',
          'Owner: Ana',
          '',
          'Mod: task-pane',
          'Change: Each task tool call draws as one row',
          'Risk: Low',
          'Owner: Bo',
        ].join('\n'),
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a wrapped table whose header line is full puts the buttons after the short last row',
    async (_world, $) => {
      const table = [
        '| Name | What the view does with a column of twelve cells or less while a long column wraps |',
        '| --- | --- |',
        '| twelve-cells | The view keeps a column of twelve cells or less at its natural width |',
        '| short | x |',
      ].join('\n')
      const ui = await mountReply($, reply(table))
      expect(await sketchOf(ui)).toEqual([
        `● ${headed('Name         │ What the view does with a column of twelve cells or less while')}`,
        `  ${headed('             │ a long column wraps')}`,
        `  ${dim('─────────────┼────────────────────────────────────────────────────────────────')}`,
        `  ${ruled('twelve-cells │ The view keeps a column of twelve cells or less at its natural')}`,
        `  ${ruled('             │ width')}`,
        `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄')}`,
        edges(`  ${ruled('short        │ x')}`, '[ copy ] [ copy as text ]'),
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a wrapped table at 120 columns whose last row is full puts the buttons on a line under it',
    async (_world, $) => {
      const ui = await mountReply($, reply(LONG_TABLE), 'terminal', 120)
      expect(await sketchOf(ui, 120)).toEqual([
        `● ${headed('Mod        │ Change                                                │ Risk                                      │ Owner')}`,
        `  ${dim('───────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────┼──────')}`,
        `  ${ruled('reply-view │ Tables wrap their long cells inside their columns and │ A wide table can still take many lines on │ Ana')}`,
        `  ${ruled('           │ keep the rows aligned                                 │ a narrow screen                           │')}`,
        `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄')}`,
        `  ${ruled('task-pane  │ Each task tool call draws as one row                  │ Low                                       │ Bo')}`,
        `  ${' '.repeat(118 - 25)}[ copy ] [ copy as text ]`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a column wider than 12 cells wraps and shares the width by the width of its widest cell',
    async (_world, $) => {
      const ui = await mountReply($, reply(CHANGES_TABLE), 'terminal', 120)
      expect(await sketchOf(ui, 120)).toEqual([
        edges(
          `● ${headed('Change        │ Why                                                    │ Effect')}`,
          '[ copy ] [ copy as text ]',
          120,
        ),
        `  ${dim('──────────────┼────────────────────────────────────────────────────────┼──────────────────────────────────────────────')}`,
        `  ${ruled('Buttons on    │ The buttons took a line of their own under every       │ A table that fits draws its buttons after the')}`,
        `  ${ruled('the header    │ table, so a short table took one line more than it     │ headings, and the reply is one line shorter')}`,
        `  ${ruled('row           │ needed                                                 │')}`,
        `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄')}`,
        `  ${ruled('Wrapped cells │ A wide table drew one block for each row, so the       │ Long cells wrap inside their columns and the')}`,
        `  ${ruled('              │ reader lost the columns                                │ rows stay aligned on a normal screen')}`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a column of 12 cells keeps its natural width beside a column that wraps',
    async (_world, $) => {
      const table = [
        '| Name | Note |',
        '| --- | --- |',
        '| twelve-cells | The view keeps a column of twelve cells or less at its natural width while the long column wraps inside its own width |',
        '| short | x |',
      ].join('\n')
      const ui = await mountReply($, reply(table))
      expect(await sketchOf(ui)).toEqual([
        edges(`● ${headed('Name         │ Note')}`, '[ copy ] [ copy as text ]'),
        `  ${dim('─────────────┼────────────────────────────────────────────────────────────────')}`,
        `  ${ruled('twelve-cells │ The view keeps a column of twelve cells or less at its natural')}`,
        `  ${ruled('             │ width while the long column wraps inside its own width')}`,
        `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄')}`,
        `  ${ruled('short        │ x')}`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a table whose cells are all 12 cells or less keeps its natural widths and draws no row rules',
    async (_world, $) => {
      const table = [
        '| Step | Lint | Test | Ship |',
        '| --- | --- | --- | --- |',
        '| build-checks | passed | passed | passed |',
        '| release-note | skipped | failed | skipped |',
      ].join('\n')
      const ui = await mountReply($, reply(table))
      expect(await sketchOf(ui)).toEqual([
        `● ${headed('Step         │ Lint    │ Test   │ Ship')}  [ copy ] [ copy as text ]`,
        `  ${dim('─────────────┼─────────┼────────┼────────')}`,
        `  ${ruled('build-checks │ passed  │ passed │ passed')}`,
        `  ${ruled('release-note │ skipped │ failed │ skipped')}`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a table of a header, its rule and 28 rows takes 30 lines and does not fold',
    async (_world, $) => {
      const rows = Array.from({ length: 28 }, (_, index) => `| row ${String(index + 1)} | ok |`)
      const ui = await mountReply(
        $,
        reply(['| Name | State |', '| --- | --- |', ...rows].join('\n')),
      )
      const drawn = await sketchOf(ui)
      expect(drawn).toHaveLength(30)
      expect(drawn.slice(0, 2)).toEqual([
        `● ${headed('Name   │ State')}  [ copy ] [ copy as text ]`,
        `  ${dim('───────┼──────')}`,
      ])
      expect(drawn.at(-1)).toBe(`  ${ruled('row 28 │ ok')}`)
      await ui.unmount()
    },
  )

  viewTest(
    'a wrapped table counts the header rule and the rule between its rows when it folds',
    async (_world, $) => {
      const rows = Array.from(
        { length: 11 },
        (_, index) => `| row ${String(index + 1)} name | released | follows the work |`,
      )
      const ui = await mountReply(
        $,
        reply(['| Mod | State | Next |', '| --- | --- | --- |', ...rows].join('\n')),
        'terminal',
        40,
      )
      const drawn = await sketchOf(ui, 40)
      expect(drawn.slice(0, 6)).toEqual([
        `● ${headed('Mod         │ State    │ Next')}`,
        `  ${dim('────────────┼──────────┼──────────────')}`,
        `  ${ruled('row 1 name  │ released │ follows the')}`,
        `  ${ruled('            │          │ work')}`,
        `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄')}`,
        `  ${ruled('row 2 name  │ released │ follows the')}`,
      ])
      expect(drawn.slice(25)).toEqual([
        `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄')}`,
        `  ${ruled('row 9 name  │ released │ follows the')}`,
        `  ${ruled('            │          │ work')}`,
        edges('  ~… 7 more lines~', '[ more ] [ copy ]', 40),
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'copy copies the table as markdown and copy as text copies label and value lines',
    async (world, $) => {
      const ui = await mountReply($, reply(TABLE))
      await ui.press({ key: 'block-1-copy' })
      await ui.press({ key: 'block-1-text' })
      expect(world.copies).toEqual([
        TABLE.split('\n').slice(2).join('\n'),
        [
          'Mod: task-pane',
          'State: released',
          'Next: follows the work',
          '',
          'Mod: simple-view',
          'State: released',
          'Next: click to expand',
        ].join('\n'),
      ])
      expect(world.toasts).toEqual(['Copied the table as markdown.', 'Copied the table as text.'])
      await ui.unmount()
    },
  )

  viewTest('keeps a column right-aligned when the table says so', async (_world, $) => {
    const table = ['| Mod | Tests |', '| :-- | --: |', '| a | 7 |', '| b | 140 |'].join('\n')
    const ui = await mountReply($, reply(table))
    expect((await sketchOf(ui)).slice(0, 4)).toEqual([
      `● ${headed('Mod │ Tests')}  [ copy ] [ copy as text ]`,
      `  ${dim('────┼──────')}`,
      `  ${ruled('a   │     7')}`,
      `  ${ruled('b   │   140')}`,
    ])
    await ui.unmount()
  })

  viewTest(
    'a cell keeps the text inside backticks as written on the screen and in copy as text',
    async (world, $) => {
      const table = [
        '| Path | Glob |',
        '| --- | --- |',
        '| `__init__.py` | `**/*.ts` |',
        '| `~~x~~` | `[x](y)` |',
        '| `C:\\*` | **bold** `code` |',
        '| a \\| b | [docs](https://x.example) |',
      ].join('\n')
      const ui = await mountReply($, reply(table))
      expect(await sketchOf(ui)).toEqual([
        `● ${headed('Path        │ Glob')}  [ copy ] [ copy as text ]`,
        `  ${dim('────────────┼──────────')}`,
        `  ${ruled('__init__.py │ **/*.ts')}`,
        `  ${ruled('~~x~~       │ [x](y)')}`,
        `  ${ruled('C:\\*        │ bold code')}`,
        `  ${ruled('a | b       │ docs')}`,
      ])
      await ui.press({ key: 'block-0-text' })
      expect(world.copies).toEqual([
        [
          'Path: __init__.py',
          'Glob: **/*.ts',
          '',
          'Path: ~~x~~',
          'Glob: [x](y)',
          '',
          'Path: C:\\*',
          'Glob: bold code',
          '',
          'Path: a | b',
          'Glob: docs (https://x.example)',
        ].join('\n'),
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a line with a bar but no delimiter row draws as the engine draws it',
    async (_world, $) => {
      const ui = await mountReply($, reply('a | b\nnext line'))
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      await ui.unmount()
    },
  )

  viewTest('a line indented by four spaces is code, not a table row', async (_world, $) => {
    const text = ['    a | b', '    --- | ---', '    c | d', '', '```sh', 'ls', '```'].join('\n')
    const ui = await mountReply($, reply(text))
    expect(await sketchOf(ui)).toEqual([
      '●     a | b',
      '      --- | ---',
      '      c | d',
      '',
      `  ~── sh ${'─'.repeat(COLUMNS - 2 - 8 - 2 - '── sh '.length)}~  [ copy ]`,
      '  ls',
    ])
    await ui.unmount()
  })

  viewTest(
    'a table ends where a code fence opens, even when the fence line holds a bar',
    async (world, $) => {
      const text = [
        '| Name | Value |',
        '| --- | --- |',
        '| example | ok |',
        '```sh | example',
        'echo a | cat',
        '```',
      ].join('\n')
      const ui = await mountReply($, reply(text))
      expect(await sketchOf(ui)).toEqual([
        `● ${headed('Name    │ Value')}  [ copy ] [ copy as text ]`,
        `  ${dim('────────┼──────')}`,
        `  ${ruled('example │ ok')}`,
        '',
        `  ~── sh ${'─'.repeat(COLUMNS - 2 - 8 - 2 - '── sh '.length)}~  [ copy ]`,
        '  echo a | cat',
      ])
      await ui.press({ key: 'block-1-copy' })
      expect(world.copies).toEqual(['echo a | cat'])
      await ui.unmount()
    },
  )

  viewTest(
    'a table with no data rows that does not fit shows its headings and no copy as text',
    async (_world, $) => {
      const text = '| Very long heading | Another very long heading |\n| --- | --- |'
      const ui = await mountReply($, reply(text), 'terminal', 30)
      expect(await sketchOf(ui, 30)).toEqual([
        '● *Very long heading*  [ copy ]',
        '  *Another very long heading*',
      ])
      await ui.unmount()
    },
  )

  viewTest('an emoji takes two columns when the columns of a table align', async (_world, $) => {
    const text = [
      '| Check | Result | Note |',
      '| --- | --- | --- |',
      '| build | ✅ | ok |',
      '| lint | ❌ | ok |',
      '| ship | 🚀 | ok |',
      '| melt | 🫠 | ok |',
      '| warn | ⚠️ | ok |',
      `| family | ${FAMILY} | ok |`,
    ].join('\n')
    const ui = await mountReply($, reply(text))
    expect((await sketchOf(ui)).slice(0, 8)).toEqual([
      `● ${headed('Check  │ Result │ Note')}  [ copy ] [ copy as text ]`,
      `  ${dim('───────┼────────┼─────')}`,
      `  ${ruled('build  │ ✅     │ ok')}`,
      `  ${ruled('lint   │ ❌     │ ok')}`,
      `  ${ruled('ship   │ 🚀     │ ok')}`,
      `  ${ruled('melt   │ 🫠     │ ok')}`,
      `  ${ruled('warn   │ ⚠️     │ ok')}`,
      `  ${ruled(`family │ ${FAMILY}     │ ok`)}`,
    ])
    await ui.unmount()
  })

  viewTest(
    'a table of emoji that is wider than the screen in columns draws one block per row',
    async (_world, $) => {
      const text = ['| Step | State |', '| --- | --- |', `| build | ${'✅'.repeat(10)} |`].join(
        '\n',
      )
      const ui = await mountReply($, reply(text), 'terminal', 26)
      expect(await sketchOf(ui, 26)).toEqual([
        '● *build*',
        `    State: ${'✅'.repeat(10)}`,
        '  [ copy ] [ copy as text ]',
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'copy as text drops markdown marks, escapes and entities and keeps the address of a link',
    async (world, $) => {
      const table = [
        '| Item | Note |',
        '| --- | --- |',
        '| \\#1 | _draft_ &amp; <https://x.example> |',
        '| [docs](https://x.example/a_b) | 5 \\* 3 &lt; 4 |',
      ].join('\n')
      const ui = await mountReply($, reply(table))
      expect((await sketchOf(ui)).slice(1)).toEqual([
        `  ${dim('─────┼──────────────────────────')}`,
        `  ${ruled('#1   │ draft & https://x.example')}`,
        `  ${ruled('docs │ 5 * 3 < 4')}`,
      ])
      await ui.press({ key: 'block-0-text' })
      expect(world.copies).toEqual([
        [
          'Item: #1',
          'Note: draft & https://x.example',
          '',
          'Item: docs (https://x.example/a_b)',
          'Note: 5 * 3 < 4',
        ].join('\n'),
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'copy as text copies a hidden character as written while the screen shows its escape',
    async (world, $) => {
      const text = ['| Name | Value |', '| --- | --- |', '| zero\u200bwidth | ok |'].join('\n')
      const ui = await mountReply($, reply(text))
      expect((await sketchOf(ui))[2]).toBe(`  ${ruled('zero\\u200bwidth │ ok')}`)
      await ui.press({ key: 'block-0-text' })
      expect(world.copies).toEqual(['Name: zero\u200bwidth\nValue: ok'])
      await ui.unmount()
    },
  )
})

describe('fenced blocks', () => {
  viewTest(
    'a fenced block draws a title line from its tag and a copy button that copies the content only',
    async (world, $) => {
      const ui = await mountReply($, reply(FENCE))
      const rule = `── plan ${'─'.repeat(COLUMNS - 2 - 8 - 2 - '── plan '.length)}`
      expect(await sketchOf(ui)).toEqual([
        '● Here is the plan:',
        '',
        `  ~${rule}~  [ copy ]`,
        '  1. Write the mocks',
        '  2. Ask the person',
      ])
      expect((await ui.find({ type: 'Code' }))?.props.language).toBe('plan')
      await ui.press({ key: 'block-1-copy' })
      expect(world.copies).toEqual(['1. Write the mocks\n2. Ask the person'])
      expect(world.toasts).toEqual(['Copied the plan block.'])
      await ui.unmount()
    },
  )

  viewTest('a block without a tag draws a rule with no title', async (_world, $) => {
    const ui = await mountReply($, reply('~~~\necho hi\n~~~'))
    expect((await sketchOf(ui))[0]).toBe(`● ~${'─'.repeat(COLUMNS - 2 - 8 - 2)}~  [ copy ]`)
    await ui.unmount()
  })

  viewTest('a block that is still open draws up to the end of the text', async (world, $) => {
    const ui = await mountReply($, reply('```sh\nnpm ci\nnpm test'))
    expect(await sketchOf(ui)).toEqual([
      `● ~── sh ${'─'.repeat(COLUMNS - 2 - 8 - 2 - '── sh '.length)}~  [ copy ]`,
      '  npm ci',
      '  npm test',
    ])
    await ui.press({ key: 'block-0-copy' })
    expect(world.copies).toEqual(['npm ci\nnpm test'])
    await ui.unmount()
  })

  viewTest(
    'a block indented inside a list item loses that indent on each line of its content',
    async (world, $) => {
      const text = [
        '1. Add:',
        '   ```python',
        '   def f():',
        '       return 1',
        '   ```',
        '2. Run it',
      ].join('\n')
      const ui = await mountReply($, reply(text))
      expect(await sketchOf(ui)).toEqual([
        '● 1. Add:',
        '',
        `  ~── python ${'─'.repeat(COLUMNS - 2 - 8 - 2 - '── python '.length)}~  [ copy ]`,
        '  def f():',
        '      return 1',
        '',
        '  2. Run it',
      ])
      await ui.press({ key: 'block-1-copy' })
      expect(world.copies).toEqual(['def f():\n    return 1'])
      await ui.unmount()
    },
  )
})

describe('/replies', () => {
  viewTest(
    'turns the reply view off and on, and the engine draws replies unchanged while it is off',
    async (_world, $) => {
      const ui = await mountReply($, reply(LONG_REPLY))
      expect(await commandText($)).toBe(
        'off for this session. Replies draw as Claude Code draws them.',
      )
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      const table = await mountReply($, reply(TABLE), 'terminal', COLUMNS, 'message-2')
      expect(await table.drawn()).toEqual(ENGINE_ROW)
      expect(await commandText($)).toBe(
        'on for this session. A reply longer than 30 lines folds to its first lines. Tables draw without box lines, and tables and code blocks get copy buttons.',
      )
      expect((await sketchOf(ui)).at(-1)).toBe(edges('  ~… 24 more lines~', '[ more ] [ copy ]'))
      await ui.unmount()
      await table.unmount()
    },
  )

  viewTest('registers /replies with a description that starts with the handily mark', (world) => {
    expect(world.commandDescriptions).toEqual([
      'handily · Turn the folded view of long replies, tables and code blocks off or on',
    ])
  })

  viewTest('refuses an argument', async (_world, $) => {
    expect(await commandText($, 'off')).toBe(
      '/replies takes no argument. It turns the reply view off or on for this session.',
    )
  })

  test('writes the ready value that /handily reads when the session starts', async ($, on) => {
    engineBeneath(on)
    const ready: unknown[] = []
    on('state.set', { plugin: 'handily-reply-view', key: 'ready' }, (_$, e, next) => {
      ready.push(e.value)
      return next(e)
    })
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    expect(ready).toEqual([{ root: expect.stringMatching(/[\\/]handily-reply-view$/) }])
  })
})
