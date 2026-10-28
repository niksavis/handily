import type { On, PromptOrigin, RenderPropsOf, UiCopyResult } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import { displayWidth, graphemesOf } from './hooks/width'
import { parseMermaid, type Flowchart, type Refusal, type SequenceDiagram } from './hooks/mermaid'
import { drawFlowchart, type LayoutMeter } from './hooks/flowchart'
import { drawSequence } from './hooks/sequence'
import { diagramOf, replyTree, type ReplyElements } from './hooks/draw'
import { blocksOf } from './hooks/markdown'

const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const COLUMNS = 80
const COLOR_MARKS: Readonly<Record<string, string>> = {
  error: '#',
  success: '+',
  warning: '!',
  suggestion: '^',
}
const ENGINE_MARGIN_AND_ROW = ['', '(engine)']
const BOX_COLUMNS = 40
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

type Surface = (typeof SURFACES)[number]

type Toast = { lines: string[]; timeoutMs: number | undefined }

type World = {
  copies: string[]
  toasts: Toast[]
  logs: string[]
  transcript: string[]
  copyResult: UiCopyResult
  copyError: Error | null
  commandDescriptions: string[]
}

function toastLines(text: string): string[] {
  const lines: string[] = []
  let line = ''
  for (const { segment } of GRAPHEMES.segment(text)) {
    if (displayWidth(line + segment) > BOX_COLUMNS) {
      lines.push(line.trimEnd())
      line = ''
    }
    line += segment
  }
  return [...lines, line.trimEnd()]
}

function engineBeneath(on: On): World {
  const world: World = {
    copies: [],
    toasts: [],
    logs: [],
    transcript: [],
    copyResult: { isCopied: true },
    copyError: null,
    commandDescriptions: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    world.commandDescriptions.push(e.description)
    return { value: { command: e.name } }
  })
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    if (world.copyError !== null) throw world.copyError
    if (world.copyResult.isCopied) world.copies.push(e.text)
    return { value: world.copyResult }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push({ lines: toastLines(e.text), timeoutMs: e.timeoutMs })
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    world.logs.push(e.text)
    if (e.to === 'transcript') world.transcript.push(e.text)
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

function isAbsolute(node: unknown): boolean {
  return isDrawnNode(node) && node.props?.position === 'absolute'
}

function paintedUnder(lines: readonly string[], placed: readonly unknown[], width: number) {
  const painted = [...lines]
  for (const node of placed) {
    const top = isDrawnNode(node) ? Number(node.props?.top ?? 0) : 0
    sketchLines(node, width).forEach((line, row) => {
      if ((painted[top + row] ?? '') === '') painted[top + row] = line
    })
  }
  return painted
}

function boxLines(props: Record<string, unknown>, children: readonly unknown[], width: number) {
  const indent = Number(props.paddingLeft ?? 0)
  const inner = (typeof props.width === 'number' ? props.width : width) - indent
  const gap = Number(props.gap ?? 0)
  const flowing = children.filter((child) => !isAbsolute(child))
  const flowed =
    props.flexDirection === 'column'
      ? flowing.flatMap((child, index) => [
          ...(index > 0 ? Array<string>(gap).fill('') : []),
          ...sketchLines(child, inner),
        ])
      : rowLines(flowing, inner, gap)
  const lines = paintedUnder(flowed, children.filter(isAbsolute), inner)
  const placed =
    props.justifyContent === 'flex-end'
      ? lines.map((line) => ' '.repeat(Math.max(inner - cellsIn(line), 0)) + line)
      : lines
  return [
    ...Array<string>(Number(props.marginTop ?? 0)).fill(''),
    ...placed.map((line) => (line === '' ? line : ' '.repeat(indent) + line)),
  ]
}

function clippedLines(node: unknown, width: number): string[] {
  if (!isDrawnNode(node) || node.type !== 'Text') return sketchLines(node, width)
  const text = (node.children ?? []).map(inlineText).join('')
  return [marked(node.props ?? {}, Array.from(text).slice(0, width).join(''))]
}

function hiddenOverflowLines(props: Record<string, unknown>, children: unknown[], width: number) {
  const lines = children.flatMap((child) => clippedLines(child, width))
  return typeof props.height === 'number' ? lines.slice(0, props.height) : lines
}

function sketchLines(node: unknown, width: number): string[] {
  if (typeof node === 'string') return [node]
  if (!isDrawnNode(node)) return []
  const props = node.props ?? {}
  if (node.type === 'Box' && props.overflow === 'hidden') {
    return hiddenOverflowLines(props, node.children ?? [], width)
  }
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
      return ENGINE_MARGIN_AND_ROW
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

const DIVIDER = `~${'─'.repeat(COLUMNS - 2)}~`

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

const MODS_TABLE = [
  'The three mods passed every gate but one:',
  '',
  '| Mod | Version | Tests | Lines | Gate | Owner | Next step |',
  '| --- | --: | --: | --: | --- | --- | --- |',
  '| handily-reply-view | 0.6.0 | 212 | 2638 | pass | Ana | diagrams in the terminal |',
  '| handily-simple-view | 0.9.1 | 341 | 4120 | pass | Bo | one row for every tool |',
  '| handily-board | 1.2.0 | 98 | 3310 | fail | Cy | agents of other sessions |',
].join('\n')

const TECHIE = '\u{1F469}\u200d\u{1F4BB}'
const AUSTRIA = '\u{1F1E6}\u{1F1F9}'
const KEYCAP_ONE = '1\ufe0f\u20e3'
const WARNING = '\u26a0\ufe0f'

const WHO_TABLE = [
  'Who holds which check:',
  '',
  '| Owner | Status | Note |',
  '| --- | --- | --- |',
  `| ${TECHIE} Ana | ✅ done | 表格对齐 |`,
  `| ${AUSTRIA} Bo | ${WARNING} waits | 日本語のテスト |`,
  `| Cy ${KEYCAP_ONE} | ○ to do | plain text |`,
].join('\n')

const WIDE_WHO_TABLE = [
  WHO_TABLE,
  `| ${AUSTRIA} Bo handily-simple-view | ${WARNING} waits | 日本語のテスト ${KEYCAP_ONE} 表格对齐 handily-reply-view keeps every border of the table in line |`,
].join('\n')

const PATHS_TABLE = [
  '| Path | Note |',
  '| --- | --- |',
  '| mods/handily-reply-view/hooks/table-of-the-reply-view.ts | the note names handily-simple-view-and-handily-board as one long word |',
].join('\n')

const FILES_TABLE = [
  '| File | Change | Note |',
  '| --- | --- | --- |',
  '| mods/handily-reply-view/hooks/table-of-the-reply-view.ts | keeps every word whole when room allows | the note is plain words |',
].join('\n')

const SIX_CELLS_TABLE = [
  '| Name | Note |',
  '| --- | --- |',
  `| handily-reply-view/hooks/table | ${Array<string>(10).fill('abc').join(' ')} |`,
].join('\n')

function bordersOf(line: string): number[] {
  const borders: number[] = []
  let column = 0
  for (const grapheme of graphemesOf(line.replace(/[~*]/g, ''))) {
    if (grapheme === '│' || grapheme === '┼') borders.push(column)
    column += displayWidth(grapheme)
  }
  return borders
}

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
            edges('  ~… 24 more lines~', '[ more ] [ copy reply ]'),
          ])
        } else {
          expect(folded).toEqual([
            ...shownLines(1, 30).map((line) => line.trim()),
            edges('~… 24 more lines~', '[ more ] [ copy reply ]'),
          ])
        }
        await ui.unmount()
      },
    )
  }

  viewTest(
    'more shows the whole reply between two dim divider lines and less folds it again without them',
    async (_world, $) => {
      const ui = await mountReply($, reply(LONG_REPLY))
      await ui.press({ key: 'fold' })
      expect(await sketchOf(ui)).toEqual([
        `● ${DIVIDER}`,
        '  Line 1',
        ...shownLines(2, 54),
        `  ${DIVIDER}`,
        edges('', '[ less ] [ copy reply ]'),
      ])
      await ui.press({ key: 'fold' })
      const folded = await sketchOf(ui)
      expect(folded[0]).toBe('● Line 1')
      expect(folded.some((line) => line.includes(DIVIDER))).toBe(false)
      expect(await ui.find({ key: 'opened-top' })).toBeUndefined()
      expect(await ui.find({ key: 'opened-bottom' })).toBeUndefined()
      expect(folded.at(-1)).toBe(edges('  ~… 24 more lines~', '[ more ] [ copy reply ]'))
      await ui.unmount()
    },
  )

  viewTest('copy copies the whole reply as markdown', async (world, $) => {
    const ui = await mountReply($, reply(LONG_REPLY))
    await ui.press({ key: 'copy-reply' })
    expect(world.copies).toEqual([LONG_REPLY])
    expect(world.toasts).toEqual([
      { lines: ['✓ Copied the reply as markdown', '54 lines'], timeoutMs: 6000 },
    ])
    await ui.unmount()
  })

  viewTest(
    'a reply that ends with a code block names the reply on its copy button and each toast names its part',
    async (world, $) => {
      const kickoff = ['Run this to start:', '', '```sh', 'npm ci', 'npm test', '```']
      const text = [LONG_REPLY, '', ...kickoff].join('\n')
      const ui = await mountReply($, reply(text))
      await ui.press({ key: 'fold' })
      const drawn = await sketchOf(ui)
      expect(drawn.slice(-5)).toEqual([
        `  ~── sh ${'─'.repeat(COLUMNS - 2 - 8 - 2 - '── sh '.length)}~  [ copy ]`,
        '  npm ci',
        '  npm test',
        `  ${DIVIDER}`,
        edges('', '[ less ] [ copy reply ]'),
      ])
      await ui.press({ key: 'block-1-copy' })
      await ui.press({ key: 'copy-reply' })
      expect(world.copies).toEqual(['npm ci\nnpm test', text])
      expect(world.toasts).toEqual([
        { lines: ['✓ Copied the sh block', '2 lines'], timeoutMs: 6000 },
        { lines: ['✓ Copied the reply as markdown', '61 lines'], timeoutMs: 6000 },
      ])
      await ui.unmount()
    },
  )

  viewTest('the hidden count cuts at the end on a narrow screen', async (_world, $) => {
    const ui = await mountReply($, reply(LONG_REPLY), 'terminal', 40)
    expect((await ui.find({ type: 'Text', text: '… 24 more lines' }))?.props.wrap).toBe(
      'truncate-end',
    )
    await ui.unmount()
  })

  viewTest('says why a copy failed', async (world, $) => {
    world.copyResult = { isCopied: false, reason: 'no-surface' }
    const ui = await mountReply($, reply(LONG_REPLY))
    await ui.press({ key: 'copy-reply' })
    expect(world.toasts).toEqual([
      { lines: ['■ Not copied', 'no screen is attached to this session'], timeoutMs: 10000 },
    ])
    await ui.unmount()
  })

  viewTest(
    'a clipboard that takes nothing draws the failed mark and Not copied for 10000 ms',
    async (world, $) => {
      world.copyResult = { isCopied: false, reason: 'no-clipboard' }
      const ui = await mountReply($, reply(FENCE))
      await ui.press({ key: 'block-1-copy' })
      expect(world.toasts).toEqual([
        {
          lines: [
            '■ Not copied',
            'the clipboard took nothing',
            'a long text may not fit this terminal',
          ],
          timeoutMs: 10000,
        },
      ])
      await ui.unmount()
    },
  )

  viewTest('a copy that another plugin refuses says so', async (world, $) => {
    world.copyResult = { isCopied: false, reason: 'refused' }
    const ui = await mountReply($, reply(FENCE))
    await ui.press({ key: 'block-1-copy' })
    expect(world.toasts).toEqual([
      { lines: ['■ Not copied', 'another plugin refused the copy'], timeoutMs: 10000 },
    ])
    await ui.unmount()
  })

  viewTest(
    'a copy that throws says the transcript shows why and logs the detail there',
    async (world, $) => {
      world.copyError = new Error('the clipboard tool crashed')
      const ui = await mountReply($, reply(FENCE))
      await ui.press({ key: 'block-1-copy' })
      expect(world.toasts).toEqual([
        { lines: ['■ Not copied', 'the transcript shows why'], timeoutMs: 10000 },
      ])
      expect(world.transcript).toHaveLength(1)
      expect(world.transcript[0]).toStartWith('reply-view: the plan block was not copied: ')
      await ui.unmount()
    },
  )

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
      expect(folded[9]).toBe(edges('  ~… 11 more lines~', '[ more ] [ copy reply ]'))
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
      expect(early.at(-1)).toBe(edges('  ~… 10 more lines~', '[ more ] [ copy reply ]'))
      expect(later.at(-1)).toBe(edges('  ~… 24 more lines~', '[ more ] [ copy reply ]'))
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
    expect((await sketchOf(ui)).at(-3)).toBe('  Line 54\\u200b\\u0007')
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
        '  ~… 7 more lines~  [ more ] [ copy reply ]',
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
      expect(world.toasts).toEqual([
        { lines: ['✓ Copied the table as markdown', '4 lines'], timeoutMs: 6000 },
        { lines: ['✓ Copied the table as text', '7 lines'], timeoutMs: 6000 },
      ])
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

  viewTest(
    'a long column keeps its longest word whole when the longest words of the long columns fit together',
    async (_world, $) => {
      const ui = await mountReply($, reply(MODS_TABLE))
      const dotted = `  ${dim('┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┼┄┄┄┄┄┄┼┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄')}`
      expect(await sketchOf(ui)).toEqual([
        '● The three mods passed every gate but one:',
        '',
        `  ${headed('Mod                 │ Version │ Tests │ Lines │ Gate │ Owner │ Next step')}`,
        `  ${dim('────────────────────┼─────────┼───────┼───────┼──────┼───────┼────────────────')}`,
        `  ${ruled('handily-reply-view  │   0.6.0 │   212 │  2638 │ pass │ Ana   │ diagrams in the')}`,
        `  ${ruled('                    │         │       │       │      │       │ terminal')}`,
        dotted,
        `  ${ruled('handily-simple-view │   0.9.1 │   341 │  4120 │ pass │ Bo    │ one row for')}`,
        `  ${ruled('                    │         │       │       │      │       │ every tool')}`,
        dotted,
        `  ${ruled('handily-board       │   1.2.0 │    98 │  3310 │ fail │ Cy    │ agents of other')}`,
        `  ${ruled('                    │         │       │       │      │       │ sessions')}`,
        `  ${' '.repeat(78 - 25)}[ copy ] [ copy as text ]`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a long column keeps its longest word whole on desktop, where the table has two columns more',
    async (_world, $) => {
      const ui = await mountReply($, reply(MODS_TABLE), 'desktop')
      const dotted = dim(
        '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┼┄┄┄┄┄┄┼┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄',
      )
      expect(await sketchOf(ui)).toEqual([
        'The three mods passed every gate but one:',
        '',
        headed('Mod                 │ Version │ Tests │ Lines │ Gate │ Owner │ Next step'),
        dim('────────────────────┼─────────┼───────┼───────┼──────┼───────┼──────────────────'),
        ruled('handily-reply-view  │   0.6.0 │   212 │  2638 │ pass │ Ana   │ diagrams in the'),
        ruled('                    │         │       │       │      │       │ terminal'),
        dotted,
        ruled('handily-simple-view │   0.9.1 │   341 │  4120 │ pass │ Bo    │ one row for every'),
        ruled('                    │         │       │       │      │       │ tool'),
        dotted,
        ruled('handily-board       │   1.2.0 │    98 │  3310 │ fail │ Cy    │ agents of other'),
        ruled('                    │         │       │       │      │       │ sessions'),
        `${' '.repeat(80 - 25)}[ copy ] [ copy as text ]`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a long column splits a word at its width as before when the longest words of the long columns do not fit together',
    async (_world, $) => {
      const ui = await mountReply($, reply(PATHS_TABLE))
      expect(await sketchOf(ui)).toEqual([
        `● ${headed('Path                               │ Note')}      [ copy ] [ copy as text ]`,
        `  ${dim('───────────────────────────────────┼──────────────────────────────────────────')}`,
        `  ${ruled('mods/handily-reply-view/hooks/tabl │ the note names')}`,
        `  ${ruled('e-of-the-reply-view.ts             │ handily-simple-view-and-handily-board as')}`,
        `  ${ruled('                                   │ one long word')}`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a long column keeps its longest word whole when the words fit but the 12 cell width of each long column does not',
    async (_world, $) => {
      const ui = await mountReply($, reply(FILES_TABLE))
      expect(await sketchOf(ui)).toEqual([
        `● ${headed('File                                                     │ Change     │ Note')}`,
        `  ${dim('─────────────────────────────────────────────────────────┼────────────┼───────')}`,
        `  ${ruled('mods/handily-reply-view/hooks/table-of-the-reply-view.ts │ keeps      │ the')}`,
        `  ${ruled('                                                         │ every word │ note')}`,
        `  ${ruled('                                                         │ whole when │ is')}`,
        `  ${ruled('                                                         │ room       │ plain')}`,
        `  ${ruled('                                                         │ allows     │ words')}`,
        `  ${' '.repeat(78 - 25)}[ copy ] [ copy as text ]`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a long column keeps its longest word whole when the other long column keeps 6 cells',
    async (_world, $) => {
      const ui = await mountReply($, reply(SIX_CELLS_TABLE), 'terminal', 41)
      expect(await sketchOf(ui, 41)).toEqual([
        `● ${headed('Name                           │ Note')}`,
        `  ${dim('───────────────────────────────┼───────')}`,
        `  ${ruled('handily-reply-view/hooks/table │ abc')}`,
        ...Array.from({ length: 9 }, () => `  ${ruled('                               │ abc')}`),
        `${' '.repeat(41 - 25)}[ copy ] [ copy as text ]`,
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'a long column splits a word as before when a whole word leaves another long column under 6 cells',
    async (_world, $) => {
      const ui = await mountReply($, reply(SIX_CELLS_TABLE), 'terminal', 40)
      expect(await sketchOf(ui, 40)).toEqual([
        `● ${headed('Name            │ Note')}`,
        `  ${dim('────────────────┼─────────────────────')}`,
        `  ${ruled('handily-reply-v │ abc abc abc abc abc')}`,
        `  ${ruled('iew/hooks/table │ abc abc abc abc abc')}`,
        `${' '.repeat(40 - 25)}[ copy ] [ copy as text ]`,
      ])
      await ui.unmount()
    },
  )

  for (const surface of SURFACES) {
    const indent = surface === 'terminal' ? 2 : 0
    const lead = ' '.repeat(indent)

    viewTest(
      `every column border of a table of emoji, flags, keycaps and CJK text lines up on ${surface}`,
      async (_world, $) => {
        const ui = await mountReply($, reply(WHO_TABLE), surface)
        const drawn = await sketchOf(ui)
        expect(drawn.slice(2)).toEqual([
          `${lead}${headed('Owner  │ Status   │ Note')}  [ copy ] [ copy as text ]`,
          `${lead}${dim('───────┼──────────┼───────────────')}`,
          `${lead}${ruled(`${TECHIE} Ana │ ✅ done  │ 表格对齐`)}`,
          `${lead}${ruled(`${AUSTRIA} Bo  │ ${WARNING} waits │ 日本語のテスト`)}`,
          `${lead}${ruled(`Cy ${KEYCAP_ONE}  │ ○ to do  │ plain text`)}`,
        ])
        expect(drawn.map(bordersOf).filter((borders) => borders.length > 0)).toEqual(
          Array.from({ length: 5 }, () => [indent + 7, indent + 18]),
        )
        await ui.unmount()
      },
    )

    viewTest(
      `a table of emoji, flags, keycaps and CJK text keeps each word whole and its borders in line when it wraps on ${surface}`,
      async (_world, $) => {
        const ui = await mountReply($, reply(WIDE_WHO_TABLE), surface, 60)
        const drawn = await sketchOf(ui, 60)
        const dotted = `${lead}${dim('┄'.repeat(20) + '┼' + '┄'.repeat(10) + '┼' + '┄'.repeat(60 - indent - 32))}`
        expect(drawn.slice(2, 12)).toEqual([
          `${lead}${headed('Owner               │ Status   │ Note')}`,
          `${lead}${dim('─'.repeat(20) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(60 - indent - 32))}`,
          `${lead}${ruled(`${TECHIE} Ana              │ ✅ done  │ 表格对齐`)}`,
          dotted,
          `${lead}${ruled(`${AUSTRIA} Bo               │ ${WARNING} waits │ 日本語のテスト`)}`,
          dotted,
          `${lead}${ruled(`Cy ${KEYCAP_ONE}               │ ○ to do  │ plain text`)}`,
          dotted,
          `${lead}${ruled(`${AUSTRIA} Bo               │ ${WARNING} waits │ 日本語のテスト ${KEYCAP_ONE}${surface === 'terminal' ? '' : ' 表格对齐'}`)}`,
          `${lead}${ruled(`handily-simple-view │          │ ${surface === 'terminal' ? '表格对齐' : 'handily-reply-view keeps'}`)}`,
        ])
        expect(drawn.join('\n')).toContain('handily-reply-view keeps')
        expect(drawn.map(bordersOf).filter((borders) => borders.length > 0)).toEqual(
          Array.from({ length: surface === 'terminal' ? 13 : 12 }, () => [
            indent + 20,
            indent + 31,
          ]),
        )
        await ui.unmount()
      },
    )
  }

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
      expect(world.toasts).toEqual([
        { lines: ['✓ Copied the plan block', '2 lines'], timeoutMs: 6000 },
      ])
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

const TYPED_AT = new Date(2026, 9, 9, 21, 37).getTime()
const PROMPT = 'make the human prompts in the terminal distinguishable from your answers'

function prompt(text: string, extra: Partial<RenderPropsOf['UserMessage']> = {}) {
  return { text, origin: { kind: 'composer' as const }, isExpanded: false, ...extra }
}

async function mountPrompt(
  $: Engine,
  props: RenderPropsOf['UserMessage'],
  surface: Surface = 'terminal',
  columns = COLUMNS,
  requestId = 'prompt-1',
) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'UserMessage',
    props,
    requestId,
    viewport: { columns, rows: 40 },
  })
}

async function appendPrompt($: Engine, text: string, origin: PromptOrigin, uuid = 'prompt-1') {
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
    door: 'prompt',
    origin,
    uuid,
  })
}

async function queuePrompt($: Engine, text: string, origin: PromptOrigin, uuid = 'prompt-1') {
  await $.session.append({
    message: {
      type: 'attachment',
      name: 'queued_command',
      role: 'user',
      content: [{ type: 'text', text }],
    },
    door: 'delivery',
    origin,
    uuid,
  })
}

function accent(text: string): string {
  return `^${text}^`
}

function promptRule(label: string, columns = COLUMNS): string {
  const head = accent(`── ${label} `)
  return head + accent('─'.repeat(columns - cellsIn(head)))
}

function framed(label: string, columns = COLUMNS): string[] {
  return ['', promptRule(label, columns), '(engine)']
}

function promptTest(name: string, body: ViewBody): void {
  test(name, async ($, on) => {
    const world = engineBeneath(on)
    mock.clock(on, { now: TYPED_AT })
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

const OTHER_ROWS: readonly [string, Partial<RenderPropsOf['UserMessage']>][] = [
  [
    'a task notification',
    { origin: { kind: 'task-notification' }, task: { id: 'agent-1', status: 'completed' } },
  ],
  ['a message from another agent', { origin: { kind: 'unclassified' }, from: { name: 'Explore' } }],
  ['a message from a teammate', { origin: { kind: 'unclassified' }, from: { name: 'Ana' } }],
  ['a message from another session', { origin: { kind: 'peer' }, from: { name: 'release' } }],
  [
    'a message from a channel',
    { origin: { kind: 'channel', server: 'slack' }, from: { name: 'Bo' } },
  ],
  ['a prompt that a plugin sent', { origin: { kind: 'plugin', name: 'handily-task-pane' } }],
]

describe('typed prompts', () => {
  promptTest(
    'a typed prompt draws a blank line, an accent rule labelled you and the time, then the engine prompt row',
    async (_world, $) => {
      await appendPrompt($, PROMPT, { kind: 'composer' })
      const ui = await mountPrompt($, prompt(PROMPT))
      expect(await sketchOf(ui)).toEqual(framed('you · 21:37'))
      await ui.unmount()
    },
  )

  for (const columns of [80, 120]) {
    promptTest(
      `the rule spans the width of the transcript at ${String(columns)} columns`,
      async (_world, $) => {
        await appendPrompt($, PROMPT, { kind: 'composer' })
        const ui = await mountPrompt($, prompt(PROMPT), 'terminal', columns)
        expect((await sketchOf(ui, columns))[1]).toBe(promptRule('you · 21:37', columns))
        await ui.unmount()
      },
    )
  }

  promptTest(
    'a prompt typed while claude works keeps its time when the session takes it from the queue',
    async (_world, $) => {
      await queuePrompt($, PROMPT, { kind: 'composer' })
      const ui = await mountPrompt($, prompt(PROMPT))
      expect(await sketchOf(ui)).toEqual(framed('you · 21:37'))
      await ui.unmount()
    },
  )

  promptTest(
    'a prompt whose time the mod does not know, such as after a resume, draws the label you alone',
    async (_world, $) => {
      const ui = await mountPrompt($, prompt(PROMPT))
      expect(await sketchOf(ui)).toEqual(framed('you'))
      await ui.unmount()
    },
  )

  promptTest('a prompt that another party appended keeps no time', async (_world, $) => {
    await appendPrompt($, PROMPT, { kind: 'peer' })
    const ui = await mountPrompt($, prompt(PROMPT))
    expect((await sketchOf(ui))[1]).toBe(promptRule('you'))
    await ui.unmount()
  })

  promptTest('a message that another session queued keeps no time', async (_world, $) => {
    await queuePrompt($, PROMPT, { kind: 'peer' })
    const ui = await mountPrompt($, prompt(PROMPT))
    expect((await sketchOf(ui))[1]).toBe(promptRule('you'))
    await ui.unmount()
  })

  promptTest(
    'a prompt longer than 60000 characters keeps the frame and the engine row',
    async (_world, $) => {
      const long = 'word '.repeat(13_000)
      const ui = await mountPrompt($, prompt(long))
      expect(await sketchOf(ui)).toEqual(framed('you'))
      await ui.unmount()
    },
  )

  for (const [row, extra] of OTHER_ROWS) {
    for (const surface of SURFACES) {
      promptTest(`${row} draws as the engine draws it on ${surface}`, async (_world, $) => {
        const ui = await mountPrompt($, prompt('The task is done.', extra), surface)
        expect(await ui.drawn()).toEqual(ENGINE_ROW)
        await ui.unmount()
      })
    }
  }

  promptTest(
    'the ctrl+o view draws the prompt in full as the engine draws it, with no rule characters',
    async (_world, $) => {
      const ui = await mountPrompt($, prompt(PROMPT, { isExpanded: true }))
      const drawn = await ui.drawn()
      expect(drawn).toEqual(ENGINE_ROW)
      expect(RULE_CHARACTERS.some((rule) => JSON.stringify(drawn).includes(rule))).toBe(false)
      await ui.unmount()
    },
  )

  promptTest('a typed prompt draws as the engine draws it on desktop', async (_world, $) => {
    const ui = await mountPrompt($, prompt(PROMPT), 'desktop')
    expect(await ui.drawn()).toEqual(ENGINE_ROW)
    await ui.unmount()
  })

  promptTest(
    'a typed prompt draws as the engine draws it while /replies is off',
    async (_world, $) => {
      const ui = await mountPrompt($, prompt(PROMPT))
      await commandText($)
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      await commandText($)
      expect(await sketchOf(ui)).toEqual(framed('you'))
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
        'off for this session. Replies and prompts draw as Claude Code draws them.',
      )
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      const table = await mountReply($, reply(TABLE), 'terminal', COLUMNS, 'message-2')
      expect(await table.drawn()).toEqual(ENGINE_ROW)
      expect(await commandText($)).toBe(
        'on for this session. A reply longer than 30 lines folds to its first lines. Tables draw without box lines, and tables and code blocks get copy buttons. Each prompt that you type opens under a rule labelled you.',
      )
      expect((await sketchOf(ui)).at(-1)).toBe(
        edges('  ~… 24 more lines~', '[ more ] [ copy reply ]'),
      )
      await ui.unmount()
      await table.unmount()
    },
  )

  viewTest('registers /replies with a description that starts with the handily mark', (world) => {
    expect(world.commandDescriptions).toEqual([
      'handily · Turn the folded view of long replies, tables, code blocks and prompt rules off or on',
    ])
  })

  viewTest('refuses an argument', async (_world, $) => {
    expect(await commandText($, 'off')).toBe(
      '/replies takes no argument. It turns the reply view off or on for this session. Set the default with the plugin\'s "mode" setting.',
    )
  })

  for (const surface of SURFACES) {
    test(
      `starts off from the mode setting off, and /replies turns the reply view on on ${surface}`,
      { options: { mode: 'off' } },
      async ($, on) => {
        engineBeneath(on)
        const written: unknown[] = []
        on('state.set', { plugin: 'handily-reply-view', key: 'mode' }, (_$, e, next) => {
          written.push(e.value)
          return next(e)
        })
        await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
        expect(written).toEqual(['off'])
        const ui = await mountReply($, reply(LONG_REPLY), surface)
        expect(await ui.drawn()).toEqual(ENGINE_ROW)
        expect(await commandText($)).toMatch(/^on for this session/)
        expect(written).toEqual(['off', 'on'])
        expect(await ui.drawn()).not.toEqual(ENGINE_ROW)
        await ui.unmount()
      },
    )
  }

  test('stores on as its mode when the session starts, and keeps off when it starts again', async ($, on) => {
    engineBeneath(on)
    const written: unknown[] = []
    on('state.set', { plugin: 'handily-reply-view', key: 'mode' }, (_$, e, next) => {
      written.push(e.value)
      return next(e)
    })
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await commandText($)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    expect(written).toEqual(['on', 'off'])
    expect(await commandText($)).toMatch(/^on for this session/)
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

function flowchartOf(source: string): Flowchart {
  const result = parseMermaid(source)
  if (result.kind !== 'flowchart') throw new Error(`not a flowchart: ${JSON.stringify(result)}`)
  return result
}

function sequenceOf(source: string): SequenceDiagram {
  const result = parseMermaid(source)
  if (result.kind !== 'sequence') throw new Error(`not a sequence: ${JSON.stringify(result)}`)
  return result
}

function refusedLine(line: number, reason: string): Refusal {
  return { kind: 'refused', reason, line, limit: null }
}

type LimitOf = NonNullable<Refusal['limit']>

function overLimit(name: LimitOf['name'], count: number, most: number, noun: string = name) {
  return {
    kind: 'refused',
    reason: `${String(count)} ${noun}, at most ${String(most)} draw`,
    line: null,
    limit: { name, count, most },
  }
}

function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)
}

function linesOf(...lines: string[]): string {
  return lines.join('\n')
}

describe('mermaid flowcharts', () => {
  test('a flowchart reads each node shape as a box, a rounded box or a decision', () => {
    const chart = flowchartOf(
      linesOf(
        'flowchart TD',
        '  A[Box] --> B(Round)',
        '  C([Stadium]) --> D((Circle))',
        '  E{Decide} --> F[[Sub]]',
        '  G{{Hex}} --> H>Flag]',
        '  I[(Store)] --> J[/Lean/]',
        '  K[\\Back\\] --> L(((Double)))',
        '  M --> N',
      ),
    )
    expect(chart.nodes.map(({ id, shape, label }) => [id, shape, label])).toEqual([
      ['A', 'box', ['Box']],
      ['B', 'rounded', ['Round']],
      ['C', 'rounded', ['Stadium']],
      ['D', 'rounded', ['Circle']],
      ['E', 'decision', ['Decide']],
      ['F', 'box', ['Sub']],
      ['G', 'box', ['Hex']],
      ['H', 'box', ['Flag']],
      ['I', 'box', ['Store']],
      ['J', 'box', ['Lean']],
      ['K', 'box', ['Back']],
      ['L', 'box', ['Double']],
      ['M', 'box', ['M']],
      ['N', 'box', ['N']],
    ])
  })

  test('TD and TB draw top down, LR draws left to right, and graph is a flowchart', () => {
    const directions = ['flowchart TD', 'flowchart TB', 'flowchart LR', 'graph TB', 'graph LR'].map(
      (header) => flowchartOf(`${header}\n  A --> B`).direction,
    )
    expect(directions).toEqual(['TD', 'TD', 'LR', 'TD', 'LR'])
  })

  test('each edge keeps its stroke and whether it has an arrow', () => {
    const chart = flowchartOf(
      linesOf(
        'flowchart LR',
        '  A --> B',
        '  B --- C',
        '  C -.-> D',
        '  D -.- E',
        '  E ==> F',
        '  F-->G',
      ),
    )
    expect(chart.edges).toEqual([
      { from: 'A', to: 'B', stroke: 'solid', arrow: true, label: [] },
      { from: 'B', to: 'C', stroke: 'solid', arrow: false, label: [] },
      { from: 'C', to: 'D', stroke: 'dashed', arrow: true, label: [] },
      { from: 'D', to: 'E', stroke: 'dashed', arrow: false, label: [] },
      { from: 'E', to: 'F', stroke: 'solid', arrow: true, label: [] },
      { from: 'F', to: 'G', stroke: 'solid', arrow: true, label: [] },
    ])
  })

  test('an edge label comes from pipes or from the text between the dashes', () => {
    const chart = flowchartOf(
      linesOf(
        'flowchart TD',
        '  A -->|yes| B',
        '  A -- no --> C',
        '  B -.->|"maybe | later"| C',
        '  C ---|plain| D',
      ),
    )
    expect(chart.edges).toEqual([
      { from: 'A', to: 'B', stroke: 'solid', arrow: true, label: ['yes'] },
      { from: 'A', to: 'C', stroke: 'solid', arrow: true, label: ['no'] },
      { from: 'B', to: 'C', stroke: 'dashed', arrow: true, label: ['maybe | later'] },
      { from: 'C', to: 'D', stroke: 'solid', arrow: false, label: ['plain'] },
    ])
  })

  test('a quoted label keeps its brackets and a br tag starts a new line in the box', () => {
    const chart = flowchartOf(
      linesOf(
        'flowchart TD',
        '  A["Parse (the subset) [now]"] --> B[One<br>Two<br/>Three<BR />Four]',
        '  C("a {b}") --> D{"Fits?<br>Yes"}',
      ),
    )
    expect(chart.nodes.map(({ shape, label }) => [shape, label])).toEqual([
      ['box', ['Parse (the subset) [now]']],
      ['box', ['One', 'Two', 'Three', 'Four']],
      ['rounded', ['a {b}']],
      ['decision', ['Fits?', 'Yes']],
    ])
  })

  test('a chain links each neighbour and a fan-out links every pair in source order', () => {
    const chart = flowchartOf(linesOf('flowchart TD', '  A --> B --> C', '  D & E --> F & G'))
    expect(chart.edges.map(({ from, to }) => `${from}${to}`)).toEqual([
      'AB',
      'BC',
      'DF',
      'DG',
      'EF',
      'EG',
    ])
  })

  test('a later shape of a node replaces its label and keeps its first place', () => {
    const chart = flowchartOf(linesOf('flowchart TD', '  A --> B', '  B{Ready?} --> A[Start]'))
    expect(chart.nodes).toEqual([
      { id: 'A', shape: 'box', label: ['Start'] },
      { id: 'B', shape: 'decision', label: ['Ready?'] },
    ])
    expect(chart.edges.map(({ from, to }) => `${from}${to}`)).toEqual(['AB', 'BA'])
  })

  test('comments, styles, classes, clicks and semicolons add nothing to the model', () => {
    const chart = flowchartOf(
      linesOf(
        '%% a leading comment',
        'flowchart TD ;',
        '  %% a comment',
        '  A:::hot --> B[Two]:::cold ;',
        '  classDef hot fill:#f00',
        '  class A hot',
        '  style B stroke:#333',
        '  linkStyle 0 stroke:#0f0',
        '  click A "https://example.com"',
      ),
    )
    expect(chart).toEqual({
      kind: 'flowchart',
      direction: 'TD',
      nodes: [
        { id: 'A', shape: 'box', label: ['A'] },
        { id: 'B', shape: 'box', label: ['Two'] },
      ],
      edges: [{ from: 'A', to: 'B', stroke: 'solid', arrow: true, label: [] }],
    })
  })

  test('a node named like an ignored statement keeps its edge', () => {
    const chart = flowchartOf(
      linesOf(
        'flowchart TD',
        '  style --> B',
        '  class & C --> D',
        '  click --- E',
        '  linkStyle -.-> F',
        '  classDef ==> G',
      ),
    )
    expect(chart.nodes.map(({ id }) => id)).toEqual([
      'style',
      'B',
      'class',
      'C',
      'D',
      'click',
      'E',
      'linkStyle',
      'F',
      'classDef',
      'G',
    ])
    expect(chart.edges.map(({ from, to, stroke, arrow }) => [from, to, stroke, arrow])).toEqual([
      ['style', 'B', 'solid', true],
      ['class', 'D', 'solid', true],
      ['C', 'D', 'solid', true],
      ['click', 'E', 'solid', false],
      ['linkStyle', 'F', 'dashed', true],
      ['classDef', 'G', 'solid', true],
    ])
  })

  test('labels and ids with emoji and CJK keep every grapheme', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    const chart = flowchartOf(
      linesOf('flowchart LR', `  開始["🚀 発射"] -->|はい ✅| B[データ ${family}]`, '  B --> 終了'),
    )
    expect(chart.nodes).toEqual([
      { id: '開始', shape: 'box', label: ['🚀 発射'] },
      { id: 'B', shape: 'box', label: [`データ ${family}`] },
      { id: '終了', shape: 'box', label: ['終了'] },
    ])
    expect(chart.edges[0]?.label).toEqual(['はい ✅'])
  })

  test('the mock source of 9.8 names line 3 and draws nothing', () => {
    expect(
      parseMermaid(linesOf('flowchart TD', '  A[Start] --> B[Parse]', '  B => C[Draw]')),
    ).toEqual(refusedLine(3, 'line 3 does not parse'))
  })

  for (const line of [
    'A --o B',
    'A <--> B',
    'A === B',
    'A ---> B',
    'A -->> B',
    'A -. text .-> B',
    'A -- yes --- B',
    'A[foo (bar)]',
    'A []',
    'end --> A',
    'A -->',
    'A B',
    'A@{ shape: rect }',
  ]) {
    test(`the flowchart line ${line} is outside the subset and names its line`, () => {
      expect(parseMermaid(linesOf('flowchart TD', '  A --> B', `  ${line}`))).toEqual(
        refusedLine(3, 'line 3 does not parse'),
      )
    })
  }

  for (const [source, line, reason] of [
    [linesOf('flowchart TD', '  A --> B', '  subgraph one', '  C', '  end'), 3, 'subgraph'],
    [linesOf('flowchart TD', '  direction LR'), 2, 'direction'],
    [linesOf('flowchart RL', '  A --> B'), 1, 'flowchart RL'],
    [linesOf('graph BT', '  A --> B'), 1, 'graph BT'],
    [linesOf('flowchart TD', '  A[fa:fa-car Car]'), 2, 'icons'],
    [linesOf('flowchart TD', '  A --> B', '  B@{ icon: "fa:user" }'), 3, 'icons'],
    [linesOf('flowchart TD', '  A["`**bold**`"]'), 2, 'markdown strings'],
    [linesOf('flowchart TD', '  A -->|"`md`"| B'), 2, 'markdown strings'],
    [linesOf('classDiagram', '  A <|-- B'), 1, 'classDiagram'],
    [linesOf('pie title Pets', '  "Dogs" : 3'), 1, 'pie'],
    [linesOf('stateDiagram-v2', '  [*] --> A'), 1, 'stateDiagram-v2'],
  ] as const) {
    test(`${reason} is refused by name on line ${String(line)}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, `${reason} does not draw yet`))
    })
  }

  test('a first line that names no diagram does not parse', () => {
    expect(parseMermaid('A --> B')).toEqual(refusedLine(1, 'line 1 does not parse'))
    expect(parseMermaid('flowchart XY\n  A')).toEqual(refusedLine(1, 'line 1 does not parse'))
  })
})

describe('mermaid sequence diagrams', () => {
  test('participants and actors keep their aliases and the place of their first appearance', () => {
    const diagram = sequenceOf(
      linesOf(
        'sequenceDiagram',
        '  participant U as You',
        '  actor C as Claude',
        '  participant R as reply-view',
        '  U->>C: prompt',
        '  X->>U: hi',
        '  participant X as Late',
        '  participant Plain',
      ),
    )
    expect(diagram.participants).toEqual([
      { id: 'U', kind: 'participant', label: ['You'] },
      { id: 'C', kind: 'actor', label: ['Claude'] },
      { id: 'R', kind: 'participant', label: ['reply-view'] },
      { id: 'X', kind: 'participant', label: ['Late'] },
      { id: 'Plain', kind: 'participant', label: ['Plain'] },
    ])
  })

  test('each message arrow keeps its stroke and its head, and drops the activation marks', () => {
    const diagram = sequenceOf(
      linesOf(
        'sequenceDiagram',
        '  A->B: solid line',
        '  A-->B: dashed line',
        '  A->>+B: solid arrow',
        '  B-->>-A: dashed arrow',
        '  A-xB: solid cross',
        '  A--xB: dashed cross',
        '  A-)B: solid open',
        '  A--)B: dashed open',
      ),
    )
    expect(diagram.participants.map(({ id }) => id)).toEqual(['A', 'B'])
    const message = (from: string, to: string, stroke: string, head: string, text: string) => ({
      kind: 'message',
      from,
      to,
      stroke,
      head,
      text: [text],
      number: null,
    })
    expect(diagram.events).toEqual([
      message('A', 'B', 'solid', 'none', 'solid line'),
      message('A', 'B', 'dashed', 'none', 'dashed line'),
      message('A', 'B', 'solid', 'arrow', 'solid arrow'),
      message('B', 'A', 'dashed', 'arrow', 'dashed arrow'),
      message('A', 'B', 'solid', 'cross', 'solid cross'),
      message('A', 'B', 'dashed', 'cross', 'dashed cross'),
      message('A', 'B', 'solid', 'open', 'solid open'),
      message('A', 'B', 'dashed', 'open', 'dashed open'),
    ])
  })

  test('a note takes one side or spans two participants, and adds a participant it names', () => {
    const diagram = sequenceOf(
      linesOf(
        'sequenceDiagram',
        '  A->>A: self',
        '  Note left of A: left',
        '  note right of A: right',
        '  Note over A,B: both<br>lines',
        '  Note over C: alone',
      ),
    )
    expect(diagram.participants.map(({ id }) => id)).toEqual(['A', 'B', 'C'])
    expect(diagram.events.slice(1)).toEqual([
      { kind: 'note', placement: 'left of', participants: ['A'], text: ['left'] },
      { kind: 'note', placement: 'right of', participants: ['A'], text: ['right'] },
      { kind: 'note', placement: 'over', participants: ['A', 'B'], text: ['both', 'lines'] },
      { kind: 'note', placement: 'over', participants: ['C'], text: ['alone'] },
    ])
  })

  test('autonumber numbers each message after it and skips the notes', () => {
    const diagram = sequenceOf(
      linesOf(
        'sequenceDiagram',
        '  A->>B: before',
        '  autonumber',
        '  A->>B: one',
        '  Note over A: not counted',
        '  B-->>A: two',
      ),
    )
    expect(
      diagram.events.map((event) => (event.kind === 'message' ? event.number : 'note')),
    ).toEqual([null, 1, 'note', 2])
  })

  test('a block holds its sections as ranges of events, with the depth of its nesting and the branch it opens in', () => {
    const diagram = sequenceOf(
      linesOf(
        'sequenceDiagram',
        '  loop every minute',
        '    A->>B: ping',
        '    alt hit',
        '      B-->>A: value',
        '    else miss',
        '      B-->>A: none',
        '    end',
        '  end',
        '  opt cached',
        '  end',
        '  par first',
        '    A->>B: one',
        '  and second',
        '    A->>C: two',
        '  end',
        '  critical lock',
        '    A->>B: write',
        '  end',
        '  break failed',
        '    A->>B: stop',
        '  end',
        '  rect rgb(0, 0, 0)',
        '    A->>B: inside',
        '  end',
      ),
    )
    expect(diagram.events.map((event) => event.text[0])).toEqual([
      'ping',
      'value',
      'none',
      'one',
      'two',
      'write',
      'stop',
      'inside',
    ])
    expect(diagram.blocks).toEqual([
      {
        kind: 'loop',
        depth: 0,
        section: 0,
        sections: [{ label: ['every minute'], from: 0, to: 3 }],
      },
      {
        kind: 'alt',
        depth: 1,
        section: 0,
        sections: [
          { label: ['hit'], from: 1, to: 2 },
          { label: ['miss'], from: 2, to: 3 },
        ],
      },
      { kind: 'opt', depth: 0, section: 0, sections: [{ label: ['cached'], from: 3, to: 3 }] },
      {
        kind: 'par',
        depth: 0,
        section: 0,
        sections: [
          { label: ['first'], from: 3, to: 4 },
          { label: ['second'], from: 4, to: 5 },
        ],
      },
      { kind: 'critical', depth: 0, section: 0, sections: [{ label: ['lock'], from: 5, to: 6 }] },
      { kind: 'break', depth: 0, section: 0, sections: [{ label: ['failed'], from: 6, to: 7 }] },
      {
        kind: 'rect',
        depth: 0,
        section: 0,
        sections: [{ label: ['rgb(0, 0, 0)'], from: 7, to: 8 }],
      },
    ])
  })

  test('an empty block keeps the branch it opens in, where two branches meet at one event', () => {
    const diagram = sequenceOf(
      linesOf(
        'sequenceDiagram',
        '  alt first',
        '    loop before',
        '    end',
        '  else second',
        '    loop after',
        '    end',
        '  end',
      ),
    )
    expect(
      diagram.blocks.map(({ kind, depth, section, sections }) => [
        kind,
        depth,
        section,
        sections[0]?.from,
      ]),
    ).toEqual([
      ['alt', 0, 0, 0],
      ['loop', 1, 0, 0],
      ['loop', 1, 1, 0],
    ])
  })

  for (const [source, line] of [
    [linesOf('sequenceDiagram', '  A->>B hi'), 2],
    [linesOf('sequenceDiagram', '  else'), 2],
    [linesOf('sequenceDiagram', '  loop x', '  and y', '  end'), 3],
    [linesOf('sequenceDiagram', '  alt x', '  A->>B: hi', '  end', '  end'), 5],
    [linesOf('sequenceDiagram', '  activate A'), 2],
    [linesOf('sequenceDiagram', '  A<<->>B: both'), 2],
    [linesOf('sequenceDiagram', '  Note over A,B,C: three'), 2],
    [linesOf('sequenceDiagram', '  Note left of A,B: two'), 2],
    [linesOf('sequenceDiagram', '  autonumber 10 5'), 2],
    [linesOf('sequenceDiagram', '  critical x', '  option y', '  end'), 3],
  ] as const) {
    const shown = source.split('\n')[line - 1]?.trim() ?? ''
    test(`the sequence line ${shown} names line ${String(line)}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, `line ${String(line)} does not parse`))
    })
  }

  test('a block with no end names the line that opens it', () => {
    expect(
      parseMermaid(linesOf('sequenceDiagram', '  A->>B: hi', '  loop forever', '  A->>B: again')),
    ).toEqual(refusedLine(3, 'line 3 opens a block with no end'))
  })

  for (const [source, line, name] of [
    [linesOf('sequenceDiagram', '  box Aqua Group', '  participant A', '  end'), 2, 'box'],
    [linesOf('sequenceDiagram', '  A->>B: hi', '  create participant C'), 3, 'create'],
    [linesOf('sequenceDiagram', '  A->>B: hi', '  destroy B'), 3, 'destroy'],
  ] as const) {
    test(`${name} is refused by name on line ${String(line)}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, `${name} does not draw yet`))
    })
  }
})

describe('mermaid input and limits', () => {
  const PARSE_BUDGET_MS = 50
  const SPACES = ' '.repeat(7950)
  const FAN = Array<string>(1990).fill('A').join('&')

  for (const [name, source, expected] of [
    [
      'a text edge label with no closing arrow',
      `flowchart TD\nA --${SPACES}x`,
      refusedLine(2, 'line 2 does not parse'),
    ],
    [
      'a pipe edge label with no closing pipe',
      `flowchart TD\nA -->|${SPACES}x`,
      refusedLine(2, 'line 2 does not parse'),
    ],
    [
      'a note with no colon',
      `sequenceDiagram\nNote over A${SPACES}x`,
      refusedLine(2, 'line 2 does not parse'),
    ],
    [
      'a participant with no alias',
      `sequenceDiagram\nparticipant a${SPACES}x`,
      {
        kind: 'sequence',
        participants: [{ id: `a${SPACES}x`, kind: 'participant', label: [`a${SPACES}x`] }],
        events: [],
        blocks: [],
      },
    ],
    [
      'a fan-out of 1990 boxes to 1990 boxes',
      `flowchart TD\n${FAN}-->${FAN}`,
      overLimit('edges', 1990 * 1990, 60),
    ],
  ] as const) {
    test(`${name} over 7900 characters parses within the budget`, () => {
      expect(Array.from(source).length).toBeGreaterThan(7900)
      const started = performance.now()
      const result = parseMermaid(source)
      const elapsed = performance.now() - started
      expect(result).toEqual(expected)
      expect(elapsed).toBeLessThan(PARSE_BUDGET_MS)
    })
  }

  test('CRLF input reads like LF input and keeps its line numbers', () => {
    const flow = linesOf('flowchart TD', '  A[Start] --> B', '  B --> C', '')
    const sequence = linesOf('sequenceDiagram', '  A->>B: hi', '  Note over B: ok', '')
    expect(flowchartOf(flow.replace(/\n/g, '\r\n'))).toEqual(flowchartOf(flow))
    expect(sequenceOf(sequence.replace(/\n/g, '\r\n'))).toEqual(sequenceOf(sequence))
    expect(flowchartOf(flow).nodes.map(({ label }) => label)).toEqual([['Start'], ['B'], ['C']])
    expect(parseMermaid('flowchart TD\r\n  A --> B\r\n  B => C\r\n')).toEqual(
      refusedLine(3, 'line 3 does not parse'),
    )
  })

  for (const [name, source] of [
    ['no text', ''],
    ['two line breaks', '\n\n'],
    ['spaces, a CRLF and a tab', '   \r\n\t'],
    ['a comment only', '%% only a comment'],
    ['90 blank lines over the line limit', '\n'.repeat(90)],
  ] as const) {
    test(`a block of ${name} is refused as empty`, () => {
      expect(parseMermaid(source)).toEqual({
        kind: 'refused',
        reason: 'the block is empty',
        line: null,
        limit: null,
      })
    })
  }

  test('80 lines draw and 81 lines name the limit, and a final line break is no line', () => {
    const lines = (count: number) => ['flowchart TD', ...Array<string>(count - 1).fill('%% c')]
    expect(flowchartOf(linesOf(...lines(80))).kind).toBe('flowchart')
    expect(flowchartOf(`${linesOf(...lines(80))}\n`).kind).toBe('flowchart')
    expect(parseMermaid(linesOf(...lines(81)))).toEqual(overLimit('lines', 81, 80))
  })

  test('8000 characters draw and 8001 name the limit, and a CR adds no character', () => {
    const source = (count: number) => `flowchart TD\nA[${'x'.repeat(count - 16)}]`
    expect(source(8000)).toHaveLength(8000)
    expect(flowchartOf(source(8000)).nodes).toHaveLength(1)
    expect(flowchartOf(source(8000).replace('\n', '\r\n')).nodes).toHaveLength(1)
    expect(parseMermaid(source(8001))).toEqual(overLimit('characters', 8001, 8000))
  })

  test('40 boxes draw and 41 boxes name the limit', () => {
    const source = (count: number) => linesOf('flowchart TD', ...numbered('  N', count))
    expect(flowchartOf(source(40)).nodes).toHaveLength(40)
    expect(parseMermaid(source(41))).toEqual(overLimit('boxes', 41, 40))
  })

  test('60 edges draw and 61 edges name the limit', () => {
    const fan = `  ${numbered('A', 6).join(' & ')} --> ${numbered('B', 10).join(' & ')}`
    expect(flowchartOf(linesOf('flowchart TD', fan)).edges).toHaveLength(60)
    expect(parseMermaid(linesOf('flowchart TD', fan, '  A1 --> A2'))).toEqual(
      overLimit('edges', 61, 60),
    )
  })

  test('12 participants draw and 13 participants name the limit', () => {
    const source = (count: number) =>
      linesOf('sequenceDiagram', ...numbered('  participant P', count))
    expect(sequenceOf(source(12)).participants).toHaveLength(12)
    expect(parseMermaid(source(13))).toEqual(overLimit('participants', 13, 12))
  })

  test('60 messages and notes draw and 61 name the limit', () => {
    const source = (notes: number) =>
      linesOf(
        'sequenceDiagram',
        ...Array<string>(30).fill('  A->>B: ask'),
        ...Array<string>(notes).fill('  Note over A: wait'),
      )
    expect(sequenceOf(source(30)).events).toHaveLength(60)
    expect(parseMermaid(source(31))).toEqual(overLimit('events', 61, 60, 'messages and notes'))
  })
})

const MOCK_9_5_SOURCE = linesOf(
  'flowchart TD',
  '  A([Reply complete]) --> B{Holds a mermaid block?}',
  '  B -->|yes| C[Parse the subset]',
  '  B -->|no| D[Draw as today]',
  '  C --> E{Fits the width?}',
  '  E -->|yes| F[Draw the art]',
  '  E -->|no| G[Source and a note]',
)

const MOCK_9_6_SOURCE = linesOf(
  'flowchart LR',
  '  A([Prompt]) --> B[Reply]',
  '  B --> C{Table?}',
  '  C -->|yes| D[Columns]',
  '  C -->|no| E[Engine]',
)

const MOCK_9_6_DRAWING = [
  '╭────────╮   ┌───────┐   ┌──────────┐ yes  ┌─────────┐',
  '│ Prompt │──▶│ Reply │──▶│ ◇ Table? │──┬──▶│ Columns │',
  '╰────────╯   └───────┘   └──────────┘  │   └─────────┘',
  '                                       │no ┌────────┐',
  '                                       └──▶│ Engine │',
  '                                           └────────┘',
]

const MOCK_9_6_LOOP_SOURCE = linesOf(
  'flowchart TD',
  '  A[Build] --> B{Test}',
  '  B -->|pass| C[Release]',
  '  B -->|fail| A',
)

const MOCK_9_6_LOOP_DRAWING = [
  '┌───────┐',
  '│ Build │◀───────┐',
  '└───┬───┘        │',
  '    ▼            │',
  '┌────────┐       │',
  '│ ◇ Test │───────┘ fail',
  '└───┬────┘',
  '    │ pass',
  '    ▼',
  '┌─────────┐',
  '│ Release │',
  '└─────────┘',
]

const REPLY_COLUMNS = 78
const LAYOUT_STEP_BUDGET = 40000

const LONG_LABELS_SOURCE = linesOf(
  'flowchart TD',
  '  A[Pick the next record from the ready set] -->|when the queue holds more work than fits| B[Build the record]',
  '  A --> C[Write the change summary]',
)

function drawnLines(source: string, width: number): string[] {
  const result = drawFlowchart(flowchartOf(source), width)
  if (result.kind !== 'drawing') throw new Error(`not drawn: ${result.reason}`)
  return result.lines
}

function notDrawn(reason: string): Refusal {
  return { kind: 'refused', reason, line: null, limit: null }
}

const LINE_UP = 1
const LINE_DOWN = 2
const LINE_LEFT = 4
const LINE_RIGHT = 8

const LINE_ENDS: Readonly<Record<string, number>> = {
  '─': LINE_LEFT | LINE_RIGHT,
  '╌': LINE_LEFT | LINE_RIGHT,
  '│': LINE_UP | LINE_DOWN,
  '╎': LINE_UP | LINE_DOWN,
  '┌': LINE_DOWN | LINE_RIGHT,
  '┐': LINE_DOWN | LINE_LEFT,
  '└': LINE_UP | LINE_RIGHT,
  '┘': LINE_UP | LINE_LEFT,
  '├': LINE_UP | LINE_DOWN | LINE_RIGHT,
  '┤': LINE_UP | LINE_DOWN | LINE_LEFT,
  '┬': LINE_LEFT | LINE_RIGHT | LINE_DOWN,
  '┴': LINE_LEFT | LINE_RIGHT | LINE_UP,
  '┼': LINE_UP | LINE_DOWN | LINE_LEFT | LINE_RIGHT,
}

const LINE_STEPS = [
  [LINE_UP, -1, 0, LINE_DOWN],
  [LINE_DOWN, 1, 0, LINE_UP],
  [LINE_LEFT, 0, -1, LINE_RIGHT],
  [LINE_RIGHT, 0, 1, LINE_LEFT],
] as const

type DrawnBox = { name: string; top: number; left: number; bottom: number; right: number }

function cellGrid(lines: readonly string[]): string[][] {
  return lines.map((line) =>
    graphemesOf(line).flatMap((grapheme) =>
      displayWidth(grapheme) > 1 ? [grapheme, ''] : [grapheme],
    ),
  )
}

function drawnBoxes(grid: readonly string[][]): DrawnBox[] {
  const at = (row: number, col: number) => grid[row]?.[col] ?? ' '
  const boxes: DrawnBox[] = []
  grid.forEach((cells, top) => {
    cells.forEach((cell, left) => {
      if (cell !== '┌' && cell !== '╭') return
      let right = left + 1
      while ('─┬┴'.includes(at(top, right))) right += 1
      if (!'┐╮'.includes(at(top, right)) || right === left + 1) return
      let bottom = top + 1
      while (at(bottom, left) === '│' && at(bottom, right) === '│') bottom += 1
      const closed = '└╰'.includes(at(bottom, left)) && '┘╯'.includes(at(bottom, right))
      if (bottom === top + 1 || !closed) return
      for (let col = left + 1; col < right; col++) if (!'─┬┴'.includes(at(bottom, col))) return
      const row = (grid[top + 1] ?? []).slice(left + 1, right)
      const name = row.join('').trim().replace(/^◇ /, '')
      if (name !== '') boxes.push({ name, top, left, bottom, right })
    })
  })
  return boxes
}

function drawnLinks(lines: readonly string[]): string[] {
  const grid = cellGrid(lines)
  const at = (row: number, col: number) => grid[row]?.[col] ?? ' '
  const boxes = drawnBoxes(grid)
  const inBox = (row: number, col: number) =>
    boxes.some(
      ({ top, left, bottom, right }) => row >= top && row <= bottom && col >= left && col <= right,
    )
  const ends = (row: number, col: number) => (inBox(row, col) ? 0 : (LINE_ENDS[at(row, col)] ?? 0))
  const upright = (row: number, col: number) => ends(row, col) === (LINE_UP | LINE_DOWN)
  const reaches = (row: number, col: number, step: number, bit: number) => {
    let next = col + step
    while (upright(row, next)) next += step
    return (ends(row, next) & bit) !== 0
  }
  const crossing = (row: number, col: number) =>
    upright(row, col) && reaches(row, col, -1, LINE_RIGHT) && reaches(row, col, 1, LINE_LEFT)
  const keyOf = (row: number, col: number, across: number) =>
    `${String(row)},${String(col)}${across !== 0 && crossing(row, col) ? ',across' : ''}`
  const parent = new Map<string, string>()
  const root = (key: string): string => {
    const up = parent.get(key)
    if (up === undefined || up === key) return key
    const top = root(up)
    parent.set(key, top)
    return top
  }
  grid.forEach((cells, row) => {
    cells.forEach((_, col) => {
      const bits = crossing(row, col) ? ends(row, col) | LINE_LEFT | LINE_RIGHT : ends(row, col)
      for (const [bit, down, across, back] of LINE_STEPS) {
        const next = row + down
        const beside = col + across
        const meets = across !== 0 && crossing(next, beside) ? back : ends(next, beside)
        if ((bits & bit) === 0 || (meets & back) === 0) continue
        parent.set(root(keyOf(row, col, across)), root(keyOf(next, beside, across)))
      }
    })
  })
  const sources = new Map<string, Set<string>>()
  const targets = new Map<string, Set<string>>()
  const pairs = new Set<string>()
  const attach = (
    side: Map<string, Set<string>>,
    row: number,
    col: number,
    bit: number,
    name: string,
  ) => {
    if ((ends(row, col) & bit) === 0) return
    const key = root(keyOf(row, col, 0))
    side.set(key, new Set([...(side.get(key) ?? []), name]))
  }
  for (const box of boxes) {
    for (let col = box.left + 1; col < box.right; col++) {
      if (at(box.bottom, col) === '┬') attach(sources, box.bottom + 1, col, LINE_UP, box.name)
      if (at(box.top, col) === '┴') attach(targets, box.top - 1, col, LINE_DOWN, box.name)
      if (at(box.bottom + 1, col) === '▲') attach(targets, box.bottom + 2, col, LINE_UP, box.name)
      if (at(box.top - 1, col) !== '▼') continue
      const above = boxes.find(
        (other) => other.bottom === box.top - 2 && col > other.left && col < other.right,
      )
      if (above !== undefined && at(box.top - 2, col) === '┬')
        pairs.add(`${above.name}>${box.name}`)
      else attach(targets, box.top - 2, col, LINE_DOWN, box.name)
    }
    for (let row = box.top + 1; row < box.bottom; row++) {
      if (at(row, box.left - 1) === '▶') attach(targets, row, box.left - 2, LINE_RIGHT, box.name)
      else attach(targets, row, box.left - 1, LINE_RIGHT, box.name)
      if (at(row, box.right + 1) === '◀') attach(targets, row, box.right + 2, LINE_LEFT, box.name)
      else attach(sources, row, box.right + 1, LINE_LEFT, box.name)
    }
  }
  for (const [key, from] of sources) {
    for (const source of from) {
      for (const target of targets.get(key) ?? []) pairs.add(`${source}>${target}`)
    }
  }
  return [...pairs].sort()
}

function chartLinks(chart: Flowchart): string[] {
  return [...new Set(chart.edges.map((edge) => `${edge.from}>${edge.to}`))].sort()
}

function generatedCharts(seed: number, count: number): string[] {
  let state = seed
  const next = (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor((state / 2147483648) * below)
  }
  return Array.from({ length: count }, () => {
    const direction = next(2) === 0 ? 'TD' : 'LR'
    const boxes = 2 + next(7)
    const lines = [`flowchart ${direction}`, `  ${numbered('N', boxes).join(' & ')}`]
    const edges = 1 + next(11)
    for (let index = 0; index < edges; index++) {
      const from = 1 + next(boxes)
      const to = 1 + next(boxes)
      const arrow = next(5) === 0 ? '-.->' : '-->'
      const label = next(10) < 3 ? `|e${String(index)}|` : ''
      if (from !== to) lines.push(`  N${String(from)} ${arrow}${label} N${String(to)}`)
    }
    return linesOf(...lines)
  })
}

function chain(count: number, direction = 'TD'): string[] {
  return [
    `flowchart ${direction}`,
    ...numbered('  N', count - 1).map((node, index) => `${node} --> N${String(index + 2)}`),
  ]
}

function loopsBack(count: number): string {
  return linesOf(
    ...chain(5),
    ...['N2', 'N3', 'N4', 'N5'].slice(0, count).map((node) => `  ${node} --> N1`),
  )
}

describe('flowchart drawings', () => {
  test('the source of mock 9.6 draws the mock at 78 columns', () => {
    expect(drawnLines(MOCK_9_6_SOURCE, REPLY_COLUMNS)).toEqual(MOCK_9_6_DRAWING)
  })

  test('the loop of mock 9.6 draws the mock at 78 columns, in a channel on the right', () => {
    expect(drawnLines(MOCK_9_6_LOOP_SOURCE, REPLY_COLUMNS)).toEqual(MOCK_9_6_LOOP_DRAWING)
  })

  test('the flowchart LR of mock 9.10 draws the same lines at 80 columns with no indent', () => {
    expect(drawnLines(MOCK_9_6_SOURCE, 80)).toEqual(MOCK_9_6_DRAWING)
  })

  test('the source of mock 9.5 draws top down at 78 columns with a bus under each decision', () => {
    expect(drawnLines(MOCK_9_5_SOURCE, REPLY_COLUMNS)).toEqual([
      '                  ╭────────────────╮',
      '                  │ Reply complete │',
      '                  ╰────────┬───────╯',
      '                           ▼',
      '             ┌──────────────────────────┐',
      '             │ ◇ Holds a mermaid block? │',
      '             └─────────────┬────────────┘',
      '                 ┌─────────┴─────────┐',
      '                 │ yes               │ no',
      '                 ▼                   ▼',
      '       ┌──────────────────┐  ┌───────────────┐',
      '       │ Parse the subset │  │ Draw as today │',
      '       └─────────┬────────┘  └───────────────┘',
      '                 ▼',
      '       ┌───────────────────┐',
      '       │ ◇ Fits the width? │',
      '       └─────────┬─────────┘',
      '       ┌─────────┴─────────┐',
      '       │ yes               │ no',
      '       ▼                   ▼',
      '┌──────────────┐ ┌───────────────────┐',
      '│ Draw the art │ │ Source and a note │',
      '└──────────────┘ └───────────────────┘',
    ])
  })

  test('an LR flowchart draws LR when it fits and redraws as TD one column narrower', () => {
    const width = Math.max(...MOCK_9_6_DRAWING.map(displayWidth))
    expect(drawnLines(MOCK_9_6_SOURCE, width)).toEqual(MOCK_9_6_DRAWING)
    const fallback = [
      '     ╭────────╮',
      '     │ Prompt │',
      '     ╰────┬───╯',
      '          ▼',
      '      ┌───────┐',
      '      │ Reply │',
      '      └───┬───┘',
      '          ▼',
      '    ┌──────────┐',
      '    │ ◇ Table? │',
      '    └─────┬────┘',
      '    ┌─────┴──────┐',
      '    │ yes        │ no',
      '    ▼            ▼',
      '┌─────────┐ ┌────────┐',
      '│ Columns │ │ Engine │',
      '└─────────┘ └────────┘',
    ]
    expect(drawnLines(MOCK_9_6_SOURCE, width - 1)).toEqual(fallback)
    expect(drawnLines(MOCK_9_6_SOURCE, 38)).toEqual(fallback)
  })

  test('box labels wrap at 16 columns, then at 12, and an edge label is cut to 12 with an ellipsis', () => {
    expect(drawnLines(LONG_LABELS_SOURCE, REPLY_COLUMNS).slice(0, 5)).toEqual([
      '         ┌─────────────────────────────────────────┐',
      '         │ Pick the next record from the ready set │',
      '         └────────────────────┬────────────────────┘',
      '         ┌────────────────────┴─────────────────────┐',
      '         │ when the queue holds more work than fits │',
    ])
    expect(drawnLines(LONG_LABELS_SOURCE, 41)).toEqual([
      '           ┌─────────────────┐',
      '           │ Pick the next   │',
      '           │ record from the │',
      '           │ ready set       │',
      '           └────────┬────────┘',
      '         ┌──────────┴──────────┐',
      '         │ when the qu…        │',
      '         ▼                     ▼',
      '┌──────────────────┐ ┌──────────────────┐',
      '│ Build the record │ │ Write the change │',
      '└──────────────────┘ │ summary          │',
      '                     └──────────────────┘',
    ])
    expect(drawnLines(LONG_LABELS_SOURCE, 40)).toEqual([
      '     ┌─────────────┐',
      '     │ Pick the    │',
      '     │ next record │',
      '     │ from the    │',
      '     │ ready set   │',
      '     └──────┬──────┘',
      '     ┌──────┴───────┐',
      '     │ when the qu… │',
      '     ▼              ▼',
      '┌───────────┐ ┌───────────┐',
      '│ Build the │ │ Write the │',
      '│ record    │ │ change    │',
      '└───────────┘ │ summary   │',
      '              └───────────┘',
    ])
  })

  test('a flowchart still too wide after the cuts names its narrowest width', () => {
    expect(drawnLines(LONG_LABELS_SOURCE, 27)).toHaveLength(14)
    expect(drawFlowchart(flowchartOf(LONG_LABELS_SOURCE), 26)).toEqual(
      notDrawn('it takes 27 columns, the screen has 26'),
    )
    expect(drawFlowchart(flowchartOf(MOCK_9_6_SOURCE), 20)).toEqual(
      notDrawn('it takes 22 columns, the screen has 20'),
    )
  })

  test('119 drawn rows draw and 123 rows name the limit of 120', () => {
    expect(drawnLines(linesOf(...chain(30)), REPLY_COLUMNS)).toHaveLength(119)
    expect(drawFlowchart(flowchartOf(linesOf(...chain(31))), REPLY_COLUMNS)).toEqual(
      notDrawn('123 rows, at most 120 draw'),
    )
  })

  test('CJK and emoji labels keep every border in its column', () => {
    const lines = drawnLines(
      linesOf(
        'flowchart TD',
        `  A[表格对齐] --> B[${TECHIE} Ana]`,
        `  B -->|日本語| C[${AUSTRIA} Bo ${KEYCAP_ONE}]`,
        '  A --> C',
      ),
      REPLY_COLUMNS,
    )
    expect(lines).toEqual([
      ' ┌──────────┐',
      ' │ 表格对齐 │',
      ' └─────┬────┘',
      '    ┌──┴───┐',
      '    ▼      │',
      '┌────────┐ │',
      `│ ${TECHIE} Ana │ │`,
      '└───┬────┘ │',
      '    │      └─┐',
      '    │ 日本語 │',
      '    ▼        ▼',
      ' ┌────────────┐',
      ` │ ${AUSTRIA} Bo ${KEYCAP_ONE}   │`,
      ' └────────────┘',
    ])
    for (const box of [lines.slice(0, 3), lines.slice(11, 14)]) {
      expect(new Set(box.map(displayWidth)).size).toBe(1)
    }
    const middle = lines
      .slice(5, 8)
      .map((line) => displayWidth(line.slice(0, line.lastIndexOf('│'))))
    expect(middle).toEqual([11, 11, 11])
  })

  test('a rounded box, a decision mark, dashed lines and edges with no arrow', () => {
    expect(
      drawnLines(
        linesOf(
          'flowchart TD',
          '  A(Round) -.-> B{Pick}',
          '  B ---|keep| C[Plain]',
          '  B -.- D[Dashed]',
        ),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '     ╭───────╮',
      '     │ Round │',
      '     ╰───┬───╯',
      '         ▼',
      '    ┌────────┐',
      '    │ ◇ Pick │',
      '    └────┬───┘',
      '   ┌─────┴╌╌╌╌╌┐',
      '   │ keep      ╎',
      '   │           ╎',
      '┌──┴────┐ ┌────┴───┐',
      '│ Plain │ │ Dashed │',
      '└───────┘ └────────┘',
    ])
  })

  test('an edge across two levels keeps its own drop, and two boxes that link only that box share one', () => {
    expect(
      drawnLines(
        linesOf(
          'flowchart TD',
          '  A[Start] --> B[Left]',
          '  A --> C[Right]',
          '  B --> D[Join]',
          '  C --> D',
          '  A --> D',
        ),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '        ┌───────┐',
      '        │ Start │',
      '        └───┬───┘',
      '   ┌────────┴┬──────┐',
      '   ▼         ▼      │',
      '┌──────┐ ┌───────┐  │',
      '│ Left │ │ Right │  │',
      '└──┬───┘ └───┬───┘  │',
      '   └────────┬┘┌─────┘',
      '            ▼ ▼',
      '         ┌──────┐',
      '         │ Join │',
      '         └──────┘',
    ])
  })

  test('a box moves beside the boxes it links, so its lines do not cross', () => {
    expect(
      drawnLines(
        linesOf('flowchart TD', '  A --> B & C & D', '  B & C & D --> E', '  C --> F'),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '       ┌───┐',
      '       │ A │',
      '       └─┬─┘',
      '  ┌──────┼──────┐',
      '  ▼      ▼      ▼',
      '┌───┐  ┌───┐  ┌───┐',
      '│ B │  │ D │  │ C │',
      '└─┬─┘  └─┬─┘  └─┬─┘',
      '  └─────┬┘┌─────┴┐',
      '        ▼ ▼      ▼',
      '      ┌─────┐  ┌───┐',
      '      │ E   │  │ F │',
      '      └─────┘  └───┘',
    ])
  })

  test('boxes that link every box below share one bus row', () => {
    expect(drawnLines('flowchart TD\n  A1 & A2 --> B1 & B2', REPLY_COLUMNS)).toEqual([
      '┌────┐  ┌────┐',
      '│ A1 │  │ A2 │',
      '└──┬─┘  └──┬─┘',
      '   ├───────┤',
      '   ▼       ▼',
      '┌────┐  ┌────┐',
      '│ B1 │  │ B2 │',
      '└────┘  └────┘',
    ])
  })

  test('two edges between the same boxes draw as one line with both labels', () => {
    expect(drawnLines('flowchart TD\n  A -->|first| B\n  A -.->|second| B', REPLY_COLUMNS)).toEqual(
      ['┌───┐', '│ A │', '└─┬─┘', '  │ first', '  │ second', '  ▼', '┌───┐', '│ B │', '└───┘'],
    )
  })

  test('three loops draw in channels on the right, and a box that a loop leaves and enters grows a row', () => {
    expect(
      drawnLines(
        linesOf(
          'flowchart TD',
          '  A --> B',
          '  B --> C',
          '  C --> D',
          '  D -->|back to b| B',
          '  C -->|back to a| A',
          '  D -->|again| C',
        ),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '┌───┐',
      '│ A │◀─────────┐',
      '└─┬─┘          │',
      '  ▼            │',
      '┌───┐          │',
      '│ B │◀───────┐ │',
      '└─┬─┘        │ │',
      '  ▼          │ │',
      '┌───┐        │ │',
      '│ C │◀─────┐ │ │',
      '│   │──────│─│─┘ back to a',
      '└─┬─┘      │ │',
      '  ▼        │ │',
      '┌───┐      │ │',
      '│ D │──────┴─┘   again',
      '└───┘            back to b',
    ])
  })

  test('a link into a shared box shows no link the chart does not have', () => {
    const down = linesOf('flowchart TD', '  A --> C', '  B --> C', '  B --> D')
    const across = linesOf('flowchart LR', '  B --> A', '  C --> A', '  C --> D')
    expect(drawnLines(down, REPLY_COLUMNS)).toEqual([
      '┌───┐  ┌───┐',
      '│ A │  │ B │',
      '└─┬─┘  └─┬─┘',
      '  │ ┌────┴─┐',
      '  ▼ ▼      ▼',
      '┌─────┐  ┌───┐',
      '│ C   │  │ D │',
      '└─────┘  └───┘',
    ])
    expect(drawnLines(across, REPLY_COLUMNS)).toEqual([
      '┌───┐      ┌───┐',
      '│ B │──┐   │ A │',
      '└───┘  └──▶│   │',
      '┌───┐  ┌──▶│   │',
      '│ C │──┤   └───┘',
      '└───┘  │   ┌───┐',
      '       └──▶│ D │',
      '           └───┘',
    ])
    for (const source of [down, across]) {
      expect(drawnLinks(drawnLines(source, REPLY_COLUMNS))).toEqual(chartLinks(flowchartOf(source)))
    }
  })

  test('the link reader finds the false link of two links that join', () => {
    expect(
      drawnLinks([
        '┌───┐  ┌───┐',
        '│ A │  │ B │',
        '└─┬─┘  └─┬─┘',
        '  └───┬──┴───┐',
        '      ▼      ▼',
        '    ┌───┐  ┌───┐',
        '    │ C │  │ D │',
        '    └───┘  └───┘',
      ]),
    ).toEqual(['A>C', 'A>D', 'B>C', 'B>D'])
  })

  test('each label and each arrowhead belongs to one link', () => {
    expect(drawnLines('flowchart TD\n  A -->|yes| C\n  B --> C\n  B --> D', REPLY_COLUMNS)).toEqual(
      [
        '  ┌───┐  ┌───┐',
        '  │ A │  │ B │',
        '  └─┬─┘  └─┬─┘',
        ' ┌──┘  ┌───┴──┐',
        ' │ yes │      │',
        ' ▼     ▼      ▼',
        '┌─────────┐ ┌───┐',
        '│ C       │ │ D │',
        '└─────────┘ └───┘',
      ],
    )
    expect(drawnLines('flowchart TD\n  A -->|yes| C\n  B -->|no| C', REPLY_COLUMNS)).toEqual([
      '┌───┐  ┌───┐',
      '│ A │  │ B │',
      '└─┬─┘  └─┬─┘',
      '  └┐     │',
      '   │ yes │ no',
      '   ▼     ▼',
      ' ┌─────────┐',
      ' │ C       │',
      ' └─────────┘',
    ])
    expect(drawnLines('flowchart TD\n  A --- C\n  B --> C', REPLY_COLUMNS)).toEqual([
      '┌───┐  ┌───┐',
      '│ A │  │ B │',
      '└─┬─┘  └─┬─┘',
      '  └──┐ ┌─┘',
      '     │ ▼',
      '   ┌─┴───┐',
      '   │ C   │',
      '   └─────┘',
    ])
  })

  test('a crossing draws the vertical line through, so it differs from a join', () => {
    const source = linesOf('flowchart TD', '  A --> B & C & D', '  E --> C')
    const lines = drawnLines(source, REPLY_COLUMNS)
    expect(lines).toEqual([
      '      ┌───┐  ┌───┐',
      '      │ A │  │ E │',
      '      └─┬─┘  └─┬─┘',
      '  ┌─────┴┬─────│┐',
      '  │      │     └│─┐',
      '  ▼      ▼      ▼ ▼',
      '┌───┐  ┌───┐  ┌─────┐',
      '│ B │  │ D │  │ C   │',
      '└───┘  └───┘  └─────┘',
    ])
    expect(lines.join('\n')).not.toContain('┼')
    expect(drawnLinks(lines)).toEqual(chartLinks(flowchartOf(source)))
  })

  test('1000 generated charts draw only the links they hold', () => {
    const drawn = generatedCharts(20261028, 1000).flatMap((source) => {
      const chart = flowchartOf(source)
      const result = drawFlowchart(chart, REPLY_COLUMNS)
      return result.kind === 'drawing' ? [[drawnLinks(result.lines), chartLinks(chart)]] : []
    })
    expect(drawn.length).toBeGreaterThan(900)
    expect(drawn.filter(([shown, held]) => JSON.stringify(shown) !== JSON.stringify(held))).toEqual(
      [],
    )
  })

  test('the label of a loop is cut to 12 columns when the labels must fit', () => {
    const source = MOCK_9_6_LOOP_SOURCE.replace('|fail|', '|fail after the third retry|')
    expect(drawnLines(source, REPLY_COLUMNS)[5]).toBe(
      '│ ◇ Test │───────┘ fail after the third retry',
    )
    expect(drawnLines(source, 40)[5]).toBe('│ ◇ Test │───────┘ fail after …')
  })

  test('a loop of an LR flowchart draws in a channel below', () => {
    expect(
      drawnLines(
        linesOf('flowchart LR', '  A --> B & C & D', '  B & C & D --> E', '  E -->|retry| A'),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '┌───┐      ┌───┐',
      '│ A │──┬──▶│ B │──┐',
      '└───┘  │   └───┘  │',
      '  ▲    │   ┌───┐  │   ┌───┐',
      '  │    ├──▶│ C │──┼──▶│ E │',
      '  │    │   └───┘  │   └─┬─┘',
      '  │    │   ┌───┐  │     │',
      '  │    └──▶│ D │──┘     │',
      '  │        └───┘        │',
      '  │                     │',
      '  └─────────────────────┘',
      '                        retry',
    ])
  })

  test('three loops draw and a fourth names the limit', () => {
    expect(drawFlowchart(flowchartOf(loopsBack(3)), REPLY_COLUMNS).kind).toBe('drawing')
    expect(drawFlowchart(flowchartOf(loopsBack(4)), REPLY_COLUMNS)).toEqual(
      notDrawn('4 loops back, at most 3 draw'),
    )
  })

  for (const [name, source, reason] of [
    [
      'an edge from a box to itself',
      'flowchart TD\n  A --> A',
      'an edge from a box to itself does not draw yet',
    ],
    [
      'loops at two boxes of one level',
      'flowchart TD\n  A --> B\n  A --> C\n  B --> A\n  C --> A',
      'loops at 2 boxes of one level do not draw yet',
    ],
    ['a flowchart with no boxes', 'flowchart TD', 'the flowchart has no boxes'],
    [
      'a crossing that would show a link the source does not have',
      linesOf(
        'flowchart TD',
        '  N1 --> N3',
        '  N1 --> N7',
        '  N2 --> N5',
        '  N2 --> N6',
        '  N3 --> N6',
        '  N4 --> N6',
        '  N5 --> N6',
        '  N5 --> N7',
      ),
      'its lines overlap',
    ],
  ] as const) {
    test(`${name} is refused by name`, () => {
      expect(drawFlowchart(flowchartOf(source), REPLY_COLUMNS)).toEqual(notDrawn(reason))
    })
  }

  test('a tab and a bidi control in a label do not move a border', () => {
    expect(drawnLines('flowchart LR\n  A[Tab\there] --> B[Bidi\u202Ex]', REPLY_COLUMNS)).toEqual([
      '┌──────────┐   ┌───────┐',
      '│ Tab here │──▶│ Bidix │',
      '└──────────┘   └───────┘',
    ])
  })

  for (const [name, source] of [
    [
      'a chain of 40 with 21 edges into its last box, LR',
      linesOf(...chain(40, 'LR'), ...numbered('  N', 21).map((node) => `${node} --> N40`)),
    ],
    [
      'a chain of 40 with 21 edges that cross it, LR',
      linesOf(
        ...chain(40, 'LR'),
        ...numbered('  N', 21).map((node, index) => `${node} --> N${String(40 - index)}`),
      ),
    ],
    [
      'a chain of 40 with 21 edges into its last box, TD',
      linesOf(...chain(40), ...numbered('  N', 21).map((node) => `${node} --> N40`)),
    ],
  ] as const) {
    test(`${name} lays out within the step budget`, () => {
      const chart = flowchartOf(source)
      expect([chart.nodes.length, chart.edges.length]).toEqual([40, 60])
      const meter: LayoutMeter = { steps: 0 }
      expect(drawFlowchart(chart, REPLY_COLUMNS, meter).kind).toBe('refused')
      expect(meter.steps).toBeGreaterThan(0)
      expect(meter.steps).toBeLessThan(LAYOUT_STEP_BUDGET)
    })
  }
})

const MOCK_9_7_SOURCE = linesOf(
  'sequenceDiagram',
  '  You->>Claude: prompt',
  '  Claude->>reply-view: reply text',
  '  reply-view-->>You: drawn reply',
  '  reply-view->>reply-view: cache by width',
  '  Note over reply-view: layout once per width',
)

const MOCK_9_7_DRAWING = [
  '┌─────┐        ┌────────┐        ┌────────────┐',
  '│ You │        │ Claude │        │ reply-view │',
  '└──┬──┘        └────┬───┘        └──────┬─────┘',
  '   │    prompt      │                   │',
  '   │───────────────▶│                   │',
  '   │                │    reply text     │',
  '   │                │──────────────────▶│',
  '   │  drawn reply   │                   │',
  '   │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│',
  '   │                │                   │──┐ cache by width',
  '   │                │                   │◀─┘',
  '   │                │       ┌───────────┴───────────┐',
  '   │                │       │ layout once per width │',
  '   │                │       └───────────┬───────────┘',
]

const MOCK_9_7_ALT_SOURCE = linesOf(
  'sequenceDiagram',
  '  autonumber',
  '  App->>Cache: get key',
  '  alt hit',
  '    Cache-->>App: value',
  '  else miss',
  '    Cache-->>App: none',
  '  end',
)

const MOCK_9_7_ALT_DRAWING = [
  '┌─────┐        ┌───────┐',
  '│ App │        │ Cache │',
  '└──┬──┘        └───┬───┘',
  '   │  1. get key   │',
  '   │──────────────▶│',
  '┄┄ alt: hit ┄┄┄┄┄┄┄┼┄┄┄┄',
  '   │   2. value    │',
  '   │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌│',
  '┄┄ else: miss ┄┄┄┄┄┼┄┄┄┄',
  '   │   3. none     │',
  '   │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌│',
  '┄┄ end ┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄',
]

const MOCK_9_7_TOO_WIDE_COLUMNS = 50
const SEQUENCE_STEP_BUDGET = 4000

function drawnSequence(source: string, width: number): string[] {
  const result = drawSequence(sequenceOf(source), width)
  if (result.kind !== 'drawing') throw new Error(`not drawn: ${result.reason}`)
  return result.lines
}

const ARROW_HEADS = '▶◀×▷◁'
const ARROW_SHAFTS = '─╌'

function drawnMessages(lines: readonly string[]): string[] {
  const grid = cellGrid(lines)
  const at = (row: number, col: number) => grid[row]?.[col] ?? ' '
  const header = grid.findIndex((cells) => cells.includes('┬'))
  const lifelines = (grid[header] ?? []).flatMap((cell, col) => (cell === '┬' ? [col] : []))
  const isShaft = (row: number, col: number) => ARROW_SHAFTS.includes(at(row, col))
  const senderOf = (row: number, from: number, step: number) => {
    let col = from
    for (;;) {
      if (isShaft(row, col)) col += step
      else if (lifelines.includes(col) && at(row, col) === '│' && isShaft(row, col + step))
        col += step
      else break
    }
    return lifelines.includes(col) && at(row, col) === '│' ? lifelines.indexOf(col) : -1
  }
  const found: string[] = []
  grid.forEach((_, row) => {
    if (row <= header) return
    lifelines.forEach((lifeline, index) => {
      const isLoop = at(row, lifeline) === '│' && at(row, lifeline + 3) === '┐'
      if (isLoop && isShaft(row, lifeline + 1)) {
        found.push(`${String(index)}>${String(index)}`)
      }
      if (ARROW_HEADS.includes(at(row, lifeline - 1)) && isShaft(row, lifeline - 2)) {
        const from = senderOf(row, lifeline - 2, -1)
        if (from >= 0) found.push(`${String(from)}>${String(index)}`)
      }
      if (ARROW_HEADS.includes(at(row, lifeline + 1)) && isShaft(row, lifeline + 2)) {
        const from = senderOf(row, lifeline + 2, 1)
        if (from >= 0) found.push(`${String(from)}>${String(index)}`)
      }
    })
  })
  return found
}

function heldMessages(diagram: SequenceDiagram): string[] {
  const index = diagram.participants.map((participant) => participant.id)
  return diagram.events.flatMap((event) =>
    event.kind === 'message'
      ? [`${String(index.indexOf(event.from))}>${String(index.indexOf(event.to))}`]
      : [],
  )
}

function generatedSequences(seed: number, count: number): string[] {
  let state = seed
  const next = (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor((state / 2147483648) * below)
  }
  const arrows = ['->>', '-->>', '-x', '--x', '-)', '--)']
  return Array.from({ length: count }, () => {
    const people = numbered('P', 2 + next(5))
    const lines = ['sequenceDiagram', ...people.map((person) => `  participant ${person}`)]
    const events = 1 + next(12)
    for (let index = 0; index < events; index++) {
      const from = people[next(people.length)] ?? 'P1'
      const to = people[next(people.length)] ?? 'P1'
      const label = next(3) === 0 ? '' : ` m${String(index)}`
      if (next(5) === 0) lines.push(`  Note over ${from}: n${String(index)}`)
      else lines.push(`  ${from}${arrows[next(arrows.length)] ?? '->>'}${to}:${label}`)
    }
    return linesOf(...lines)
  })
}

function lifelineColumns(lines: readonly string[]): number[][] {
  return lines.map(
    (line) =>
      graphemesOf(line).reduce<{ col: number; found: number[] }>(
        (seen, grapheme) => ({
          col: seen.col + displayWidth(grapheme),
          found: '│┬┴┼'.includes(grapheme) ? [...seen.found, seen.col] : seen.found,
        }),
        { col: 0, found: [] },
      ).found,
  )
}

describe('sequence drawings', () => {
  test('the source of mock 9.7 draws the mock at 78 columns, with the lifeline drawn through where the reply crosses it', () => {
    expect(drawnSequence(MOCK_9_7_SOURCE, REPLY_COLUMNS)).toEqual(MOCK_9_7_DRAWING)
  })

  test('the source of mock 9.7 alt draws numbered messages and the alt rows at 78 columns', () => {
    expect(drawnSequence(MOCK_9_7_ALT_SOURCE, REPLY_COLUMNS)).toEqual(MOCK_9_7_ALT_DRAWING)
  })

  test('labels wrap to fit the width in at most 3 lines, and a drawing still too wide names its width', () => {
    expect(drawnSequence(MOCK_9_7_SOURCE, 53).slice(9, 15)).toEqual([
      '   │                │                   │──┐ cache by',
      '   │                │                   │◀─┘ width',
      '   │                │            ┌──────┴──────┐',
      '   │                │            │ layout once │',
      '   │                │            │ per width   │',
      '   │                │            └──────┬──────┘',
    ])
    expect(drawnSequence(MOCK_9_7_SOURCE, MOCK_9_7_TOO_WIDE_COLUMNS)).toEqual([
      '┌─────┐        ┌────────┐        ┌────────────┐',
      '│ You │        │ Claude │        │ reply-view │',
      '└──┬──┘        └────┬───┘        └──────┬─────┘',
      '   │    prompt      │                   │',
      '   │───────────────▶│                   │',
      '   │                │      reply        │',
      '   │                │      text         │',
      '   │                │──────────────────▶│',
      '   │     drawn      │                   │',
      '   │     reply      │                   │',
      '   │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│',
      '   │                │                   │──┐ cache',
      '   │                │                   │  │ by',
      '   │                │                   │◀─┘ width',
      '   │                │             ┌─────┴────┐',
      '   │                │             │ layout   │',
      '   │                │             │ once per │',
      '   │                │             │ width    │',
      '   │                │             └─────┬────┘',
    ])
    expect(drawSequence(sequenceOf(MOCK_9_7_SOURCE), MOCK_9_7_TOO_WIDE_COLUMNS - 1)).toEqual(
      notDrawn(`it takes ${String(MOCK_9_7_TOO_WIDE_COLUMNS)} columns, the screen has 49`),
    )
  })

  test('each stroke and head, notes on each side and over two, a dashed loop and nested blocks', () => {
    expect(
      drawnSequence(
        linesOf(
          'sequenceDiagram',
          '  participant A as Alice',
          '  participant B as Bob',
          '  actor C as Carol',
          '  loop every minute',
          '    A-xC: ping',
          '    alt fine',
          '      C--)A: pong',
          '    else down',
          '      Note left of A: retry',
          '      Note right of C: wake up',
          '    end',
          '  end',
          '  Note over A,C: all three hear it',
          '  B-->B: think it over',
          '  A->B: plain',
          '  B--xA: lost',
          '  A-)B: async',
        ),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '      ┌───────┐        ┌─────┐           ┌───────┐',
      '      │ Alice │        │ Bob │           │ Carol │',
      '      └───┬───┘        └──┬──┘           └───┬───┘',
      '┄┄ loop: every minute ┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄',
      '          │     ping      │                  │',
      '          │───────────────│─────────────────×│',
      '  ┄┄ alt: fine ┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄',
      '          │     pong      │                  │',
      '          │◁╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│',
      '  ┄┄ else: down ┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄',
      '┌───────┐ │               │                  │',
      '│ retry │ │               │                  │',
      '└───────┘ │               │                  │',
      '          │               │                  │ ┌─────────┐',
      '          │               │                  │ │ wake up │',
      '          │               │                  │ └─────────┘',
      '  ┄┄ end ┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄',
      '┄┄ end ┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄',
      '        ┌─┴───────────────┴──────────────────┴─┐',
      '        │          all three hear it           │',
      '        └─┬───────────────┬──────────────────┬─┘',
      '          │               │╌╌┐ think it over │',
      '          │               │╌╌┘               │',
      '          │    plain      │                  │',
      '          │───────────────│                  │',
      '          │     lost      │                  │',
      '          │×╌╌╌╌╌╌╌╌╌╌╌╌╌╌│                  │',
      '          │    async      │                  │',
      '          │──────────────▷│                  │',
    ])
  })

  test('par, opt, critical, break and rect rows name their word and label, and an empty section keeps its rows', () => {
    expect(
      drawnSequence(
        linesOf(
          'sequenceDiagram',
          '  par to Bo',
          '    A->>B: one',
          '  and to Cy',
          '    A->>C: two',
          '  end',
          '  opt',
          '  end',
          '  critical lock',
          '    break full',
          '      B->>A: stop',
          '    end',
          '  end',
          '  rect rgb(1, 2, 3)',
          '    C->>A: tint',
          '  end',
        ),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '┌───┐        ┌───┐        ┌───┐',
      '│ A │        │ B │        │ C │',
      '└─┬─┘        └─┬─┘        └─┬─┘',
      '┄┄ par: to Bo ┄┼┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄',
      '  │    one     │            │',
      '  │───────────▶│            │',
      '┄┄ and: to Cy ┄┼┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄',
      '  │    two     │            │',
      '  │────────────│───────────▶│',
      '┄┄ end ┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄',
      '┄┄ opt ┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄',
      '┄┄ end ┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄',
      '┄┄ critical: lock ┄┄┄┄┄┄┄┄┄┄┼┄┄',
      '  ┄┄ break: full ┄┄┄┄┄┄┄┄┄┄┄┼',
      '  │   stop     │            │',
      '  │◀───────────│            │',
      '  ┄┄ end ┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┼',
      '┄┄ end ┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄',
      '┄┄ rect: rgb(1, 2, 3) ┄┄┄┄┄┄┼┄┄',
      '  │   tint     │            │',
      '  │◀───────────│────────────│',
      '┄┄ end ┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄',
    ])
  })

  test('an empty block at the end of an alt branch draws in that branch, before the else row', () => {
    expect(
      drawnSequence(
        linesOf(
          'sequenceDiagram',
          'A->>B: a',
          'alt first',
          'loop inner',
          'end',
          'else second',
          'B->>A: b',
          'end',
        ),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '┌───┐        ┌───┐',
      '│ A │        │ B │',
      '└─┬─┘        └─┬─┘',
      '  │     a      │',
      '  │───────────▶│',
      '┄┄ alt: first ┄┼┄┄┄┄┄',
      '  ┄┄ loop: inner ┄┄',
      '  ┄┄ end ┄┄┄┄┄┄┼┄┄┄',
      '┄┄ else: second ┄┄┄┄┄',
      '  │     b      │',
      '  │◀───────────│',
      '┄┄ end ┄┄┄┄┄┄┄┄┼┄┄┄┄┄',
    ])
  })

  test('an empty block at the end of a par branch draws in that branch, before the and row', () => {
    expect(
      drawnSequence(
        linesOf('sequenceDiagram', 'par one', 'opt o', 'end', 'and two', 'A->>B: y', 'end'),
        REPLY_COLUMNS,
      ),
    ).toEqual([
      '┌───┐        ┌───┐',
      '│ A │        │ B │',
      '└─┬─┘        └─┬─┘',
      '┄┄ par: one ┄┄┄┼┄┄',
      '  ┄┄ opt: o ┄┄┄┼',
      '  ┄┄ end ┄┄┄┄┄┄┼',
      '┄┄ and: two ┄┄┄┼┄┄',
      '  │     y      │',
      '  │───────────▶│',
      '┄┄ end ┄┄┄┄┄┄┄┄┼┄┄',
    ])
  })

  test('a block label too wide for the screen is cut with an ellipsis', () => {
    expect(
      drawnSequence(
        linesOf(
          'sequenceDiagram',
          '  loop while the cache holds no drawing for this width',
          '    A->>B: hi',
          '  end',
        ),
        30,
      ),
    ).toEqual([
      '┌───┐        ┌───┐',
      '│ A │        │ B │',
      '└─┬─┘        └─┬─┘',
      '┄┄ loop: while the cache h… ┄┄',
      '  │    hi      │',
      '  │───────────▶│',
      '┄┄ end ┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄',
    ])
  })

  test('CJK and emoji labels keep every lifeline in its column', () => {
    const lines = drawnSequence(
      linesOf(
        'sequenceDiagram',
        '  participant T as 表格对齐',
        `  participant A as ${TECHIE} Ana`,
        '  T->>A: 日本語のテスト',
        `  A-->>T: ${AUSTRIA} Bo ${KEYCAP_ONE}`,
        `  Note over A: ${WARNING} 表格`,
        '  A->>A: tab\there',
      ),
      REPLY_COLUMNS,
    )
    expect(lines).toEqual([
      '┌──────────┐        ┌────────┐',
      `│ 表格对齐 │        │ ${TECHIE} Ana │`,
      '└─────┬────┘        └────┬───┘',
      '      │ 日本語のテスト   │',
      '      │─────────────────▶│',
      `      │    ${AUSTRIA} Bo ${KEYCAP_ONE}      │`,
      '      │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│',
      '      │             ┌────┴────┐',
      `      │             │ ${WARNING} 表格 │`,
      '      │             └────┬────┘',
      '      │                  │──┐ tab here',
      '      │                  │◀─┘',
    ])
    expect(
      lifelineColumns(lines.slice(2)).map((found) => [6, 25].filter((col) => found.includes(col))),
    ).toEqual([...Array<number[]>(6).fill([6, 25]), [6], ...Array<number[]>(3).fill([6, 25])])
  })

  test('119 drawn rows draw and 121 rows name the limit of 120', () => {
    const source = (count: number) =>
      linesOf('sequenceDiagram', ...Array<string>(count).fill('  A->>B: ask'))
    expect(drawnSequence(source(58), REPLY_COLUMNS)).toHaveLength(119)
    expect(drawSequence(sequenceOf(source(59)), REPLY_COLUMNS)).toEqual(
      notDrawn('121 rows, at most 120 draw'),
    )
  })

  test('a diagram with no participants and a message that names none are refused by name', () => {
    expect(drawSequence(sequenceOf('sequenceDiagram'), REPLY_COLUMNS)).toEqual(
      notDrawn('the sequence diagram has no participants'),
    )
    const diagram = sequenceOf(linesOf('sequenceDiagram', '  A->>B: hi'))
    const unnamed: SequenceDiagram = {
      ...diagram,
      participants: diagram.participants.filter((participant) => participant.id === 'A'),
    }
    expect(drawSequence(unnamed, REPLY_COLUMNS)).toEqual(notDrawn('a message names no participant'))
  })

  test('the message reader tells a reply that crosses a lifeline from a reply that starts there', () => {
    expect(drawnMessages(MOCK_9_7_DRAWING)).toEqual(['0>1', '1>2', '2>0', '2>2'])
    const shorter = MOCK_9_7_DRAWING.map((line, row) =>
      row === 8 ? `   │◀${'╌'.repeat(15)}│                   │` : line,
    )
    expect(drawnMessages(shorter)).toEqual(['0>1', '1>2', '1>0', '2>2'])
  })

  test('500 generated sequence diagrams draw each message between its own two lifelines', () => {
    const drawn = generatedSequences(20261028, 500).flatMap((source) => {
      const diagram = sequenceOf(source)
      const result = drawSequence(diagram, REPLY_COLUMNS)
      return result.kind === 'drawing' ? [[drawnMessages(result.lines), heldMessages(diagram)]] : []
    })
    expect(drawn.length).toBeGreaterThan(400)
    expect(drawn.filter(([shown, held]) => JSON.stringify(shown) !== JSON.stringify(held))).toEqual(
      [],
    )
  })

  for (const [count, width, reason] of [
    [12, REPLY_COLUMNS, 'it takes 387 columns, the screen has 78'],
    [2, 60, '243 rows, at most 120 draw'],
  ] as const) {
    test(`${String(count)} participants and 60 long messages lay out within the step budget at ${String(width)} columns`, () => {
      const people = numbered('P', count)
      const diagram = sequenceOf(
        linesOf(
          'sequenceDiagram',
          ...people.map((person) => `  participant ${person}`),
          ...Array.from(
            { length: 60 },
            (_, index) =>
              `  ${people[index % count] ?? 'P1'}->>${people[(index * 5 + 7) % count] ?? 'P2'}: ${'word '.repeat(20)}${String(index)}`,
          ),
        ),
      )
      const meter: LayoutMeter = { steps: 0 }
      expect(drawSequence(diagram, width, meter)).toEqual(notDrawn(reason))
      expect(meter.steps).toBeGreaterThan(0)
      expect(meter.steps).toBeLessThan(SEQUENCE_STEP_BUDGET)
    })
  }
})

const DIAGRAM_COLUMNS = [78, 40] as const
const DIAGRAM_BUTTONS = '[ copy ] [ copy drawing ]'
const FENCE_BUTTON_ROOM = '  [ copy ]'.length

function mermaidReply(lead: string, ...sources: string[]): string {
  return [lead, ...sources.flatMap((source) => ['', '```mermaid', source, '```'])].join('\n')
}

function replyWidth(surface: Surface, columns: number): number {
  return surface === 'terminal' ? columns - 2 : columns
}

function onSurface(surface: Surface, lines: readonly string[]): string[] {
  if (surface === 'desktop') return [...lines]
  return lines.map((line, index) => {
    if (line === '') return ''
    return `${index === 0 ? '●' : ' '} ${line}`
  })
}

function titledRule(title: string, columns: number): string {
  const head = title === '' ? '' : `── ${title} `
  return head + '─'.repeat(Math.max(columns - cellsIn(head), 2))
}

function diagramTitleLines(width: number, name = 'flowchart'): string[] {
  const title = `mermaid · ${name}`
  const room = width - DIAGRAM_BUTTONS.length - 2
  if (cellsIn(titledRule(title, 0)) <= room) {
    return [`~${titledRule(title, room)}~  ${DIAGRAM_BUTTONS}`]
  }
  return [
    `~${titledRule(title, width)}~`,
    ' '.repeat(width - DIAGRAM_BUTTONS.length) + DIAGRAM_BUTTONS,
  ]
}

function todaysFence(source: string, width: number): string[] {
  const title = `~${titledRule('mermaid', Math.max(width - FENCE_BUTTON_ROOM, 4))}~  [ copy ]`
  return source === '' ? [title] : [title, ...source.split('\n')]
}

function diagramTest(name: string, options: Record<string, string>, body: ViewBody): void {
  test(name, { options }, async ($, on) => {
    const world = engineBeneath(on)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

const MOCK_9_8_SOURCE = linesOf('flowchart TD', '  A[Start] --> B[Parse]', '  B => C[Draw]')

const SEQUENCE_SOURCE = linesOf(
  'sequenceDiagram',
  '  You->>Claude: prompt',
  '  Claude-->>You: reply',
)

const CLASS_SOURCE = linesOf('classDiagram', '  Animal <|-- Duck', '  Animal <|-- Fish')

const WIDE_SOURCE = linesOf(
  'flowchart TD',
  '  A[Start] --> B[Alpha box] & C[Bravo box] & D[Charlie box] & E[Delta box]',
)

const PARTIAL_SOURCES = [
  linesOf('flowchart TD', '  A[Start] --> B[Pa'),
  linesOf('flowchart TD', '  A[Start] --> B[Parse]'),
  'flow',
] as const

const UNSEEN_PARTIAL_SOURCES = [
  linesOf('flowchart TD', '  Q[Queue] --> R[Re'),
  linesOf('flowchart TD', '  Q[Queue] --> R[Read]'),
  'flowc',
] as const

const TINY_SOURCE = linesOf('flowchart TD', '  A --> B')

function openMermaidReply(partial: string): string {
  return ['Here is the flow:', '', '```mermaid', partial].join('\n')
}

const ELEMENTS_NOT_DRAWN = {
  Box: () => ({}),
  Text: () => ({}),
  Button: () => ({}),
  Markdown: () => ({}),
  Code: () => ({}),
} as unknown as ReplyElements

function laidOut(text: string): void {
  replyTree(
    ELEMENTS_NOT_DRAWN,
    text,
    blocksOf(text),
    {
      columns: COLUMNS,
      hasBullet: true,
      isFirstOfReply: true,
      surface: 'terminal',
      drawsDiagrams: true,
    },
    'folded',
    { copy: () => undefined, fold: () => undefined },
  )
}

describe('diagram blocks', () => {
  for (const surface of SURFACES) {
    for (const columns of DIAGRAM_COLUMNS) {
      viewTest(
        `a flowchart that fits draws its title, its drawing, copy and copy drawing on ${surface} at ${String(columns)} columns`,
        async (world, $) => {
          const width = replyWidth(surface, columns)
          const drawing = drawnLines(MOCK_9_6_SOURCE, width)
          const ui = await mountReply(
            $,
            reply(mermaidReply('The view decides per block:', MOCK_9_6_SOURCE)),
            surface,
            columns,
          )
          expect(await sketchOf(ui, columns)).toEqual(
            onSurface(surface, [
              'The view decides per block:',
              '',
              ...diagramTitleLines(width),
              ...drawing.map((line) => line.trimEnd()),
            ]),
          )
          const code = await ui.find({ type: 'Code' })
          expect(code?.props.source).toBe(drawing.join('\n'))
          expect(code?.props.language).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          await ui.press({ key: 'block-1-drawing' })
          expect(world.copies).toEqual([MOCK_9_6_SOURCE, drawing.join('\n')])
          expect(world.toasts).toEqual([
            { lines: ['✓ Copied the flowchart source', '5 lines'], timeoutMs: 6000 },
            {
              lines: ['✓ Copied the flowchart drawing', `${String(drawing.length)} lines`],
              timeoutMs: 6000,
            },
          ])
          await ui.unmount()
        },
      )

      viewTest(
        `a block that does not draw keeps the fence of today under a dim note with the reason on ${surface} at ${String(columns)} columns`,
        async (world, $) => {
          const width = replyWidth(surface, columns)
          const ui = await mountReply(
            $,
            reply(mermaidReply('Here is the flow:', MOCK_9_8_SOURCE, CLASS_SOURCE, '')),
            surface,
            columns,
          )
          expect(await sketchOf(ui, columns)).toEqual(
            onSurface(surface, [
              'Here is the flow:',
              '',
              '~diagram not drawn: line 3 does not parse.~',
              ...todaysFence(MOCK_9_8_SOURCE, width),
              '',
              '~diagram not drawn: classDiagram does not draw yet.~',
              ...todaysFence(CLASS_SOURCE, width),
              '',
              '~diagram not drawn: the block is empty.~',
              ...todaysFence('', width),
            ]),
          )
          expect(await ui.find({ key: 'block-2-drawing' })).toBeUndefined()
          await ui.press({ key: 'block-2-copy' })
          expect(world.copies).toEqual([CLASS_SOURCE])
          expect(world.toasts).toEqual([
            { lines: ['✓ Copied the mermaid block', '3 lines'], timeoutMs: 6000 },
          ])
          await ui.unmount()
        },
      )

      viewTest(
        `when the fold ends inside a diagram only its title line shows on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const width = replyWidth(surface, columns)
          const drawing = drawnLines(MOCK_9_5_SOURCE, width)
          const lead = Array.from({ length: 26 }, (_, index) => `Line ${String(index + 1)}`)
          const ui = await mountReply(
            $,
            reply(mermaidReply(lead.join('\n'), MOCK_9_5_SOURCE)),
            surface,
            columns,
          )
          const folded = await sketchOf(ui, columns)
          expect(folded.slice(0, -1)).toEqual(
            onSurface(surface, [...lead, '', ...diagramTitleLines(width)]),
          )
          expect(folded.at(-1)).toContain(`~… ${String(drawing.length)} more lines~`)
          expect(await ui.find({ type: 'Code' })).toBeUndefined()
          await ui.press({ key: 'fold' })
          const indent = surface === 'terminal' ? '  ' : ''
          expect((await sketchOf(ui, columns)).slice(-3 - drawing.length, -2)).toEqual(
            [...diagramTitleLines(width).slice(-1), ...drawing].map((line) =>
              `${indent}${line}`.trimEnd(),
            ),
          )
          await ui.unmount()
        },
      )
    }

    diagramTest(
      `with the diagrams setting off every mermaid block draws as today on ${surface}`,
      { diagrams: 'off' },
      async (_world, $) => {
        const width = replyWidth(surface, COLUMNS)
        const ui = await mountReply(
          $,
          reply(mermaidReply('Two diagrams:', MOCK_9_6_SOURCE, SEQUENCE_SOURCE)),
          surface,
        )
        expect(await sketchOf(ui)).toEqual(
          onSurface(surface, [
            'Two diagrams:',
            '',
            ...todaysFence(MOCK_9_6_SOURCE, width),
            '',
            ...todaysFence(SEQUENCE_SOURCE, width),
          ]),
        )
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        await ui.unmount()
      },
    )

    diagramTest(
      `with the diagrams setting on the same reply draws its flowchart and its sequence diagram on ${surface}`,
      { diagrams: 'on' },
      async (_world, $) => {
        const width = replyWidth(surface, COLUMNS)
        const ui = await mountReply(
          $,
          reply(mermaidReply('Two diagrams:', MOCK_9_6_SOURCE, SEQUENCE_SOURCE)),
          surface,
        )
        expect(await sketchOf(ui)).toEqual(
          onSurface(surface, [
            'Two diagrams:',
            '',
            ...diagramTitleLines(width),
            ...drawnLines(MOCK_9_6_SOURCE, width),
            '',
            ...diagramTitleLines(width, 'sequence'),
            '┌─────┐        ┌────────┐',
            '│ You │        │ Claude │',
            '└──┬──┘        └────┬───┘',
            '   │    prompt      │',
            '   │───────────────▶│',
            '   │     reply      │',
            '   │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│',
          ]),
        )
        await ui.unmount()
      },
    )

    viewTest(
      `the source of mock 9.7 draws its title, its drawing, copy and copy drawing on ${surface}`,
      async (world, $) => {
        const width = replyWidth(surface, COLUMNS)
        const ui = await mountReply(
          $,
          reply(mermaidReply('The reply takes three steps:', MOCK_9_7_SOURCE)),
          surface,
        )
        expect(await sketchOf(ui)).toEqual(
          onSurface(surface, [
            'The reply takes three steps:',
            '',
            ...diagramTitleLines(width, 'sequence'),
            ...MOCK_9_7_DRAWING,
          ]),
        )
        expect((await ui.find({ type: 'Code' }))?.props.source).toBe(MOCK_9_7_DRAWING.join('\n'))
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([MOCK_9_7_SOURCE, MOCK_9_7_DRAWING.join('\n')])
        expect(world.toasts).toEqual([
          { lines: ['✓ Copied the sequence source', '6 lines'], timeoutMs: 6000 },
          { lines: ['✓ Copied the sequence drawing', '14 lines'], timeoutMs: 6000 },
        ])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'the title line of a drawn sequence diagram at 80 columns is the line of mock 9.7',
    async (_world, $) => {
      const ui = await mountReply(
        $,
        reply(mermaidReply('The reply takes three steps:', MOCK_9_7_ALT_SOURCE)),
      )
      const title = (await sketchOf(ui))[2] ?? ''
      expect(title.replace(/~/g, '')).toBe(
        '  ── mermaid · sequence ─────────────────────────────  [ copy ] [ copy drawing ]',
      )
      await ui.unmount()
    },
  )

  viewTest(
    'a sequence diagram too wide for 40 columns draws whole as its source under the width note, as in mock 9.9',
    async (_world, $) => {
      const ui = await mountReply(
        $,
        reply(mermaidReply('The reply takes three steps:', MOCK_9_7_SOURCE)),
        'terminal',
        40,
      )
      expect(await sketchOf(ui, 40)).toEqual([
        '● The reply takes three steps:',
        '',
        `  ~diagram not drawn: it takes ${String(MOCK_9_7_TOO_WIDE_COLUMNS)} columns, the screen has 38.~`,
        '  ~── mermaid ─────────────────~  [ copy ]',
        ...MOCK_9_7_SOURCE.split('\n').map((line) => `  ${line}`),
      ])
      expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
      await ui.unmount()
    },
  )

  viewTest(
    'the title line of a drawn flowchart at 80 columns is the line of mock 9.5',
    async (_world, $) => {
      const ui = await mountReply($, reply(mermaidReply('This is how:', MOCK_9_5_SOURCE)))
      const title = (await sketchOf(ui))[2] ?? ''
      expect(title.replace(/~/g, '')).toBe(
        '  ── mermaid · flowchart ────────────────────────────  [ copy ] [ copy drawing ]',
      )
      await ui.unmount()
    },
  )

  viewTest(
    'a flowchart too wide for the screen draws whole as its source, never in part',
    async (_world, $) => {
      const ui = await mountReply($, reply(mermaidReply('Wide:', WIDE_SOURCE)), 'terminal', 40)
      expect(await sketchOf(ui, 40)).toEqual([
        '● Wide:',
        '',
        '  ~diagram not drawn: it takes 59 columns, the screen has 38.~',
        '  ~── mermaid ─────────────────~  [ copy ]',
        '  flowchart TD',
        '    A[Start] --> B[Alpha box] & C[Bravo box] & D[Charlie box] & E[Delta box]',
      ])
      await ui.unmount()
    },
  )

  viewTest(
    'at 40 columns the buttons of a drawn flowchart stand under its title line, as in mock 9.9',
    async (_world, $) => {
      const ui = await mountReply(
        $,
        reply(mermaidReply('The view decides per block:', MOCK_9_6_SOURCE)),
        'terminal',
        40,
      )
      expect((await sketchOf(ui, 40)).slice(2, 5)).toEqual([
        '  ~── mermaid · flowchart ───────────────~',
        '               [ copy ] [ copy drawing ]',
        `  ${drawnLines(MOCK_9_6_SOURCE, 38)[0] ?? ''}`,
      ])
      await ui.unmount()
    },
  )

  test('a drawing is kept for its source, width and surface, and the least recent of 33 is dropped', () => {
    const source = linesOf('flowchart TD', '  Keep[Kept drawing] --> Next[Next box]')
    const first = diagramOf(source, 78, 'terminal')
    expect(first.kind).toBe('drawing')
    expect(diagramOf(source, 78, 'terminal')).toBe(first)
    expect(diagramOf(source, 76, 'terminal')).not.toBe(first)
    expect(diagramOf(source, 78, 'desktop')).not.toBe(first)
    expect(diagramOf(source, 78, 'desktop')).toEqual(first)
    const others = Array.from({ length: 31 }, (_, index) =>
      linesOf('flowchart TD', `  K${String(index)}[Other ${String(index)}] --> Next[Next box]`),
    )
    expect(diagramOf(source, 78, 'terminal')).toBe(first)
    for (const other of others) diagramOf(other, 78, 'terminal')
    expect(diagramOf(source, 78, 'terminal')).toBe(first)
    for (const other of [...others, linesOf('flowchart TD', '  X --> Y')]) {
      diagramOf(other, 78, 'desktop')
    }
    expect(diagramOf(source, 78, 'terminal')).not.toBe(first)
  })

  for (const surface of SURFACES) {
    viewTest(
      `a mermaid block that is still open draws as the fence of today with no note on ${surface}`,
      async (_world, $) => {
        const width = replyWidth(surface, COLUMNS)
        for (const partial of PARTIAL_SOURCES) {
          const ui = await mountReply($, reply(openMermaidReply(partial)), surface)
          expect(await sketchOf(ui)).toEqual(
            onSurface(surface, ['Here is the flow:', '', ...todaysFence(partial, width)]),
          )
          await ui.unmount()
        }
      },
    )
  }

  test('a mermaid block that is still open takes no place among the kept drawings', () => {
    const held = linesOf('flowchart TD', '  Held[Held drawing] --> Next[Next box]')
    const fill = (name: string) => {
      for (let index = 0; index < 31; index += 1) {
        diagramOf(
          linesOf('flowchart TD', `  ${name}${String(index)}[Filler] --> Next[Next box]`),
          78,
          'terminal',
        )
      }
    }
    const first = diagramOf(held, 78, 'terminal')
    fill('F')
    for (const partial of UNSEEN_PARTIAL_SOURCES) laidOut(openMermaidReply(partial))
    expect(diagramOf(held, 78, 'terminal')).toBe(first)
    fill('G')
    laidOut(mermaidReply('Closed:', linesOf('flowchart TD', '  Closed[Closed] --> Next[Next box]')))
    expect(diagramOf(held, 78, 'terminal')).not.toBe(first)
  })

  viewTest(
    'at 20 columns each diagram button stands on its own line and no title line is wider than the reply',
    async (_world, $) => {
      const ui = await mountReply($, reply(mermaidReply('Tiny:', TINY_SOURCE)), 'terminal', 20)
      const drawn = await sketchOf(ui, 20)
      expect(drawn.slice(0, 5)).toEqual([
        '● Tiny:',
        '',
        '  ~── mermaid · flow…~',
        `  ${' '.repeat(10)}[ copy ]`,
        `  ${' '.repeat(2)}[ copy drawing ]`,
      ])
      expect(drawn.slice(5)).toEqual(
        drawnLines(TINY_SOURCE, 18).map((line) => `  ${line}`.trimEnd()),
      )
      expect(drawn.filter((line) => cellsIn(line.replace(/~/g, '')) > 20)).toEqual([])
      await ui.unmount()
    },
  )

  viewTest('at 20 columns the fold counts the three title rows of a diagram', async (_world, $) => {
    const lead = Array.from({ length: 26 }, (_, index) => `Line ${String(index + 1)}`)
    const ui = await mountReply(
      $,
      reply(mermaidReply(lead.join('\n'), TINY_SOURCE)),
      'terminal',
      20,
    )
    const drawing = drawnLines(TINY_SOURCE, 18)
    const folded = await sketchOf(ui, 20)
    expect(folded.slice(-4, -1)).toEqual([
      '  ~── mermaid · flow…~',
      `  ${' '.repeat(10)}[ copy ]`,
      `  ${' '.repeat(2)}[ copy drawing ]`,
    ])
    expect(folded).toHaveLength(26 + 1 + 3 + 1)
    expect(folded.at(-1)).toContain(`~… ${String(drawing.length)} more lines~`)
    await ui.unmount()
  })
})
