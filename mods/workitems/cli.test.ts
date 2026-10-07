import type { FsEntry, On, ProcessRunResult, RenderSurface } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import { LIST_BLOCKED, LIST_IN_PROGRESS, LIST_OPEN } from './fixtures/basicly/tracker-list'
import { sha256Hex } from './hooks/approval'
import type { WorkitemsLine, WorkitemsSnapshot, WorkitemsWriteVerbs } from './types'

const ROOT = '/work/app'
const TEMPLATE = '.basicly/ledger/template.json'
const KIT_CLI = '.basicly/core/kit/tracker/cli.py'
const KIT_CLI_TEXT = 'print("the tracker kit")\n'
const BASICLY_BIN = '/opt/tools/basicly'
const PYTHON_LINK = '/usr/bin/python3'
const PYTHON_REAL = '/usr/lib/python3.12/bin/python3.12'
const PATH_WITH_BASICLY = '/usr/bin:/opt/tools'
const PATH_WITHOUT_BASICLY = '/usr/bin'
const KIT_COMMAND = `python3 ${KIT_CLI}`
const ADAPTER_SCRIPT = 'tools/tracker.mjs'
const ADAPTER_COMMAND = `node ${ADAPTER_SCRIPT}`
const NODE_BIN = '/usr/bin/node'

const BASICLY_REPO: Record<string, string> = {
  [TEMPLATE]: '{\n  "prefix": "app"\n}\n',
  '.basicly/ledger/pending-main.jsonl': '{"id":"app-3o75#ev-1"}\n',
  [KIT_CLI]: KIT_CLI_TEXT,
}

const DESCRIBE = {
  name: 'tickets',
  version: '1.4.0',
  contract: 1,
  watch: ['tickets/*.json'],
  writes: [['close'], ['comments', 'add']],
  statusMap: { todo: 'open', doing: 'in_progress', done: 'closed' },
}

const ADAPTER_ITEMS = [
  {
    id: 'T-1',
    title: 'Add the export button',
    status: 'doing',
    priority: 1,
    type: 'feature',
    assignee: 'dev-one',
    updatedAt: '2026-10-02T10:30:00Z',
    labels: ['ui'],
    url: 'https://tickets.example/T-1',
  },
  { id: 'T-2', title: 'Fix the date parser', status: 'todo' },
]

const ADAPTER_REPO: Record<string, string> = {
  '.handily.json': JSON.stringify({ command: ['node', ADAPTER_SCRIPT] }),
  [ADAPTER_SCRIPT]: 'console.log("tickets")\n',
  'tickets/t-1.json': '{}',
}

type Run = { argv: string[]; cwd: string | undefined }

type Ask = { question: string; header: unknown; options: string[] }

type World = {
  files: Map<string, { text: string; mtimeMs: number }>
  links: Map<string, string>
  surfaces: RenderSurface[]
  runs: Run[]
  outputs: Map<string, Partial<ProcessRunResult>>
  stored: Map<string, unknown>
  asks: Ask[]
  answer: string | undefined
}

function isDirectory(world: World, path: string): boolean {
  return [...world.files.keys()].some((file) => file.startsWith(`${path}/`))
}

function entriesIn(world: World, directory: string): FsEntry[] {
  const names = new Map<string, FsEntry>()
  for (const [file, { text, mtimeMs }] of world.files) {
    if (!file.startsWith(`${directory}/`)) continue
    const [name = '', ...below] = file.slice(directory.length + 1).split('/')
    const size = new TextEncoder().encode(text).length
    names.set(
      name,
      below.length === 0
        ? { name, kind: 'file', size, mtimeMs, isLink: false }
        : { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    )
  }
  return [...names.values()]
}

function processResult(answer: Partial<ProcessRunResult> | undefined): ProcessRunResult {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
    ...(answer ?? { exitCode: 127, stderr: 'not found' }),
  }
}

function questionText(questions: unknown): string {
  const [first] = Array.isArray(questions) ? (questions as unknown[]) : []
  const question = (first as { question?: unknown } | undefined)?.question
  return typeof question === 'string' ? question : ''
}

function askOf(questions: unknown): Ask {
  const [first] = Array.isArray(questions) ? (questions as unknown[]) : []
  const asked = first as { header?: unknown; options?: { label: string }[] } | undefined
  return {
    question: questionText(questions),
    header: asked?.header,
    options: (asked?.options ?? []).map((option) => option.label),
  }
}

function fakeWorld(on: On, repo: Record<string, string>, path: string): World {
  const world: World = {
    files: new Map(),
    links: new Map([[PYTHON_LINK, PYTHON_REAL]]),
    surfaces: ['terminal'],
    runs: [],
    outputs: new Map(),
    stored: new Map(),
    asks: [],
    answer: undefined,
  }
  for (const [relative, text] of Object.entries(repo)) {
    world.files.set(`${ROOT}/${relative}`, { text, mtimeMs: 10 })
  }
  for (const program of [PYTHON_REAL, NODE_BIN, BASICLY_BIN]) {
    world.files.set(program, { text: 'binary', mtimeMs: 1 })
  }
  const realOf = (target: string) => world.links.get(target) ?? target
  mock.env(on, { PATH: path })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.CwdChanged', () => ({}))
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: world.surfaces }))
  on('fs.exists', (_$, e) => {
    const real = realOf(e.path)
    return { value: world.files.has(real) || isDirectory(world, real) }
  })
  on('fs.stat', (_$, e) => {
    const real = realOf(e.path)
    const file = world.files.get(real)
    const kind = file ? ('file' as const) : ('dir' as const)
    if (!file && !isDirectory(world, real)) return { deny: `ENOENT: ${e.path}` }
    const size = file ? new TextEncoder().encode(file.text).length : 0
    const stat = { kind, size, mtimeMs: file?.mtimeMs ?? 0, isLink: world.links.has(e.path) }
    return { value: e.resolve ? { ...stat, realPath: real } : stat }
  })
  on('fs.list', (_$, e) => {
    if (!isDirectory(world, e.path)) return { deny: `ENOENT: ${e.path}` }
    return { value: entriesIn(world, e.path) }
  })
  on('fs.read', (_$, e) => {
    const file = world.files.get(realOf(e.path))
    if (!file) return { deny: `ENOENT: ${e.path}` }
    return { value: e.as === 'bytes' ? { base64: btoa(file.text) } : file.text }
  })
  on('store.get', (_$, e) => ({ value: world.stored.get(e.key) }))
  on('store.set', (_$, e) => {
    world.stored.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    world.runs.push({ argv: [...e.argv], cwd: e.init?.cwd })
    return { value: processResult(world.outputs.get(e.argv.join(' '))) }
  })
  on('tool.call', (_$, e, next) => {
    if (e.tool !== 'AskUserQuestion') return next(e)
    const ask = askOf(e.questions)
    world.asks.push(ask)
    if (world.answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [ask.question]: world.answer } } }
  })
  return world
}

function answerBasicly(world: World, program: readonly string[], ledger: readonly string[]) {
  const lists = { open: LIST_OPEN, in_progress: LIST_IN_PROGRESS, blocked: LIST_BLOCKED }
  for (const [status, stdout] of Object.entries(lists)) {
    world.outputs.set([...program, '--status', status, ...ledger].join(' '), { stdout })
  }
}

function answerAdapter(world: World, describe: object, items: readonly object[]) {
  world.outputs.set(`${ADAPTER_COMMAND} describe --json`, { stdout: JSON.stringify(describe) })
  world.outputs.set(`${ADAPTER_COMMAND} items --json`, { stdout: JSON.stringify(items) })
}

const consumer: Plugin = {
  name: 'consumer',
  register(on) {
    on('command.run', async ($, e, next) => {
      if (e.command === 'snapshot') {
        const { value } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
        return { text: JSON.stringify(value ?? null) }
      }
      if (e.command === 'lines') {
        const { value } = await $.state.get({ plugin: 'workitems', key: 'snapshot' })
        if (!value) return { text: 'no snapshot' }
        return { text: JSON.stringify(await $.workitems.lines({ snapshot: value, now: value.at })) }
      }
      if (e.command === 'write-verbs') {
        return { text: JSON.stringify(await $.workitems.writeVerbs()) }
      }
      return next(e)
    })
  },
}

async function commandText(engine: Engine, command: string): Promise<string> {
  const result = await engine.command.run({
    command,
    args: '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return result.text ?? ''
}

async function snapshotOf(engine: Engine): Promise<WorkitemsSnapshot> {
  return JSON.parse(await commandText(engine, 'snapshot')) as WorkitemsSnapshot
}

async function linesOf(engine: Engine): Promise<WorkitemsLine[]> {
  return JSON.parse(await commandText(engine, 'lines')) as WorkitemsLine[]
}

async function startSession(
  engine: Engine,
  clock: MockClock,
  isInteractive: boolean,
): Promise<WorkitemsSnapshot> {
  await engine.session.start({
    cwd: ROOT,
    surface: isInteractive ? 'terminal' : null,
    isInteractive,
  })
  await clock.settle()
  return snapshotOf(engine)
}

function kitRuns(world: World): Run[] {
  return world.runs.filter((run) => run.argv[1] === KIT_CLI)
}

const KIT_QUESTION = [
  "Allow handily to run this repo's tracker CLI to read work items?",
  `${KIT_COMMAND} list --status open .basicly/ledger`,
  '(read-only; asked again if this file or the command changes)',
].join('\n')

describe('basicly source', () => {
  test(
    'runs basicly tracker list per open status from PATH and maps the records',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on, { now: 1_000 })
      const world = fakeWorld(on, BASICLY_REPO, PATH_WITH_BASICLY)
      answerBasicly(world, ['basicly', 'tracker', 'list'], [])
      const snapshot = await startSession($, clock, false)
      expect(world.runs).toEqual(
        ['open', 'in_progress', 'blocked'].map((status) => ({
          argv: ['basicly', 'tracker', 'list', '--status', status],
          cwd: ROOT,
        })),
      )
      expect(snapshot.state).toBe('ok')
      expect(snapshot.source).toBe('basicly')
      expect(snapshot.items.map((item) => item.key)).toEqual([
        'basicly:app-3o75',
        'basicly:app-ngri',
        'basicly:app-f0fo',
      ])
      expect(snapshot.items[0]).toEqual({
        key: 'basicly:app-3o75',
        id: 'app-3o75',
        title: 'Add the export button',
        status: 'open',
        rawStatus: 'open',
        priority: 2,
        type: 'feature',
        assignee: 'dev-one',
        updatedAt: '2026-10-02T10:30:00.000000Z',
        source: 'basicly',
      })
      expect(snapshot.items[1]?.status).toBe('in_progress')
      expect(snapshot.items[1]?.assignee).toBeNull()
      expect(snapshot.items[2]?.status).toBe('blocked')
      expect(world.asks).toEqual([])
      expect((await linesOf($))[0]?.text).toBe('basicly · 3 open · read 0 s ago')
    },
  )

  test('a cut-off output fails with the reason', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    const world = fakeWorld(on, BASICLY_REPO, PATH_WITH_BASICLY)
    answerBasicly(world, ['basicly', 'tracker', 'list'], [])
    world.outputs.set('basicly tracker list --status in_progress', {
      stdout: LIST_IN_PROGRESS.slice(0, 40),
      isStdoutTruncated: true,
    })
    const snapshot = await startSession($, clock, false)
    expect(snapshot.state).toBe('failed')
    expect(snapshot.reason).toBe('basicly tracker list output was cut off.')
    expect(snapshot.items).toEqual([])
    expect(await linesOf($)).toEqual([
      {
        kind: 'failed',
        tone: 'error',
        text: 'Work items unavailable: basicly tracker list output was cut off.',
      },
    ])
  })

  test(
    'a non-zero exit fails with the command and its code',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, BASICLY_REPO, PATH_WITH_BASICLY)
      world.outputs.set('basicly tracker list --status open', { exitCode: 2, stderr: 'no kit' })
      const snapshot = await startSession($, clock, false)
      expect(snapshot.state).toBe('failed')
      expect(snapshot.reason).toBe('basicly tracker list exited 2. Run it in a shell to see why.')
    },
  )

  test(
    'reports terminal-only and runs nothing on a surface without process.run',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, BASICLY_REPO, PATH_WITH_BASICLY)
      world.surfaces = ['desktop']
      const snapshot = await startSession($, clock, true)
      expect(snapshot.state).toBe('terminal-only')
      expect(world.runs).toEqual([])
      expect(world.asks).toEqual([])
      expect(await linesOf($)).toEqual([
        {
          kind: 'terminal-only',
          tone: 'dim',
          text: 'basicly is read through a CLI, which only a terminal session can run. Open this repo in a terminal to see its items.',
        },
      ])
    },
  )
})

describe('approval of a repo command', () => {
  test(
    'never asks while the session is not interactive and reports approval-needed',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, BASICLY_REPO, PATH_WITHOUT_BASICLY)
      world.answer = 'Allow for this repo'
      const snapshot = await startSession($, clock, false)
      await clock.advance(4_000)
      expect(world.asks).toEqual([])
      expect(kitRuns(world)).toEqual([])
      expect(snapshot.state).toBe('approval-needed')
      expect(await linesOf($)).toEqual([
        {
          kind: 'approval-needed',
          tone: 'warning',
          text: `Work items need your approval to run ${KIT_COMMAND}.`,
        },
        {
          kind: 'approval-hint',
          tone: 'dim',
          text: 'Asked at the next refresh in an interactive session.',
        },
      ])
    },
  )

  test(
    'asks with the mock text and runs the kit after Allow, keyed on root, argv, file hash and argv0',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, BASICLY_REPO, PATH_WITHOUT_BASICLY)
      answerBasicly(world, ['python3', KIT_CLI, 'list'], ['.basicly/ledger'])
      world.answer = 'Allow for this repo'
      const snapshot = await startSession($, clock, true)
      expect(world.asks).toEqual([
        {
          question: KIT_QUESTION,
          header: 'workitems',
          options: ['Allow for this repo', 'Not now'],
        },
      ])
      expect(snapshot.state).toBe('ok')
      expect(snapshot.items.length).toBe(3)
      expect(kitRuns(world).map((run) => run.argv.join(' '))).toEqual([
        `${KIT_COMMAND} list --status open .basicly/ledger`,
        `${KIT_COMMAND} list --status in_progress .basicly/ledger`,
        `${KIT_COMMAND} list --status blocked .basicly/ledger`,
      ])
      expect([...world.stored.values()]).toEqual([
        {
          root: ROOT,
          argv: ['python3', KIT_CLI],
          files: { [KIT_CLI]: await sha256Hex(new TextEncoder().encode(KIT_CLI_TEXT)) },
          argv0: PYTHON_REAL,
        },
      ])
    },
  )

  test(
    'a stored approval runs the kit in a later session without asking',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, BASICLY_REPO, PATH_WITHOUT_BASICLY)
      answerBasicly(world, ['python3', KIT_CLI, 'list'], ['.basicly/ledger'])
      world.answer = 'Allow for this repo'
      await startSession($, clock, true)
      world.answer = undefined
      const snapshot = await startSession($, clock, false)
      expect(world.asks.length).toBe(1)
      expect(snapshot.state).toBe('ok')
    },
  )

  test(
    'after Not now it reports approval-needed and asks again only at the next session start',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, BASICLY_REPO, PATH_WITHOUT_BASICLY)
      answerBasicly(world, ['python3', KIT_CLI, 'list'], ['.basicly/ledger'])
      world.answer = 'Not now'
      const declined = await startSession($, clock, true)
      world.files.set(`${ROOT}/.basicly/ledger/pending-main.jsonl`, {
        text: '{}\n{}\n',
        mtimeMs: 20,
      })
      await clock.advance(4_000)
      expect((await snapshotOf($)).version).toBeGreaterThan(declined.version)
      expect(declined.state).toBe('approval-needed')
      expect(declined.reason).toBe(KIT_COMMAND)
      expect(world.asks.length).toBe(1)
      expect(kitRuns(world)).toEqual([])
      expect(world.stored.size).toBe(0)
      world.answer = 'Allow for this repo'
      const approved = await startSession($, clock, true)
      expect(world.asks.length).toBe(2)
      expect(approved.state).toBe('ok')
    },
  )

  test('a dismissed ask counts as Not now', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    const world = fakeWorld(on, BASICLY_REPO, PATH_WITHOUT_BASICLY)
    const snapshot = await startSession($, clock, true)
    await clock.advance(4_000)
    expect(world.asks.length).toBe(1)
    expect(snapshot.state).toBe('approval-needed')
    expect(world.stored.size).toBe(0)
  })

  test(
    'a changed hash of the kit file asks again and runs nothing until approved',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, BASICLY_REPO, PATH_WITHOUT_BASICLY)
      answerBasicly(world, ['python3', KIT_CLI, 'list'], ['.basicly/ledger'])
      world.answer = 'Allow for this repo'
      expect((await startSession($, clock, true)).state).toBe('ok')
      const runsBefore = kitRuns(world).length
      world.answer = 'Not now'
      world.files.set(`${ROOT}/${KIT_CLI}`, { text: 'print("changed")\n', mtimeMs: 20 })
      await clock.advance(2_000)
      await clock.settle()
      const snapshot = await snapshotOf($)
      expect(world.asks.length).toBe(2)
      expect(snapshot.state).toBe('approval-needed')
      expect(kitRuns(world).length).toBe(runsBefore)
    },
  )

  test('a changed resolved argv0 asks again', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    const world = fakeWorld(on, BASICLY_REPO, PATH_WITHOUT_BASICLY)
    answerBasicly(world, ['python3', KIT_CLI, 'list'], ['.basicly/ledger'])
    world.answer = 'Allow for this repo'
    await startSession($, clock, true)
    world.files.set('/usr/lib/python3.13/bin/python3.13', { text: 'binary', mtimeMs: 1 })
    world.links.set(PYTHON_LINK, '/usr/lib/python3.13/bin/python3.13')
    world.answer = 'Not now'
    const snapshot = await startSession($, clock, true)
    expect(world.asks.length).toBe(2)
    expect(snapshot.state).toBe('approval-needed')
  })
})

describe('CLI adapter contract 1', () => {
  test(
    'runs describe and items after approval, honours statusMap and extends the write verbs',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, ADAPTER_REPO, PATH_WITHOUT_BASICLY)
      answerAdapter(world, DESCRIBE, ADAPTER_ITEMS)
      world.answer = 'Allow for this repo'
      const snapshot = await startSession($, clock, true)
      expect(world.asks[0]?.question.split('\n')[1]).toBe(`${ADAPTER_COMMAND} describe --json`)
      expect(world.runs.map((run) => run.argv.join(' '))).toEqual([
        `${ADAPTER_COMMAND} describe --json`,
        `${ADAPTER_COMMAND} items --json`,
      ])
      expect(snapshot.state).toBe('ok')
      expect(snapshot.source).toBe('adapter')
      expect(snapshot.sourceLabel).toBe('tickets')
      expect(snapshot.items).toEqual([
        {
          key: 'tickets:T-1',
          id: 'T-1',
          title: 'Add the export button',
          status: 'in_progress',
          rawStatus: 'doing',
          priority: 1,
          type: 'feature',
          assignee: 'dev-one',
          updatedAt: '2026-10-02T10:30:00Z',
          source: 'tickets',
          url: 'https://tickets.example/T-1',
          labels: ['ui'],
        },
        {
          key: 'tickets:T-2',
          id: 'T-2',
          title: 'Fix the date parser',
          status: 'open',
          rawStatus: 'todo',
          priority: null,
          type: null,
          assignee: null,
          updatedAt: null,
          source: 'tickets',
        },
      ])
      expect([...world.stored.values()]).toEqual([
        {
          root: ROOT,
          argv: ['node', ADAPTER_SCRIPT],
          files: {
            [ADAPTER_SCRIPT]: await sha256Hex(
              new TextEncoder().encode(ADAPTER_REPO[ADAPTER_SCRIPT]),
            ),
          },
          argv0: NODE_BIN,
        },
      ])
      const verbs = JSON.parse(await commandText($, 'write-verbs')) as WorkitemsWriteVerbs
      expect(verbs[ADAPTER_COMMAND]).toEqual(['close', 'comments add'])
      expect(verbs.br.length).toBe(16)
    },
  )

  test('reads again when a watched file changes', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    const world = fakeWorld(on, ADAPTER_REPO, PATH_WITHOUT_BASICLY)
    answerAdapter(world, DESCRIBE, ADAPTER_ITEMS)
    world.answer = 'Allow for this repo'
    await startSession($, clock, true)
    await clock.advance(2_000)
    const runsSettled = world.runs.length
    await clock.advance(2_000)
    expect(world.runs.length).toBe(runsSettled)
    answerAdapter(world, DESCRIBE, [{ id: 'T-3', title: 'Ship it', status: 'done' }])
    world.files.set(`${ROOT}/tickets/t-1.json`, { text: '{"changed":true}', mtimeMs: 30 })
    await clock.advance(2_000)
    const snapshot = await snapshotOf($)
    expect(snapshot.items.map((item) => [item.key, item.status])).toEqual([
      ['tickets:T-3', 'closed'],
    ])
  })

  test('refuses a contract other than 1 by name', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    const world = fakeWorld(on, ADAPTER_REPO, PATH_WITHOUT_BASICLY)
    answerAdapter(world, { ...DESCRIBE, contract: 2 }, ADAPTER_ITEMS)
    world.answer = 'Allow for this repo'
    const snapshot = await startSession($, clock, true)
    expect(snapshot.state).toBe('failed')
    expect(snapshot.reason).toBe('the adapter says contract 2; handily reads contract 1.')
    expect(world.runs.map((run) => run.argv.at(-2))).toEqual(['describe'])
    expect(await linesOf($)).toEqual([
      {
        kind: 'failed',
        tone: 'error',
        text: 'Work items unavailable: the adapter says contract 2; handily reads contract 1.',
      },
    ])
  })

  test(
    'never asks while not interactive and runs nothing',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      const world = fakeWorld(on, ADAPTER_REPO, PATH_WITHOUT_BASICLY)
      answerAdapter(world, DESCRIBE, ADAPTER_ITEMS)
      world.answer = 'Allow for this repo'
      const snapshot = await startSession($, clock, false)
      expect(snapshot.state).toBe('approval-needed')
      expect(snapshot.reason).toBe(ADAPTER_COMMAND)
      expect(world.asks).toEqual([])
      expect(world.runs).toEqual([])
    },
  )

  test('reports terminal-only on the desktop surface', { plugins: [consumer] }, async ($, on) => {
    const clock = mock.clock(on)
    const world = fakeWorld(on, ADAPTER_REPO, PATH_WITHOUT_BASICLY)
    world.surfaces = ['desktop']
    const snapshot = await startSession($, clock, true)
    expect(snapshot.state).toBe('terminal-only')
    expect(world.runs).toEqual([])
    expect(world.asks).toEqual([])
  })

  test(
    'refuses a command in .handily.json that is not a list',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = mock.clock(on)
      fakeWorld(
        on,
        { '.handily.json': '{"command":"node tools/tracker.mjs"}' },
        PATH_WITHOUT_BASICLY,
      )
      const snapshot = await startSession($, clock, false)
      expect(snapshot.state).toBe('failed')
      expect(snapshot.reason).toBe(
        '.handily.json needs command as a list of the program and its arguments, so it could not be read.',
      )
    },
  )
})
