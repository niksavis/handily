import type { FsEntry, On, RenderPropsOf, RenderSurface } from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type MockClock,
  type Mounted,
} from 'claude-code/testing'
import { displayWidth } from './hooks/width'

const ROOT = '/work/app'
const PLUGIN = 'handily-filetree'
const PANE = 'files'
const SURFACES: readonly RenderSurface[] = ['terminal', 'desktop']
const RULE_41 = '─'.repeat(41)

type FakeFolder = FsEntry[] | string

type FakeFile = { kind: 'file' | 'dir'; text: string; mtimeMs: number }

type GitAnswer =
  | { kind: 'ok'; stdout: string; isCut?: boolean; tookMs?: number }
  | { kind: 'exit'; exitCode: number; stderr: string }
  | { kind: 'reject'; message: string; tookMs: number }

type GitRun = { argv: readonly string[]; cwd: string | undefined; timeoutMs: number | undefined }

type World = {
  folders: Map<string, FakeFolder>
  files: Map<string, FakeFile>
  listed: string[]
  stats: string[]
  runs: GitRun[]
  runStarts: number[]
  inFlight: number
  mostInFlight: number
  cwd: string
  answer: GitAnswer
  clock: MockClock
  commands: string[]
  panes: Set<string>
  shown: string | undefined
  opens: { id: string; title: string | undefined; focus: boolean }[]
  closes: string[]
  logs: string[]
}

type WorldOptions = { unplacedReason?: string }

const NO_CHANGES: GitAnswer = { kind: 'ok', stdout: '# branch.oid 1a2b3c\0# branch.head main\0' }

function gitResult(stdout: string, exitCode: number, stderr: string, isCut: boolean) {
  return { exitCode, stdout, stderr, isStdoutTruncated: isCut, isStderrTruncated: false }
}

function fakeGit(on: On, seen: World): void {
  on('fs.stat', (_$, e) => {
    seen.stats.push(e.path)
    const found = seen.files.get(e.path)
    if (found === undefined) return { deny: `ENOENT: no such file or directory, stat '${e.path}'` }
    const size = found.text.length
    return { value: { kind: found.kind, size, mtimeMs: found.mtimeMs, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    const found = seen.files.get(e.path)
    if (found?.kind !== 'file')
      return { deny: `ENOENT: no such file or directory, open '${e.path}'` }
    return { value: found.text }
  })
  on('process.run', async (_$, e) => {
    seen.runs.push({ argv: e.argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
    seen.runStarts.push(seen.clock.now())
    const answer = seen.answer
    if (answer.kind === 'exit')
      return { value: gitResult('', answer.exitCode, answer.stderr, false) }
    seen.inFlight += 1
    seen.mostInFlight = Math.max(seen.mostInFlight, seen.inFlight)
    if (answer.tookMs !== undefined) await seen.clock.sleep(answer.tookMs)
    seen.inFlight -= 1
    if (answer.kind === 'reject') return { deny: answer.message }
    return { value: gitResult(answer.stdout, 0, '', answer.isCut === true) }
  })
}

function relativeOf(path: string): string {
  if (path === ROOT) return '.'
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path
}

function file(name: string): FsEntry {
  return { name, kind: 'file', size: 1, mtimeMs: 1, isLink: false }
}

function folder(name: string): FsEntry {
  return { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
}

function link(name: string): FsEntry {
  return { name, kind: 'other', size: 0, mtimeMs: 0, isLink: true }
}

function numbered(count: number): FsEntry[] {
  return Array.from({ length: count }, (_, index) =>
    file(`a${String(index + 1).padStart(4, '0')}.ts`),
  )
}

const APP: [string, FsEntry[]][] = [
  [
    '.',
    [
      file('README.md'),
      folder('scripts'),
      file('.gitignore'),
      folder('node_modules'),
      folder('docs'),
      folder('.git'),
      folder('hooks'),
    ],
  ],
  ['docs', [file('mocks.md'), file('design.md'), file('install.md'), file('guide.md')]],
  ['hooks', [file('pane.tsx'), folder('dist'), file('register.tsx')]],
  ['scripts', [file('mods.mjs')]],
]

function world(on: On, entries: readonly [string, FakeFolder][], options: WorldOptions = {}) {
  const seen: World = {
    folders: new Map(entries),
    files: new Map(),
    listed: [],
    stats: [],
    runs: [],
    runStarts: [],
    inFlight: 0,
    mostInFlight: 0,
    cwd: ROOT,
    answer: NO_CHANGES,
    clock: mock.clock(on, { now: 1_000_000 }),
    commands: [],
    panes: new Set(),
    shown: undefined,
    opens: [],
    closes: [],
    logs: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: seen.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('fs.list', (_$, e) => {
    const path = relativeOf(e.path)
    seen.listed.push(path)
    const found = seen.folders.get(path)
    if (found === undefined) return { deny: 'ENOENT: no such file or directory, scandir' }
    if (typeof found === 'string') return { deny: found }
    return { value: found }
  })
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    seen.panes.add(e.id)
    seen.opens.push({ id: e.id, title: e.title, focus: e.focus === true })
    if (seen.shown === undefined || e.focus === true) seen.shown = e.id
    if (options.unplacedReason !== undefined) {
      return { value: { isPlaced: false as const, reason: options.unplacedReason } }
    }
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    seen.panes.delete(e.id)
    seen.closes.push(e.id)
    if (seen.shown === e.id) seen.shown = [...seen.panes][0]
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...seen.panes].map((id) => ({
      id,
      title: id,
      isShown: id === seen.shown,
      isFocused: false,
      isPlaced: options.unplacedReason === undefined,
    })),
  }))
  on('ui.log', (_$, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  fakeGit(on, seen)
  return seen
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

async function tree($: Engine, args: string): Promise<string> {
  const result = await $.command.run({
    command: 'tree',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  return result.text ?? ''
}

function paneProps(placement: 'dock' | 'inline', bodyColumns: number): RenderPropsOf['Pane'] {
  return {
    title: 'files',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  }
}

async function mountFiles(
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

type Drawn = { type: string; props: Record<string, unknown>; text: string; children: Drawn[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function drawnOf(value: unknown): Drawn | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const props = isRecord(value.props) ? value.props : {}
  const raw = Array.isArray(value.children) ? (value.children as unknown[]) : []
  const children = raw.map(drawnOf).filter((child) => child !== null)
  const own = raw.map((child) => (typeof child === 'string' ? child : '')).join('')
  const text =
    value.type === 'Button' && props.plain !== true && typeof props.label === 'string'
      ? `[ ${props.label} ]`
      : `${own}${children.map((child) => child.text).join('')}`
  return { type: value.type, props, text, children }
}

function linesOf(element: Drawn): string[] {
  if (element.type !== 'Box') return [element.text]
  const indent = typeof element.props.paddingLeft === 'number' ? element.props.paddingLeft : 0
  const lines =
    element.props.flexDirection === 'row' ? [element.text] : element.children.flatMap(linesOf)
  return lines.map((line) => `${' '.repeat(indent)}${line}`)
}

async function screen(ui: { find: Mounted['find'] }, columns = 41): Promise<string[]> {
  const root = drawnOf(await ui.find({ type: 'Box' }))
  if (root === null) throw new Error('the pane drew no Box')
  const lines = linesOf(root).map((line) => line.trimEnd())
  for (const line of lines) {
    expect(displayWidth(line) <= columns, `"${line}" is wider than ${String(columns)}`).toBe(true)
  }
  return lines
}

async function treeLines(ui: { find: Mounted['find'] }, columns = 41): Promise<string[]> {
  const lines = await screen(ui, columns)
  return lines.slice(lines.indexOf('─'.repeat(columns)) + 1)
}

describe('/tree', () => {
  test('registers /tree at session start', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    expect(seen.commands).toEqual(['tree'])
  })

  test('/tree opens the files tab with the focus, and /tree on the shown tab closes it', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    expect(await tree($, '')).toBe('Tree opened: files.')
    expect(seen.opens).toEqual([{ id: PANE, title: 'files', focus: true }])
    expect(await tree($, '')).toBe('Tree closed.')
    expect(seen.panes.size).toBe(0)
    expect(await tree($, '  ')).toBe('Tree opened: files.')
    expect(seen.opens).toHaveLength(2)
  })

  test('/tree close closes the tab, and says so when it is not open', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    expect(await tree($, 'close')).toBe('The tree is not open. Run /tree to open it.')
    expect(seen.closes).toEqual([])
    await tree($, '')
    expect(await tree($, 'close')).toBe('Tree closed.')
    expect(seen.closes).toEqual([PANE])
  })

  test('/tree shows the files tab when another tab is shown, and keeps it open', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    await tree($, '')
    seen.panes.add('tasks')
    seen.shown = 'tasks'
    expect(await tree($, '')).toBe('Tree opened: files.')
    expect(seen.opens.at(-1)).toEqual({ id: PANE, title: 'files', focus: true })
    expect(seen.shown).toBe(PANE)
    expect(seen.closes).toEqual([])
  })

  test('/tree with an unknown argument prints the usage and opens nothing', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    expect(await tree($, 'open now')).toBe(
      'Unknown argument "open now". Use /tree to open or close the files tab, or /tree close.',
    )
    expect(seen.opens).toEqual([])
  })

  test('/tree says why the tab is not drawn yet', async ($, on) => {
    world(on, APP, { unplacedReason: 'The terminal is too narrow.' })
    await start($)
    expect(await tree($, '')).toBe(
      'Tree opened, but this session does not show it yet: The terminal is too narrow.',
    )
  })
})

describe('the files tab, docked', () => {
  test('lists the working folder with folders first, pruned folders not listed and dotfiles dim', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    for (const surface of SURFACES) {
      const ui = await mountFiles($, surface)
      expect(await screen(ui)).toEqual([
        'Files  app · not a git repo',
        '[ refresh ]',
        'No git status here; git init adds it.',
        RULE_41,
        '▸ .git/  not listed',
        '▸ node_modules/  not listed',
        '▸ docs/',
        '▸ hooks/',
        '▸ scripts/',
        '  .gitignore',
        '  README.md',
      ])
      expect((await ui.find({ type: 'Text', text: '  .gitignore' }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: '  README.md' }))?.props.dimColor).toBe(false)
      expect((await ui.find({ type: 'Text', text: 'Files' }))?.props.bold).toBe(true)
      expect((await ui.findAll({ type: 'Button' })).map((button) => button.key)).toEqual([
        'refresh',
        'open:docs',
        'open:hooks',
        'open:scripts',
      ])
      await ui.unmount()
    }
    expect(new Set(seen.listed)).toEqual(new Set(['.']))
  })

  test('a press on a folder lists it, indented under it, and a second press closes it', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    for (const surface of SURFACES) {
      const ui = await mountFiles($, surface)
      await ui.press({ key: 'open:docs' })
      await ui.press({ key: 'open:hooks' })
      expect(await treeLines(ui)).toEqual([
        '▸ .git/  not listed',
        '▸ node_modules/  not listed',
        '▾ docs/',
        '    design.md',
        '    guide.md',
        '    install.md',
        '    mocks.md',
        '▾ hooks/',
        '  ▸ dist/  not listed',
        '    pane.tsx',
        '    register.tsx',
        '▸ scripts/',
        '  .gitignore',
        '  README.md',
      ])
      expect(seen.listed).not.toContain('scripts')
      expect(seen.listed).not.toContain('hooks/dist')
      await ui.press({ key: 'open:docs' })
      await ui.press({ key: 'open:hooks' })
      expect(await treeLines(ui)).not.toContain('    design.md')
      expect(await ui.find({ type: 'Text', text: '▸ docs/' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('refresh lists the open folders again', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    const ui = await mountFiles($, 'terminal')
    seen.folders.set('.', [...(APP[0]?.[1] ?? []), file('NOTES.md')])
    expect(await treeLines(ui)).not.toContain('  NOTES.md')
    await ui.press({ key: 'refresh' })
    expect(await treeLines(ui)).toContain('  NOTES.md')
    expect((await ui.find({ key: 'refresh' }))?.props.hotkey).toBe('r')
    await ui.unmount()
  })

  test('a redraw lists no folder again, and opening a folder lists it again', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    const ui = await mountFiles($, 'terminal')
    await ui.press({ key: 'open:docs' })
    await ui.press({ key: 'open:hooks' })
    const before = seen.listed.length
    for (let offset = 1; offset <= 10; offset += 1) {
      await ui.redraw({ ...paneProps('dock', 41), scroll: { offset, bodyRows: 40 } })
    }
    expect(seen.listed.length).toBe(before)
    seen.folders.set('docs', [file('design.md'), file('new.md')])
    await ui.press({ key: 'open:docs' })
    expect(seen.listed.length).toBe(before)
    await ui.press({ key: 'open:docs' })
    expect(seen.listed.slice(before)).toEqual(['docs'])
    expect(await treeLines(ui)).toContain('    new.md')
    await ui.unmount()
  })

  test('a closed and opened tab lists the working folder again', async ($, on) => {
    const seen = world(on, APP)
    await start($)
    await tree($, '')
    const first = await mountFiles($, 'terminal')
    await first.unmount()
    seen.folders.set('.', [...(APP[0]?.[1] ?? []), file('NOTES.md')])
    expect(await tree($, '')).toBe('Tree closed.')
    expect(await tree($, '')).toBe('Tree opened: files.')
    const ui = await mountFiles($, 'terminal')
    expect(await treeLines(ui)).toContain('  NOTES.md')
    await ui.unmount()
  })

  test('an empty folder says so', async ($, on) => {
    world(on, [['.', []]])
    await start($)
    for (const surface of SURFACES) {
      const ui = await mountFiles($, surface)
      expect(await treeLines(ui)).toEqual(['This folder is empty.'])
      await ui.unmount()
    }
  })

  test('a folder that cannot be listed says why, and the rest of the tree stays', async ($, on) => {
    const seen = world(on, [
      ['.', [folder('hooks'), file('README.md')]],
      ['hooks', 'EACCES: permission denied, scandir'],
    ])
    await start($)
    const ui = await mountFiles($, 'terminal')
    await ui.press({ key: 'open:hooks' })
    expect(await treeLines(ui)).toEqual([
      '▾ hooks/',
      '  Cannot list hooks/: permission denied.',
      '  README.md',
    ])
    const line = await ui.find({ type: 'Text', text: /Cannot list/ })
    expect(line?.props.color).toBe('error')
    expect(seen.logs.some((log) => log.includes('EACCES'))).toBe(true)
    await ui.unmount()
  })

  test('a nested folder that cannot be listed shows its name at its indent, cut to fit', async ($, on) => {
    world(on, [
      ['.', [folder('src')]],
      ['src', [folder('deeply-nested-folder-name')]],
      ['src/deeply-nested-folder-name', 'EACCES: permission denied, scandir'],
    ])
    await start($)
    const ui = await mountFiles($, 'terminal', 'dock', 24)
    await ui.press({ key: 'open:src' })
    await ui.press({ key: 'open:src/deeply-nested-folder-name' })
    expect(await treeLines(ui, 24)).toEqual([
      '▾ src/',
      '  ▾ deeply-nested-folde…',
      '    Cannot list deeply-…',
    ])
    await ui.unmount()
  })

  test('the working folder that cannot be listed says why', async ($, on) => {
    world(on, [['.', 'the disk went away']])
    await start($)
    const ui = await mountFiles($, 'desktop')
    expect(await treeLines(ui)).toEqual(['Cannot list app/: see the transcript log.'])
    await ui.unmount()
  })

  test('a link is drawn as an entry and never opened', async ($, on) => {
    world(on, [['.', [link('current'), folder('src')]]])
    await start($)
    const ui = await mountFiles($, 'terminal')
    expect(await treeLines(ui)).toEqual(['▸ src/', '  current'])
    expect(await ui.find({ key: 'open:current' })).toBeUndefined()
    await ui.unmount()
  })

  test('a name with a control or bidi character is drawn escaped', async ($, on) => {
    world(on, [['.', [file('evil\u202Egnp.exe'), file('tab\there')]]])
    await start($)
    const ui = await mountFiles($, 'terminal')
    expect(await treeLines(ui)).toEqual(['  evil\\u202egnp.exe', '  tab\\u0009here'])
    await ui.unmount()
  })

  test('a narrow dock cuts a long name with the cut mark', async ($, on) => {
    world(on, [['.', [folder('a-folder-with-a-very-long-name'), file('short.md')]]])
    await start($)
    const ui = await mountFiles($, 'terminal', 'dock', 24)
    expect(await treeLines(ui, 24)).toEqual(['▸ a-folder-with-a-very-…', '  short.md'])
    await ui.unmount()
  })
})

describe('the 200 entry cap', () => {
  for (const surface of SURFACES) {
    test(`a folder of more than 200 entries draws 200 and a more button that draws the rest on the ${surface}`, async ($, on) => {
      world(on, [
        ['.', [folder('src'), file('README.md')]],
        ['src', [folder('gen')]],
        ['src/gen', numbered(1840)],
      ])
      await start($)
      const ui = await mountFiles($, surface)
      await ui.press({ key: 'open:src' })
      await ui.press({ key: 'open:src/gen' })
      const capped = await treeLines(ui)
      expect(capped.slice(0, 4)).toEqual(['▾ src/', '  ▾ gen/', '      a0001.ts', '      a0002.ts'])
      expect(capped.filter((line) => line.startsWith('      a'))).toHaveLength(200)
      expect(capped.slice(-2)).toEqual(['      [ +1,640 more in gen/ ]', '  README.md'])
      await ui.press({ key: 'more:src/gen' })
      const whole = await treeLines(ui)
      expect(whole.filter((line) => line.startsWith('      a'))).toHaveLength(1840)
      expect(whole.slice(-2)).toEqual(['      a1840.ts', '  README.md'])
      expect(await ui.find({ key: 'more:src/gen' })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('the working folder of more than 200 entries names itself on the more button', async ($, on) => {
    world(on, [['.', numbered(201)]])
    await start($)
    const ui = await mountFiles($, 'terminal')
    const lines = await treeLines(ui)
    expect(lines).toHaveLength(201)
    expect(lines.at(-1)).toBe('  [ +1 more in app/ ]')
    await ui.unmount()
  })

  test('the cap cuts the sorted listing, so folders after 200 files still come first', async ($, on) => {
    world(on, [['.', [...numbered(205), folder('zeta'), folder('alpha'), folder('node_modules')]]])
    await start($)
    const ui = await mountFiles($, 'terminal')
    const lines = await treeLines(ui)
    expect(lines.slice(0, 4)).toEqual([
      '▸ node_modules/  not listed',
      '▸ alpha/',
      '▸ zeta/',
      '  a0001.ts',
    ])
    expect(lines.at(-1)).toBe('  [ +8 more in app/ ]')
    await ui.unmount()
  })

  test('the more button is cut to fit a narrow dock', async ($, on) => {
    world(on, [
      ['.', [folder('a-folder-with-a-very-long-name')]],
      ['a-folder-with-a-very-long-name', numbered(1201)],
    ])
    await start($)
    const ui = await mountFiles($, 'terminal', 'dock', 24)
    await ui.press({ key: 'open:a-folder-with-a-very-long-name' })
    expect((await treeLines(ui, 24)).at(-1)).toBe('    [ +1,001 more in … ]')
    await ui.unmount()
  })

  test('a folder of exactly 200 entries has no more button', async ($, on) => {
    world(on, [['.', numbered(200)]])
    await start($)
    const ui = await mountFiles($, 'terminal')
    expect(await treeLines(ui)).toHaveLength(200)
    expect(await ui.find({ type: 'Button', text: /more in/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('the files tab, inline above the prompt', () => {
  test('draws a flat list of at most 8 rows, the last naming what is left', async ($, on) => {
    world(on, [
      ['.', [...(APP[0]?.[1] ?? []), file('a.md'), file('b.md'), file('c.md'), file('d.md')]],
      ['docs', [file('design.md')]],
    ])
    await start($)
    for (const surface of SURFACES) {
      const ui = await mountFiles($, surface, 'inline', 76)
      const lines = await screen(ui, 76)
      expect(lines).toEqual([
        'Files  app · not a git repo[ refresh ]',
        '.git/  not listed',
        'node_modules/  not listed',
        'docs/',
        'hooks/',
        'scripts/',
        '.gitignore',
        'a.md',
        '+4 more: a dock (fullscreen, 110 columns) shows the tree',
      ])
      expect(lines.length - 1).toBe(8)
      expect((await ui.findAll({ type: 'Button' })).map((button) => button.key)).toEqual([
        'refresh',
      ])
      await ui.unmount()
    }
  })

  test('draws every entry when there are 8 or fewer', async ($, on) => {
    const seen = world(on, [
      ['.', [folder('src'), file('a.md')]],
      ['src', [file('b.md')]],
    ])
    await start($)
    const ui = await mountFiles($, 'terminal', 'inline', 76)
    expect((await screen(ui, 76)).slice(1)).toEqual(['src/', 'a.md'])
    expect(seen.listed).not.toContain('src')
    await ui.unmount()
  })
})

const GIT_DIR = `${ROOT}/.git`
const HASH = 'a'.repeat(40)
const DOCKED_PANE = paneProps('dock', 41)

const GIT_APP: [string, FsEntry[]][] = [
  ...APP.filter(([path]) => path !== 'docs'),
  [
    'docs',
    [
      file('mocks.md'),
      file('design.md'),
      file('install.md'),
      file('guide.md'),
      file('filetree.md'),
    ],
  ],
]

function changed(xy: string, path: string): string {
  return `1 ${xy} N... 100644 100644 100644 ${HASH} ${HASH} ${path}\0`
}

function renamed(xy: string, path: string, from: string): string {
  return `2 ${xy} N... 100644 100644 100644 ${HASH} ${HASH} R100 ${path}\0${from}\0`
}

function conflicted(path: string): string {
  return `u UU N... 100644 100644 100644 100644 ${HASH} ${HASH} ${HASH} ${path}\0`
}

function untracked(path: string): string {
  return `? ${path}\0`
}

function statusOf(records: readonly string[], options: { ab?: string; oid?: string } = {}) {
  const ab =
    options.ab === undefined ? '' : `# branch.upstream origin/main\0# branch.ab ${options.ab}\0`
  return `# branch.oid ${options.oid ?? HASH}\0# branch.head main\0${ab}${records.join('')}`
}

const CLEAN = statusOf([])

const APP_CHANGES = statusOf(
  [
    changed('.M', 'docs/design.md'),
    changed('.M', 'docs/mocks.md'),
    changed('.M', 'hooks/pane.tsx'),
    changed('.D', 'hooks/old-pane.tsx'),
    changed('M.', 'README.md'),
    untracked('docs/filetree.md'),
  ],
  { ab: '+1 -0' },
)

const STATUS_ARGV = [
  'git',
  '--no-optional-locks',
  'status',
  '--porcelain=v2',
  '--branch',
  '-z',
  '--untracked-files=normal',
  '--',
  '.',
]

function gitFolder(seen: World, gitDir = GIT_DIR, head = 'ref: refs/heads/main\n'): void {
  if (gitDir === GIT_DIR) seen.files.set(GIT_DIR, { kind: 'dir', text: '', mtimeMs: 1 })
  seen.files.set(`${gitDir}/HEAD`, { kind: 'file', text: head, mtimeMs: 1 })
  seen.files.set(`${gitDir}/index`, { kind: 'file', text: 'DIRC', mtimeMs: 1 })
}

function gitWorld(on: On, entries: readonly [string, FakeFolder][], answer: GitAnswer): World {
  const seen = world(on, entries)
  gitFolder(seen)
  seen.answer = answer
  return seen
}

function touch(seen: World, path: string, text?: string): void {
  const found = seen.files.get(path)
  if (found === undefined) throw new Error(`no fake file ${path}`)
  seen.files.set(path, { ...found, text: text ?? found.text, mtimeMs: found.mtimeMs + 1 })
}

async function openTab($: Engine): Promise<void> {
  await start($)
  expect(await tree($, '')).toBe('Tree opened: files.')
}

async function mountSettled(
  $: Engine,
  seen: World,
  surface: RenderSurface,
  placement: 'dock' | 'inline' = 'dock',
  columns = 41,
) {
  const ui = await mountFiles($, surface, placement, columns)
  await seen.clock.settle()
  return ui
}

async function openFiles(
  $: Engine,
  seen: World,
  surface: RenderSurface = 'terminal',
  placement: 'dock' | 'inline' = 'dock',
  columns = 41,
) {
  await openTab($)
  return mountSettled($, seen, surface, placement, columns)
}

async function headerOf(ui: { find: Mounted['find'] }, columns = 41): Promise<string[]> {
  const lines = await screen(ui, columns)
  return lines.slice(0, lines.indexOf('─'.repeat(columns)))
}

function underTool(on: On): void {
  on('tool.call', () => ({ result: '' }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
}

describe('git status: letters and counts', () => {
  for (const surface of SURFACES) {
    test(`one git status in porcelain v2 marks files with letters and folders with counts on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      const ui = await openFiles($, seen, surface)
      await ui.press({ key: 'open:docs' })
      await ui.press({ key: 'open:hooks' })
      expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', '[ refresh ]'])
      expect(await treeLines(ui)).toEqual([
        '▸ .git/  not listed',
        '▸ node_modules/  not listed',
        '▾ docs/  M2 ?1',
        '    design.md           M',
        '    filetree.md         ?',
        '    guide.md',
        '    install.md',
        '    mocks.md            M',
        '▾ hooks/  M1 D1',
        '  ▸ dist/  not listed',
        '    old-pane.tsx        D',
        '    pane.tsx            M',
        '    register.tsx',
        '▸ scripts/',
        '  .gitignore',
        '  README.md             M',
      ])
      expect((await ui.find({ type: 'Text', text: /^M$/ }))?.props.color).toBe('warning')
      expect((await ui.find({ type: 'Text', text: /^D$/ }))?.props.color).toBe('error')
      expect((await ui.find({ type: 'Text', text: /^\?$/ }))?.props.color).toBe('success')
      expect(seen.runs).toEqual([{ argv: STATUS_ARGV, cwd: ROOT, timeoutMs: 10_000 }])
      await ui.unmount()
    })
  }

  test('a conflict shows U, and a rename shows R and the file it came from', async ($, on) => {
    const seen = gitWorld(
      on,
      [
        ['.', [folder('src')]],
        ['src', [file('merge.ts'), file('routes.ts'), file('moved.ts')]],
      ],
      {
        kind: 'ok',
        stdout: statusOf([
          conflicted('src/merge.ts'),
          renamed('R.', 'src/routes.ts', 'src/api.ts'),
          renamed('.R', 'src/moved.ts', 'lib/moved.ts'),
        ]),
      },
    )
    const ui = await openFiles($, seen)
    await ui.press({ key: 'open:src' })
    expect(await treeLines(ui)).toEqual([
      '▾ src/  U1 R2',
      '    merge.ts            U',
      '    moved.ts            R',
      '      renamed from lib/moved.ts · not st…',
      '    routes.ts           R',
      '      renamed from api.ts · staged',
    ])
    expect((await ui.find({ type: 'Text', text: /^U$/ }))?.props.color).toBe('error')
    await ui.unmount()
  })

  test('an untracked folder shows ? and so does each entry in it, and a deleted folder shows its files', async ($, on) => {
    const seen = gitWorld(
      on,
      [
        ['.', [folder('scratch'), folder('src')]],
        ['scratch', [file('notes.md'), folder('deep')]],
        ['src', [file('main.ts')]],
      ],
      {
        kind: 'ok',
        stdout: statusOf([
          untracked('scratch/'),
          changed('D.', 'lib/a.ts'),
          changed('.D', 'lib/inner/b.ts'),
          changed('.M', 'src/main.ts'),
        ]),
      },
    )
    const ui = await openFiles($, seen)
    expect(await treeLines(ui)).toEqual(['▸ lib/  D2', '▸ scratch/  ?', '▸ src/  M1'])
    await ui.press({ key: 'open:scratch' })
    await ui.press({ key: 'open:lib' })
    expect(await treeLines(ui)).toEqual([
      '▾ lib/  D2',
      '  ▸ inner/  D1',
      '    a.ts                D',
      '▾ scratch/  ?',
      '  ▸ deep/  ?',
      '    notes.md            ?',
      '▸ src/  M1',
    ])
    await ui.unmount()
  })

  test('the header says clean, and no commits yet in a new repo', async ($, on) => {
    const seen = gitWorld(on, [['.', [file('README.md')]]], { kind: 'ok', stdout: CLEAN })
    const ui = await openFiles($, seen)
    expect(await headerOf(ui)).toEqual(['Files  app · main · clean', '[ refresh ]'])
    seen.answer = { kind: 'ok', stdout: statusOf([], { oid: '(initial)' }) }
    await ui.press({ key: 'refresh' })
    await seen.clock.advance(2000)
    expect(await headerOf(ui)).toEqual(['Files  app · main · no commits yet', '[ refresh ]'])
    expect(seen.runs).toHaveLength(2)
    await ui.unmount()
  })

  test('in a folder below the top of the repo, paths count from the top and the branch comes from HEAD', async ($, on) => {
    const seen = world(on, [['.', [file('a.ts'), file('b.ts')]]])
    seen.files.set('/work/.git', { kind: 'dir', text: '', mtimeMs: 1 })
    gitFolder(seen, '/work/.git', 'ref: refs/heads/lane-a1\n')
    seen.answer = {
      kind: 'ok',
      stdout: statusOf([changed('.M', 'app/a.ts'), changed('.M', 'a.ts')]),
    }
    const ui = await openFiles($, seen)
    expect(await headerOf(ui)).toEqual(['Files  app · lane-a1 · 2 changed', '[ refresh ]'])
    expect(await treeLines(ui)).toEqual(['  a.ts                  M', '  b.ts'])
    expect(seen.stats.slice(0, 2)).toEqual([GIT_DIR, '/work/.git'])
    await ui.unmount()
  })

  for (const [depth, gitDir, untrackedFolder] of [
    ['the working folder', '/work/.git', 'app/'],
    ['a folder above the working folder', '/.git', 'work/'],
  ] as const) {
    test(`when ${depth} is untracked, every entry shows ? and the header counts it`, async ($, on) => {
      const seen = world(on, [
        ['.', [folder('deep'), file('a.ts')]],
        ['deep', [file('g.ts')]],
      ])
      seen.files.set(gitDir, { kind: 'dir', text: '', mtimeMs: 1 })
      gitFolder(seen, gitDir)
      seen.answer = {
        kind: 'ok',
        stdout: statusOf([untracked(untrackedFolder)]),
      }
      const ui = await openFiles($, seen)
      await ui.press({ key: 'open:deep' })
      expect((await headerOf(ui))[0]).toBe('Files  app · main · 1 changed')
      expect(await treeLines(ui)).toEqual([
        '▾ deep/  ?',
        '    g.ts                ?',
        '  a.ts                  ?',
      ])
      await ui.unmount()
    })
  }

  test('a name with a space, a line break or a non-ASCII letter, and a staged rename to a name with a space, keep their letters', async ($, on) => {
    const seen = gitWorld(
      on,
      [['.', [file('a b.md'), file('line\nbreak.md'), file('naïve.md'), file('new name.md')]]],
      {
        kind: 'ok',
        stdout: statusOf([
          changed('.M', 'a b.md'),
          changed('A.', 'line\nbreak.md'),
          untracked('naïve.md'),
          renamed('R.', 'new name.md', 'old name.md'),
        ]),
      },
    )
    const ui = await openFiles($, seen)
    expect(await treeLines(ui)).toEqual([
      '  a b.md                M',
      '  line\\u000abreak.md    A',
      '  naïve.md              ?',
      '  new name.md           R',
      '    renamed from old name.md · staged',
    ])
    expect((await headerOf(ui))[0]).toBe('Files  app · main · 4 changed')
    await ui.unmount()
  })

  for (const [kind, pointer] of [
    ['relative', 'gitdir: ../main/.git/worktrees/app'],
    ['absolute', 'gitdir: /work/main/.git/worktrees/app'],
  ] as const) {
    test(`a .git file with a ${kind} gitdir leads to the HEAD and index of the worktree`, async ($, on) => {
      const gitDir = '/work/main/.git/worktrees/app'
      const seen = world(on, [['.', [file('a.ts')]]])
      seen.files.set(GIT_DIR, { kind: 'file', text: `${pointer}\n`, mtimeMs: 1 })
      gitFolder(seen, gitDir, `${HASH}\n`)
      seen.answer = { kind: 'ok', stdout: CLEAN }
      const ui = await openFiles($, seen)
      expect(seen.logs).toEqual([])
      expect(await headerOf(ui)).toEqual(['Files  app · aaaaaaa · clean', '[ refresh ]'])
      const before = seen.runs.length
      touch(seen, `${gitDir}/index`)
      await seen.clock.advance(2000)
      expect(seen.runs.length).toBe(before + 1)
      await ui.unmount()
    })
  }

  test('inline above the prompt, the header shows the git summary', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    const ui = await openFiles($, seen, 'desktop', 'inline', 76)
    expect((await screen(ui, 76))[0]).toBe('Files  app · main ↑1 · 6 changed[ refresh ]')
    await ui.unmount()
  })
})

describe('git status: when it runs', () => {
  test('exactly one git status runs when the index stamp changes, and one when HEAD changes', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    const ui = await openFiles($, seen)
    expect(seen.runs).toHaveLength(1)
    await seen.clock.advance(10_000)
    expect(seen.runs).toHaveLength(1)
    seen.answer = { kind: 'ok', stdout: APP_CHANGES }
    touch(seen, `${GIT_DIR}/index`)
    await seen.clock.advance(2000)
    expect(seen.runs).toHaveLength(2)
    expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', '[ refresh ]'])
    expect(await treeLines(ui)).toContain('  README.md             M')
    await seen.clock.advance(20_000)
    expect(seen.runs).toHaveLength(2)
    touch(seen, `${GIT_DIR}/HEAD`, 'ref: refs/heads/feature\n')
    await seen.clock.advance(2000)
    expect(seen.runs).toHaveLength(3)
    expect((await headerOf(ui))[0]).toBe('Files  app · feature ↑1 · 6 changed')
    await seen.clock.advance(20_000)
    expect(seen.runs).toHaveLength(3)
    await ui.unmount()
  })

  test('nothing changes for a minute: the poll reads the stamps and runs no process', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    const ui = await openFiles($, seen)
    expect(seen.runs).toHaveLength(1)
    const statsBefore = seen.stats.length
    for (let second = 0; second < 60; second += 1) await seen.clock.advance(1000)
    expect(seen.runs).toHaveLength(1)
    expect(seen.stats.length - statsBefore).toBe(60)
    await ui.unmount()
  })

  test('no git folder above: no git process runs and the header says not a git repo', async ($, on) => {
    const seen = world(on, GIT_APP)
    underTool(on)
    await openTab($)
    for (const surface of SURFACES) {
      const ui = await mountSettled($, seen, surface)
      expect(await headerOf(ui)).toEqual([
        'Files  app · not a git repo',
        '[ refresh ]',
        'No git status here; git init adds it.',
      ])
      expect((await ui.find({ type: 'Text', text: /No git status/ }))?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^M$/ })).toBeUndefined()
      await ui.unmount()
    }
    expect(seen.stats.slice(0, 3)).toEqual([GIT_DIR, '/work/.git', '/.git'])
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/a.md`, content: 'a' })
    await seen.clock.advance(60_000)
    expect(seen.runs).toEqual([])
  })

  test('after Bash, Edit or Write ends, on prompt submit and on focus: one run each, at least 2 s apart', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    underTool(on)
    const ui = await openFiles($, seen)
    expect(seen.runs).toHaveLength(1)
    await $.tool.call({ tool: 'Read', file_path: `${ROOT}/README.md` })
    await seen.clock.advance(4000)
    expect(seen.runs).toHaveLength(1)
    await $.tool.call({
      tool: 'Edit',
      file_path: `${ROOT}/README.md`,
      old_string: 'a',
      new_string: 'b',
    })
    await $.tool.call({ tool: 'Bash', command: 'touch notes.md' })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(2)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.md`, content: 'b' })
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    await seen.clock.advance(1999)
    expect(seen.runs).toHaveLength(2)
    await seen.clock.advance(1)
    expect(seen.runs).toHaveLength(3)
    await seen.clock.advance(10_000)
    await ui.redraw({ ...DOCKED_PANE, isFocused: true })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(4)
    await ui.redraw({ ...DOCKED_PANE, isFocused: true })
    await seen.clock.advance(10_000)
    expect(seen.runs).toHaveLength(4)
    const gaps = seen.runStarts.slice(1).map((at, index) => at - (seen.runStarts[index] ?? 0))
    expect(gaps.every((gap) => gap >= 2000)).toBe(true)
    await ui.unmount()
  })

  test('a change while git status runs starts one more run after it, not two at once', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    underTool(on)
    const ui = await openFiles($, seen)
    seen.answer = { kind: 'ok', stdout: CLEAN, tookMs: 3000 }
    await seen.clock.advance(2000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(2)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({
      tool: 'Edit',
      file_path: `${ROOT}/a.md`,
      old_string: 'a',
      new_string: 'b',
    })
    await seen.clock.advance(2999)
    expect(seen.runs).toHaveLength(2)
    await seen.clock.advance(1)
    expect(seen.runs).toHaveLength(3)
    await seen.clock.advance(20_000)
    expect(seen.runs).toHaveLength(3)
    await ui.unmount()
  })

  test('the poll stops while another tab is shown, and the tab catches up when shown again', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    underTool(on)
    const ui = await openFiles($, seen)
    seen.panes.add('tasks')
    seen.shown = 'tasks'
    await seen.clock.advance(2000)
    const statsWhileHidden = seen.stats.length
    touch(seen, `${GIT_DIR}/index`)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await seen.clock.advance(30_000)
    expect(seen.stats.length).toBe(statsWhileHidden)
    expect(seen.runs).toHaveLength(1)
    seen.shown = PANE
    await ui.redraw()
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(2)
    await seen.clock.advance(4000)
    expect(seen.runs).toHaveLength(2)
    expect(seen.stats.length).toBeGreaterThan(statsWhileHidden)
    await ui.unmount()
  })

  test('a redraw runs no git status and lists no folder again', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    const ui = await openFiles($, seen)
    await ui.press({ key: 'open:docs' })
    const listedBefore = seen.listed.length
    for (let offset = 1; offset <= 10; offset += 1) {
      await ui.redraw({ ...DOCKED_PANE, scroll: { offset, bodyRows: 40 } })
    }
    await seen.clock.settle()
    expect(seen.listed.length).toBe(listedBefore)
    expect(seen.runs).toHaveLength(1)
    expect(await treeLines(ui)).toContain('    design.md           M')
    await ui.unmount()
  })

  test('closing the tab stops the poll', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    const ui = await openFiles($, seen)
    await ui.unmount()
    expect(await tree($, 'close')).toBe('Tree closed.')
    const statsAfterClose = seen.stats.length
    touch(seen, `${GIT_DIR}/index`)
    await seen.clock.advance(30_000)
    expect(seen.stats.length).toBe(statsAfterClose)
    expect(seen.runs).toHaveLength(1)
  })

  test('session end cancels the poll, the 2 s gap and the retry', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'exit', exitCode: 128, stderr: 'fatal' })
    underTool(on)
    const ui = await openFiles($, seen)
    expect((await headerOf(ui)).at(-1)).toBe('retry in 10s  [ retry ]')
    seen.answer = { kind: 'ok', stdout: CLEAN }
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(1)
    await ui.unmount()
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    await start($)
    const next = await mountSettled($, seen, 'terminal')
    expect(seen.runs).toHaveLength(2)
    const statsOfNewSession = seen.stats.length
    await seen.clock.advance(12_000)
    expect(seen.stats.length - statsOfNewSession).toBe(12)
    expect(seen.runs).toHaveLength(2)
    expect(await headerOf(next)).toEqual(['Files  app · main · clean', '[ refresh ]'])
    await next.unmount()
  })

  test('session end during a slow run: the old run neither marks the new tab slow nor overwrites its status', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, {
      kind: 'ok',
      stdout: statusOf([changed('.M', 'README.md')]),
      tookMs: 8000,
    })
    const first = await openFiles($, seen)
    await first.unmount()
    await seen.clock.advance(1000)
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    seen.answer = { kind: 'ok', stdout: CLEAN }
    await start($)
    const ui = await mountSettled($, seen, 'terminal')
    expect(await headerOf(ui)).toEqual(['Files  app · main · clean', '[ refresh ]'])
    await seen.clock.advance(4000)
    expect(await headerOf(ui)).toEqual(['Files  app · main · clean', '[ refresh ]'])
    await seen.clock.advance(3000)
    expect(seen.inFlight).toBe(0)
    await ui.redraw()
    expect(await headerOf(ui)).toEqual(['Files  app · main · clean', '[ refresh ]'])
    expect(await treeLines(ui)).toContain('  README.md')
    expect(seen.runs).toHaveLength(2)
    await ui.unmount()
  })

  test('a change of working folder during a run: the next run waits for the run of the new folder', async ($, on) => {
    const seen = gitWorld(on, [...GIT_APP, ['sub', [file('s.ts')]]], {
      kind: 'ok',
      stdout: CLEAN,
      tookMs: 5000,
    })
    underTool(on)
    const ui = await openFiles($, seen)
    seen.cwd = `${ROOT}/sub`
    seen.answer = { kind: 'ok', stdout: statusOf([changed('.M', 'sub/s.ts')]), tookMs: 8000 }
    await ui.redraw()
    await seen.clock.settle()
    expect(seen.runs.map((run) => run.cwd)).toEqual([ROOT, `${ROOT}/sub`])
    await seen.clock.advance(5000)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(2)
    await seen.clock.advance(3000)
    expect(seen.runs).toHaveLength(3)
    expect(seen.mostInFlight).toBe(2)
    expect(await treeLines(ui)).toEqual(['  s.ts                  M'])
    await seen.clock.advance(8000)
    await ui.unmount()
  })
})

describe('git status: errors', () => {
  test('git exits non-zero: the header and the error line say so, the tree stays, and a retry follows in 10 s', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, {
      kind: 'exit',
      exitCode: 128,
      stderr: 'fatal: detected dubious ownership',
    })
    await openTab($)
    for (const surface of SURFACES) {
      const ui = await mountSettled($, seen, surface)
      expect(await headerOf(ui)).toEqual([
        'Files  app · git status failed',
        '[ refresh ]',
        'git status failed: exit 128.',
        'Run git status in a shell to see why.',
        'retry in 10s  [ retry ]',
      ])
      expect((await ui.find({ type: 'Text', text: /exit 128/ }))?.props.color).toBe('error')
      expect(await treeLines(ui)).toContain('▸ docs/')
      await ui.unmount()
    }
    expect(seen.logs.some((log) => log.includes('dubious ownership'))).toBe(true)
    const ui = await mountFiles($, 'terminal')
    await seen.clock.advance(2000)
    expect((await headerOf(ui)).at(-1)).toBe('retry in 8s  [ retry ]')
    seen.answer = { kind: 'ok', stdout: APP_CHANGES }
    await seen.clock.advance(8000)
    expect(seen.runs).toHaveLength(2)
    expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', '[ refresh ]'])
    await ui.unmount()
  })

  test('a second failure waits for the retry button', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'exit', exitCode: 1, stderr: 'boom' })
    const ui = await openFiles($, seen)
    await seen.clock.advance(10_000)
    expect(seen.runs).toHaveLength(2)
    expect((await headerOf(ui)).at(-1)).toBe('[ retry ]')
    await seen.clock.advance(30_000)
    expect(seen.runs).toHaveLength(2)
    seen.answer = { kind: 'ok', stdout: CLEAN }
    await ui.press({ key: 'retry' })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(3)
    expect((await headerOf(ui))[0]).toBe('Files  app · main · clean')
    await ui.unmount()
  })

  test('git does not answer in 10 s: it reads git status first, then shows the error line, and the tree stays', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, {
      kind: 'reject',
      message: 'the command was still running after 10000 ms',
      tookMs: 10_000,
    })
    const ui = await openFiles($, seen)
    expect(await headerOf(ui)).toEqual(['Files  app', '[ refresh ]', 'Reading git status…'])
    await seen.clock.advance(6000)
    expect(await headerOf(ui)).toEqual(['Files  app', '[ refresh ]', 'Reading git status…'])
    await seen.clock.advance(4000)
    expect((await headerOf(ui)).slice(0, 3)).toEqual([
      'Files  app · git status failed',
      '[ refresh ]',
      'git status failed: no answer in 10 s.',
    ])
    expect(await treeLines(ui)).toContain('▸ docs/')
    await ui.unmount()
  })

  test('git is not on PATH: the header says git not found, and no run follows a change', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'reject', message: 'spawn git ENOENT', tookMs: 0 })
    const ui = await openFiles($, seen)
    expect(await headerOf(ui)).toEqual([
      'Files  app · git not found',
      '[ refresh ]',
      'git is not on PATH, so git status',
      'is not shown.',
    ])
    expect(await ui.find({ key: 'retry' })).toBeUndefined()
    touch(seen, `${GIT_DIR}/index`)
    await seen.clock.advance(30_000)
    expect(seen.runs).toHaveLength(1)
    expect(await treeLines(ui)).toContain('  README.md')
    await ui.unmount()
  })

  test('git takes over 5 s: the header and a warning show the age of the last status', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, {
      kind: 'ok',
      stdout: statusOf([changed('.M', 'README.md')]),
    })
    const ui = await openFiles($, seen)
    await seen.clock.advance(120_000)
    seen.answer = { kind: 'ok', stdout: APP_CHANGES, tookMs: 6000 }
    touch(seen, `${GIT_DIR}/index`)
    await seen.clock.advance(2000)
    await seen.clock.advance(4999)
    expect((await headerOf(ui))[0]).toBe('Files  app · main · 1 changed')
    await seen.clock.advance(1)
    expect(await headerOf(ui)).toEqual([
      'Files  app · main · 1 changed · 2m old',
      '[ refresh ]',
      'git status took over 5 s; showing',
      'the status of 2m ago.  [ retry ]',
    ])
    expect((await ui.find({ type: 'Text', text: /took over 5 s/ }))?.props.color).toBe('warning')
    expect(await treeLines(ui)).toContain('  README.md             M')
    await seen.clock.advance(1000)
    expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', '[ refresh ]'])
    await ui.unmount()
  })

  test('after two runs over 5 s, git status skips untracked files and the tab says so', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES, tookMs: 5001 })
    const ui = await openFiles($, seen)
    await seen.clock.advance(5001)
    expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', '[ refresh ]'])
    touch(seen, `${GIT_DIR}/index`)
    await seen.clock.advance(2000)
    await seen.clock.advance(5001)
    expect(seen.runs.map((run) => run.argv.at(-3))).toEqual([
      '--untracked-files=normal',
      '--untracked-files=normal',
    ])
    expect((await headerOf(ui)).slice(2)).toEqual([
      'git status took over 5 s twice, so',
      'untracked files are not shown.',
    ])
    seen.answer = { kind: 'ok', stdout: CLEAN }
    touch(seen, `${GIT_DIR}/index`)
    await seen.clock.advance(2000)
    expect(seen.runs.at(-1)?.argv.at(-3)).toBe('--untracked-files=no')
    expect(seen.runs).toHaveLength(3)
    await ui.unmount()
  })

  test('output over 4 MiB: the cut last record is dropped and the cut note shows', async ($, on) => {
    const whole = [changed('.M', 'docs/design.md'), changed('.M', 'docs/mocks.md')]
    const seen = gitWorld(on, GIT_APP, {
      kind: 'ok',
      stdout: `${statusOf(whole)}${changed('.M', 'docs/guide.md').slice(0, -4)}`,
      isCut: true,
    })
    const ui = await openFiles($, seen)
    await ui.press({ key: 'open:docs' })
    const lines = await treeLines(ui)
    expect(lines.slice(2, 8)).toEqual([
      '▾ docs/  M2',
      '    design.md           M',
      '    filetree.md',
      '    guide.md',
      '    install.md',
      '    mocks.md            M',
    ])
    expect(lines.slice(-2)).toEqual([
      'git status is over 4 MiB; the first',
      '2 entries are marked.',
    ])
    expect((await ui.find({ type: 'Text', text: /over 4 MiB/ }))?.props.color).toBe('warning')
    expect((await headerOf(ui))[0]).toBe('Files  app · main · 2 changed')
    seen.answer = {
      kind: 'ok',
      stdout: `${statusOf(whole)}${renamed('R.', 'docs/guide.md', 'docs/old-guide.md').slice(0, -6)}`,
      isCut: true,
    }
    touch(seen, `${GIT_DIR}/index`)
    await seen.clock.advance(2000)
    expect(await treeLines(ui)).toContain('    guide.md')
    expect((await treeLines(ui)).slice(-1)).toEqual(['2 entries are marked.'])
    seen.answer = { kind: 'ok', stdout: statusOf(whole) }
    touch(seen, `${GIT_DIR}/index`)
    await seen.clock.advance(2000)
    expect(await treeLines(ui)).not.toContain('2 entries are marked.')
    await ui.unmount()
  })
})
