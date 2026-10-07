import type { FsEntry, On } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Plugin,
} from 'claude-code/testing'
import type { WorkitemsItem, WorkitemsLine, WorkitemsSnapshot } from './types'

const ROOT = '/work/app'

const BEAN_EXPORT = [
  '---',
  '# app-ab12',
  'title: Add the export button',
  'status: in-progress',
  'type: feature',
  'priority: high',
  'tags:',
  '  - ui',
  'created_at: 2026-10-01T09:00:00Z',
  'updated_at: 2026-10-02T10:30:00Z',
  '---',
  '',
  'Add a button that exports the report as a CSV file.',
  '',
].join('\n')

const BEAN_PARSER = [
  '---',
  '# app-cd34',
  'title: Fix the date parser',
  'status: todo',
  'type: bug',
  'priority: normal',
  'parent: app-ab12',
  'updated_at: 2026-10-03T08:15:00Z',
  '---',
  '',
  'The parser drops the time zone.',
  '',
].join('\n')

const BEAN_ARCHIVED = [
  '---',
  '# app-ef56',
  'title: Write the release notes',
  'status: completed',
  'type: task',
  'priority: deferred',
  'updated_at: 2026-10-04T12:00:00Z',
  '---',
  '',
  'The notes for the first release are done.',
  '',
].join('\n')

const BEANS_FIXTURE: Record<string, string> = {
  '.beans/app-ab12--add-the-export-button.md': BEAN_EXPORT,
  '.beans/app-cd34--fix-the-date-parser.md': BEAN_PARSER,
  '.beans/archive/app-ef56--write-the-release-notes.md': BEAN_ARCHIVED,
}

const GENERIC_CONFIG = JSON.stringify({
  globs: ['work/*.jsonl'],
  format: 'jsonl',
  fields: {
    id: 'key',
    title: 'summary',
    status: 'state',
    priority: 'rank',
    assignee: 'owner',
    labels: 'tags',
  },
})

const GENERIC_FIXTURE: Record<string, string> = {
  '.handily.json': GENERIC_CONFIG,
  'work/items.jsonl': [
    '{"key":"T-1","summary":"Add the export button","state":"open","rank":1,"owner":"dev-one","tags":["ui"]}',
    '{"key":"T-2","summary":"Fix the date parser","state":"in_progress","rank":2}',
    '{"key":"T-3","summary":"Write the release notes","state":"closed"}',
    '',
  ].join('\n'),
}

const BEADS_ISSUES = '{"id":"app-1","title":"A beads issue","status":"open","priority":1}'

type World = {
  files: Map<string, { text: string; mtimeMs: number }>
  links: Map<string, string>
  touched: string[]
  listed: string[]
  resolved: string[]
  reads: string[]
}

function normalized(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

function realPathIn(world: World, path: string): string {
  let real = normalized(path)
  for (const [link, target] of world.links) {
    if (real === link || real.startsWith(`${link}/`)) real = target + real.slice(link.length)
  }
  return real
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
  for (const link of world.links.keys()) {
    const name = link.slice(directory.length + 1)
    if (link.startsWith(`${directory}/`) && !name.includes('/')) {
      names.set(name, { name, kind: 'other', size: 0, mtimeMs: 0, isLink: true })
    }
  }
  return [...names.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
}

function fakeRepo(on: On, files: Record<string, string>, outside: Record<string, string> = {}) {
  const world: World = {
    files: new Map(),
    links: new Map(),
    touched: [],
    listed: [],
    resolved: [],
    reads: [],
  }
  for (const [path, text] of Object.entries(files)) {
    world.files.set(`${ROOT}/${path}`, { text, mtimeMs: 10 })
  }
  for (const [path, text] of Object.entries(outside)) world.files.set(path, { text, mtimeMs: 10 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.CwdChanged', () => ({}))
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', (_$, e) => {
    world.touched.push(normalized(e.path))
    const real = realPathIn(world, e.path)
    return { value: world.files.has(real) || isDirectory(world, real) }
  })
  on('fs.stat', (_$, e) => {
    world.touched.push(normalized(e.path))
    if (e.resolve) world.resolved.push(normalized(e.path))
    const real = realPathIn(world, e.path)
    const file = world.files.get(real)
    const isLink = world.links.has(normalized(e.path))
    if (file) {
      const size = new TextEncoder().encode(file.text).length
      const stat = { kind: 'file' as const, size, mtimeMs: file.mtimeMs, isLink }
      return { value: e.resolve ? { ...stat, realPath: real } : stat }
    }
    if (!isDirectory(world, real)) return { deny: `ENOENT: ${e.path}` }
    const stat = { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink }
    return { value: e.resolve ? { ...stat, realPath: real } : stat }
  })
  on('fs.list', (_$, e) => {
    world.touched.push(normalized(e.path))
    world.listed.push(normalized(e.path))
    const real = realPathIn(world, e.path)
    if (!isDirectory(world, real)) return { deny: `ENOENT: ${e.path}` }
    return { value: entriesIn(world, real) }
  })
  on('fs.read', (_$, e) => {
    world.touched.push(normalized(e.path))
    world.reads.push(normalized(e.path))
    const file = world.files.get(realPathIn(world, e.path))
    if (!file) return { deny: `ENOENT: ${e.path}` }
    return { value: file.text }
  })
  return world
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

async function startedSnapshot(engine: Engine): Promise<WorkitemsSnapshot> {
  await engine.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  return JSON.parse(await commandText(engine, 'snapshot')) as WorkitemsSnapshot
}

async function snapshotOf(engine: Engine): Promise<WorkitemsSnapshot> {
  return JSON.parse(await commandText(engine, 'snapshot')) as WorkitemsSnapshot
}

function keysOf(items: readonly WorkitemsItem[]): string[] {
  return items.map((item) => item.key)
}

function startClock(on: On): MockClock {
  return mock.clock(on, { now: 1_000 })
}

describe('beans reader', () => {
  test(
    'reads 2 beans and 1 archived bean as 3 items with priority numbers',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, BEANS_FIXTURE)
      const snapshot = await startedSnapshot($)
      expect(snapshot.state).toBe('ok')
      expect(snapshot.source).toBe('beans')
      expect(keysOf(snapshot.items)).toEqual(['beans:app-ab12', 'beans:app-cd34', 'beans:app-ef56'])
      expect(snapshot.items[0]).toEqual({
        key: 'beans:app-ab12',
        id: 'app-ab12',
        title: 'Add the export button',
        status: 'in_progress',
        rawStatus: 'in-progress',
        priority: 1,
        type: 'feature',
        assignee: null,
        updatedAt: '2026-10-02T10:30:00Z',
        source: 'beans',
        labels: ['ui'],
      })
      expect(snapshot.items[1]).toMatchObject({ status: 'open', priority: 2, parent: 'app-ab12' })
      expect(snapshot.items[2]).toMatchObject({
        status: 'closed',
        rawStatus: 'completed',
        priority: 4,
      })
    },
  )

  test(
    'closes a bean under archive whatever its status says',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.beans/archive/app-x1--old.md': '---\ntitle: Old work\nstatus: todo\n---\n',
      })
      const snapshot = await startedSnapshot($)
      expect(snapshot.items[0]).toMatchObject({ id: 'app-x1', status: 'closed', rawStatus: 'todo' })
    },
  )

  test(
    'maps critical to 0, draft to other and scrapped to closed',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.beans/app-a1--urgent.md': '---\ntitle: Urgent\nstatus: draft\npriority: critical\n---\n',
        '.beans/app-b2--dropped.md': '---\ntitle: Dropped\nstatus: scrapped\n---\n',
      })
      const snapshot = await startedSnapshot($)
      expect(snapshot.items[0]).toMatchObject({ status: 'other', priority: 0 })
      expect(snapshot.items[1]).toMatchObject({ status: 'closed', priority: null })
    },
  )

  test(
    'reads beans from the path that .beans.yml names',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.beans.yml':
          'project:\n  name: app\nbeans:\n  # the folder\n  path: work/beans\n  prefix: app-\n',
        'work/beans/app-ab12--add-the-export-button.md': BEAN_EXPORT,
      })
      const snapshot = await startedSnapshot($)
      expect(snapshot.state).toBe('ok')
      expect(keysOf(snapshot.items)).toEqual(['beans:app-ab12'])
    },
  )

  test(
    'skips only the bean whose priority word is unknown and names its file and line',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.beans/app-a1--x.md': '---\ntitle: X\nstatus: todo\npriority: urgent\n---\n',
        '.beans/app-b2--y.md': '---\ntitle: Y\nstatus: todo\n---\n',
      })
      const snapshot = await startedSnapshot($)
      expect(snapshot.state).toBe('ok')
      expect(keysOf(snapshot.items)).toEqual(['beans:app-b2'])
      expect(snapshot.caveat).toBe('1 item file skipped: .beans/app-a1--x.md line 4 is malformed.')
    },
  )
})

describe('generic reader', () => {
  test('maps JSON Lines items by the field map', { plugins: [consumer] }, async ($, on) => {
    startClock(on)
    fakeRepo(on, GENERIC_FIXTURE)
    const snapshot = await startedSnapshot($)
    expect(snapshot.state).toBe('ok')
    expect(snapshot.source).toBe('files')
    expect(snapshot.items).toEqual([
      {
        key: 'files:T-1',
        id: 'T-1',
        title: 'Add the export button',
        status: 'open',
        rawStatus: 'open',
        priority: 1,
        type: null,
        assignee: 'dev-one',
        updatedAt: null,
        source: 'files',
        labels: ['ui'],
      },
      {
        key: 'files:T-2',
        id: 'T-2',
        title: 'Fix the date parser',
        status: 'in_progress',
        rawStatus: 'in_progress',
        priority: 2,
        type: null,
        assignee: null,
        updatedAt: null,
        source: 'files',
      },
      {
        key: 'files:T-3',
        id: 'T-3',
        title: 'Write the release notes',
        status: 'closed',
        rawStatus: 'closed',
        priority: null,
        type: null,
        assignee: null,
        updatedAt: null,
        source: 'files',
      },
    ])
  })

  test('maps a JSON array file by the field map', { plugins: [consumer] }, async ($, on) => {
    startClock(on)
    fakeRepo(on, {
      '.handily.json': JSON.stringify({
        globs: ['data/items.json'],
        format: 'json',
        fields: { id: 'n', title: 'name', status: 'phase', url: 'link' },
      }),
      'data/items.json': JSON.stringify([
        { n: 7, name: 'Seven', phase: 'blocked', link: 'https://example.invalid/7' },
      ]),
    })
    const snapshot = await startedSnapshot($)
    expect(snapshot.items).toEqual([
      {
        key: 'files:7',
        id: '7',
        title: 'Seven',
        status: 'blocked',
        rawStatus: 'blocked',
        priority: null,
        type: null,
        assignee: null,
        updatedAt: null,
        source: 'files',
        url: 'https://example.invalid/7',
      },
    ])
  })

  test(
    'maps front matter files that a ** glob finds in nested folders',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.handily.json': JSON.stringify({
          globs: ['tasks/**/*.md'],
          format: 'frontmatter',
          fields: { id: 'ref', title: 'title', status: 'state', labels: 'tags', type: 'kind' },
        }),
        'tasks/one.md':
          '---\nref: A-1\ntitle: "First: quoted"\nstate: open\ntags: [ui, api]\n---\n',
        'tasks/later/two.md': "---\nref: A-2\ntitle: 'Second'\nstate: done\nkind: bug\n---\n",
        'tasks/notes.txt': 'not an item',
      })
      const snapshot = await startedSnapshot($)
      expect(keysOf(snapshot.items)).toEqual(['files:A-2', 'files:A-1'])
      expect(snapshot.items[1]).toMatchObject({ title: 'First: quoted', labels: ['ui', 'api'] })
      expect(snapshot.items[0]).toMatchObject({ status: 'other', rawStatus: 'done', type: 'bug' })
    },
  )

  test(
    'refuses by name a glob whose folder resolves outside the repo root',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      const world = fakeRepo(
        on,
        {
          '.handily.json': JSON.stringify({
            globs: ['work/shared/*.json'],
            format: 'json',
            fields: { id: 'id', title: 'title', status: 'status' },
          }),
          'work/keep.json': '[]',
        },
        { '/elsewhere/items.json': '[{"id":"x","title":"Secret","status":"open"}]' },
      )
      world.links.set(`${ROOT}/work/shared`, '/elsewhere')
      const snapshot = await startedSnapshot($)
      expect(snapshot.state).toBe('failed')
      expect(snapshot.reason).toBe(
        'work/shared resolves outside the repo root, so the glob work/shared/*.json could not be read.',
      )
      expect(world.reads.filter((path) => path.startsWith('/elsewhere'))).toEqual([])
      expect(world.listed.filter((path) => !path.startsWith(ROOT))).toEqual([])
    },
  )

  test(
    'refuses by name a glob that climbs out of the repo root',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      const world = fakeRepo(
        on,
        {
          '.handily.json': JSON.stringify({
            globs: ['../other/*.jsonl'],
            format: 'jsonl',
            fields: { id: 'id', title: 'title', status: 'status' },
          }),
        },
        { '/work/other/items.jsonl': '{"id":"x","title":"Secret","status":"open"}' },
      )
      const snapshot = await startedSnapshot($)
      expect(snapshot.reason).toBe(
        '../other resolves outside the repo root, so the glob ../other/*.jsonl could not be read.',
      )
      expect(world.listed).toEqual([])
      expect(world.reads.filter((path) => path.startsWith('/work/other'))).toEqual([])
    },
  )

  test(
    'refuses by name a linked file that leads outside',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      const world = fakeRepo(
        on,
        {
          '.handily.json': JSON.stringify({
            globs: ['work/*.jsonl'],
            format: 'jsonl',
            fields: { id: 'id', title: 'title', status: 'status' },
          }),
          'work/a.jsonl': '{"id":"a","title":"Kept","status":"open"}',
        },
        { '/elsewhere/b.jsonl': '{"id":"b","title":"Secret","status":"open"}' },
      )
      world.links.set(`${ROOT}/work/b.jsonl`, '/elsewhere/b.jsonl')
      const snapshot = await startedSnapshot($)
      expect(snapshot.reason).toBe(
        'work/b.jsonl resolves outside the repo root, so the glob work/*.jsonl could not be read.',
      )
    },
  )

  test(
    'fails by name when .handily.json has an unknown key',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, { '.handily.json': '{"glob":["work/*.json"]}' })
      const snapshot = await startedSnapshot($)
      expect(snapshot.state).toBe('failed')
      expect(snapshot.source).toBe('.handily.json')
      expect(snapshot.reason).toBe(
        '.handily.json has the key glob, which is not one of source, globs, format, fields, so it could not be read.',
      )
    },
  )

  test(
    'fails with the file and line when a JSON Lines item has no title',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        ...GENERIC_FIXTURE,
        'work/items.jsonl':
          '{"key":"T-1","summary":"Ok","state":"open"}\n{"key":"T-2","state":"open"}',
      })
      const snapshot = await startedSnapshot($)
      expect(snapshot.reason).toBe(
        'work/items.jsonl line 2 has no summary, so it could not be read.',
      )
    },
  )
})

describe('one source per repo', () => {
  test(
    'reads the first detected source and reports the other as ignored',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, { ...BEANS_FIXTURE, '.beads/issues.jsonl': BEADS_ISSUES })
      const snapshot = await startedSnapshot($)
      expect(snapshot.source).toBe('beads')
      expect(snapshot.ignored).toEqual(['beans'])
      const lines = JSON.parse(await commandText($, 'lines')) as WorkitemsLine[]
      expect(lines[1]).toEqual({
        kind: 'ignored',
        tone: 'dim',
        text: 'Using beads; ignoring beans. Name one in .handily.json to change it.',
      })
    },
  )

  test(
    'reads the source that .handily.json names and ignores the first detected',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        ...BEANS_FIXTURE,
        '.beads/issues.jsonl': BEADS_ISSUES,
        '.handily.json': '{"source":"beans"}',
      })
      const snapshot = await startedSnapshot($)
      expect(snapshot.source).toBe('beans')
      expect(snapshot.ignored).toEqual(['beads'])
      expect(snapshot.items.length).toBe(3)
    },
  )

  test(
    'fails by name when .handily.json names an unknown source',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, { '.beads/issues.jsonl': BEADS_ISSUES, '.handily.json': '{"source":"jira"}' })
      const snapshot = await startedSnapshot($)
      expect(snapshot.state).toBe('failed')
      expect(snapshot.reason).toBe(
        '.handily.json names the source jira, which is not one of beads, beans, files, so it could not be read.',
      )
    },
  )
})

describe('provider seams', () => {
  test(
    'the host lists folders and resolves real paths at the repo root',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      const world = fakeRepo(on, BEANS_FIXTURE)
      await startedSnapshot($)
      expect(world.listed).toContain(`${ROOT}/.beans`)
      expect(world.listed).toContain(`${ROOT}/.beans/archive`)
      expect(world.resolved).toContain(ROOT)
      expect(world.resolved).toContain(`${ROOT}/.beans/archive`)
      expect(world.touched.filter((path) => !path.startsWith(ROOT))).toEqual([])
    },
  )

  test(
    'a folder that cannot be listed fails with its name',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, { '.beans.yml': 'beans:\n  path: missing\n' })
      const snapshot = await startedSnapshot($)
      expect(snapshot.state).toBe('failed')
      expect(snapshot.reason).toBe(
        'the glob missing/**/*.md needs missing, which could not be read.',
      )
    },
  )

  test(
    'detection reads .handily.json, so a fix to it is seen at the next refresh',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = startClock(on)
      const world = fakeRepo(on, { ...BEANS_FIXTURE, '.handily.json': '{"source":"nope"}' })
      expect((await startedSnapshot($)).state).toBe('failed')
      world.files.set(`${ROOT}/.handily.json`, { text: '{"source":"beans"}', mtimeMs: 20 })
      await clock.advance(2_000)
      const snapshot = await snapshotOf($)
      expect(snapshot.state).toBe('ok')
      expect(snapshot.source).toBe('beans')
    },
  )

  test(
    'the poll sees an edit inside a nested bean file and skips an unchanged tree',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = startClock(on)
      const world = fakeRepo(on, BEANS_FIXTURE)
      await startedSnapshot($)
      const readsAfterStart = world.reads.length
      await clock.advance(2_000)
      expect(world.reads.length).toBe(readsAfterStart)
      world.files.set(`${ROOT}/.beans/archive/app-ef56--write-the-release-notes.md`, {
        text: BEAN_ARCHIVED.replace('Write the release notes', 'Write the notes'),
        mtimeMs: 30,
      })
      await clock.advance(2_000)
      const snapshot = await snapshotOf($)
      expect(snapshot.items[2]?.title).toBe('Write the notes')
    },
  )
})

describe('review regressions', () => {
  test(
    'ignored follows a second tracker that appears while the first is unchanged',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = startClock(on)
      const world = fakeRepo(on, { '.beads/issues.jsonl': BEADS_ISSUES })
      expect((await startedSnapshot($)).ignored).toEqual([])
      world.files.set(`${ROOT}/.beans/app-ab12--add-the-export-button.md`, {
        text: BEAN_EXPORT,
        mtimeMs: 10,
      })
      await clock.advance(2_000)
      expect((await snapshotOf($)).ignored).toEqual(['beans'])
    },
  )

  test(
    'a linked bean inside the root is read again after its target changes',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = startClock(on)
      const world = fakeRepo(on, {
        'store/app-l1.md': '---\ntitle: One\nstatus: todo\n---\n',
        '.beans/keep/app-k1--k.md': '---\ntitle: K\nstatus: todo\n---\n',
      })
      world.links.set(`${ROOT}/.beans/app-l1--linked.md`, `${ROOT}/store/app-l1.md`)
      expect((await startedSnapshot($)).state).toBe('ok')
      world.files.set(`${ROOT}/store/app-l1.md`, {
        text: '---\ntitle: Two words\nstatus: todo\n---\n',
        mtimeMs: 99,
      })
      await clock.advance(2_000)
      const snapshot = await snapshotOf($)
      expect(snapshot.items.find((item) => item.id === 'app-l1')?.title).toBe('Two words')
    },
  )

  test(
    'a linked file that a glob matches is read again after its target changes',
    { plugins: [consumer] },
    async ($, on) => {
      const clock = startClock(on)
      const world = fakeRepo(on, {
        '.handily.json': JSON.stringify({
          globs: ['work/*.jsonl'],
          format: 'jsonl',
          fields: { id: 'id', title: 'title', status: 'status' },
        }),
        'data/a.jsonl': '{"id":"a","title":"One","status":"open"}',
        'work/keep.txt': 'x',
      })
      world.links.set(`${ROOT}/work/a.jsonl`, `${ROOT}/data/a.jsonl`)
      expect((await startedSnapshot($)).items[0]?.title).toBe('One')
      world.files.set(`${ROOT}/data/a.jsonl`, {
        text: '{"id":"a","title":"Two","status":"open"}',
        mtimeMs: 50,
      })
      await clock.advance(2_000)
      expect((await snapshotOf($)).items[0]?.title).toBe('Two')
    },
  )

  test(
    'a bean file without a slug keeps its whole name as the id',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.beans/app-ab12.md': '---\ntitle: X\nstatus: todo\n---\n',
        '.beans/app.cd34--with-a-dot.md': '---\ntitle: Y\nstatus: todo\n---\n',
      })
      const snapshot = await startedSnapshot($)
      expect(snapshot.items.map((item) => item.id)).toEqual(['app-ab12', 'app.cd34'])
    },
  )

  test('reads a block scalar in front matter', { plugins: [consumer] }, async ($, on) => {
    startClock(on)
    fakeRepo(on, {
      '.beans/app-a1--x.md': [
        '---',
        'title: >-',
        '  A folded',
        '  title',
        'status: todo',
        'note: |',
        '  line one',
        '',
        '  line two',
        '---',
        '',
      ].join('\n'),
    })
    const snapshot = await startedSnapshot($)
    expect([snapshot.state, snapshot.reason, snapshot.caveat]).toEqual(['ok', null, null])
    expect(snapshot.items[0]?.title).toBe('A folded title')
  })

  test('reads a list at column 0 under its key', { plugins: [consumer] }, async ($, on) => {
    startClock(on)
    fakeRepo(on, {
      '.beans/app-a1--x.md': '---\ntitle: X\nstatus: todo\ntags:\n- ui\n- api\n---\n',
    })
    const snapshot = await startedSnapshot($)
    expect([snapshot.state, snapshot.caveat]).toEqual(['ok', null])
    expect(snapshot.items[0]?.labels).toEqual(['ui', 'api'])
  })

  test('reads a quoted value with a trailing comment', { plugins: [consumer] }, async ($, on) => {
    startClock(on)
    fakeRepo(on, {
      '.beans/app-a1--x.md':
        '---\ntitle: "X # not a comment" # a comment\nstatus: \'todo\' # c\n---\n',
    })
    const snapshot = await startedSnapshot($)
    expect([snapshot.state, snapshot.caveat]).toEqual(['ok', null])
    expect(snapshot.items[0]).toMatchObject({ title: 'X # not a comment', rawStatus: 'todo' })
  })

  test(
    'a front matter form it cannot read skips only that bean and names it',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.beans/app-a1--x.md': '---\ntitle:\n  nested: map\nstatus: todo\n---\n',
        '.beans/app-b2--y.md': '---\ntitle: Y\nstatus: todo\nextra: {a: 1}\n---\n',
      })
      const snapshot = await startedSnapshot($)
      expect(snapshot.state).toBe('ok')
      expect(keysOf(snapshot.items)).toEqual(['beans:app-b2'])
      expect(snapshot.caveat).toBe('1 item file skipped: .beans/app-a1--x.md line 2 is malformed.')
    },
  )

  test(
    'a generic front matter file that it cannot read skips only that item',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.handily.json': JSON.stringify({
          globs: ['tasks/*.md'],
          format: 'frontmatter',
          fields: { id: 'ref', title: 'title', status: 'state' },
        }),
        'tasks/a.md': '---\nref: A-1\ntitle: A\nstate: open\n---\n',
        'tasks/b.md': 'no front matter',
        'tasks/c.md': '---\nref: A-3\nstate: open\n---\n',
      })
      const snapshot = await startedSnapshot($)
      expect(keysOf(snapshot.items)).toEqual(['files:A-1'])
      expect(snapshot.caveat).toBe(
        '2 item files skipped, the first: tasks/b.md line 1 is malformed.',
      )
    },
  )

  for (const rank of ['" "', '"0x1"', '"1e1"', '"-1"', '1.5']) {
    test(
      `fails on the priority ${rank}, which is not a whole number`,
      { plugins: [consumer] },
      async ($, on) => {
        startClock(on)
        fakeRepo(on, {
          ...GENERIC_FIXTURE,
          'work/items.jsonl': `{"key":"T-1","summary":"Ok","state":"open","rank":${rank}}\n`,
        })
        const snapshot = await startedSnapshot($)
        expect([snapshot.state, snapshot.reason]).toEqual([
          'failed',
          'work/items.jsonl line 1 is malformed.',
        ])
      },
    )
  }

  test('reads a priority string of digits as a number', { plugins: [consumer] }, async ($, on) => {
    startClock(on)
    fakeRepo(on, {
      ...GENERIC_FIXTURE,
      'work/items.jsonl': '{"key":"T-1","summary":"Ok","state":"open","rank":"3"}\n',
    })
    expect((await startedSnapshot($)).items[0]?.priority).toBe(3)
  })

  test(
    'a mapped field that only the object prototype has reads as absent',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.handily.json': JSON.stringify({
          globs: ['work/*.jsonl'],
          format: 'jsonl',
          fields: { id: 'key', title: 'summary', status: 'state', type: 'constructor' },
        }),
        'work/items.jsonl': '{"key":"T-1","summary":"Ok","state":"open"}\n',
      })
      const snapshot = await startedSnapshot($)
      expect([snapshot.state, snapshot.reason, snapshot.items[0]?.type]).toEqual(['ok', null, null])
    },
  )

  test(
    'reads beans at the repo root when .beans.yml names the path .',
    { plugins: [consumer] },
    async ($, on) => {
      startClock(on)
      fakeRepo(on, {
        '.beans.yml': 'beans:\n  path: .\n',
        'app-a1--x.md': '---\ntitle: X\nstatus: todo\n---\n',
        'archive/app-b2--y.md': '---\ntitle: Y\nstatus: todo\n---\n',
      })
      const snapshot = await startedSnapshot($)
      expect([snapshot.state, snapshot.reason]).toEqual(['ok', null])
      expect(snapshot.items.map((item) => [item.id, item.status])).toEqual([
        ['app-a1', 'open'],
        ['app-b2', 'closed'],
      ])
    },
  )

  test('reads .handily.json once per poll', { plugins: [consumer] }, async ($, on) => {
    const clock = startClock(on)
    const world = fakeRepo(on, GENERIC_FIXTURE)
    await startedSnapshot($)
    const configReads = (): number =>
      world.reads.filter((path) => path === `${ROOT}/.handily.json`).length
    const before = configReads()
    await clock.advance(2_000)
    expect(configReads() - before).toBe(1)
  })
})

describe('confinement of every glob form', () => {
  const globs = [
    'work/../../other/items.jsonl',
    '*/../../other/*.jsonl',
    '**/../../other/*.jsonl',
    '/work/other/*.jsonl',
    './../other/*.jsonl',
  ]
  for (const glob of globs) {
    test(
      `refuses ${glob} and touches nothing outside the root`,
      { plugins: [consumer] },
      async ($, on) => {
        startClock(on)
        const world = fakeRepo(
          on,
          {
            '.handily.json': JSON.stringify({
              globs: [glob],
              format: 'jsonl',
              fields: { id: 'id', title: 'title', status: 'status' },
            }),
            'work/k.txt': 'x',
          },
          { '/work/other/items.jsonl': '{"id":"x","title":"Secret","status":"open"}' },
        )
        const snapshot = await startedSnapshot($)
        expect(snapshot.state).toBe('failed')
        expect(snapshot.reason).toContain(glob)
        expect(world.reads.filter((path) => !path.startsWith(ROOT))).toEqual([])
        expect(world.listed.filter((path) => !path.startsWith(ROOT))).toEqual([])
      },
    )
  }
})
