import type { ConfigRow, On, RenderPropsOf, RenderSurface, ToolCallResult } from 'claude-code'
import { describe, expect, mock, test, type Engine, type MockClock } from 'claude-code/testing'
import { JEST_ONE_FAILED } from './fixtures/jest'
import { NODE_CALC_FAIL, NODE_SPEC_FAIL } from './fixtures/node'
import { PYTEST_ONE_FAILED, PYTEST_QUIET_FAILED } from './fixtures/pytest'
import { CARGO_FAILED, LISTING, MOCHA_PASSED, PASS_LINES } from './fixtures/unknown'
import {
  VITEST_NO_FILES,
  VITEST_ONE_FAILED,
  VITEST_PASSED,
  VITEST_SUITE_FAILED,
  VITEST_TWO_FAILED,
} from './fixtures/vitest'
import { displayWidth } from './hooks/width'

const ROOT = '/work/app'
const PLUGIN = 'handily-tests'
const PANE = 'tests'
const SURFACES: readonly RenderSurface[] = ['terminal', 'desktop']
const START = 1_000_000
const RULE_41 = '─'.repeat(41)
const NERD_BLOCKED = '\u{EA87}'
const INTERRUPT_MARK = '[Request interrupted by user for tool use]'

type BashAnswer =
  | {
      kind: 'ok'
      stdout: string
      interrupted?: boolean
      backgroundTaskId?: string
      persistedOutputPath?: string
    }
  | { kind: 'error'; text: string }

type World = {
  clock: MockClock
  answers: Map<string, { answer: BashAnswer; tookMs: number }>
  statuses: (string | undefined)[]
  toasts: string[]
  logs: string[]
  panes: Set<string>
  shown: string | undefined
  opens: { id: string; focus: boolean }[]
  closes: string[]
  copies: string[]
  copyRefusal: 'no-clipboard' | undefined
  commands: string[]
  config: ConfigRow[]
}

function world(on: On): World {
  const seen: World = {
    clock: mock.clock(on, { now: START }),
    answers: new Map(),
    statuses: [],
    toasts: [],
    logs: [],
    panes: new Set(),
    shown: undefined,
    opens: [],
    closes: [],
    copies: [],
    copyRefusal: undefined,
    commands: [],
    config: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    seen.panes.add(e.id)
    seen.opens.push({ id: e.id, focus: e.focus === true })
    seen.shown = e.id
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    seen.panes.delete(e.id)
    seen.closes.push(e.id)
    if (seen.shown === e.id) seen.shown = undefined
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...seen.panes].map((id) => ({
      id,
      title: id,
      isShown: id === seen.shown,
      isFocused: false,
      isPlaced: true,
    })),
  }))
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    seen.copies.push(e.text)
    if (seen.copyRefusal !== undefined) {
      return { value: { isCopied: false as const, reason: seen.copyRefusal } }
    }
    return { value: { isCopied: true as const } }
  })
  on('config.list', () => ({ value: seen.config }))
  on('agent.list', () => ({
    value: [
      {
        id: 'agent-1',
        name: 'scout',
        description: 'Check the login',
        type: 'Explore',
        status: 'running' as const,
      },
    ],
  }))
  on('tool.call', async (_$, e): Promise<ToolCallResult> => {
    if (e.tool !== 'Bash') return { deny: `the test answers only Bash, not ${e.tool}` }
    const found = seen.answers.get(e.command)
    if (found === undefined) return { deny: `the test has no answer for ${e.command}` }
    if (found.tookMs > 0) await seen.clock.sleep(found.tookMs)
    const { answer } = found
    if (answer.kind === 'error') return { isError: true, result: answer.text, text: answer.text }
    return {
      result: {
        stdout: answer.stdout,
        stderr: '',
        interrupted: answer.interrupted === true,
        ...(answer.backgroundTaskId === undefined
          ? {}
          : { backgroundTaskId: answer.backgroundTaskId }),
        ...(answer.persistedOutputPath === undefined
          ? {}
          : { persistedOutputPath: answer.persistedOutputPath }),
      },
    }
  })
  return seen
}

function answer(seen: World, command: string, reply: BashAnswer, tookMs = 0): void {
  seen.answers.set(command, { answer: reply, tookMs })
}

function failing(text: string): BashAnswer {
  return { kind: 'error', text: `Exit code 1\n${text}` }
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

async function bash($: Engine, command: string, extra: { agentId?: string } = {}): Promise<void> {
  await $.tool.call({ tool: 'Bash', command, ...extra })
}

async function tests($: Engine, args: string): Promise<string> {
  const result = await $.command.run({
    command: 'tests',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  return result.text ?? ''
}

function paneProps(placement: 'dock' | 'inline', bodyColumns: number): RenderPropsOf['Pane'] {
  return {
    title: PANE,
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  }
}

async function mountTests(
  $: Engine,
  surface: RenderSurface,
  placement: 'dock' | 'inline' = 'dock',
  columns = 41,
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: paneProps(placement, columns),
  })
}

type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }

function isDrawn(value: unknown): value is Drawn {
  return typeof value === 'object' && value !== null && 'type' in value
}

function propsOf(node: Drawn): Record<string, unknown> {
  return node.props ?? {}
}

function childrenOf(node: Drawn): unknown[] {
  return Array.isArray(node.children) ? node.children : []
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (!isDrawn(node)) return ''
  const props = propsOf(node)
  if (node.type === 'Button' && props.plain !== true) return `[ ${String(props.label)} ]`
  return childrenOf(node).map(textOf).join('')
}

function linesOf(node: unknown): string[] {
  if (!isDrawn(node)) return [textOf(node)]
  const props = propsOf(node)
  if (node.type === 'Code') return String(props.source).split('\n').slice(1)
  if (node.type !== 'Box' || props.flexDirection === 'row') return [textOf(node)]
  const indent = typeof props.paddingLeft === 'number' ? props.paddingLeft : 0
  return childrenOf(node)
    .flatMap(linesOf)
    .map((line) => `${' '.repeat(indent)}${line}`)
}

async function screen(ui: { drawn: () => Promise<unknown> }, columns = 41): Promise<string[]> {
  const lines = linesOf(await ui.drawn()).map((line) => line.trimEnd())
  for (const line of lines) {
    expect(displayWidth(line) <= columns, `"${line}" is wider than ${String(columns)}`).toBe(true)
  }
  return lines
}

const ONE_FAILED_SCREEN = [
  'Tests  ■ 1 failed · 3 of 4 passed',
  'vitest · npm test · 0s ago · 1.4s',
  RULE_41,
  '■ adds two numbers        math.test.ts:12',
  '    expected 5 to be 4',
  '    - Expected',
  '    + Received',
  '    - 4',
  '    + 5',
  '    [ copy ]',
  '+3 passed',
]

describe('the tests tab lists each failed test by name', () => {
  for (const surface of SURFACES) {
    test(`vitest under npm test on the ${surface}: name, file, line and diff`, async ($, on) => {
      const seen = world(on)
      answer(seen, 'npm test', failing(VITEST_ONE_FAILED), 1400)
      await start($)
      const call = bash($, 'npm test')
      await seen.clock.advance(1400)
      await call
      const ui = await mountTests($, surface)
      expect(await screen(ui)).toEqual(ONE_FAILED_SCREEN)
    })

    test(`jest, node --test and pytest on the ${surface}`, async ($, on) => {
      const seen = world(on)
      answer(seen, 'npx jest', failing(JEST_ONE_FAILED))
      answer(seen, 'node --test', failing(NODE_SPEC_FAIL))
      answer(seen, 'pytest', failing(PYTEST_ONE_FAILED))
      await start($)
      await bash($, 'npx jest')
      const ui = await mountTests($, surface)
      expect((await screen(ui)).slice(0, 8)).toEqual([
        'Tests  ■ 1 failed · 3 of 4 passed',
        'jest · npx jest · 0s ago · 0.0s',
        RULE_41,
        '■ adds two numbers        math.test.js:12',
        '    expect(received).toBe(expected)',
        '    Expected: 4',
        '    Received: 5',
        '    [ copy ]',
      ])
      await bash($, 'node --test')
      expect((await screen(ui)).slice(0, 8)).toEqual([
        'Tests  ■ 2 failed · 2 of 4 passed',
        'node · node --test · 0s ago · 0.0s',
        RULE_41,
        '■ adds two numbers        math.test.mjs:5',
        '    Expected values to be strictly equal:',
        '    5 !== 4',
        '    [ copy ]',
        '■ parses a table         math.test.mjs:12',
      ])
      await bash($, 'pytest')
      expect((await screen(ui)).slice(0, 7)).toEqual([
        'Tests  ■ 1 failed · 3 of 4 passed',
        'pytest · pytest · 0s ago · 0.0s',
        RULE_41,
        '■ test_adds_two_numbers   test_math.py:12',
        '    assert 5 == 4',
        '    +  where 5 = add(2, 3)',
        '    [ copy ]',
      ])
    })
  }

  test('a press on another failure opens it, and a second press closes it', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_TWO_FAILED))
    await start($)
    await bash($, 'npm test')
    const ui = await mountTests($, 'terminal')
    await ui.press({ key: 'failure:1' })
    expect((await screen(ui)).slice(3)).toEqual([
      '■ adds two numbers        math.test.ts:12',
      '■ parses an empty table…  table.test.ts:8',
      "    expected [] to deeply equal [ '' ]",
      '    - Expected',
      '    + Received',
      '    - [',
      '    -   "",',
      '    - ]',
      '    + []',
      '    [ copy ]',
      '+3 passed',
    ])
    await ui.press({ key: 'failure:1' })
    expect((await screen(ui)).slice(3)).toEqual([
      '■ adds two numbers        math.test.ts:12',
      '■ parses an empty table…  table.test.ts:8',
      '+3 passed',
    ])
  })

  test('shows 5 failures before the fold and the rest behind a button', async ($, on) => {
    const seen = world(on)
    const many = Array.from({ length: 7 }, (_, index) =>
      [
        ` FAIL  src/math.test.ts > math > case ${String(index + 1)}`,
        `AssertionError: expected ${String(index)} to be 9`,
        ` \u{276F} src/math.test.ts:${String(index + 10)}:5`,
      ].join('\n'),
    ).join('\n\n')
    const text = ` RUN  v3.2.4 /work/app\n\n${many}\n\n Test Files  1 failed (1)\n      Tests  7 failed | 3 passed (10)\n`
    answer(seen, 'npm test', failing(text))
    await start($)
    await bash($, 'npm test')
    const ui = await mountTests($, 'terminal')
    const lines = await screen(ui)
    expect(lines.filter((line) => line.startsWith('■ case'))).toHaveLength(5)
    expect(lines).toContain('[ +2 more failed ]')
    await ui.press({ key: 'more' })
    expect((await screen(ui)).filter((line) => line.startsWith('■ case'))).toHaveLength(7)
  })

  test('the narrow dock puts the place under the opened name', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    await start($)
    await bash($, 'npm test')
    const ui = await mountTests($, 'terminal', 'dock', 30)
    expect(await screen(ui, 30)).toEqual([
      'Tests  ■ 1 failed · 3 of 4 pa…',
      'vitest · npm test · 0s ago · …',
      '─'.repeat(30),
      '■ adds two numbers',
      '    math.test.ts:12',
      '    expected 5 to be 4',
      '    - Expected',
      '    + Received',
      '    - 4',
      '    + 5',
      '    [ copy ]',
      '+3 passed',
    ])
  })

  test('inline above the prompt takes at most 8 rows and points to the dock', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    answer(seen, 'npm run test', { kind: 'ok', stdout: VITEST_PASSED })
    await start($)
    await bash($, 'npm run test')
    await bash($, 'npm test')
    const ui = await mountTests($, 'terminal', 'inline', 76)
    const lines = await screen(ui, 76)
    expect(lines.length <= 8).toBe(true)
    expect(lines).toEqual([
      'Tests  ■ 1 failed · 3 of 4 passed · vitest · npm test · 0s ago · 0.0s',
      '■ adds two numbers                             src/math.test.ts:12  [ copy ]',
      '    expected 5 to be 4',
      '    - Expected',
      '    + Received',
      '    - 4',
      '+3 passed   Runs: ■ 3/4 0s · ✓ 4/4 0s',
      '+1 more rows: a dock (fullscreen, 110 columns) shows every run',
    ])
  })

  test('the runs list shows the last 5 of more runs, with the agent that ran one', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    answer(seen, 'npm run test', { kind: 'ok', stdout: VITEST_PASSED })
    await start($)
    for (let run = 0; run < 6; run += 1) {
      await bash($, 'npm run test')
      await seen.clock.advance(60_000)
    }
    await bash($, 'npm test', { agentId: 'agent-1' })
    const ui = await mountTests($, 'terminal')
    const lines = await screen(ui)
    expect(lines.slice(lines.indexOf('Runs  last 5 of 7'))).toEqual([
      'Runs  last 5 of 7',
      '■ 3/4    vitest  npm test              0s',
      '    by scout',
      '✓ 4/4    vitest  npm run test          1m',
      '✓ 4/4    vitest  npm run test          2m',
      '✓ 4/4    vitest  npm run test          3m',
      '✓ 4/4    vitest  npm run test          4m',
      '[ +2 older runs ]',
    ])
    await ui.press({ key: 'older' })
    expect((await screen(ui)).filter((line) => line.startsWith('✓ 4/4'))).toHaveLength(6)
  })

  test('while a test command runs, the tab says so and keeps the last result below', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED), 12_000)
    answer(seen, 'npm run test', failing(VITEST_ONE_FAILED))
    await start($)
    await bash($, 'npm run test')
    const call = bash($, 'npm test')
    await seen.clock.advance(12_000 - 1)
    const ui = await mountTests($, 'terminal')
    expect((await screen(ui)).slice(0, 3)).toEqual([
      'Tests  ▶ npm test runs · 12s',
      'last run: ■ 1 failed · 3 of 4 passed',
      RULE_41,
    ])
    await seen.clock.advance(1)
    await call
    expect((await screen(ui))[0]).toBe('Tests  ■ 1 failed · 3 of 4 passed')
  })

  test('the copy button copies the opened failure and says so', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    await start($)
    await bash($, 'npm test')
    const ui = await mountTests($, 'terminal')
    expect(await ui.find({ key: 'copy' })).toMatchObject({ props: { hotkey: 'y' } })
    await ui.press({ key: 'copy' })
    expect(seen.copies).toEqual([
      'adds two numbers\nsrc/math.test.ts:12\nexpected 5 to be 4\n- Expected\n+ Received\n- 4\n+ 5',
    ])
    expect(seen.toasts).toEqual([expect.stringContaining('✓ Copied the failure')])
    seen.copyRefusal = 'no-clipboard'
    await ui.press({ key: 'copy' })
    expect(seen.toasts.at(-1)).toContain('■ Copy failed')
    expect(seen.logs.at(-1)).toContain('no-clipboard')
  })
})

describe('the runner is found from the output format', () => {
  test('npm test that prints vitest output counts as vitest, and one that prints jest as jest', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    await start($)
    await bash($, 'npm test')
    const ui = await mountTests($, 'terminal')
    expect((await screen(ui))[1]).toBe('vitest · npm test · 0s ago · 0.0s')
    answer(seen, 'npm test', failing(JEST_ONE_FAILED))
    await bash($, 'npm test')
    expect((await screen(ui))[1]).toBe('jest · npm test · 0s ago · 0.0s')
  })
})

describe('output with no known runner format changes nothing', () => {
  for (const surface of SURFACES) {
    test(
      `cargo and ls output leave the tab, the status line and the toasts as they were on the ${surface}`,
      { options: { statusLine: 'always', toasts: 'on' } },
      async ($, on) => {
        const seen = world(on)
        answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
        answer(seen, 'cargo build', failing(CARGO_FAILED))
        answer(seen, 'ls -la', { kind: 'ok', stdout: LISTING })
        answer(seen, 'npx mocha', { kind: 'ok', stdout: MOCHA_PASSED })
        answer(seen, './scripts/check-links.sh', failing(PASS_LINES))
        await start($)
        await bash($, 'npm test')
        const ui = await mountTests($, surface)
        const before = await screen(ui)
        const statuses = [...seen.statuses]
        const toasts = [...seen.toasts]
        await bash($, 'cargo build')
        await bash($, 'ls -la')
        await bash($, 'npx mocha')
        await bash($, './scripts/check-links.sh')
        expect(await screen(ui)).toEqual(before)
        expect(seen.statuses).toEqual(statuses)
        expect(seen.toasts).toEqual(toasts)
        expect(await tests($, 'list')).toContain('■ adds two numbers')
      },
    )
  }
})

describe('the status line', () => {
  test('reads tests: 1 failed · 3 of 4 passed after a failed run, and clears on a pass', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    answer(seen, 'npm run test', { kind: 'ok', stdout: VITEST_PASSED })
    await start($)
    await bash($, 'npm test')
    expect(seen.statuses).toEqual(['■ tests: 1 failed · 3 of 4 passed'])
    await bash($, 'npm run test')
    expect(seen.statuses).toEqual(['■ tests: 1 failed · 3 of 4 passed', undefined])
  })

  test(
    'with always, it also shows a run in progress and a pass',
    { options: { statusLine: 'always' } },
    async ($, on) => {
      const seen = world(on)
      answer(seen, 'npm run test', { kind: 'ok', stdout: VITEST_PASSED }, 1200)
      await start($)
      const call = bash($, 'npm run test')
      await seen.clock.settle()
      expect(seen.statuses).toEqual(['▶ tests: npm run test runs'])
      await seen.clock.advance(1200)
      await call
      expect(seen.statuses).toEqual(['▶ tests: npm run test runs', '✓ tests: 4 of 4 passed'])
    },
  )

  test('draws the mark of the glyph setting', async ($, on) => {
    const seen = world(on)
    seen.config = [
      {
        key: 'handily.glyphs',
        value: 'nerd',
        provider: { plugin: 'handily@niksavis', kind: 'userConfig' },
      } as unknown as ConfigRow,
    ]
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    await start($)
    await bash($, 'npm test')
    expect(seen.statuses).toEqual([`${NERD_BLOCKED} tests: 1 failed · 3 of 4 passed`])
    const desktop = await mountTests($, 'desktop')
    expect((await screen(desktop))[0]).toBe('Tests  ■ 1 failed · 3 of 4 passed')
  })

  for (const surface of SURFACES) {
    test(
      `with statusLine off, the mod sets no status line on the ${surface}`,
      { options: { statusLine: 'off' } },
      async ($, on) => {
        const seen = world(on)
        answer(seen, 'npm test', failing(VITEST_ONE_FAILED), 500)
        await start($)
        const call = bash($, 'npm test')
        await seen.clock.advance(500)
        await call
        const ui = await mountTests($, surface)
        expect((await screen(ui))[0]).toBe('Tests  ■ 1 failed · 3 of 4 passed')
        await tests($, 'clear')
        expect(seen.statuses).toEqual([])
      },
    )
  }
})

describe('a run it cannot read whole never shows a pass', () => {
  for (const surface of SURFACES) {
    test(`cut output on the ${surface}`, async ($, on) => {
      const seen = world(on)
      const head = VITEST_TWO_FAILED.slice(0, VITEST_TWO_FAILED.indexOf(' Test Files'))
      answer(seen, 'npm test', {
        kind: 'ok',
        stdout: VITEST_PASSED,
        persistedOutputPath: 'out.txt',
      })
      answer(seen, 'npm run test', failing(`${head}\n\n... [40 lines truncated] ...`))
      await start($)
      await bash($, 'npm test')
      const ui = await mountTests($, surface)
      expect((await screen(ui)).slice(0, 2)).toEqual([
        'Tests  ○ output cut',
        'vitest · npm test · counts may be short',
      ])
      expect((await screen(ui)).join('\n')).not.toContain('passed')
      await bash($, 'npm run test')
      const lines = await screen(ui)
      expect(lines.slice(0, 2)).toEqual([
        'Tests  ■ 2 failed · output cut',
        'vitest · npm run test · counts may be sh…',
      ])
      expect(lines.join('\n')).not.toMatch(/passed|✓/)
    })

    test(`a run in the background and an interrupted run on the ${surface}`, async ($, on) => {
      const seen = world(on)
      answer(seen, 'npm test', { kind: 'ok', stdout: '', backgroundTaskId: 'b1' })
      answer(seen, 'pytest -x', { kind: 'error', text: `Exit code 130\n${INTERRUPT_MARK}` })
      await start($)
      await bash($, 'npm test')
      const ui = await mountTests($, surface)
      expect((await screen(ui)).slice(0, 3)).toEqual([
        'Tests  ▶ npm test runs in the background',
        'its output is not read here',
        'a run in the foreground shows here',
      ])
      await bash($, 'pytest -x')
      const lines = await screen(ui)
      expect(lines.slice(0, 2)).toEqual(['Tests  ■ pytest -x was interrupted', 'no result'])
      expect(lines.join('\n')).not.toMatch(/passed|✓/)
    })
  }

  test('an interrupted call with passing output still shows no pass', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', { kind: 'ok', stdout: VITEST_PASSED, interrupted: true })
    await start($)
    await bash($, 'npm test')
    const ui = await mountTests($, 'terminal')
    const lines = await screen(ui)
    expect(lines[0]).toBe('Tests  ■ npm test was interrupted')
    expect(lines.join('\n')).not.toMatch(/passed|✓/)
  })
})

describe('/tests', () => {
  test('registers /tests and the ready value that /handily reads', async ($, on) => {
    const seen = world(on)
    const ready: unknown[] = []
    on('state.set', { plugin: PLUGIN, key: 'ready' }, (_$, e, next) => {
      ready.push(e.value)
      return next(e)
    })
    await start($)
    expect(seen.commands).toEqual(['tests'])
    expect(ready).toEqual([{ root: expect.stringMatching(/[\\/]handily-tests$/) }])
  })

  test('/tests opens the tab with the focus, and /tests on the shown tab closes it', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    await start($)
    await bash($, 'npm test')
    expect(await tests($, '')).toBe('Tests tab opened.')
    expect(seen.opens).toEqual([{ id: PANE, focus: true }])
    expect(await tests($, '')).toBe('Tests tab closed.')
    expect(seen.closes).toEqual([PANE])
  })

  test('/tests close closes the tab, and says so when it is not open', async ($, on) => {
    const seen = world(on)
    await start($)
    expect(await tests($, 'close')).toBe('The tests tab is not open. Run /tests to open it.')
    await tests($, '')
    expect(await tests($, 'close')).toBe('Tests tab closed.')
    expect(seen.closes).toEqual([PANE])
  })

  test('/tests list prints the last run as text', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    await start($)
    expect(await tests($, 'list')).toBe(
      'No test run yet. A Bash call that runs vitest, jest, node --test or pytest fills the tests tab.',
    )
    await bash($, 'npm test')
    expect(await tests($, 'list')).toBe(
      [
        'Tests  ■ 1 failed · 3 of 4 passed',
        'vitest · npm test · 0s ago · 0.0s',
        '■ adds two numbers  src/math.test.ts:12',
        '    expected 5 to be 4',
        '    - Expected',
        '    + Received',
        '    - 4',
        '    + 5',
      ].join('\n'),
    )
  })

  for (const surface of SURFACES) {
    test(`/tests clear empties the tab on the ${surface}`, async ($, on) => {
      const seen = world(on)
      answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
      await start($)
      await bash($, 'npm test')
      const ui = await mountTests($, surface)
      expect(await tests($, 'clear')).toBe('Cleared 1 test run.')
      expect(await screen(ui)).toEqual([
        'Tests  no run yet',
        'A Bash call that runs vitest, jest,',
        'node --test or pytest fills this tab.',
        'Other output is not read.',
      ])
      expect(seen.statuses.at(-1)).toBeUndefined()
      expect(await tests($, 'clear')).toBe('No test run to clear.')
    })
  }

  test('/tests with an unknown argument prints the usage and opens nothing', async ($, on) => {
    const seen = world(on)
    await start($)
    expect(await tests($, 'open now')).toBe(
      'Unknown argument "open now". Use /tests to open or close the tests tab, /tests close, /tests list or /tests clear.',
    )
    expect(seen.opens).toEqual([])
  })
})

describe('toasts', () => {
  test(
    'with toast on, a new failure and the pass after it each show a toast while the tab is not shown',
    { options: { toasts: 'on' } },
    async ($, on) => {
      const seen = world(on)
      answer(seen, 'npm test', failing(VITEST_TWO_FAILED))
      answer(seen, 'npm run test', { kind: 'ok', stdout: VITEST_PASSED })
      await start($)
      await bash($, 'npm test')
      await bash($, 'npm test')
      await bash($, 'npm run test')
      expect(seen.toasts).toEqual([
        expect.stringMatching(
          /^■ 2 tests failed\s+"adds two numbers" and 1 more\s+\/tests shows the diffs$/,
        ),
        expect.stringMatching(/^✓ Tests pass again\s+vitest · 4 of 4 passed$/),
      ])
    },
  )

  test(
    'with toast on and the tab shown, no toast',
    { options: { toasts: 'on' } },
    async ($, on) => {
      const seen = world(on)
      answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
      await start($)
      await tests($, '')
      await bash($, 'npm test')
      expect(seen.toasts).toEqual([])
    },
  )

  test('with toast off by default, no toast', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
    await start($)
    await bash($, 'npm test')
    expect(seen.toasts).toEqual([])
  })
})

function longPlaceRun(): string {
  return [
    ' RUN  v3.2.4 /work/app',
    ' FAIL  packages/markdown-table-renderer/src/parse-markdown-table.test.ts > table > parses a table with a very long header name',
    'AssertionError: expected 1 to be 2',
    ' \u{276F} packages/markdown-table-renderer/src/parse-markdown-table.test.ts:120:5',
    ' Test Files  1 failed (1)',
    '      Tests  1 failed | 2 passed (3)',
  ].join('\n')
}

describe('review repairs', () => {
  for (const surface of SURFACES) {
    test(`a node strict equal shows only the lines node printed, with no made-up diff, on the ${surface}`, async ($, on) => {
      const seen = world(on)
      answer(seen, 'node --test', failing(NODE_CALC_FAIL))
      await start($)
      await bash($, 'node --test')
      const ui = await mountTests($, surface)
      expect(await screen(ui)).toEqual([
        'Tests  ■ 1 failed · 1 of 2 passed',
        'node · node --test · 0s ago · 0.0s',
        RULE_41,
        '■ multiplies two numbers  calc.test.mjs:4',
        '    Expected values to be strictly equal:',
        '    6 !== 7',
        '    [ copy ]',
        '+1 passed',
      ])
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
    })

    test(`the diff lines draw in the error and success colours on the ${surface}`, async ($, on) => {
      const seen = world(on)
      answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
      await start($)
      await bash($, 'npm test')
      const ui = await mountTests($, surface)
      expect((await ui.find({ type: 'Text', text: '- 4' }))?.props.color).toBe('error')
      expect((await ui.find({ type: 'Text', text: '+ 5' }))?.props.color).toBe('success')
    })

    test(
      `a file that fails to load after a failure shows a failure and no pass toast on the ${surface}`,
      { options: { toasts: 'on' } },
      async ($, on) => {
        const seen = world(on)
        answer(seen, 'npm test', failing(VITEST_ONE_FAILED))
        answer(seen, 'npm run test', failing(VITEST_SUITE_FAILED))
        await start($)
        await bash($, 'npm test')
        await bash($, 'npm run test')
        const ui = await mountTests($, surface)
        expect((await screen(ui)).slice(0, 5)).toEqual([
          'Tests  ■ 1 failed · 3 of 4 passed',
          'vitest · npm run test · 0s ago · 0.0s',
          RULE_41,
          '■ src/b.test.ts               b.test.ts:2',
          "    Error: Cannot find module './b' impo…",
        ])
        expect(seen.toasts.join('\n')).not.toContain('pass again')
        expect(seen.statuses.at(-1)).toBe('■ tests: 1 failed · 3 of 4 passed')
      },
    )

    test(`pytest -q output fills the tab on the ${surface}`, async ($, on) => {
      const seen = world(on)
      answer(seen, 'pytest -q', failing(PYTEST_QUIET_FAILED))
      await start($)
      await bash($, 'pytest -q')
      const ui = await mountTests($, surface)
      expect((await screen(ui)).slice(0, 5)).toEqual([
        'Tests  ■ 1 failed · 3 of 4 passed',
        'pytest · pytest -q · 0s ago · 0.0s',
        RULE_41,
        '■ test_adds_two_numbers   test_math.py:12',
        '    assert 5 == 4',
      ])
    })

    test(`vitest that finds no test files shows a run that found no tests on the ${surface}`, async ($, on) => {
      const seen = world(on)
      answer(seen, 'npm test', failing(VITEST_NO_FILES))
      await start($)
      await bash($, 'npm test')
      const ui = await mountTests($, surface)
      expect(await screen(ui)).toEqual([
        'Tests  ■ vitest found no tests',
        'No test files found, exiting with code 1',
      ])
    })

    for (const [placement, columns] of [
      ['dock', 30],
      ['dock', 41],
      ['inline', 30],
      ['inline', 41],
      ['inline', 76],
    ] as const) {
      test(`a long place fits beside the name, ${placement} at ${String(columns)} on the ${surface}`, async ($, on) => {
        const seen = world(on)
        answer(seen, 'npm test', failing(longPlaceRun()))
        await start($)
        await bash($, 'npm test')
        const ui = await mountTests($, surface, placement, columns)
        const lines = await screen(ui, columns)
        const row = lines.find((line) => line.startsWith('■ parses'))
        expect(row, lines.join('\n')).toBeDefined()
        if (columns > 30 || placement === 'inline') expect(row).toMatch(/:120/)
      })
    }

    test(`a long diff shows 12 lines and names the cut on the ${surface}`, async ($, on) => {
      const seen = world(on)
      const diff = Array.from({ length: 20 }, (_, index) => `- line ${String(index + 1)}`)
      const text = [
        ' RUN  v3.2.4 /work/app',
        ' FAIL  src/a.test.ts > a > long',
        'AssertionError: expected long to equal short',
        '',
        ...diff,
        '',
        ' \u{276F} src/a.test.ts:3:1',
        ' Test Files  1 failed (1)',
        '      Tests  1 failed (1)',
      ].join('\n')
      answer(seen, 'npm test', failing(text))
      await start($)
      await bash($, 'npm test')
      const ui = await mountTests($, surface)
      const lines = await screen(ui)
      expect(lines.filter((line) => line.startsWith('    - line'))).toHaveLength(12)
      expect(lines).toContain('    +8 more lines in the transcript')
    })

    test(`a run of 60 failures keeps 50 and names the cut on the ${surface}`, async ($, on) => {
      const seen = world(on)
      const blocks = Array.from({ length: 60 }, (_, index) =>
        [` FAIL  src/a.test.ts > a > case ${String(index + 1)}`, 'AssertionError: no'].join('\n'),
      )
      const text = [
        ' RUN  v3.2.4 /work/app',
        ...blocks,
        ' Test Files  1 failed (1)',
        '      Tests  60 failed (60)',
      ].join('\n')
      answer(seen, 'npm test', failing(text))
      await start($)
      await bash($, 'npm test')
      const ui = await mountTests($, surface)
      const lines = await screen(ui)
      expect(lines).toContain('[ +45 more failed ]')
      expect(lines).toContain('+10 more failures in the transcript')
    })
  }

  test('two Bash runs that end together both land in the runs list', async ($, on) => {
    const seen = world(on)
    answer(seen, 'npm test', failing(VITEST_ONE_FAILED), 500)
    answer(seen, 'npm run test', { kind: 'ok', stdout: VITEST_PASSED }, 500)
    await start($)
    const first = bash($, 'npm test')
    const second = bash($, 'npm run test', { agentId: 'agent-1' })
    await seen.clock.advance(500)
    await Promise.all([first, second])
    const ui = await mountTests($, 'terminal')
    expect(await screen(ui)).toContain('Runs  last 2 of 2')
  })
})
