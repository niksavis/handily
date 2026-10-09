import type { On, RenderPropsOf, ToolCallResult } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import type { QuietItemsSimpleViewMode } from './.claude-plugin/types/quiet-items'
import { commandLabel, programOf, segments } from './hooks/command'

const ROOT = '/work/app'
const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const MARKER = { terminal: '● ', desktop: '' } as const
const QUIET_COMMAND = 'br close handily-ab12'
const QUIET_MODE_COMMAND = 'quiet-items-mode'

type Surface = (typeof SURFACES)[number]
type Answer = ToolCallResult
type BashCall = { command: string; description?: string; run_in_background?: boolean }

type World = {
  clock: MockClock
  ids: string[]
  logs: string[]
  answer: (input: Record<string, unknown>) => Answer
  delayMs: number
  isRootRefused: boolean
  isCallWriteRefused: boolean
  isModeReadRefused: boolean
  groups: boolean[]
  copies: string[]
  toasts: string[]
  copyRefusal: 'no-surface' | 'no-clipboard' | 'refused' | null
  files: Record<string, string>
}

function bashOutput(stdout: string, extra: Record<string, unknown> = {}) {
  return { stdout, stderr: '', interrupted: false, ...extra }
}

function answered(stdout: string, extra: Record<string, unknown> = {}): Answer {
  return { result: bashOutput(stdout, extra), text: stdout }
}

function failed(text: string): Answer {
  return { isError: true, result: text, text }
}

const fakeQuietItems: Plugin = {
  name: 'quiet-items',
  register(on) {
    const modeCommand = 'quiet-items-mode'
    const quietCommand = 'br close handily-ab12'
    on('session.start', async ($, e, next) => {
      await $.command.register({ name: modeCommand, description: 'test only' })
      await $.state.set({ plugin: 'quiet-items', key: 'mode' }, 'on')
      return next(e)
    })
    on('command.run', { command: modeCommand }, async ($, e) => {
      if (e.args === 'off') await $.state.set({ plugin: 'quiet-items', key: 'mode' }, 'off')
      const { value } = await $.state.get({ plugin: 'quiet-items', key: 'mode' })
      return { text: `quiet-items mode ${String(value)}` }
    })
    on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
      const result = await next(e)
      if (e.command === quietCommand) {
        await $.state.set({ plugin: 'quiet-items', key: 'rows', id: e.tool_use_id }, [
          {
            kind: 'item',
            verb: 'closed',
            id: 'handily-ab12',
            title: 'Draw text mocks',
            status: 'closed',
            priority: 2,
          },
        ])
      }
      return result
    })
  },
}

function engineBeneath(on: On): World {
  const world: World = {
    clock: mock.clock(on, { now: 1_000_000 }),
    ids: [],
    logs: [],
    answer: () => answered('one\ntwo\n'),
    delayMs: 0,
    isRootRefused: false,
    isCallWriteRefused: false,
    isModeReadRefused: false,
    groups: [],
    copies: [],
    toasts: [],
    copyRefusal: null,
    files: {},
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.root', () =>
    world.isRootRefused ? { deny: 'the fake root is unavailable' } : { value: ROOT },
  )
  on('state.set', (_$, e, next) =>
    world.isCallWriteRefused && e.plugin === 'simple-view' && e.key === 'calls'
      ? { deny: 'the fake state refuses the write' }
      : next(e),
  )
  on('state.get', (_$, e, next) =>
    world.isModeReadRefused && e.plugin === 'simple-view' && e.key === 'mode'
      ? { deny: 'the fake state refuses the read' }
      : next(e),
  )
  on('tool.call', async (_$, e) => {
    world.ids.push(e.tool_use_id)
    if (world.delayMs > 0) await world.clock.sleep(world.delayMs)
    return world.answer(e)
  })
  on('ui.render', (_$, e) => {
    if (e.component === 'ToolGroup') world.groups.push(e.props.isExpanded)
    return ENGINE_ROW
  })
  on('ui.log', (_$, e) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    if (world.copyRefusal !== null) {
      return { value: { isCopied: false as const, reason: world.copyRefusal } }
    }
    world.copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = world.files[e.path]
    if (text === undefined) return { deny: `no fixture file ${e.path}` }
    return { value: text }
  })
  return world
}

type ViewBody = (world: World, $: Engine, on: On) => unknown

function viewTest(name: string, body: ViewBody): void {
  test(name, { plugins: [fakeQuietItems] }, async ($, on) => {
    const world = engineBeneath(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await body(world, $, on)
  })
}

async function runTool(world: World, $: Engine, input: Record<string, unknown>): Promise<string> {
  const pending = $.tool.call(input as Parameters<Engine['tool']['call']>[0])
  await world.clock.settle()
  if (world.delayMs > 0) await world.clock.advance(world.delayMs)
  await pending
  const id = world.ids.at(-1)
  if (id === undefined) throw new Error('the tool call reached no engine')
  return id
}

async function runBash(world: World, $: Engine, call: BashCall): Promise<string> {
  return runTool(world, $, { tool: 'Bash', ...call })
}

function useProps(
  id: string,
  tool: string,
  input: unknown,
  answer: Answer,
  extra: Partial<RenderPropsOf['ToolUse']> = {},
): RenderPropsOf['ToolUse'] {
  return {
    tool_use_id: id,
    tool,
    input,
    isRunning: false,
    isErrored: answer.isError === true,
    isInterrupted: false,
    output: answer.result,
    ...extra,
  }
}

function resultProps(id: string, tool: string, answer: Answer): RenderPropsOf['ToolResult'] {
  return { tool_use_id: id, tool, output: answer.result, isErrored: answer.isError === true }
}

function shown(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null || !('children' in node)) return ''
  const { children } = node
  return Array.isArray(children) ? children.map(shown).join(' ') : ''
}

type Mountable =
  | { component: 'ToolUse'; props: RenderPropsOf['ToolUse'] }
  | { component: 'ToolResult'; props: RenderPropsOf['ToolResult'] }

async function texts($: Engine, surface: Surface, target: Mountable): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'simple-view', surface, ...target })
  const boxes = await ui.findAll({ type: 'Box' })
  const keyed = boxes.filter((box) => box.key === 'row' || box.key?.startsWith('change-'))
  const found = keyed.map((box) => box.children.map(shown).join(' ').replace(/\s+/g, ' ').trim())
  await ui.unmount()
  return found
}

async function drawn($: Engine, target: Mountable, surface: Surface = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'simple-view', surface, ...target })
  const tree = await ui.drawn()
  const textCount = (await ui.findAll({ type: 'Text' })).length
  await ui.unmount()
  return { tree, textCount }
}

const SKETCH_COLUMNS = 100
const COLOR_MARKS: Readonly<Record<string, string>> = { error: '#', success: '+', warning: '!' }

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

function cellsOf(line: string): number {
  return Array.from(line).length
}

function blockWidth(lines: readonly string[]): number {
  return Math.max(0, ...lines.map(cellsOf))
}

function isGrower(node: unknown): boolean {
  return isDrawnNode(node) && Number(node.props?.flexGrow ?? 0) > 0
}

function rowLines(children: readonly unknown[], width: number, gap: number): string[] {
  const margins = (node: unknown) =>
    isDrawnNode(node)
      ? [Number(node.props?.marginLeft ?? 0), Number(node.props?.marginRight ?? 0)]
      : [0, 0]
  const blocks = children.map((child) => (isGrower(child) ? null : sketchLines(child, width)))
  const used = blocks.reduce(
    (sum, block, index) => {
      const [left = 0, right = 0] = margins(children[index])
      return sum + left + right + (block === null ? 0 : blockWidth(block))
    },
    gap * Math.max(children.length - 1, 0),
  )
  const filled = children.map((child, index) => {
    const block = blocks[index]
    if (block !== null && block !== undefined) return block
    const least = isDrawnNode(child) ? Number(child.props?.minWidth ?? 0) : 0
    return [' '.repeat(Math.max(least, width - used))]
  })
  const height = Math.max(0, ...filled.map((block) => block.length))
  return Array.from({ length: height }, (_, row) =>
    filled
      .map((block, index) => {
        const [left = 0, right = 0] = margins(children[index])
        const text = block[row] ?? ''
        const padded = text + ' '.repeat(blockWidth(block) - cellsOf(text))
        return ' '.repeat(left) + padded + ' '.repeat(right)
      })
      .join(' '.repeat(gap))
      .trimEnd(),
  )
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
      ? lines.map((line) => ' '.repeat(Math.max(inner - cellsOf(line), 0)) + line)
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
    case 'Box':
      return boxLines(props, node.children ?? [], width)
    case 'engine':
      return ['(engine)']
    default:
      return []
  }
}

function sketch(node: unknown): string[] {
  return sketchLines(node, SKETCH_COLUMNS).map((line) => line.trimEnd())
}

function edges(left: string, right: string): string {
  return left + ' '.repeat(SKETCH_COLUMNS - cellsOf(left) - cellsOf(right)) + right
}

async function commandText($: Engine, args: string, command = 'simple'): Promise<string> {
  const result = await $.command.run({
    command,
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  return result.text ?? ''
}

const EDIT_DIFF = {
  files: [
    {
      filePath: `${ROOT}/src/app.ts`,
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          lines: [' a', '-b', '+c', '+d', ' e'],
        },
      ],
    },
    {
      filePath: `${ROOT}/docs/new.md`,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+x', '+y'] }],
      created: true,
    },
  ],
  moreFiles: 0,
  changedFiles: [`${ROOT}/src/app.ts`, `${ROOT}/docs/new.md`],
}

function groupCall(id: string, command: string, answer: Answer) {
  return {
    tool_use_id: id,
    tool: 'Bash',
    input: { command },
    isRunning: false,
    isErrored: answer.isError === true,
    isInterrupted: false,
    output: answer.result,
  }
}

const LISTED = groupCall('toolu_g1', 'ls', answered('a\nb\n'))
const MISSING = groupCall(
  'toolu_g2',
  'ls /nonexistent-dir',
  failed("Error: Exit code 2\nls: cannot access '/nonexistent-dir': No such file or directory"),
)

function group(
  calls: RenderPropsOf['ToolGroup']['calls'],
  isExpanded = false,
): RenderPropsOf['ToolGroup'] {
  return { calls, isActive: false, isExpanded }
}

async function groupExpansion(
  world: World,
  $: Engine,
  props: RenderPropsOf['ToolGroup'],
  surface: Surface = 'terminal',
): Promise<boolean[]> {
  world.groups.length = 0
  const ui = await $.ui.mount({ plugin: 'simple-view', surface, component: 'ToolGroup', props })
  await ui.unmount()
  return [...world.groups]
}

describe('command reading', () => {
  test('splits a command at its separators outside quotes and substitutions', () => {
    expect(segments('cd /x && npm test | tail -5; echo "a && b" || git log')).toEqual([
      'cd /x',
      'npm test',
      'tail -5',
      'echo "a && b"',
      'git log',
    ])
    expect(segments('X=$(git rev-parse HEAD; true) git show')).toEqual([
      'X=$(git rev-parse HEAD; true) git show',
    ])
    expect(segments("echo 'a;b' `c;d`\nls")).toEqual(["echo 'a;b' `c;d`", 'ls'])
    expect(segments('grep a\\;b f')).toEqual(['grep a\\;b f'])
  })

  test('names the program of the first segment that is not a directory change', () => {
    expect(programOf('cd /work/app && git status')).toBe('git')
    expect(programOf('LANG=C /usr/bin/sort -u f')).toBe('sort')
    expect(programOf('python3 .basicly/core/kit/tracker/cli.py list')).toBe('python3')
    expect(programOf('cd /tmp')).toBe('cd')
  })
})

describe('Bash row', () => {
  for (const surface of SURFACES) {
    viewTest(`draws a finished call as one row on ${surface}`, async (world, $) => {
      world.delayMs = 1200
      world.answer = () => answered('one\ntwo\nthree\n')
      const input = { command: 'npm test', description: 'Run the unit tests' }
      const id = await runBash(world, $, input)
      const answer = world.answer(input)
      expect(
        await texts($, surface, {
          component: 'ToolUse',
          props: useProps(id, 'Bash', input, answer),
        }),
      ).toEqual([`${MARKER[surface]}Run the unit tests npm exit 0 3 lines 1.2s`])
      const result = await drawn($, {
        component: 'ToolResult',
        props: resultProps(id, 'Bash', answer),
      })
      expect(result.tree).toMatchObject({ type: 'Box' })
      expect(result.textCount).toBe(0)
    })

    viewTest(`draws one Updated line per changed file on ${surface}`, async (world, $) => {
      world.answer = () => answered('', { bashEditDiff: EDIT_DIFF })
      const input = { command: 'node scripts/fix.mjs', description: 'Apply the fix script' }
      const id = await runBash(world, $, input)
      expect(
        await texts($, surface, {
          component: 'ToolResult',
          props: resultProps(id, 'Bash', world.answer(input)),
        }),
      ).toEqual(['Updated src/app.ts (+2 -1)', 'Created docs/new.md (+2 -0)'])
      const ui = await $.ui.mount({
        plugin: 'simple-view',
        surface,
        component: 'ToolResult',
        props: resultProps(id, 'Bash', world.answer(input)),
      })
      const block = (await ui.findAll({ type: 'Box' })).find(
        (box) => box.props.flexDirection === 'column',
      )
      expect(block?.props.paddingLeft).toBe(surface === 'terminal' ? 2 : 0)
      await ui.unmount()
    })
  }

  viewTest('names the files the diff left out', async (world, $) => {
    world.answer = () => answered('', { bashEditDiff: { ...EDIT_DIFF, moreFiles: 3 } })
    const input = { command: 'node fix.mjs', description: 'Fix' }
    const id = await runBash(world, $, input)
    expect(
      await texts($, 'terminal', {
        component: 'ToolResult',
        props: resultProps(id, 'Bash', world.answer(input)),
      }),
    ).toEqual([
      'Updated src/app.ts (+2 -1)',
      'Created docs/new.md (+2 -0)',
      'and 3 more changed files',
    ])
  })

  viewTest('says so when the engine did not track the file changes', async (world, $) => {
    world.answer = () => answered('', { bashEditDiff: { files: [], moreFiles: 0, skipped: true } })
    const input = { command: 'make', description: 'Build' }
    const id = await runBash(world, $, input)
    expect(
      await texts($, 'terminal', {
        component: 'ToolResult',
        props: resultProps(id, 'Bash', world.answer(input)),
      }),
    ).toEqual(['File changes were not tracked for this call'])
  })

  viewTest('draws no result line when the engine reports no bashEditDiff', async (world, $) => {
    world.answer = () => answered('')
    const input = { command: 'printf x >> notes.txt', description: 'Append a line' }
    const id = await runBash(world, $, input)
    const result = await drawn($, {
      component: 'ToolResult',
      props: resultProps(id, 'Bash', world.answer(input)),
    })
    expect(result.tree).toMatchObject({ type: 'Box' })
    expect(result.textCount).toBe(0)
  })

  viewTest('shows the meaning of a non-error exit code in place of exit 0', async (world, $) => {
    world.answer = () => answered('', { returnCodeInterpretation: 'No matches found' })
    const input = { command: 'grep -r zzz src', description: 'Search for zzz' }
    const id = await runBash(world, $, input)
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps(id, 'Bash', input, world.answer(input)),
      }),
    ).toEqual(['● Search for zzz grep No matches found 0 lines 0.0s'])
  })

  for (const surface of SURFACES) {
    viewTest(`shows exit N and the first error line on ${surface}`, async (world, $) => {
      world.delayMs = 15_000
      world.answer = () => failed('Error: Exit code 2\n\n  src/app.ts(3,1): error TS2304\nmore\n')
      const input = { command: 'npx tsc -p .', description: 'Type check the project' }
      const id = await runBash(world, $, input)
      const answer = world.answer(input)
      expect(
        await texts($, surface, {
          component: 'ToolUse',
          props: useProps(id, 'Bash', input, answer),
        }),
      ).toEqual([
        `${MARKER[surface]}Type check the project npx exit 2 src/app.ts(3,1): error TS2304 15s`,
      ])
      const ui = await $.ui.mount({
        plugin: 'simple-view',
        surface,
        component: 'ToolUse',
        props: useProps(id, 'Bash', input, answer),
      })
      expect((await ui.find({ type: 'Text', text: 'exit 2' }))?.props.color).toBe('error')
      await ui.unmount()
      const result = await drawn(
        $,
        { component: 'ToolResult', props: resultProps(id, 'Bash', answer) },
        surface,
      )
      expect(result.tree).toMatchObject({ type: 'Box' })
      expect(result.textCount).toBe(0)
    })
  }

  viewTest('names the stderr lines of a call that did not fail', async (world, $) => {
    world.answer = () => answered('', { stderr: '\nwarning: deprecated option --old\nuse --new\n' })
    const input = { command: 'tool --old', description: 'Run the tool' }
    const id = await runBash(world, $, input)
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps(id, 'Bash', input, world.answer(input)),
      }),
    ).toEqual([
      '● Run the tool tool exit 0 0 lines 2 stderr lines warning: deprecated option --old 0.0s',
    ])
    const ui = await $.ui.mount({
      plugin: 'simple-view',
      surface: 'terminal',
      component: 'ToolUse',
      props: useProps(id, 'Bash', input, world.answer(input)),
    })
    const line = await ui.find({ type: 'Text', text: 'warning: deprecated option --old' })
    expect(line?.props.dimColor).toBe(true)
    expect(line?.props.wrap).toBe('truncate-end')
    await ui.unmount()
  })

  viewTest('says the output was saved to a file in place of the count', async (world, $) => {
    world.answer = () =>
      answered('preview\n', { persistedOutputPath: '/work/app/.out/toolu_1.txt' })
    const input = { command: 'cat big.log', description: 'Print the log' }
    const id = await runBash(world, $, input)
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps(id, 'Bash', input, world.answer(input)),
      }),
    ).toEqual(['● Print the log cat exit 0 output saved to a file 0.0s'])
    expect(await commandText($, 'show 1')).toContain(
      'Full output saved to /work/app/.out/toolu_1.txt',
    )
  })

  viewTest('shows exit N alone when no error line follows', async (world, $) => {
    world.answer = () => failed('Error: Exit code 1')
    const input = { command: 'false', description: 'Fail' }
    const id = await runBash(world, $, input)
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps(id, 'Bash', input, world.answer(input)),
      }),
    ).toEqual(['● Fail false exit 1 0.0s'])
  })

  viewTest('shows the first command segment cut with an ellipsis', async (world, $) => {
    const input = { command: 'cd /work/app && npm test -- --watch=false' }
    const id = await runBash(world, $, input)
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps(id, 'Bash', input, world.answer(input)),
      }),
    ).toEqual(['● cd /work/app … npm exit 0 2 lines 0.0s'])
  })

  test('cuts a long first segment with an ellipsis', () => {
    const long = `git log --format=%H ${'a'.repeat(80)}`
    expect(commandLabel(long)).toBe(`${long.slice(0, 60)}…`)
    expect(commandLabel('ls -la')).toBe('ls -la')
  })

  viewTest('shows running and the time since its tool.call', async (world, $) => {
    world.delayMs = 5000
    const input = { command: 'sleep 5', description: 'Wait five seconds' }
    const pending = $.tool.call({ tool: 'Bash', ...input })
    await world.clock.settle()
    const id = world.ids.at(-1) ?? ''
    const running = useProps(
      id,
      'Bash',
      input,
      { result: undefined },
      {
        isRunning: true,
        output: undefined,
      },
    )
    expect(await texts($, 'terminal', { component: 'ToolUse', props: running })).toEqual([
      '● Wait five seconds sleep running 0.0s',
    ])
    await world.clock.advance(3000)
    expect(await texts($, 'terminal', { component: 'ToolUse', props: running })).toEqual([
      '● Wait five seconds sleep running 3.0s',
    ])
    await world.clock.advance(2000)
    await pending
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps(id, 'Bash', input, world.answer(input)),
      }),
    ).toEqual(['● Wait five seconds sleep exit 0 2 lines 5.0s'])
  })
})

const LONG_STDOUT = `${Array.from({ length: 140 }, (_, index) => `line ${String(index + 1)}`).join('\n')}\n`
const TESTS_RUN = { command: 'npm test', description: 'Run the unit tests' }
const FOLDED_ROW = '+●+ Run the unit tests  ~npm~  +exit 0+  ~140 lines~  ~3.0s~'

async function longCall(world: World, $: Engine) {
  world.delayMs = 3000
  world.answer = () => answered(LONG_STDOUT)
  const id = await runBash(world, $, TESTS_RUN)
  return useProps(id, 'Bash', TESTS_RUN, world.answer(TESTS_RUN))
}

async function mountUse($: Engine, props: RenderPropsOf['ToolUse'], surface: Surface = 'terminal') {
  return $.ui.mount({ plugin: 'simple-view', surface, component: 'ToolUse', props })
}

function numbered(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => `  ~line ${String(from + index)}~`)
}

describe('tool row fold and copy', () => {
  for (const surface of SURFACES) {
    viewTest(
      `a finished call with output draws more and copy on its row on ${surface}`,
      async (world, $) => {
        const ui = await mountUse($, await longCall(world, $), surface)
        const row = surface === 'terminal' ? FOLDED_ROW : FOLDED_ROW.slice('+●+ '.length)
        expect(sketch(await ui.drawn())).toEqual([edges(row, '[ more ] [ copy ]')])
        expect(
          (await ui.findAll({ type: 'Button' })).map((button) => button.props.dimColor),
        ).toEqual([true, true])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'more opens 20 lines under the row, all opens every line, less folds it',
    async (world, $) => {
      const ui = await mountUse($, await longCall(world, $))
      await ui.press({ key: 'fold' })
      expect(sketch(await ui.drawn())).toEqual([
        edges(FOLDED_ROW, '[ less ] [ copy ]'),
        ...numbered(1, 20),
        '  ~…~',
        '  [ all 140 lines ]',
      ])
      await ui.press({ key: 'all' })
      const all = sketch(await ui.drawn())
      expect(all).toEqual([edges(FOLDED_ROW, '[ less ] [ copy ]'), ...numbered(1, 140)])
      await ui.press({ key: 'fold' })
      expect(sketch(await ui.drawn())).toEqual([edges(FOLDED_ROW, '[ more ] [ copy ]')])
      await ui.unmount()
    },
  )

  viewTest('more on one row leaves every other row folded', async (world, $) => {
    const first = await mountUse($, await longCall(world, $))
    const second = await mountUse($, await longCall(world, $))
    await first.press({ key: 'fold' })
    expect(sketch(await second.drawn())).toEqual([edges(FOLDED_ROW, '[ more ] [ copy ]')])
    await first.unmount()
    await second.unmount()
  })

  viewTest('more on a short output opens every line and draws no all button', async (world, $) => {
    world.answer = () => answered('alpha\n\tbeta\n')
    const input = { command: 'ls', description: 'List files' }
    const id = await runBash(world, $, input)
    const ui = await mountUse($, useProps(id, 'Bash', input, world.answer(input)))
    await ui.press({ key: 'fold' })
    expect(sketch(await ui.drawn()).slice(1)).toEqual(['  ~alpha~', '  ~        beta~'])
    expect(await ui.find({ key: 'all' })).toBeUndefined()
    await ui.unmount()
  })

  viewTest('copy copies the full output of the call and says so', async (world, $) => {
    const ui = await mountUse($, await longCall(world, $))
    await ui.press({ key: 'copy' })
    expect(world.copies).toEqual([LONG_STDOUT.trimEnd()])
    expect(world.toasts).toEqual(['Copied 140 lines of output.'])
    await ui.unmount()
  })

  viewTest('copy takes the stderr lines after the stdout lines', async (world, $) => {
    world.answer = () => answered('built\n', { stderr: 'warning: old option\n' })
    const input = { command: 'make', description: 'Build' }
    const id = await runBash(world, $, input)
    const ui = await mountUse($, useProps(id, 'Bash', input, world.answer(input)))
    await ui.press({ key: 'copy' })
    expect(world.copies).toEqual(['built\nwarning: old option'])
    await ui.unmount()
  })

  viewTest('an exit N row opens and copies the error output', async (world, $) => {
    const error = 'Error: Exit code 2\n\n  src/app.ts(3,1): error TS2304\nmore\n'
    world.answer = () => failed(error)
    const input = { command: 'npx tsc -p .', description: 'Type check the project' }
    const id = await runBash(world, $, input)
    const ui = await mountUse($, useProps(id, 'Bash', input, world.answer(input)))
    await ui.press({ key: 'fold' })
    expect(sketch(await ui.drawn()).slice(1)).toEqual([
      '  ~  src/app.ts(3,1): error TS2304~',
      '  ~more~',
    ])
    await ui.press({ key: 'copy' })
    expect(world.copies).toEqual(['  src/app.ts(3,1): error TS2304\nmore'])
    await ui.unmount()
  })

  viewTest('copy of an output saved to a file copies the file', async (world, $) => {
    const path = `${ROOT}/.tool-results/out.txt`
    world.files[path] = 'all\nof\nit\n'
    world.answer = () => answered('all\n', { persistedOutputPath: path })
    const input = { command: 'cat big.log', description: 'Print the log' }
    const id = await runBash(world, $, input)
    const ui = await mountUse($, useProps(id, 'Bash', input, world.answer(input)))
    await ui.press({ key: 'fold' })
    expect(sketch(await ui.drawn()).slice(1)).toEqual([
      '  ~all~',
      `  ~The full output is in ${path}. Copy takes all of it.~`,
    ])
    await ui.press({ key: 'copy' })
    expect(world.copies).toEqual(['all\nof\nit\n'])
    expect(world.toasts).toEqual(['Copied 4 lines of output.'])
    await ui.unmount()
  })

  viewTest('says why a copy failed', async (world, $) => {
    const ui = await mountUse($, await longCall(world, $))
    world.copyRefusal = 'no-clipboard'
    await ui.press({ key: 'copy' })
    expect(world.toasts).toEqual([
      'Not copied: the clipboard took nothing. The text may be too long for this terminal.',
    ])
    await ui.unmount()
  })

  viewTest('says that a saved output it cannot read was not copied', async (world, $) => {
    world.answer = () => answered('x\n', { persistedOutputPath: `${ROOT}/gone.txt` })
    const input = { command: 'cat big.log', description: 'Print the log' }
    const id = await runBash(world, $, input)
    const ui = await mountUse($, useProps(id, 'Bash', input, world.answer(input)))
    await ui.press({ key: 'copy' })
    expect(world.copies).toEqual([])
    expect(world.toasts).toEqual(['Not copied. The debug log says why.'])
    expect(
      world.logs.some((line) => line.startsWith('simple-view: the output was not copied')),
    ).toBe(true)
    await ui.unmount()
  })

  viewTest('shows hidden characters as escapes and drops colour codes', async (world, $) => {
    world.answer = () => answered('\u001b[32mok\u001b[0m\u200b\n10%\r100%\n')
    const input = { command: 'npm ci', description: 'Install' }
    const id = await runBash(world, $, input)
    const ui = await mountUse($, useProps(id, 'Bash', input, world.answer(input)))
    await ui.press({ key: 'fold' })
    expect(sketch(await ui.drawn()).slice(1)).toEqual(['  ~ok\\u200b~', '  ~100%~'])
    await ui.unmount()
  })

  viewTest('a call with no output draws no buttons', async (world, $) => {
    world.answer = () => answered('')
    const input = { command: 'true', description: 'Do nothing' }
    const id = await runBash(world, $, input)
    const quiet = await mountUse($, useProps(id, 'Bash', input, world.answer(input)))
    expect(await quiet.findAll({ type: 'Button' })).toEqual([])
    await quiet.unmount()
  })

  viewTest(
    'a running call draws one row with a dim running state and its full command behind more',
    async (world, $) => {
      world.delayMs = 4000
      const command = 'git add -A\ngit commit -m "save"\ngit push'
      const input = { command, description: 'Commit and push the work' }
      const pending = $.tool.call({ tool: 'Bash', ...input })
      await world.clock.settle()
      await world.clock.advance(3000)
      const id = world.ids.at(-1) ?? ''
      const props = useProps(
        id,
        'Bash',
        input,
        { result: undefined },
        { isRunning: true, output: undefined },
      )
      const ui = await mountUse($, props)
      const row = '● Commit and push the work  ~git~  ~running~  ~3.0s~'
      expect(sketch(await ui.drawn())).toEqual([edges(row, '[ more ]')])
      await ui.press({ key: 'fold' })
      expect(sketch(await ui.drawn())).toEqual([
        edges(row, '[ less ]'),
        '  ~git add -A~',
        '  ~git commit -m "save"~',
        '  ~git push~',
      ])
      await ui.unmount()
      await world.clock.advance(1000)
      await pending
    },
  )
})

describe('Edit and Write rows', () => {
  const patch = [
    { oldStart: 4, oldLines: 2, newStart: 4, newLines: 3, lines: [' x', '-y', '+y2', '+z'] },
  ]
  const edit = {
    filePath: `${ROOT}/src/app.ts`,
    oldString: 'y',
    newString: 'y2\nz',
    originalFile: 'x\ny\n',
    structuredPatch: patch,
    userModified: false,
    replaceAll: false,
  }

  for (const surface of SURFACES) {
    viewTest(`draws an Edit as its path and totals on ${surface}`, async (_world, $) => {
      const answer = { result: edit } as Answer
      const input = { file_path: edit.filePath, old_string: 'y', new_string: 'y2\nz' }
      expect(
        await texts($, surface, {
          component: 'ToolUse',
          props: useProps('toolu_e1', 'Edit', input, answer),
        }),
      ).toEqual([`${MARKER[surface]}Edit src/app.ts +2 -1`])
      const result = await drawn(
        $,
        { component: 'ToolResult', props: resultProps('toolu_e1', 'Edit', answer) },
        surface,
      )
      expect(result.tree).toMatchObject({ type: 'Box' })
      expect(result.textCount).toBe(0)
    })
  }

  viewTest('counts the lines of a new file', async (_world, $) => {
    const answer = {
      result: {
        type: 'create',
        filePath: `${ROOT}/docs/new.md`,
        content: 'a\nb\nc\n',
        structuredPatch: [],
        originalFile: null,
      },
    } as Answer
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps('toolu_w1', 'Write', { file_path: `${ROOT}/docs/new.md` }, answer),
      }),
    ).toEqual(['● Write docs/new.md +3 -0'])
  })

  viewTest('counts trailing blank lines of a new file as the diff does', async (world, $) => {
    const result = {
      type: 'create',
      filePath: `${ROOT}/docs/blank.md`,
      content: 'x\n\n\n\n',
      structuredPatch: [],
      originalFile: null,
    }
    world.answer = () => ({ result })
    await runTool(world, $, { tool: 'Write', file_path: result.filePath, content: result.content })
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps('toolu_w3', 'Write', { file_path: result.filePath }, { result }),
      }),
    ).toEqual(['● Write docs/blank.md +4 -0'])
    expect(await commandText($, 'show 1')).toContain('@@ -0,0 +1,4 @@\n+x\n+\n+\n+')
  })

  viewTest('shows the path alone when the totals are not known', async (_world, $) => {
    const answer = {
      result: {
        type: 'update',
        filePath: '/elsewhere/big.json',
        content: '{}',
        structuredPatch: [],
        originalFile: null,
      },
    } as Answer
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps('toolu_w2', 'Write', { file_path: '/elsewhere/big.json' }, answer),
      }),
    ).toEqual(['● Write /elsewhere/big.json'])
  })

  viewTest('passes a staged edit on unchanged', async (_world, $) => {
    const answer = { result: { ...edit, staged: true } } as Answer
    const target = {
      component: 'ToolUse',
      props: useProps('toolu_e2', 'Edit', {}, answer),
    } as const
    expect((await drawn($, target)).tree).toEqual(ENGINE_ROW)
  })
})

describe('quiet-items rows', () => {
  viewTest('pass ToolUse and ToolResult on unchanged', async (world, $) => {
    const input = { command: QUIET_COMMAND, description: 'Close the item' }
    const quiet = await runBash(world, $, input)
    const plain = await runBash(world, $, { command: 'br show handily-ab12', description: 'Show' })
    const answer = world.answer(input)
    expect(
      (await drawn($, { component: 'ToolUse', props: useProps(quiet, 'Bash', input, answer) }))
        .tree,
    ).toEqual(ENGINE_ROW)
    expect(
      (await drawn($, { component: 'ToolResult', props: resultProps(quiet, 'Bash', answer) })).tree,
    ).toEqual(ENGINE_ROW)
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps(
          plain,
          'Bash',
          { command: 'br show handily-ab12', description: 'Show' },
          answer,
        ),
      }),
    ).toEqual(['● Show br exit 0 2 lines 0.0s'])
  })

  viewTest('draw the simple row while the quiet-items mode is off', async (world, $) => {
    const input = { command: QUIET_COMMAND, description: 'Close the item' }
    const quiet = await runBash(world, $, input)
    expect(await commandText($, 'off', QUIET_MODE_COMMAND)).toBe('quiet-items mode off')
    expect(
      await texts($, 'terminal', {
        component: 'ToolUse',
        props: useProps(quiet, 'Bash', input, world.answer(input)),
      }),
    ).toEqual(['● Close the item br exit 0 2 lines 0.0s'])
  })
})

describe('/simple', () => {
  viewTest('toggles the mode and every row follows it', async (world, $) => {
    const input = { command: 'ls', description: 'List files' }
    const id = await runBash(world, $, input)
    const answer = world.answer(input)
    const use = { component: 'ToolUse', props: useProps(id, 'Bash', input, answer) } as const
    const result = { component: 'ToolResult', props: resultProps(id, 'Bash', answer) } as const
    expect(await commandText($, '')).toBe(
      'off for this session. Tool calls draw as Claude Code draws them.',
    )
    expect((await drawn($, use)).tree).toEqual(ENGINE_ROW)
    expect((await drawn($, result)).tree).toEqual(ENGINE_ROW)
    expect(await commandText($, '')).toBe(
      'on for this session. Bash, Edit and Write calls draw as one row. /simple show N prints call N in full, where 1 is the last call.',
    )
    expect(await texts($, 'terminal', use)).toEqual(['● List files ls exit 0 2 lines 0.0s'])
  })

  viewTest('leaves the quiet-items mode to quiet-items', async (_world, $) => {
    await commandText($, '')
    expect(await commandText($, '', QUIET_MODE_COMMAND)).toBe('quiet-items mode on')
  })

  test(
    'writes off and then on, the mode values that quiet-items reads',
    { plugins: [fakeQuietItems] },
    async ($, on) => {
      engineBeneath(on)
      const written: unknown[] = []
      on('state.set', { plugin: 'simple-view', key: 'mode' }, (_$, e, next) => {
        written.push(e.value)
        return next(e)
      })
      await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
      await commandText($, '')
      await commandText($, '')
      const quietItemsReads: QuietItemsSimpleViewMode[] = ['off', 'on']
      expect(written).toEqual(quietItemsReads)
    },
  )

  viewTest('refuses an argument it does not know', async (_world, $) => {
    const usage =
      '/simple takes no argument, or show N. /simple toggles this session; /simple show N prints the N-th last tool call in full.'
    expect(await commandText($, 'off')).toBe(usage)
    expect(await commandText($, 'show 1 2')).toBe(usage)
  })
})

describe('/simple show', () => {
  viewTest('says so before any tool call', async (_world, $) => {
    expect(await commandText($, 'show 1')).toBe(
      '/simple show has no tool call to print yet in this session.',
    )
  })

  viewTest('prints the input, output and file diff of the N-th last call', async (world, $) => {
    world.answer = () => answered('first\n')
    await runBash(world, $, { command: 'echo first', description: 'Say first' })
    world.answer = () => answered('done\n', { bashEditDiff: EDIT_DIFF })
    world.delayMs = 2500
    await runBash(world, $, { command: 'node fix.mjs', description: 'Fix' })
    world.delayMs = 0
    world.answer = () => failed('Error: Exit code 1\nnope')
    await runBash(world, $, { command: 'false', description: 'Fail' })

    const second = await commandText($, 'show 2')
    expect(second).toContain('Call 2 of the last 3 (1 is the last): Bash, answered, 2.5s')
    expect(second).toContain('"command": "node fix.mjs"')
    expect(second).toContain('"description": "Fix"')
    expect(second).toContain('```text\ndone\n\n```')
    expect(second).toContain(
      `--- ${ROOT}/src/app.ts\n+++ ${ROOT}/src/app.ts\n@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e`,
    )
    expect(second).toContain(`--- ${ROOT}/docs/new.md`)
    const last = await commandText($, 'show 1')
    expect(last).toContain('Call 1 of the last 3 (1 is the last): Bash, errored, 0.0s')
    expect(last).toContain('Error: Exit code 1\nnope')
    expect(last).toContain('File diff: not reported by the engine.')
    expect(last).not.toContain('File diff: none.')
    expect(await commandText($, 'show 3')).toContain('"command": "echo first"')
  })

  viewTest('says the engine reported no file diff for an errored Bash call', async (world, $) => {
    world.answer = () => failed('Error: Exit code 1\n')
    await runBash(world, $, { command: 'echo x > f; false', description: 'Write then fail' })
    const shown = await commandText($, 'show 1')
    expect(shown).toContain('File diff: not reported by the engine.')
    expect(shown).not.toContain('File diff: none.')
  })

  for (const flag of ['unavailable', 'skipped'] as const) {
    viewTest(`says the engine did not track the file diff when it is ${flag}`, async (world, $) => {
      world.answer = () => answered('', { bashEditDiff: { files: [], moreFiles: 0, [flag]: true } })
      await runBash(world, $, { command: 'make', description: 'Build' })
      const shown = await commandText($, 'show 1')
      expect(shown).toContain('File diff: not tracked by the engine.')
      expect(shown).not.toContain('File diff: none.')
    })
  }

  viewTest('says the engine reported no file diff when the diff is malformed', async (world, $) => {
    world.answer = () => answered('done\n', { bashEditDiff: { files: 'src/app.ts' } })
    await runBash(world, $, { command: 'make', description: 'Build' })
    const shown = await commandText($, 'show 1')
    expect(shown).toContain('File diff: not reported by the engine.')
    expect(shown).not.toContain('File diff: none.')
  })

  viewTest(
    'says the engine reported no file diff for a Bash output without one',
    async (world, $) => {
      world.answer = () => answered('done\n')
      await runBash(world, $, { command: 'printf x >> notes.txt', description: 'Append a line' })
      const shown = await commandText($, 'show 1')
      expect(shown).toContain('File diff: not reported by the engine.')
      expect(shown).not.toContain('File diff: none.')
    },
  )

  viewTest('says none for a Bash output with an empty file diff', async (world, $) => {
    world.answer = () => answered('done\n', { bashEditDiff: { files: [], moreFiles: 0 } })
    await runBash(world, $, { command: 'ls', description: 'List files' })
    const shown = await commandText($, 'show 1')
    expect(shown).toContain('File diff: none.')
    expect(shown).not.toContain('not reported by the engine')
  })

  viewTest('refuses a number out of range and gives the range', async (world, $) => {
    await runBash(world, $, { command: 'ls' })
    await runBash(world, $, { command: 'pwd' })
    const range = '/simple show takes a call number from 1 to 2, where 1 is the last tool call.'
    expect(await commandText($, 'show 3')).toBe(`No call 3 is kept. ${range}`)
    expect(await commandText($, 'show 0')).toBe(`No call 0 is kept. ${range}`)
    expect(await commandText($, 'show')).toBe(range)
    expect(await commandText($, 'show last')).toBe(range)
  })

  viewTest('keeps the last 50 calls and cuts each part', async (world, $) => {
    world.answer = () => answered('x'.repeat(9000))
    for (let index = 0; index < 52; index += 1) {
      await runBash(world, $, { command: `echo ${String(index)}` })
    }
    const range = '/simple show takes a call number from 1 to 50, where 1 is the last tool call.'
    expect(await commandText($, 'show 51')).toBe(`No call 51 is kept. ${range}`)
    const oldest = await commandText($, 'show 50')
    expect(oldest).toContain('"command": "echo 2"')
    expect(oldest).toContain(
      `${'x'.repeat(8000)}\n[simple-view kept the first 8000 characters; 1000 more were cut]`,
    )
    expect(await commandText($, 'show 1')).toContain('"command": "echo 51"')
  })

  viewTest('never shows an older call kept in the same slot', async (world, $) => {
    for (let index = 0; index < 50; index += 1) {
      await runBash(world, $, { command: `echo ${String(index)}` })
    }
    world.isCallWriteRefused = true
    await runBash(world, $, { command: 'echo lost' })
    const range = '/simple show takes a call number from 1 to 50, where 1 is the last tool call.'
    expect(await commandText($, 'show 1')).toBe(`No call 1 is kept. ${range}`)
    expect(await commandText($, 'show 51')).toBe(`No call 51 is kept. ${range}`)
    expect(await commandText($, 'show 2')).toContain('"command": "echo 49"')
    expect(world.logs.some((line) => line.startsWith('simple-view: /simple show misses'))).toBe(
      true,
    )
  })

  viewTest('prints the content of a new file as its diff', async (world, $) => {
    world.answer = () => ({
      result: {
        type: 'create',
        filePath: `${ROOT}/docs/new.md`,
        content: 'a\nb\n',
        structuredPatch: [],
        originalFile: null,
      },
    })
    await runTool(world, $, { tool: 'Write', file_path: `${ROOT}/docs/new.md`, content: 'a\nb\n' })
    expect(await commandText($, 'show 1')).toContain(
      `--- /dev/null\n+++ ${ROOT}/docs/new.md\n@@ -0,0 +1,2 @@\n+a\n+b`,
    )
  })

  for (const reason of ['clear', 'resume', 'other'] as const) {
    viewTest(`forgets the calls and their times at a session end (${reason})`, async (world, $) => {
      world.delayMs = 1500
      const input = { command: 'ls', description: 'List files' }
      const id = await runBash(world, $, input)
      world.delayMs = 0
      const use = {
        component: 'ToolUse',
        props: useProps(id, 'Bash', input, world.answer(input)),
      } as const
      expect(await texts($, 'terminal', use)).toEqual(['● List files ls exit 0 2 lines 1.5s'])
      await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
      expect(await commandText($, 'show 1')).toBe(
        '/simple show has no tool call to print yet in this session.',
      )
      expect(await texts($, 'terminal', use)).toEqual(['● List files ls exit 0 2 lines'])
      await runBash(world, $, { command: 'pwd', description: 'Print the folder' })
      const range = '/simple show takes a call number from 1 to 1, where 1 is the last tool call.'
      expect(await commandText($, 'show 2')).toBe(`No call 2 is kept. ${range}`)
      expect(await commandText($, 'show 1')).toContain('"command": "pwd"')
    })
  }

  viewTest('never shows a call of an ended session', async (world, $) => {
    await runBash(world, $, { command: 'echo before' })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    world.isCallWriteRefused = true
    await runBash(world, $, { command: 'echo after' })
    const range = '/simple show takes a call number from 1 to 1, where 1 is the last tool call.'
    expect(await commandText($, 'show 1')).toBe(`No call 1 is kept. ${range}`)
  })

  viewTest('keeps a call that was refused', async (world, $) => {
    world.answer = () => ({ deny: 'not in this folder' })
    await runTool(world, $, { tool: 'Read', file_path: '/etc/hosts' })
    const text = await commandText($, 'show 1')
    expect(text).toContain('Read, errored')
    expect(text).toContain('Refused: not in this folder')
  })
})

describe('folded tool group', () => {
  for (const surface of SURFACES) {
    viewTest(`unfolds a group that holds a failed call on ${surface}`, async (world, $) => {
      expect(await groupExpansion(world, $, group([LISTED, MISSING]), surface)).toEqual([true])
    })
  }

  viewTest('leaves a group without a failed call folded', async (world, $) => {
    expect(await groupExpansion(world, $, group([LISTED]))).toEqual([false])
  })

  viewTest('leaves a group folded while its failed call still runs', async (world, $) => {
    const running = { ...MISSING, isRunning: true, output: undefined }
    expect(await groupExpansion(world, $, group([LISTED, running]))).toEqual([false])
  })

  viewTest('unfolds the live group while a Bash call in it runs', async (world, $) => {
    const running = { ...LISTED, isRunning: true, output: undefined }
    const live = { ...group([LISTED, running]), isActive: true }
    expect(await groupExpansion(world, $, live)).toEqual([true])
  })

  viewTest('leaves the live group folded when no call in it runs', async (world, $) => {
    expect(await groupExpansion(world, $, { ...group([LISTED]), isActive: true })).toEqual([false])
  })

  viewTest(
    'leaves the live group folded while its running call runs in the background',
    async (world, $) => {
      const background = {
        ...LISTED,
        input: { command: 'npm run dev', run_in_background: true },
        isRunning: true,
        output: undefined,
      }
      const live = { ...group([background]), isActive: true }
      expect(await groupExpansion(world, $, live)).toEqual([false])
    },
  )

  viewTest('leaves the live group folded while the mode is off', async (world, $) => {
    await commandText($, '')
    const running = { ...LISTED, isRunning: true, output: undefined }
    expect(await groupExpansion(world, $, { ...group([running]), isActive: true })).toEqual([false])
  })

  viewTest('leaves an unfolded group as it is', async (world, $) => {
    expect(await groupExpansion(world, $, group([LISTED], true))).toEqual([true])
  })

  viewTest('leaves every group folded while the mode is off', async (world, $) => {
    await commandText($, '')
    expect(await groupExpansion(world, $, group([LISTED, MISSING]))).toEqual([false])
    expect(await groupExpansion(world, $, group([LISTED]))).toEqual([false])
  })

  viewTest('leaves the group folded when the mode cannot be read', async (world, $) => {
    world.isModeReadRefused = true
    expect(await groupExpansion(world, $, group([LISTED, MISSING]))).toEqual([false])
    expect(world.logs.some((line) => line.startsWith('simple-view: the engine folds'))).toBe(true)
  })
})

describe('fallback to the engine row', () => {
  viewTest('when the call was interrupted', async (world, $) => {
    const input = { command: 'sleep 60', description: 'Wait' }
    const id = await runBash(world, $, input)
    const props = useProps(id, 'Bash', input, failed('Error: Exit code 130\n^C'), {
      isInterrupted: true,
    })
    expect((await drawn($, { component: 'ToolUse', props })).tree).toEqual(ENGINE_ROW)
    expect(
      (
        await drawn($, {
          component: 'ToolResult',
          props: resultProps(id, 'Bash', failed('Interrupted by user')),
        })
      ).tree,
    ).toEqual(ENGINE_ROW)
  })

  viewTest('when the call was refused', async (world, $) => {
    const refusal = failed("The user doesn't want to proceed with this tool use.")
    world.answer = () => refusal
    const input = { command: 'rm notes.md', description: 'Remove the notes' }
    const id = await runBash(world, $, input)
    expect(
      (await drawn($, { component: 'ToolUse', props: useProps(id, 'Bash', input, refusal) })).tree,
    ).toEqual(ENGINE_ROW)
    expect(
      (await drawn($, { component: 'ToolResult', props: resultProps(id, 'Bash', refusal) })).tree,
    ).toEqual(ENGINE_ROW)
  })

  viewTest('when the call runs in the background', async (world, $) => {
    world.answer = () => answered('', { backgroundTaskId: 'b1' })
    const input = { command: 'npm run dev', description: 'Start', run_in_background: true }
    const id = await runBash(world, $, input)
    expect(
      (
        await drawn($, {
          component: 'ToolUse',
          props: useProps(id, 'Bash', input, world.answer(input)),
        })
      ).tree,
    ).toEqual(ENGINE_ROW)
  })

  viewTest('when the output is not a shape it reads', async (world, $) => {
    const input = { command: 'ls', description: 'List' }
    const id = await runBash(world, $, input)
    const odd = { result: { stdout: 3 } } as unknown as Answer
    expect(
      (await drawn($, { component: 'ToolUse', props: useProps(id, 'Bash', input, odd) })).tree,
    ).toEqual(ENGINE_ROW)
    expect(
      (await drawn($, { component: 'ToolUse', props: useProps(id, 'Read', {}, odd) })).tree,
    ).toEqual(ENGINE_ROW)
    const oddInput = { command: 'ls', description: 3 }
    expect(
      (
        await drawn($, {
          component: 'ToolUse',
          props: useProps(id, 'Bash', oddInput, world.answer(input)),
        })
      ).tree,
    ).toEqual(ENGINE_ROW)
    expect(world.logs).toEqual([])
  })

  viewTest('when drawing throws', async (world, $) => {
    world.isRootRefused = true
    const answer = {
      result: {
        filePath: `${ROOT}/a.ts`,
        oldString: 'a',
        newString: 'b',
        originalFile: 'a',
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] },
        ],
        userModified: false,
        replaceAll: false,
      },
    } as Answer
    const props = useProps('toolu_e9', 'Edit', {}, answer)
    expect((await drawn($, { component: 'ToolUse', props })).tree).toEqual(ENGINE_ROW)
    expect(
      world.logs.some((line) => line.startsWith('simple-view: the engine draws toolu_e9')),
    ).toBe(true)
  })
})

describe('ready value for /handily', () => {
  test(
    'writes the ready value that /handily reads when the session starts',
    { plugins: [fakeQuietItems] },
    async ($, on) => {
      engineBeneath(on)
      const ready: unknown[] = []
      on('state.set', { plugin: 'simple-view', key: 'ready' }, (_$, e, next) => {
        ready.push(e.value)
        return next(e)
      })
      await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
      expect(ready).toEqual([{ root: expect.stringMatching(/[\\/]simple-view$/) }])
    },
  )
})
