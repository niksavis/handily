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
    on('command.run', { command: modeCommand }, async ($) => {
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
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.root', () =>
    world.isRootRefused ? { deny: 'the fake root is unavailable' } : { value: ROOT },
  )
  on('state.set', (_$, e, next) =>
    world.isCallWriteRefused && e.plugin === 'simple-view' && e.key === 'calls'
      ? { deny: 'the fake state refuses the write' }
      : next(e),
  )
  on('tool.call', async (_$, e) => {
    world.ids.push(e.tool_use_id)
    if (world.delayMs > 0) await world.clock.sleep(world.delayMs)
    return world.answer(e)
  })
  on('ui.render', () => ENGINE_ROW)
  on('ui.log', (_$, e) => {
    world.logs.push(e.text)
    return { value: undefined }
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
    expect(last).toContain('File diff: none.')
    expect(await commandText($, 'show 3')).toContain('"command": "echo first"')
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

  viewTest('keeps a call that was refused', async (world, $) => {
    world.answer = () => ({ deny: 'not in this folder' })
    await runTool(world, $, { tool: 'Read', file_path: '/etc/hosts' })
    const text = await commandText($, 'show 1')
    expect(text).toContain('Read, errored')
    expect(text).toContain('Refused: not in this folder')
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
