import type { On, RenderPropsOf, UiCopyResult } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { blocksOf, cellsOf, plainCell } from './hooks/markdown'

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
}

function engineBeneath(on: On): World {
  const world: World = { copies: [], toasts: [], logs: [], copyResult: { isCopied: true } }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
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
    plugin: 'reply-view',
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
  let shown = props.bold === true ? `*${text}*` : text
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
      `a reply of 12 lines or fewer draws as the engine draws it on ${surface}`,
      async (_world, $) => {
        const ui = await mountReply($, reply(shownLines(1, 12).join('\n')), surface)
        expect(await ui.drawn()).toEqual(ENGINE_ROW)
        await ui.unmount()
      },
    )

    viewTest(
      `a reply longer than 12 lines draws its first lines, the hidden count, more and copy on ${surface}`,
      async (_world, $) => {
        const ui = await mountReply($, reply(LONG_REPLY), surface)
        const folded = await sketchOf(ui)
        if (surface === 'terminal') {
          expect(folded).toEqual([
            '● Line 1',
            ...shownLines(2, 12),
            edges('  ~… 42 more lines~', '[ more ] [ copy ]'),
          ])
        } else {
          expect(folded).toEqual([
            ...shownLines(1, 12).map((line) => line.trim()),
            edges('~… 42 more lines~', '[ more ] [ copy ]'),
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
    expect((await sketchOf(ui)).at(-1)).toBe(edges('  ~… 42 more lines~', '[ more ] [ copy ]'))
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
      const text = [long, '', long, '', long, '', long].join('\n')
      const ui = await mountReply($, reply(text))
      const folded = await sketchOf(ui)
      const rowsOfLong = Math.ceil(long.length / (COLUMNS - 2))
      expect(rowsOfLong).toBe(6)
      expect(folded).toHaveLength(4)
      expect(folded.slice(0, 2)).toEqual([`● ${long}`, ''])
      const cut = folded[2] ?? ''
      expect(cut).toMatch(/^ {2}word0 word1( word\d+)* word\d+…$/)
      expect(cut.length - 2).toBeLessThanOrEqual(5 * (COLUMNS - 2))
      expect(long.startsWith(cut.slice(2, -1))).toBe(true)
      expect(folded[3]).toBe(edges('  ~… 15 more lines~', '[ more ] [ copy ]'))
      await ui.unmount()
    },
  )

  viewTest(
    'a reply that grows while it streams keeps its first lines in place',
    async (_world, $) => {
      const lines = LONG_REPLY.split('\n')
      const ui = await mountReply($, reply(lines.slice(0, 20).join('\n')))
      const early = await sketchOf(ui)
      await ui.redraw(reply(LONG_REPLY))
      const later = await sketchOf(ui)
      expect(later.slice(0, 12)).toEqual(early.slice(0, 12))
      expect(early.at(-1)).toBe(edges('  ~… 8 more lines~', '[ more ] [ copy ]'))
      expect(later.at(-1)).toBe(edges('  ~… 42 more lines~', '[ more ] [ copy ]'))
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
    'a table draws without box lines, with aligned columns and a bold header',
    async (_world, $) => {
      const ui = await mountReply($, reply(TABLE))
      expect(await sketchOf(ui)).toEqual([
        '● The state of the mods:',
        '',
        '  *Mod           State      Next*',
        '  task-pane     released   follows the work',
        '  simple-view   released   click to expand',
        '                  [ copy ] [ copy as text ]',
      ])
      const header = await ui.find({ key: 'header' })
      expect(header?.text).toBe('Mod           State      Next')
      expect((await ui.find({ type: 'Text', text: 'Mod' }))?.props.bold).toBe(true)
      await ui.unmount()
    },
  )

  viewTest('a table that does not fit the width draws one block per row', async (_world, $) => {
    const ui = await mountReply($, reply(TABLE), 'terminal', 36)
    expect(await sketchOf(ui, 36)).toEqual([
      '● The state of the mods:',
      '',
      '  *task-pane*',
      '    State: released',
      '    Next:  follows the work',
      '',
      '  *simple-view*',
      '    State: released',
      '    Next:  click to expand',
      '           [ copy ] [ copy as text ]',
    ])
    await ui.unmount()
  })

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
    expect((await sketchOf(ui)).slice(0, 3)).toEqual([
      '● *Mod   Tests*',
      '  a         7',
      '  b       140',
    ])
    await ui.unmount()
  })

  test('reads a cell with an escaped bar, a link and inline marks as plain text', () => {
    expect(
      cellsOf('| a \\| b | [docs](https://x.example) | **bold** `code` |').map(plainCell),
    ).toEqual(['a | b', 'docs', 'bold code'])
  })

  test('leaves a line with a bar but no delimiter row as prose', () => {
    expect(blocksOf('a | b\nnext line').map((block) => block.kind)).toEqual(['prose'])
  })
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

  test('reads a block that is still open up to the end of the text', () => {
    expect(blocksOf('```sh\nnpm ci\nnpm test')).toEqual([
      { kind: 'fence', tag: 'sh', content: 'npm ci\nnpm test' },
    ])
  })
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
        'on for this session. A reply longer than 12 lines folds to its first lines. Tables draw without box lines, and tables and code blocks get copy buttons.',
      )
      expect((await sketchOf(ui)).at(-1)).toBe(edges('  ~… 42 more lines~', '[ more ] [ copy ]'))
      await ui.unmount()
      await table.unmount()
    },
  )

  viewTest('refuses an argument', async (_world, $) => {
    expect(await commandText($, 'off')).toBe(
      '/replies takes no argument. It turns the reply view off or on for this session.',
    )
  })

  test('writes the ready value that /handily reads when the session starts', async ($, on) => {
    engineBeneath(on)
    const ready: unknown[] = []
    on('state.set', { plugin: 'reply-view', key: 'ready' }, (_$, e, next) => {
      ready.push(e.value)
      return next(e)
    })
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    expect(ready).toEqual([{ root: expect.stringMatching(/[\\/]reply-view$/) }])
  })
})
