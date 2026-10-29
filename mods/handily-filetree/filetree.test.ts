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
import { beginShellRun, endShellRun, endTurn, newShell } from './hooks/shellmarks'
import { newTouches } from './hooks/touches'
import { displayWidth } from './hooks/width'

const ROOT = '/work/app'
const PLUGIN = 'handily-filetree'
const PANE = 'files'
const SURFACES: readonly RenderSurface[] = ['terminal', 'desktop']
const RULE_41 = '─'.repeat(41)
const CONTROLS = '[ work only ] {agent: all} [ refresh ]'
const NOW_EMPTY = 'Now  nothing read or edited yet'

type FakeFolder = FsEntry[] | string

type FakeFile = {
  kind: 'file' | 'dir'
  text: string
  mtimeMs: number
  size?: number
  denial?: string
}

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
  reads: string[]
  diffAnswer: GitAnswer
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
    const size = found.size ?? found.text.length
    return { value: { kind: found.kind, size, mtimeMs: found.mtimeMs, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    seen.reads.push(e.path)
    const found = seen.files.get(e.path)
    if (found?.denial !== undefined) return { deny: found.denial }
    if (found?.kind !== 'file')
      return { deny: `ENOENT: no such file or directory, open '${e.path}'` }
    return { value: found.text }
  })
  on('process.run', async (_$, e) => {
    seen.runs.push({ argv: e.argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
    seen.runStarts.push(seen.clock.now())
    const answer = e.argv[4] === 'diff' ? seen.diffAnswer : seen.answer
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
    reads: [],
    diffAnswer: { kind: 'ok', stdout: '' },
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

type View = 'work' | 'all'

const VIEW_BUTTON_LABELS: Readonly<Record<View, string>> = { work: 'all files', all: 'work only' }

type Viewed = { find: Mounted['find']; press: Mounted['press'] }

async function isViewShown(ui: Viewed, view: View): Promise<boolean> {
  const label = (await ui.find({ key: 'view' }))?.props.label
  return typeof label === 'string' && VIEW_BUTTON_LABELS[view].startsWith(label.replace(/…$/, ''))
}

async function pickView(ui: Viewed, view: View): Promise<void> {
  if (!(await isViewShown(ui, view))) await ui.press({ key: 'view' })
  expect(await isViewShown(ui, view)).toBe(true)
}

async function mountFiles(
  $: Engine,
  surface: RenderSurface,
  placement: 'dock' | 'inline' = 'dock',
  columns = 41,
  view: View = 'all',
) {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: paneProps(placement, columns),
  })
  if (placement === 'dock') await pickView(ui, view)
  return ui
}

type Drawn = { type: string; props: Record<string, unknown>; text: string; children: Drawn[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function selectText(props: Record<string, unknown>): string {
  const options = Array.isArray(props.options) ? (props.options as unknown[]) : []
  const picked = options.filter(isRecord).find((option) => option.value === props.value)
  const label = typeof picked?.label === 'string' ? picked.label : ''
  return `{${typeof props.label === 'string' ? props.label : ''}: ${label}}`
}

function drawnOf(value: unknown): Drawn | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const props = isRecord(value.props) ? value.props : {}
  const raw = Array.isArray(value.children) ? (value.children as unknown[]) : []
  const children = raw.map(drawnOf).filter((child) => child !== null)
  const own = raw.map((child) => (typeof child === 'string' ? child : '')).join('')
  const text =
    value.type === 'Select'
      ? selectText(props)
      : value.type === 'Code' || value.type === 'Markdown'
        ? `(${value.type})`
        : value.type === 'Button' && props.plain !== true && typeof props.label === 'string'
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

  test('writes the ready value that /handily reads when the session starts', async ($, on) => {
    world(on, APP)
    const ready: unknown[] = []
    on('state.set', { plugin: PLUGIN, key: 'ready' }, (_$, e, next) => {
      ready.push(e.value)
      return next(e)
    })
    await start($)
    expect(ready).toEqual([{ root: expect.stringMatching(/[\\/]handily-filetree$/) }])
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
        CONTROLS,
        'No git status here; git init adds it.',
        NOW_EMPTY,
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
        'view',
        'refresh',
        'open:docs',
        'open:hooks',
        'open:scripts',
        'file:.gitignore',
        'file:README.md',
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

function inlineRow(name: string, cell = ''): string {
  return cell === '' ? name : `${name.padEnd(58)}${cell}`
}

describe('the files tab, inline above the prompt', () => {
  test('draws the touched files as a flat list of at most 8 rows, the file in Now first, the last naming what is left', async ($, on) => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((name) => `${name}.md`)
    const seen = world(on, [['.', [...(APP[0]?.[1] ?? []), ...names.map(file)]]])
    fakeTools(on, seen, new Map())
    await start($)
    for (const name of names) {
      await read($, name)
      await seen.clock.advance(1000)
    }
    for (const surface of SURFACES) {
      const ui = await mountFiles($, surface, 'inline', 76)
      const lines = await screen(ui, 76)
      expect(lines).toEqual([
        'Files  app · not a git repo{agent: all}  [ refresh ]',
        inlineRow('i.md', '◦ main          1s'),
        inlineRow('a.md', '◦ main          9s'),
        inlineRow('b.md', '◦ main          8s'),
        inlineRow('c.md', '◦ main          7s'),
        inlineRow('d.md', '◦ main          6s'),
        inlineRow('e.md', '◦ main          5s'),
        inlineRow('f.md', '◦ main          4s'),
        '+2 more: a dock (fullscreen, 110 columns) shows the tree',
      ])
      expect(lines.length - 1).toBe(8)
      expect((await ui.findAll({ type: 'Button' })).map((button) => button.key)).toEqual([
        'refresh',
      ])
      await ui.unmount()
    }
  })

  test('draws every touched file with its path when there are 8 or fewer, and lists no folder for it', async ($, on) => {
    const seen = world(on, [
      ['.', [folder('src'), file('a.md')]],
      ['src', [file('b.md')]],
    ])
    fakeTools(on, seen, new Map())
    await start($)
    await read($, 'src/b.md')
    await seen.clock.advance(1000)
    await read($, 'a.md')
    const ui = await mountFiles($, 'terminal', 'inline', 76)
    expect((await screen(ui, 76)).slice(1)).toEqual([
      inlineRow('a.md', '◦ main          0s'),
      inlineRow('src/b.md', '◦ main          1s'),
    ])
    expect(seen.listed).not.toContain('src')
    await ui.unmount()
  })

  test('with no touched file outside a git repo, says that no file is changed or touched', async ($, on) => {
    world(on, APP)
    await start($)
    for (const surface of SURFACES) {
      const ui = await mountFiles($, surface, 'inline', 76)
      expect((await screen(ui, 76)).slice(1)).toEqual(['No changed or touched files.'])
      await ui.unmount()
    }
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

const APP_RECORDS = [
  changed('.M', 'docs/design.md'),
  changed('.M', 'docs/mocks.md'),
  changed('.M', 'hooks/pane.tsx'),
  changed('.D', 'hooks/old-pane.tsx'),
  changed('M.', 'README.md'),
  untracked('docs/filetree.md'),
]

const APP_CHANGES = statusOf(APP_RECORDS, { ab: '+1 -0' })

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
      expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', CONTROLS, NOW_EMPTY])
      expect(await treeLines(ui)).toEqual([
        '▸ .git/  not listed',
        '▸ node_modules/  not listed',
        '▾ docs/  M2 ?1',
        '  M design.md',
        '  ? filetree.md',
        '    guide.md',
        '    install.md',
        '  M mocks.md',
        '▾ hooks/  M1 D1',
        '  ▸ dist/  not listed',
        '  D old-pane.tsx',
        '  M pane.tsx',
        '    register.tsx',
        '▸ scripts/',
        '  .gitignore',
        'M README.md',
      ])
      expect((await ui.find({ type: 'Text', text: /^M$/ }))?.props.color).toBe('warning')
      expect((await ui.find({ type: 'Text', text: /^D$/ }))?.props.color).toBe('error')
      expect((await ui.find({ type: 'Text', text: /^\?$/ }))?.props.color).toBe('success')
      const colorOf = async (text: string) => (await ui.find({ type: 'Text', text }))?.props.color
      expect(await colorOf('design.md')).toBe('warning')
      expect(await colorOf('filetree.md')).toBe('success')
      expect(await colorOf('old-pane.tsx')).toBe('error')
      expect(await colorOf('README.md')).toBe('warning')
      expect(await colorOf('    guide.md')).toBeUndefined()
      expect(await colorOf('M2')).toBe('warning')
      expect(await colorOf('?1')).toBe('success')
      expect(await colorOf('D1')).toBe('error')
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
      '  U merge.ts',
      '  R moved.ts',
      '      renamed from lib/moved.ts · not st…',
      '  R routes.ts',
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
      '  D a.ts',
      '▾ scratch/  ?',
      '  ▸ deep/  ?',
      '  ? notes.md',
      '▸ src/  M1',
    ])
    await ui.unmount()
  })

  test('the header says clean, and no commits yet in a new repo', async ($, on) => {
    const seen = gitWorld(on, [['.', [file('README.md')]]], { kind: 'ok', stdout: CLEAN })
    const ui = await openFiles($, seen)
    expect(await headerOf(ui)).toEqual(['Files  app · main · clean', CONTROLS, NOW_EMPTY])
    seen.answer = { kind: 'ok', stdout: statusOf([], { oid: '(initial)' }) }
    await ui.press({ key: 'refresh' })
    await seen.clock.advance(2000)
    expect(await headerOf(ui)).toEqual(['Files  app · main · no commits yet', CONTROLS, NOW_EMPTY])
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
    expect(await headerOf(ui)).toEqual(['Files  app · lane-a1 · 2 changed', CONTROLS, NOW_EMPTY])
    expect(await treeLines(ui)).toEqual(['M a.ts', '  b.ts'])
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
      expect(await treeLines(ui)).toEqual(['▾ deep/  ?', '  ? g.ts', '? a.ts'])
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
      'M a b.md',
      'A line\\u000abreak.md',
      '? naïve.md',
      'R new name.md',
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
      expect(await headerOf(ui)).toEqual(['Files  app · aaaaaaa · clean', CONTROLS, NOW_EMPTY])
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
    expect((await screen(ui, 76))[0]).toBe(
      'Files  app · main ↑1 · 6 changed{agent: all}  [ refresh ]',
    )
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`inline above the prompt, each changed file shows its mark before its name in its colour on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      const ui = await openFiles($, seen, surface, 'inline', 76)
      expect((await screen(ui, 76)).slice(1)).toEqual([
        'M docs/design.md',
        '? docs/filetree.md',
        'M docs/mocks.md',
        'D hooks/old-pane.tsx',
        'M hooks/pane.tsx',
        'M README.md',
      ])
      expect((await ui.find({ type: 'Text', text: 'README.md' }))?.props.color).toBe('warning')
      const colorOf = async (text: string) => (await ui.find({ type: 'Text', text }))?.props.color
      expect(await colorOf('docs/filetree.md')).toBe('success')
      expect(await colorOf('hooks/old-pane.tsx')).toBe('error')
      await ui.unmount()
    })
  }

  test('a folder count of 1000 or more prints without a comma', async ($, on) => {
    const many = Array.from({ length: 2140 }, (_, index) =>
      changed('.M', `src/f${String(index)}.ts`),
    )
    const seen = gitWorld(on, [['.', [folder('src')]]], { kind: 'ok', stdout: statusOf(many) })
    const ui = await openFiles($, seen)
    expect(await treeLines(ui)).toEqual(['▸ src/  M2140'])
    await ui.unmount()
  })

  test('a changed file deep in a narrow tab keeps its letter', async ($, on) => {
    const depths = ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e', 'a/b/c/d/e/f']
    const seen = gitWorld(
      on,
      [
        ['.', [folder('a')]],
        ...depths
          .slice(0, -1)
          .map((path, index): [string, FsEntry[]] => [
            path,
            [folder(depths[index + 1]?.split('/').at(-1) ?? '')],
          ]),
        ['a/b/c/d/e/f', [file('x.ts')]],
      ],
      { kind: 'ok', stdout: statusOf([changed('.M', 'a/b/c/d/e/f/x.ts')]) },
    )
    const ui = await openFiles($, seen, 'terminal', 'dock', 12)
    for (const path of depths) await ui.press({ key: `open:${path}` })
    expect((await treeLines(ui, 12)).at(-1)).toBe('        M x…')
    await ui.unmount()
  })

  test('inline in a git repo, names keep their column while the first status is read', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES, tookMs: 8000 })
    fakeTools(on, seen, new Map())
    await openTab($)
    await read($, 'docs/design.md')
    const ui = await mountFiles($, 'terminal', 'inline', 76)
    await seen.clock.advance(100)
    expect((await screen(ui, 76)).slice(1)).toEqual([
      inlineRow('  docs/design.md', '◦ main          0s'),
    ])
    await seen.clock.advance(8000)
    expect((await screen(ui, 76))[1]).toBe(inlineRow('M docs/design.md', '◦ main          8s'))
    await ui.unmount()
  })

  test('a cut row keeps the colour of the part that it cuts', async ($, on) => {
    const seen = gitWorld(on, [['.', [file('a-very-long-file-name-that-does-not-fit.md')]]], {
      kind: 'ok',
      stdout: statusOf([changed('.M', 'a-very-long-file-name-that-does-not-fit.md')]),
    })
    const ui = await openFiles($, seen, 'terminal', 'dock', 24)
    expect(await treeLines(ui, 24)).toEqual(['M a-very-long-file-name…'])
    expect((await ui.find({ type: 'Text', text: /^a-very.*…$/ }))?.props.color).toBe('warning')
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
    expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', CONTROLS, NOW_EMPTY])
    expect(await treeLines(ui)).toContain('M README.md')
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
        CONTROLS,
        'No git status here; git init adds it.',
        NOW_EMPTY,
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
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.md`, content: 'b' })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(2)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.md`, content: 'c' })
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
    expect(await treeLines(ui)).toContain('  M design.md')
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
    expect((await headerOf(ui)).slice(-2)).toEqual(['retry in 10s  [ retry ]', NOW_EMPTY])
    seen.answer = { kind: 'ok', stdout: CLEAN }
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.md`, content: 'b' })
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
    expect(await headerOf(next)).toEqual(['Files  app · main · clean', CONTROLS, NOW_EMPTY])
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
    expect(await headerOf(ui)).toEqual(['Files  app · main · clean', CONTROLS, NOW_EMPTY])
    await seen.clock.advance(4000)
    expect(await headerOf(ui)).toEqual(['Files  app · main · clean', CONTROLS, NOW_EMPTY])
    await seen.clock.advance(3000)
    expect(seen.inFlight).toBe(0)
    await ui.redraw()
    expect(await headerOf(ui)).toEqual(['Files  app · main · clean', CONTROLS, NOW_EMPTY])
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
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/sub/t.ts`, content: 't' })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(2)
    await seen.clock.advance(3000)
    expect(seen.runs).toHaveLength(3)
    expect(seen.mostInFlight).toBe(2)
    expect(await treeLines(ui)).toEqual(['M s.ts'])
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
        CONTROLS,
        'git status failed: exit 128.',
        'Run git status in a shell to see why.',
        'retry in 10s  [ retry ]',
        NOW_EMPTY,
      ])
      expect((await ui.find({ type: 'Text', text: /exit 128/ }))?.props.color).toBe('error')
      expect(await treeLines(ui)).toContain('▸ docs/')
      await ui.unmount()
    }
    expect(seen.logs.some((log) => log.includes('dubious ownership'))).toBe(true)
    const ui = await mountFiles($, 'terminal')
    await seen.clock.advance(2000)
    expect((await headerOf(ui)).slice(-2)).toEqual(['retry in 8s  [ retry ]', NOW_EMPTY])
    seen.answer = { kind: 'ok', stdout: APP_CHANGES }
    await seen.clock.advance(8000)
    expect(seen.runs).toHaveLength(2)
    expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', CONTROLS, NOW_EMPTY])
    await ui.unmount()
  })

  test('a second failure waits for the retry button', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'exit', exitCode: 1, stderr: 'boom' })
    const ui = await openFiles($, seen)
    await seen.clock.advance(10_000)
    expect(seen.runs).toHaveLength(2)
    expect((await headerOf(ui)).slice(-2)).toEqual(['[ retry ]', NOW_EMPTY])
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
    expect(await headerOf(ui)).toEqual(['Files  app', CONTROLS, 'Reading git status…', NOW_EMPTY])
    await seen.clock.advance(6000)
    expect(await headerOf(ui)).toEqual(['Files  app', CONTROLS, 'Reading git status…', NOW_EMPTY])
    await seen.clock.advance(4000)
    expect((await headerOf(ui)).slice(0, 3)).toEqual([
      'Files  app · git status failed',
      CONTROLS,
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
      CONTROLS,
      'git is not on PATH, so git status',
      'is not shown.',
      NOW_EMPTY,
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
      CONTROLS,
      'git status took over 5 s; showing',
      'the status of 2m ago.  [ retry ]',
      NOW_EMPTY,
    ])
    expect((await ui.find({ type: 'Text', text: /took over 5 s/ }))?.props.color).toBe('warning')
    expect(await treeLines(ui)).toContain('M README.md')
    await seen.clock.advance(1000)
    expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', CONTROLS, NOW_EMPTY])
    await ui.unmount()
  })

  test('after two runs over 5 s, git status skips untracked files and the tab says so', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES, tookMs: 5001 })
    const ui = await openFiles($, seen)
    await seen.clock.advance(5001)
    expect(await headerOf(ui)).toEqual(['Files  app · main ↑1 · 6 changed', CONTROLS, NOW_EMPTY])
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
      NOW_EMPTY,
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
      '  M design.md',
      '    filetree.md',
      '    guide.md',
      '    install.md',
      '  M mocks.md',
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

type ToolAnswer = 'ok' | 'deny' | 'error' | 'throw'

type FakeTool = { answer: ToolAnswer; tookMs?: number; result?: unknown }

const SCOUT = 'a1b2c3d4e5f6'
const HELPER = 'f00dfeed0123'

function boardAgent(id: string, names: { type: string; label?: string }) {
  return {
    id,
    startedAt: 1,
    isSpawnSeen: true,
    seenAt: 1,
    endedAt: null,
    tools: 0,
    running: [],
    last: null,
    description: null,
    type: names.type,
    name: null,
    parentId: null,
    listedStatus: 'running' as const,
    isListed: true,
    hasLoopEvents: true,
    ...(names.label === undefined ? {} : { label: names.label }),
  }
}

function boardKnowsScout(on: On): void {
  on('state.get', { plugin: 'handily-board', key: 'agents' }, () => ({
    value: { value: [boardAgent(SCOUT, { type: 'Explore', label: 'scout' })], version: 1 },
  }))
}

type ToolThisBuildLacks = (input: { tool: string } & Record<string, unknown>) => Promise<unknown>

async function grep($: Engine, input: Record<string, unknown>): Promise<void> {
  const call = $.tool.call as unknown as ToolThisBuildLacks
  await call({ tool: 'Grep', ...input })
}

function fakeTools(on: On, seen: World, tools: ReadonlyMap<string, FakeTool>): void {
  on('tool.call', async (_$, e) => {
    const tool = tools.get(e.tool) ?? { answer: 'ok' }
    if (tool.tookMs !== undefined) await seen.clock.sleep(tool.tookMs)
    switch (tool.answer) {
      case 'ok':
        return { result: tool.result ?? '' }
      case 'deny':
        return { deny: 'The person refused the call.' }
      case 'error':
        return { isError: true as const, result: 'boom', text: 'boom' }
      case 'throw':
        throw new Error('the tool broke')
    }
  })
}

async function edit($: Engine, path: string, agentId?: string): Promise<void> {
  await $.tool.call({
    tool: 'Edit',
    file_path: `${ROOT}/${path}`,
    old_string: 'a',
    new_string: 'b',
    ...(agentId === undefined ? {} : { agentId }),
  })
}

async function read($: Engine, path: string, agentId?: string): Promise<void> {
  await $.tool.call({
    tool: 'Read',
    file_path: `${ROOT}/${path}`,
    ...(agentId === undefined ? {} : { agentId }),
  })
}

async function mainEditsScoutReads($: Engine, seen: World): Promise<void> {
  await edit($, 'hooks/pane.tsx')
  await seen.clock.advance(2000)
  await read($, 'docs/design.md', SCOUT)
  await seen.clock.advance(2000)
}

describe('marks: which agent read or edited each file', () => {
  for (const surface of SURFACES) {
    test(`an edit by main and a read by a subagent mark both rows with label and age, and Now lists both agents on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      fakeTools(on, seen, new Map())
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface)
      await mainEditsScoutReads($, seen)
      await ui.press({ key: 'open:docs' })
      await ui.press({ key: 'open:hooks' })
      expect(await screen(ui)).toEqual([
        'Files  app · main ↑1 · 6 changed',
        CONTROLS,
        'Now  2 agents',
        '✎ main      hooks/pane.tsx             4s',
        '◦ scout     docs/design.md             2s',
        RULE_41,
        '▸ .git/  not listed',
        '▸ node_modules/  not listed',
        '▾ docs/  M2 ?1            ◦ scout      2s',
        '  M design.md             ◦ scout      2s',
        '  ? filetree.md',
        '    guide.md',
        '    install.md',
        '  M mocks.md',
        '▾ hooks/  M1 D1           ✎ main       4s',
        '  ▸ dist/  not listed',
        '  D old-pane.tsx',
        '  M pane.tsx              ✎ main       4s',
        '    register.tsx',
        '▸ scripts/',
        '  .gitignore',
        'M README.md',
      ])
      expect((await ui.find({ type: 'Text', text: 'Now' }))?.props.bold).toBe(true)
      expect((await ui.find({ type: 'Text', text: /^ {2}4s$/ }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: /^pane\.tsx$/ }))?.props.color).toBe('warning')
      await ui.unmount()
    })
  }

  test('a file two agents touched shows the latest with +1, and an agent the board has not labelled shows the first 8 characters of its id', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    fakeTools(on, seen, new Map())
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    await read($, 'docs/mocks.md', SCOUT)
    await seen.clock.advance(60_000)
    await edit($, 'docs/mocks.md')
    await read($, 'hooks/register.tsx', HELPER)
    await seen.clock.advance(1000)
    await ui.press({ key: 'open:docs' })
    await ui.press({ key: 'open:hooks' })
    const lines = await screen(ui)
    expect(lines).toContain('  M mocks.md              ✎ main +1    1s')
    expect(lines).toContain('    register.tsx          ◦ f00dfeed   1s')
    expect(lines.slice(2, 6)).toEqual([
      'Now  3 agents',
      '✎ main      docs/mocks.md              1s',
      '◦ scout     docs/mocks.md              1m',
      '◦ f00dfeed  hooks/register.tsx         1s',
    ])
    await ui.unmount()
  })

  test('the ages follow the short form of the board: seconds, minutes, hours, days, rounded down', async ($, on) => {
    const seen = world(on, APP)
    fakeTools(on, seen, new Map())
    await openTab($)
    const ui = await mountSettled($, seen, 'terminal')
    await read($, 'README.md')
    const ages: string[] = []
    for (const wait of [59_999, 1, 3_480_000, 60_000, 79_200_000, 3_600_000]) {
      await seen.clock.advance(wait)
      await ui.redraw(DOCKED_PANE)
      ages.push(
        (await treeLines(ui)).find((line) => line.startsWith('  README.md'))?.slice(-3) ?? '',
      )
    }
    expect(ages).toEqual(['59s', ' 1m', '59m', ' 1h', '23h', ' 1d'])
    await ui.unmount()
  })
})

describe('marks: narrow docks and inline', () => {
  async function touched($: Engine, seen: World): Promise<void> {
    await read($, 'docs/mocks.md', SCOUT)
    await mainEditsScoutReads($, seen)
    await edit($, 'docs/mocks.md')
    await seen.clock.advance(1000)
  }

  for (const surface of SURFACES) {
    test(`at body 30 the age drops and the agent cuts to 5 on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      fakeTools(on, seen, new Map())
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface, 'dock', 30)
      await touched($, seen)
      await ui.press({ key: 'open:docs' })
      const lines = await screen(ui, 30)
      expect(lines.slice(1, 6)).toEqual([
        '[ work only ] [ refresh ]',
        '{agent: all}',
        'Now  2 agents',
        '✎ main  docs/mocks.md',
        '◦ scout docs/design.md',
      ])
      expect(lines).toContain('▾ docs/  M2 ?1         ✎ main')
      expect(lines).toContain('  M design.md          ◦ scout')
      expect(lines).toContain('  M mocks.md           ✎ main+')
      expect(lines).toContain('▸ hooks/  M1 D1        ✎ main')
      await ui.unmount()
    })

    test(`at body 24 the agent drops from the rows, and the mark and the git letter stay on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      fakeTools(on, seen, new Map())
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface, 'dock', 24)
      await touched($, seen)
      await ui.press({ key: 'open:docs' })
      const lines = await screen(ui, 24)
      expect(lines.slice(1, 6)).toEqual([
        '[ work only ]',
        '[ refresh ] {agent: all}',
        'Now  2 agents',
        '✎ main  docs/mocks.md',
        '◦ scout docs/design.md',
      ])
      expect(lines).toContain('  M design.md          ◦')
      expect(lines).toContain('  M mocks.md           ✎')
      await ui.redraw({ ...paneProps('dock', 24), view: { agentId: SCOUT } })
      expect((await screen(ui, 24)).slice(1, 7)).toEqual([
        '[ work only ]',
        '[ refresh ]',
        '{agent: scout}',
        'scout is in view, so',
        'only scout shows',
        'Now  scout',
      ])
      await ui.unmount()
    })

    test(`inline above the prompt, the flat rows carry the marks and the header the agent filter on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      fakeTools(on, seen, new Map())
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface, 'inline', 76)
      await touched($, seen)
      await ui.redraw(paneProps('inline', 76))
      const lines = await screen(ui, 76)
      expect(lines[0]).toBe('Files  app · main ↑1 · 6 changed{agent: all}  [ refresh ]')
      expect(lines.slice(1)).toEqual([
        inlineRow('M docs/mocks.md', '✎ main +1       1s'),
        inlineRow('M docs/design.md', '◦ scout         3s'),
        '? docs/filetree.md',
        'D hooks/old-pane.tsx',
        inlineRow('M hooks/pane.tsx', '✎ main          5s'),
        'M README.md',
      ])
      expect(lines.some((line) => line.startsWith('Now'))).toBe(false)
      await ui.unmount()
    })
  }
})

describe('marks: a call that is denied or fails', () => {
  for (const surface of SURFACES) {
    for (const answer of ['deny', 'error', 'throw'] as const) {
      test(`a ${answer} removes the mark of the call, and an earlier read of the file shows again on the ${surface}`, async ($, on) => {
        const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
        fakeTools(on, seen, new Map([['Edit', { answer, tookMs: 1000 }]]))
        const ui = await openFiles($, seen, surface)
        await ui.press({ key: 'open:hooks' })
        await read($, 'hooks/pane.tsx')
        await seen.clock.advance(5000)
        const call = edit($, 'hooks/register.tsx', SCOUT).catch(() => undefined)
        const again = edit($, 'hooks/pane.tsx').catch(() => undefined)
        await seen.clock.advance(500)
        expect(await treeLines(ui)).toContain('    register.tsx          ✎ a1b2c3d4   0s')
        expect(await treeLines(ui)).toContain('  M pane.tsx              ✎ main       0s')
        expect(await headerOf(ui)).toContain('Now  2 agents')
        await seen.clock.advance(500)
        await Promise.all([call, again])
        await ui.redraw(DOCKED_PANE)
        expect(await treeLines(ui)).toContain('    register.tsx')
        expect(await treeLines(ui)).toContain('  M pane.tsx              ◦ main       6s')
        expect((await headerOf(ui)).slice(2)).toEqual([
          'Now  1 agent',
          '◦ main      hooks/pane.tsx             6s',
        ])
        await ui.unmount()
      })
    }
  }

  test('a denied call that was the only touch leaves Now empty', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    fakeTools(on, seen, new Map([['Read', { answer: 'deny' }]]))
    const ui = await openFiles($, seen)
    await read($, 'README.md', SCOUT)
    expect((await headerOf(ui)).at(-1)).toBe(NOW_EMPTY)
    expect(await treeLines(ui)).toContain('  README.md')
    await ui.unmount()
  })
})

describe('marks: the agent filter', () => {
  for (const surface of SURFACES) {
    test(`when the person opens the scout transcript, only scout shows, and the main view shows all again on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      fakeTools(on, seen, new Map())
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface)
      await read($, 'hooks/register.tsx', SCOUT)
      await mainEditsScoutReads($, seen)
      await ui.press({ key: 'open:docs' })
      await ui.press({ key: 'open:hooks' })
      await ui.redraw({ ...DOCKED_PANE, view: { agentId: SCOUT } })
      expect(await headerOf(ui)).toEqual([
        'Files  app · main ↑1 · 6 changed',
        '[ work only ] {agent: scout} [ refresh ]',
        'scout is in view, so only scout shows',
        'Now  scout',
        '◦ scout     docs/design.md             2s',
      ])
      const tree = await treeLines(ui)
      expect(tree).toContain('▾ docs/  M2 ?1            ◦ scout      2s')
      expect(tree).toContain('▾ hooks/  M1 D1           ◦ scout      4s')
      expect(tree).toContain('  M pane.tsx')
      expect(tree).toContain('    register.tsx          ◦ scout      4s')
      expect(tree.filter((line) => line.includes('main'))).toEqual([])
      await ui.redraw(DOCKED_PANE)
      expect((await headerOf(ui)).slice(1, 3)).toEqual([CONTROLS, 'Now  2 agents'])
      expect(await treeLines(ui)).toContain('  M pane.tsx              ✎ main       4s')
      await ui.unmount()
    })
  }

  test('the person picks an agent in the filter, and the view of a transcript wins over the pick', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    fakeTools(on, seen, new Map())
    boardKnowsScout(on)
    await openTab($)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'Pane',
      requestId: PANE,
      props: DOCKED_PANE,
    })
    await seen.clock.settle()
    await mainEditsScoutReads($, seen)
    const filter = await ui.find({ key: 'agent' })
    expect(filter?.props.options).toEqual([
      { value: 'all', label: 'all' },
      { value: 'main', label: 'main' },
      { value: `agent:${SCOUT}`, label: 'scout' },
    ])
    await ui.select({ key: 'agent', value: 'main' })
    expect((await headerOf(ui)).slice(1)).toEqual([
      '[ all files ] {agent: main} [ refresh ]',
      'Now  main',
      '✎ main      hooks/pane.tsx             4s',
    ])
    await ui.redraw({ ...DOCKED_PANE, view: { agentId: SCOUT } })
    expect((await headerOf(ui))[1]).toBe('[ all files ] {agent: scout} [ refresh ]')
    await ui.redraw(DOCKED_PANE)
    expect((await headerOf(ui))[1]).toBe('[ all files ] {agent: main} [ refresh ]')
    await ui.select({ key: 'agent', value: 'all' })
    expect((await headerOf(ui))[2]).toBe('Now  2 agents')
    await ui.unmount()
  })
})

describe('marks: a Grep', () => {
  const GEN = numbered(40).map((entry) => `src/gen/${entry.name}`)
  const BIG: [string, FsEntry[]][] = [
    ['.', [folder('src'), file('README.md')]],
    ['src', [folder('gen')]],
    ['src/gen', numbered(40)],
  ]
  const forms = [
    { surface: 'terminal' as const, form: 'relative', names: GEN },
    { surface: 'desktop' as const, form: 'absolute', names: GEN.map((name) => `${ROOT}/${name}`) },
  ]

  for (const { surface, form, names } of forms) {
    test(`a Grep that returns 40 files with ${form} paths reveals 12, and Now counts the other 28 on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, BIG, { kind: 'ok', stdout: CLEAN })
      const result = { mode: 'files_with_matches', numFiles: names.length, filenames: names }
      fakeTools(on, seen, new Map([['Grep', { answer: 'ok', result }]]))
      const ui = await openFiles($, seen, surface)
      await grep($, { pattern: 'export', output_mode: 'files_with_matches' })
      await seen.clock.advance(9000)
      await ui.press({ key: 'open:src' })
      await ui.press({ key: 'open:src/gen' })
      expect((await headerOf(ui)).slice(2)).toEqual([
        'Now  1 agent',
        '◦ main      src/gen/a0001.ts           9s',
        '  and 28 more files from one Grep',
      ])
      const tree = await treeLines(ui)
      const marked = tree.filter((line) => line.includes('◦ main'))
      expect(marked).toEqual([
        '▾ src/                    ◦ main       9s',
        '  ▾ gen/                  ◦ main       9s',
        ...numbered(12).map((entry) => `      ${entry.name}${' '.repeat(12)}◦ main       9s`),
      ])
      expect(tree).toContain('      a0013.ts')
      await ui.unmount()
    })
  }

  test('a Grep that fails or finds nothing marks no file', async ($, on) => {
    const seen = gitWorld(on, BIG, { kind: 'ok', stdout: CLEAN })
    fakeTools(on, seen, new Map([['Grep', { answer: 'ok', result: { filenames: [] } }]]))
    const ui = await openFiles($, seen)
    await grep($, { pattern: 'nothing' })
    expect((await headerOf(ui)).at(-1)).toBe(NOW_EMPTY)
    await ui.unmount()
  })
})

type ShellRun = { tookMs: number; writesAt: number; write: (seen: World) => void }

function shellTools(on: On, seen: World, runs: ReadonlyMap<string, ShellRun>): void {
  on('tool.call', async (_$, e) => {
    const input: Readonly<Record<string, unknown>> = e
    const run = typeof input.command === 'string' ? runs.get(input.command) : undefined
    if (run !== undefined) {
      await seen.clock.sleep(run.writesAt)
      run.write(seen)
      await seen.clock.sleep(run.tookMs - run.writesAt)
    }
    return { result: '' }
  })
}

const READ_ONLY: ShellRun = { tookMs: 0, writesAt: 0, write: () => undefined }

function bash($: Engine, command: string, agentId?: string): Promise<unknown> {
  return $.tool.call({ tool: 'Bash', command, ...(agentId === undefined ? {} : { agentId }) })
}

function trackedFile(seen: World, path: string): void {
  seen.files.set(`${ROOT}/${path}`, { kind: 'file', text: 'x', mtimeMs: 1 })
}

function written(seen: World, path: string): void {
  const at = `${ROOT}/${path}`
  const found = seen.files.get(at)
  if (found === undefined) throw new Error(`no fake file ${at}`)
  seen.files.set(at, { ...found, mtimeMs: seen.clock.now() })
}

function modified(seen: World, paths: readonly string[]): void {
  seen.answer = { kind: 'ok', stdout: statusOf(paths.map((path) => changed('.M', path))) }
}

function editWrites(on: On, seen: World, path: string): void {
  on('tool.call', { tool: 'Edit' }, (_$, e, next) => {
    written(seen, path)
    modified(seen, [path])
    return next(e)
  })
}

describe('marks: a Bash call', () => {
  for (const surface of SURFACES) {
    test(`a Bash call by a subagent that changes two tracked files marks both rows with that agent after one status run on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, {
        kind: 'ok',
        stdout: statusOf([changed('.M', 'docs/design.md')]),
      })
      trackedFile(seen, 'docs/design.md')
      trackedFile(seen, 'hooks/pane.tsx')
      trackedFile(seen, 'docs/mocks.md')
      const build: ShellRun = {
        tookMs: 0,
        writesAt: 0,
        write: (world) => {
          written(world, 'docs/design.md')
          written(world, 'hooks/pane.tsx')
          modified(world, ['docs/design.md', 'hooks/pane.tsx'])
        },
      }
      shellTools(on, seen, new Map([['npm run build', build]]))
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface)
      const call = bash($, 'npm run build', SCOUT)
      await seen.clock.advance(2000)
      await call
      expect(seen.runs).toHaveLength(2)
      await ui.press({ key: 'open:docs' })
      await ui.press({ key: 'open:hooks' })
      expect((await headerOf(ui)).slice(2)).toEqual([
        'Now  1 agent',
        '✎ scout     docs/design.md             2s',
        '  and 1 more file from one Bash',
      ])
      const tree = await treeLines(ui)
      expect(tree.filter((line) => line.includes('✎'))).toEqual([
        '▾ docs/  M1               ✎ scout      2s',
        '  M design.md             ✎ scout      2s',
        '▾ hooks/  M1              ✎ scout      2s',
        '  M pane.tsx              ✎ scout      2s',
      ])
      expect(tree).toContain('    mocks.md')
      await seen.clock.advance(60_000)
      expect(seen.runs).toHaveLength(2)
      await ui.unmount()
    })

    test(`two Bash calls that write and overlap mark the changed rows 2 agents, and the open row names both, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
      trackedFile(seen, 'docs/mocks.md')
      trackedFile(seen, 'hooks/pane.tsx')
      const generate: ShellRun = {
        tookMs: 3000,
        writesAt: 1000,
        write: (world) => {
          written(world, 'hooks/pane.tsx')
          modified(world, ['hooks/pane.tsx'])
        },
      }
      const format: ShellRun = {
        tookMs: 3000,
        writesAt: 2000,
        write: (world) => {
          written(world, 'docs/mocks.md')
          modified(world, ['docs/mocks.md', 'hooks/pane.tsx'])
        },
      }
      shellTools(
        on,
        seen,
        new Map([
          ['npm run gen', generate],
          ['npm run format', format],
        ]),
      )
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface)
      const main = bash($, 'npm run gen')
      await seen.clock.advance(500)
      const scout = bash($, 'npm run format', SCOUT)
      await seen.clock.advance(3500)
      await Promise.all([main, scout])
      await seen.clock.advance(2000)
      expect(seen.runs).toHaveLength(3)
      await openRow(ui, ['docs', 'hooks'], 'docs/mocks.md')
      expect((await headerOf(ui)).slice(2)).toEqual([NOW_EMPTY])
      const tree = await treeLines(ui)
      const row = tree.indexOf('  M mocks.md              ✎ 2 agents   2s')
      expect(tree.slice(row, row + 3)).toEqual([
        '  M mocks.md              ✎ 2 agents   2s',
        '      changed while Bash of main and',
        '      scout ran 2s ago',
      ])
      expect(tree).toContain('  M pane.tsx              ✎ 2 agents   2s')
      expect(tree.some((line) => / ✎ (main|scout) /.test(line))).toBe(false)
      await ui.unmount()
    })
  }

  test('a file that the person changed before a read-only Bash call gets no mark', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    shellTools(on, seen, new Map([['git diff', READ_ONLY]]))
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    await seen.clock.advance(10_000)
    written(seen, 'README.md')
    modified(seen, ['README.md'])
    await seen.clock.advance(10_000)
    expect(seen.runs).toHaveLength(1)
    const call = bash($, 'git diff', SCOUT)
    await seen.clock.advance(2000)
    await call
    expect(seen.runs).toHaveLength(3)
    expect(await treeLines(ui)).toContain('M README.md')
    expect((await headerOf(ui)).at(-1)).toBe(NOW_EMPTY)
    await ui.unmount()
  })

  test('a file that a background writer changed after the Bash call ended gets no mark', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    shellTools(on, seen, new Map([['npm test', READ_ONLY]]))
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    const call = bash($, 'npm test', SCOUT)
    await seen.clock.advance(1000)
    await call
    written(seen, 'README.md')
    modified(seen, ['README.md'])
    await seen.clock.advance(1000)
    expect(seen.runs).toHaveLength(2)
    expect(await treeLines(ui)).toContain('M README.md')
    expect((await headerOf(ui)).at(-1)).toBe(NOW_EMPTY)
    await ui.unmount()
  })

  test('a call that ended before the change is not counted, even when it overlaps the call that made it', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'hooks/pane.tsx')
    const lint: ShellRun = { tookMs: 1000, writesAt: 0, write: () => undefined }
    const generate: ShellRun = {
      tookMs: 2500,
      writesAt: 2000,
      write: (world) => {
        written(world, 'hooks/pane.tsx')
        modified(world, ['hooks/pane.tsx'])
      },
    }
    shellTools(
      on,
      seen,
      new Map([
        ['npm run lint', lint],
        ['npm run gen', generate],
      ]),
    )
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    const main = bash($, 'npm run lint')
    await seen.clock.advance(500)
    const scout = bash($, 'npm run gen', SCOUT)
    await seen.clock.advance(4500)
    await Promise.all([main, scout])
    expect(seen.runs).toHaveLength(3)
    await ui.press({ key: 'open:hooks' })
    expect(await treeLines(ui)).toContain('  M pane.tsx              ✎ scout      2s')
    await ui.unmount()
  })

  test('an Edit by a subagent during a read-only Bash call of main marks 2 agents, never main alone', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    editWrites(on, seen, 'README.md')
    shellTools(on, seen, new Map([['npm run lint', { ...READ_ONLY, tookMs: 3000 }]]))
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    const main = bash($, 'npm run lint')
    await seen.clock.advance(1000)
    await edit($, 'README.md', SCOUT)
    await seen.clock.advance(4000)
    await main
    await ui.redraw(DOCKED_PANE)
    const tree = await treeLines(ui)
    expect(tree).toContain('M README.md               ✎ 2 agents   2s')
    expect(tree.some((line) => line.includes('✎ main'))).toBe(false)
    await ui.unmount()
  })

  test('an Edit and then a Bash call that writes nothing leave the Edit mark alone', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    editWrites(on, seen, 'README.md')
    shellTools(on, seen, new Map())
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    await edit($, 'README.md')
    await bash($, 'npm test', SCOUT)
    await seen.clock.advance(2000)
    expect(seen.runs).toHaveLength(3)
    expect(await treeLines(ui)).toContain('M README.md               ✎ main       2s')
    expect((await headerOf(ui)).slice(2)).toEqual([
      'Now  1 agent',
      '✎ main      README.md                  2s',
    ])
    await ui.unmount()
  })

  test('a Bash call that the person denies marks no file', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    on('tool.call', { tool: 'Bash' }, () => {
      written(seen, 'README.md')
      modified(seen, ['README.md'])
      return { deny: 'The person refused the call.' }
    })
    const ui = await openFiles($, seen)
    await bash($, 'npm run build', SCOUT).catch(() => undefined)
    await seen.clock.advance(2000)
    expect(seen.runs).toHaveLength(2)
    expect(await treeLines(ui)).toContain('M README.md')
    await ui.unmount()
  })

  test('a Bash call that starts during a git status run waits for it and starts no run beside it', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    const build: ShellRun = {
      tookMs: 0,
      writesAt: 0,
      write: (world) => {
        written(world, 'README.md')
        modified(world, ['README.md'])
      },
    }
    shellTools(on, seen, new Map([['npm run build', build]]))
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    seen.answer = { kind: 'ok', stdout: CLEAN, tookMs: 500 }
    await seen.clock.advance(2000)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.md`, content: 'b' })
    const call = bash($, 'npm run build', SCOUT)
    await seen.clock.advance(400)
    expect(seen.runs).toHaveLength(2)
    await seen.clock.advance(4000)
    await call
    expect(seen.runs).toHaveLength(3)
    expect(seen.mostInFlight).toBe(1)
    await ui.redraw(DOCKED_PANE)
    expect(await treeLines(ui)).toContain('M README.md               ✎ scout      3s')
    await ui.unmount()
  })

  test('a Bash call that waits over 1 s for a slow git status runs on with no baseline and marks no file', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    const build: ShellRun = {
      tookMs: 1000,
      writesAt: 500,
      write: (world) => {
        written(world, 'README.md')
        modified(world, ['README.md'])
      },
    }
    shellTools(on, seen, new Map([['npm run build', build]]))
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    seen.answer = { kind: 'ok', stdout: CLEAN, tookMs: 3000 }
    await seen.clock.advance(2000)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.md`, content: 'b' })
    const call = bash($, 'npm run build', SCOUT)
    await seen.clock.advance(20_000)
    await call
    expect(seen.mostInFlight).toBe(1)
    expect(await treeLines(ui)).toContain('M README.md')
    expect((await screen(ui)).some((line) => line.includes('scout'))).toBe(false)
    await ui.unmount()
  })

  test('a change while a call with no baseline ran gets no mark, even for the call that has one', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    const build: ShellRun = {
      tookMs: 1000,
      writesAt: 500,
      write: (world) => {
        written(world, 'README.md')
        modified(world, ['README.md'])
      },
    }
    shellTools(
      on,
      seen,
      new Map([
        ['npm run serve', { ...READ_ONLY, tookMs: 6000 }],
        ['npm run build', build],
      ]),
    )
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    const main = bash($, 'npm run serve')
    seen.answer = { kind: 'ok', stdout: CLEAN, tookMs: 3000 }
    await seen.clock.advance(2000)
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.md`, content: 'b' })
    const scout = bash($, 'npm run build', SCOUT)
    await seen.clock.advance(10_000)
    await Promise.all([main, scout])
    expect(seen.runs).toHaveLength(4)
    const tree = await treeLines(ui)
    expect(tree).toContain('M README.md')
    expect(tree.some((line) => line.includes('✎'))).toBe(false)
    await ui.unmount()
  })

  test('a Bash call that never ends stops counting at the end of the turn', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
    trackedFile(seen, 'README.md')
    shellTools(on, seen, new Map([['npm run serve', { ...READ_ONLY, tookMs: 600_000 }]]))
    on('turn.complete', () => ({ text: '' }))
    on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    const call = bash($, 'npm run serve', SCOUT)
    await seen.clock.advance(1000)
    await $.turn.complete({
      turnId: 'main-turn',
      reason: 'answer',
      answer: 'done',
      durationMs: 1,
      isAborted: false,
    })
    await seen.clock.advance(1000)
    written(seen, 'README.md')
    modified(seen, ['README.md'])
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    await seen.clock.settle()
    expect(seen.runs).toHaveLength(2)
    expect(await treeLines(ui)).toContain('M README.md')
    expect((await headerOf(ui)).at(-1)).toBe(NOW_EMPTY)
    await seen.clock.advance(600_000)
    await call
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`outside a git repo a Bash call lists the open folders again and marks the new and changed files, with no process, on the ${surface}`, async ($, on) => {
      const seen = world(on, APP)
      const write: ShellRun = {
        tookMs: 1000,
        writesAt: 500,
        write: (world) => {
          world.folders.set('docs', [
            file('mocks.md'),
            file('design.md'),
            file('install.md'),
            { ...file('guide.md'), size: 9, mtimeMs: world.clock.now() },
            { ...file('plan.md'), mtimeMs: world.clock.now() },
          ])
          world.folders.set('hooks', [file('pane.tsx'), folder('dist'), file('new.tsx')])
        },
      }
      shellTools(on, seen, new Map([['make notes', write]]))
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface)
      await ui.press({ key: 'open:docs' })
      const listedBefore = seen.listed.length
      const call = bash($, 'make notes', SCOUT)
      await seen.clock.advance(6000)
      await call
      await ui.redraw(DOCKED_PANE)
      expect(seen.listed.slice(listedBefore)).toEqual(['.', 'docs', '.', 'docs'])
      expect(seen.runs).toEqual([])
      expect(await screen(ui)).toEqual([
        'Files  app · not a git repo',
        CONTROLS,
        'No git status here; git init adds it.',
        'Now  1 agent',
        '✎ scout     docs/guide.md              5s',
        '  and 1 more file from one Bash',
        RULE_41,
        '▸ .git/  not listed',
        '▸ node_modules/  not listed',
        '▾ docs/                   ✎ scout      5s',
        '    design.md',
        '    guide.md              ✎ scout      5s',
        '    install.md',
        '    mocks.md',
        '    plan.md               ✎ scout      5s',
        '▸ hooks/',
        '▸ scripts/',
        '  .gitignore',
        '  README.md',
      ])
      await ui.unmount()
    })
  }

  test('outside a git repo a file that the person added before a read-only Bash call gets no mark', async ($, on) => {
    const seen = world(on, APP)
    shellTools(on, seen, new Map([['ls', READ_ONLY]]))
    boardKnowsScout(on)
    const ui = await openFiles($, seen)
    await ui.press({ key: 'open:docs' })
    await seen.clock.advance(10_000)
    seen.folders.set('docs', [
      file('mocks.md'),
      file('design.md'),
      file('install.md'),
      file('guide.md'),
      { ...file('person.md'), mtimeMs: seen.clock.now() },
    ])
    await seen.clock.advance(60_000)
    const call = bash($, 'ls', SCOUT)
    await seen.clock.advance(1000)
    await call
    await ui.redraw(DOCKED_PANE)
    const lines = await screen(ui)
    expect(lines).toContain('    person.md')
    expect(lines.some((line) => line.includes('✎'))).toBe(false)
    expect(seen.runs).toEqual([])
    await ui.unmount()
  })

  test('outside a git repo a Bash call lists again only the open folders, not a closed one', async ($, on) => {
    const seen = world(on, APP)
    shellTools(on, seen, new Map([['ls', READ_ONLY]]))
    const ui = await openFiles($, seen)
    await ui.press({ key: 'open:docs' })
    await ui.press({ key: 'open:docs' })
    const listedBefore = seen.listed.length
    const call = bash($, 'ls')
    await seen.clock.advance(1000)
    await call
    expect(seen.listed.slice(listedBefore)).toEqual(['.', '.'])
    await ui.unmount()
  })

  test('the call records stay bounded while no baseline is taken, and a call that never ends goes at the turn end', () => {
    const shell = newShell(newTouches())
    beginShellRun(shell, { id: 'stuck', agent: SCOUT, baseline: undefined, startedAt: 0 })
    for (let index = 1; index <= 200; index += 1) {
      const id = `call-${String(index)}`
      beginShellRun(shell, { id, agent: '', baseline: undefined, startedAt: index * 10 })
      endShellRun(shell, { id, hasRun: true, endedAt: index * 10 + 5 })
    }
    expect(shell.runs.size).toBe(1)
    endTurn(shell, { agent: SCOUT, at: 5000 })
    expect(shell.runs.size).toBe(0)
  })
})

const MIB = 1024 * 1024
const DIFF_ARGV = [
  'git',
  '-c',
  'core.quotePath=false',
  '--literal-pathspecs',
  'diff',
  'HEAD',
  '--no-color',
  '--no-ext-diff',
  '--no-renames',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--no-relative',
  '--',
]
const DIFF_COMMAND = DIFF_ARGV.join(' ')
const BACKSLASH = String.fromCharCode(0x5c)
const ESCAPE = String.fromCharCode(0x1b)
const RIGHT_TO_LEFT = String.fromCharCode(0x202e)
const NUL = String.fromCharCode(0)
const HUNK_A = [
  '@@ -1,3 +1,4 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  ' const d = 5',
].join('\n')
const HUNK_B = ['@@ -40,2 +41,2 @@', '-old', '+new', ' same'].join('\n')

function textFile(seen: World, path: string, text: string, extra: Partial<FakeFile> = {}): void {
  seen.files.set(`${ROOT}/${path}`, { kind: 'file', text, mtimeMs: 1, ...extra })
}

function lineText(count: number, width = 0): string {
  return Array.from({ length: count }, (_, index) =>
    `line ${String(index + 1)}`.padEnd(width, 'x'),
  ).join('\n')
}

function fileDiff(path: string, hunks: readonly string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks,
    '',
  ].join('\n')
}

function addingHunk(start: number, lines: number): string {
  const context = Array.from({ length: lines - 1 }, (_, index) => ` c${String(index)}`)
  const header = `@@ -${String(start)},${String(lines - 1)} +${String(start)},${String(lines)} @@`
  return [header, ...context, '+added'].join('\n')
}

function diffRuns(seen: World): GitRun[] {
  return seen.runs.filter((run) => run.argv[4] === 'diff')
}

async function codeOf(ui: { find: Mounted['find'] }): Promise<Record<string, unknown> | undefined> {
  return (await ui.find({ type: 'Code' }))?.props
}

async function openRow(
  ui: { press: Mounted['press'] },
  folders: readonly string[],
  path: string,
): Promise<void> {
  for (const one of folders) await ui.press({ key: `open:${one}` })
  await ui.press({ key: `file:${path}` })
}

describe('preview and diff: the open row', () => {
  for (const surface of SURFACES) {
    test(`a press on a file row opens it with its agents, its git state and four buttons, one row at a time, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      fakeTools(on, seen, new Map())
      boardKnowsScout(on)
      const ui = await openFiles($, seen, surface)
      await read($, 'docs/mocks.md', SCOUT)
      await seen.clock.advance(120_000)
      await edit($, 'docs/mocks.md')
      await seen.clock.advance(60_000)
      await openRow(ui, ['docs'], 'docs/mocks.md')
      const lines = await treeLines(ui)
      const row = lines.indexOf('  M mocks.md              ✎ main +1    1m')
      expect(lines.slice(row, row + 7)).toEqual([
        '  M mocks.md              ✎ main +1    1m',
        '      edited by main 1m ago',
        '      read by scout 3m ago',
        '      modified, not staged',
        '      [ preview ] [ diff ] [ copy path ]',
        '      [ @ to prompt ]',
        '▸ hooks/  M1 D1',
      ])
      expect((await ui.findAll({ type: 'Button' })).map((button) => button.key)).toEqual(
        expect.arrayContaining(['preview', 'diff', 'copy-path', 'to-prompt']),
      )
      expect((await ui.find({ key: 'preview' }))?.props.hotkey).toBeUndefined()
      await ui.press({ key: 'file:docs/design.md' })
      const other = await treeLines(ui)
      expect(other).not.toContain('      edited by main 1m ago')
      expect(other.slice(other.indexOf('  M design.md') + 1).slice(0, 2)).toEqual([
        '      modified, not staged',
        '      [ preview ] [ diff ] [ copy path ]',
      ])
      await ui.press({ key: 'file:docs/design.md' })
      expect(await treeLines(ui)).not.toContain('      modified, not staged')
      expect(await ui.find({ key: 'preview' })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('outside a git repo the open row has no diff button', async ($, on) => {
    const seen = world(on, APP)
    const ui = await openFiles($, seen)
    await openRow(ui, [], 'README.md')
    expect((await treeLines(ui)).slice(-2)).toEqual([
      '    [ preview ] [ copy path ]',
      '    [ @ to prompt ]',
    ])
    expect(await ui.find({ key: 'diff' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('preview and diff: preview', () => {
  for (const surface of SURFACES) {
    test(`preview of a long file shows a Code element with a gutter, at most 2000 lines and a note, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      textFile(seen, 'hooks/pane.tsx', `${lineText(3000)}\n`)
      const ui = await openFiles($, seen, surface)
      await openRow(ui, ['hooks'], 'hooks/pane.tsx')
      await ui.press({ key: 'preview' })
      expect(await screen(ui)).toEqual([
        'Files  app · main ↑1 · 6 changed',
        '[ back ] [ diff ] [ copy path ]',
        'hooks/pane.tsx  M · 3,000 lines',
        'first 2,000 lines shown of 3,000',
        RULE_41,
        '(Code)',
      ])
      expect(await codeOf(ui)).toMatchObject({
        source: lineText(2000),
        path: 'hooks/pane.tsx',
        startLine: 1,
      })
      expect((await codeOf(ui))?.format).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^first 2,000/ }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: 'M' }))?.props.color).toBe('warning')
      await ui.press({ key: 'back' })
      expect(await treeLines(ui)).toContain('  M pane.tsx')
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      await ui.unmount()
    })
  }

  test('preview of a file of 2000 lines or fewer has no cut note', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    textFile(seen, 'hooks/pane.tsx', lineText(2000))
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/pane.tsx')
    await ui.press({ key: 'preview' })
    expect((await screen(ui)).slice(2, 4)).toEqual(['hooks/pane.tsx  M · 2,000 lines', RULE_41])
    expect((await codeOf(ui))?.source).toBe(lineText(2000))
    await ui.unmount()
  })

  test('preview stops below 100000 characters in the whole drawing, on a line boundary, and says how many lines it shows', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    textFile(seen, 'hooks/pane.tsx', lineText(1500, 99))
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/pane.tsx')
    await ui.press({ key: 'preview' })
    const source = String((await codeOf(ui))?.source)
    const shown = source.split('\n').length
    expect(shown).toBeGreaterThan(900)
    expect(shown).toBeLessThan(1000)
    expect(source).toBe(lineText(shown, 99))
    expect((await screen(ui))[3]).toBe(
      `first ${shown.toLocaleString('en-US')} lines shown of 1,500`,
    )
    await ui.drawn()
    expect(seen.logs.filter((line) => line.includes('characters of text'))).toEqual([])
    await ui.unmount()
  })

  test('preview of a file with one very long line shows the start of it and says the line is cut', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    textFile(seen, 'hooks/pane.tsx', 'x'.repeat(150_000))
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/pane.tsx')
    await ui.press({ key: 'preview' })
    expect((await screen(ui)).slice(2, 5)).toEqual([
      'hooks/pane.tsx  M · 1 line',
      'the first line is too long; it is cut',
      RULE_41,
    ])
    const source = String((await codeOf(ui))?.source)
    expect(source.length).toBeGreaterThan(90_000)
    expect(source.length).toBeLessThan(100_000)
    await ui.drawn()
    await ui.unmount()
  })

  test('preview of a Markdown file uses the Markdown element and shows the latest agent', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    fakeTools(on, seen, new Map())
    textFile(seen, 'docs/mocks.md', '# Mocks\n\nThe tree.\n')
    const ui = await openFiles($, seen, 'desktop')
    await read($, 'docs/mocks.md')
    await seen.clock.advance(4000)
    await openRow(ui, ['docs'], 'docs/mocks.md')
    await ui.press({ key: 'preview' })
    expect((await screen(ui)).slice(2)).toEqual([
      'docs/mocks.md  M · 3 lines',
      'read by main 4s ago',
      RULE_41,
      '(Markdown)',
    ])
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('# Mocks\n\nThe tree.')
    await ui.unmount()
  })

  test('preview escapes control and bidi characters and drops the carriage return of a line end', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    textFile(seen, 'hooks/pane.tsx', `a${ESCAPE}b\r\nc${RIGHT_TO_LEFT}d\r\n`)
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/pane.tsx')
    await ui.press({ key: 'preview' })
    expect((await codeOf(ui))?.source).toBe(`a${BACKSLASH}u001bb\nc${BACKSLASH}u202ed`)
    await ui.drawn()
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`a binary, an over 4 MiB, an unreadable and a deleted file each show their one-line note on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, [['.', [file('dump.sql'), file('key.pem'), file('logo.png')]]], {
        kind: 'ok',
        stdout: statusOf([changed('.D', 'old.tsx')]),
      })
      textFile(seen, 'logo.png', `PNG${NUL}x`, { size: 48 * 1024 })
      textFile(seen, 'dump.sql', 'select 1;', { size: 210 * MIB })
      textFile(seen, 'key.pem', 'secret', { denial: "EACCES: permission denied, open 'key.pem'" })
      const ui = await openFiles($, seen, surface)
      const notes: string[][] = []
      for (const name of ['logo.png', 'dump.sql', 'key.pem', 'old.tsx']) {
        await ui.press({ key: `file:${name}` })
        await ui.press({ key: 'preview' })
        const lines = await screen(ui)
        notes.push(lines.slice(2, lines.indexOf(RULE_41)))
        expect(await ui.find({ type: 'Code' })).toBeUndefined()
        await ui.press({ key: 'back' })
      }
      expect(notes).toEqual([
        ['logo.png  · 48K', 'binary file, no preview'],
        ['dump.sql  · 210M', 'over 4 MiB, no preview'],
        ['key.pem', 'Cannot read it: permission denied.'],
        ['old.tsx  D', 'deleted; [ diff ] shows what it held'],
      ])
      expect(seen.reads).not.toContain(`${ROOT}/dump.sql`)
      expect(seen.reads).not.toContain(`${ROOT}/old.tsx`)
      await ui.unmount()
    })
  }

  test('the unreadable note draws in the error colour and the binary note draws dim', async ($, on) => {
    const seen = gitWorld(on, [['.', [file('key.pem'), file('logo.png')]]], {
      kind: 'ok',
      stdout: CLEAN,
    })
    textFile(seen, 'key.pem', 'secret', { denial: "EACCES: permission denied, open 'key.pem'" })
    textFile(seen, 'logo.png', `PNG${NUL}`)
    const ui = await openFiles($, seen)
    await openRow(ui, [], 'key.pem')
    await ui.press({ key: 'preview' })
    expect((await ui.find({ type: 'Text', text: /^Cannot read it/ }))?.props.color).toBe('error')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'file:logo.png' })
    await ui.press({ key: 'preview' })
    expect((await ui.find({ type: 'Text', text: /^binary file/ }))?.props.dimColor).toBe(true)
    await ui.unmount()
  })
})

describe('preview and diff: diff', () => {
  for (const surface of SURFACES) {
    test(`diff of a changed file runs one git diff and shows its hunks in a Code element in diff format on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      seen.diffAnswer = { kind: 'ok', stdout: fileDiff('hooks/pane.tsx', [HUNK_A, HUNK_B]) }
      const ui = await openFiles($, seen, surface)
      await openRow(ui, ['hooks'], 'hooks/pane.tsx')
      await ui.press({ key: 'diff' })
      expect(diffRuns(seen)).toEqual([
        { argv: [...DIFF_ARGV, 'hooks/pane.tsx'], cwd: ROOT, timeoutMs: 10_000 },
      ])
      expect(await screen(ui)).toEqual([
        'Files  app · main ↑1 · 6 changed',
        '[ back ] [ preview ] [ copy path ]',
        'hooks/pane.tsx  M · +3 -2 vs HEAD',
        RULE_41,
        '(Code)',
      ])
      expect(await codeOf(ui)).toMatchObject({
        source: `${HUNK_A}\n${HUNK_B}`,
        path: 'hooks/pane.tsx',
        format: 'diff',
      })
      await ui.press({ key: 'preview' })
      expect((await screen(ui))[1]).toBe('[ back ] [ diff ] [ copy path ]')
      expect(diffRuns(seen)).toHaveLength(1)
      await ui.unmount()
    })
  }

  test('a diff over 2000 lines is cut at a hunk boundary and says how many hunks it shows', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    const hunks = [addingHunk(1, 1000), addingHunk(2000, 900), addingHunk(5000, 500)]
    seen.diffAnswer = { kind: 'ok', stdout: fileDiff('hooks/pane.tsx', hunks) }
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/pane.tsx')
    await ui.press({ key: 'diff' })
    expect((await screen(ui)).slice(2, 4)).toEqual([
      'hooks/pane.tsx  M · +3 -0 vs HEAD',
      'first 2 of 3 hunks shown',
    ])
    expect((await codeOf(ui))?.source).toBe(hunks.slice(0, 2).join('\n'))
    await ui.unmount()
  })

  test('a git diff cut at 4 MiB drops the hunk that the limit cut and says so', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    const whole = fileDiff('hooks/pane.tsx', [HUNK_A, HUNK_B])
    seen.diffAnswer = { kind: 'ok', stdout: whole.slice(0, whole.indexOf('+new')), isCut: true }
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/pane.tsx')
    await ui.press({ key: 'diff' })
    expect((await screen(ui)).slice(2, 5)).toEqual([
      'hooks/pane.tsx  M · +2 -1 vs HEAD',
      'git diff is over 4 MiB; the rest is not',
      'shown.',
    ])
    expect((await codeOf(ui))?.source).toBe(HUNK_A)
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`diff of an untracked file builds one added hunk from the file text and runs no process on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      textFile(seen, 'docs/filetree.md', 'one\ntwo\nthree\n')
      const ui = await openFiles($, seen, surface)
      const before = seen.runs.length
      await openRow(ui, ['docs'], 'docs/filetree.md')
      await ui.press({ key: 'diff' })
      expect(seen.runs).toHaveLength(before)
      expect((await screen(ui)).slice(1)).toEqual([
        '[ back ] [ preview ] [ copy path ]',
        'docs/filetree.md  ? · new, 3 lines',
        RULE_41,
        '(Code)',
      ])
      expect(await codeOf(ui)).toMatchObject({
        source: '@@ -0,0 +1,3 @@\n+one\n+two\n+three',
        format: 'diff',
      })
      await ui.unmount()
    })
  }

  test('in a repo with no commit, the diff shows the file whole from its text and runs no process', async ($, on) => {
    const seen = gitWorld(on, [['.', [file('README.md')]]], {
      kind: 'ok',
      stdout: statusOf([changed('A.', 'README.md')], { oid: '(initial)' }),
    })
    textFile(seen, 'README.md', 'hello\n')
    const ui = await openFiles($, seen)
    const before = seen.runs.length
    await openRow(ui, [], 'README.md')
    await ui.press({ key: 'diff' })
    expect(seen.runs).toHaveLength(before)
    expect((await screen(ui)).slice(2, 5)).toEqual([
      'README.md  A · new, 1 line',
      'every file is new; diff shows it whole',
      RULE_41,
    ])
    expect((await codeOf(ui))?.source).toBe('@@ -0,0 +1,1 @@\n+hello')
    await ui.unmount()
  })

  test('a long untracked file is cut to a hunk whose header counts the lines it shows', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    textFile(seen, 'docs/filetree.md', lineText(2500))
    const ui = await openFiles($, seen)
    await openRow(ui, ['docs'], 'docs/filetree.md')
    await ui.press({ key: 'diff' })
    expect((await screen(ui)).slice(2, 4)).toEqual([
      'docs/filetree.md  ? · new, 2,500 lines',
      'first 1,999 lines shown of 2,500',
    ])
    const source = String((await codeOf(ui))?.source)
    expect(source.split('\n')).toHaveLength(2000)
    expect(source.startsWith('@@ -0,0 +1,1999 @@\n+line 1\n')).toBe(true)
    await ui.unmount()
  })

  test('a deleted file shows what it held through the diff', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    const removed = ['@@ -1,2 +0,0 @@', '-export const old = 1', '-export const gone = 2'].join(
      '\n',
    )
    seen.diffAnswer = { kind: 'ok', stdout: fileDiff('hooks/old-pane.tsx', [removed]) }
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/old-pane.tsx')
    await ui.press({ key: 'diff' })
    expect((await screen(ui))[2]).toBe('hooks/old-pane.tsx  D · +0 -2 vs HEAD')
    expect((await codeOf(ui))?.source).toBe(removed)
    await ui.unmount()
  })

  test('a binary change, no change, a failed git diff and a repo whose HEAD is missing each say so', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    textFile(seen, 'hooks/pane.tsx', 'const a = 1\n')
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/pane.tsx')
    const binary = [
      'diff --git a/hooks/pane.tsx b/hooks/pane.tsx',
      'Binary files a/hooks/pane.tsx and b/hooks/pane.tsx differ',
      '',
    ].join('\n')
    const answers: GitAnswer[] = [
      { kind: 'ok', stdout: binary },
      { kind: 'ok', stdout: '' },
      { kind: 'exit', exitCode: 129, stderr: 'usage: git diff' },
      { kind: 'exit', exitCode: 128, stderr: "fatal: bad revision 'HEAD'" },
    ]
    const shown: string[][] = []
    for (const answer of answers) {
      seen.diffAnswer = answer
      await ui.press({ key: 'diff' })
      const lines = await screen(ui)
      shown.push(lines.slice(2, lines.indexOf(RULE_41)))
      await ui.press({ key: 'back' })
    }
    expect(shown).toEqual([
      ['hooks/pane.tsx  M', 'binary file changed'],
      ['hooks/pane.tsx  M', 'no change against HEAD'],
      ['hooks/pane.tsx', 'git diff failed: exit 129.', 'Run git diff in a shell to see why.'],
      ['hooks/pane.tsx  M · new, 1 line', 'every file is new; diff shows it whole'],
    ])
    expect(diffRuns(seen)).toHaveLength(4)
    await ui.unmount()
  })
})

describe('preview and diff: a folder', () => {
  for (const surface of SURFACES) {
    test(`a press on the counts of a folder shows one Code per changed file, from one git diff, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      const design = ['@@ -1 +1 @@', '-a', '+b'].join('\n')
      const mocks = ['@@ -0,0 +1 @@', '+c'].join('\n')
      seen.diffAnswer = {
        kind: 'ok',
        stdout: `${fileDiff('docs/design.md', [design])}${fileDiff('docs/mocks.md', [mocks])}`,
      }
      textFile(seen, 'docs/filetree.md', 'new\n')
      const ui = await openFiles($, seen, surface)
      await ui.press({ key: 'diff:docs' })
      expect(diffRuns(seen)).toEqual([
        {
          argv: [...DIFF_ARGV, 'docs/design.md', 'docs/mocks.md'],
          cwd: ROOT,
          timeoutMs: 10_000,
        },
      ])
      expect((await screen(ui)).slice(1)).toEqual([
        '[ back ] [ copy path ]',
        'docs/  3 changed files vs HEAD',
        RULE_41,
        'docs/design.md  M +1 -1',
        '(Code)',
        'docs/filetree.md  ? new, 1 line',
        '(Code)',
        'docs/mocks.md  M +1 -0',
        '(Code)',
      ])
      const codes = await ui.findAll({ type: 'Code' })
      expect(codes.map((code) => code.props.source)).toEqual([
        design,
        '@@ -0,0 +1,1 @@\n+new',
        mocks,
      ])
      expect(codes.every((code) => code.props.format === 'diff')).toBe(true)
      expect((await ui.find({ type: 'Text', text: 'docs/design.md' }))?.props.bold).toBe(true)
      await ui.unmount()
    })
  }

  test('a folder of 60 changed files shows the first 50 and copies the git diff command', async ($, on) => {
    const names = numbered(60).map((entry) => `src/gen/${entry.name}`)
    const seen = gitWorld(
      on,
      [
        ['.', [folder('src')]],
        ['src', [folder('gen')]],
        ['src/gen', numbered(60)],
      ],
      { kind: 'ok', stdout: statusOf(names.map((name) => changed('.M', name))) },
    )
    const context = Array.from({ length: 60 }, (_, index) => ` ${String(index).padEnd(79, 'y')}`)
    const hunk = ['@@ -1,60 +1,60 @@', ...context].join('\n')
    seen.diffAnswer = {
      kind: 'ok',
      stdout: names
        .slice(0, 50)
        .map((name) => fileDiff(name, [hunk]))
        .join(''),
    }
    const copies: { text: string; surface: string | undefined }[] = []
    on('ui.copy', (_$, e) => {
      copies.push({ text: e.text, surface: e.surface })
      return { value: { isCopied: true as const } }
    })
    const ui = await openFiles($, seen)
    await ui.press({ key: 'diff:src' })
    const codes = await ui.findAll({ type: 'Code' })
    expect(codes.length).toBeGreaterThan(10)
    expect(codes.length).toBeLessThan(50)
    expect(codes.slice(0, -1).every((code) => code.props.source === hunk)).toBe(true)
    const last = String(codes.at(-1)?.props.source)
    const [lastHeader, ...lastBody] = last.split('\n')
    const shownCount = String(lastBody.length)
    expect(lastHeader).toBe(`@@ -1,${shownCount} +1,${shownCount} @@`)
    expect(lastBody).toEqual(context.slice(0, lastBody.length))
    const lines = await screen(ui)
    expect(lines.filter((line) => /^hunk cut: \d+ of 60 lines shown$/.test(line))).toHaveLength(1)
    expect(lines.filter((line) => line === 'not shown; the pane is full')).toHaveLength(
      50 - codes.length,
    )
    await ui.drawn()
    expect(diffRuns(seen).map((run) => run.argv.slice(DIFF_ARGV.length))).toEqual([
      names.slice(0, 50),
    ])
    expect((await screen(ui)).slice(2, 5)).toEqual([
      'src/  60 changed files vs HEAD',
      'first 50 of 60 changed files shown',
      '[ copy the git diff command ]',
    ])
    await ui.press({ key: 'copy-command' })
    expect(copies).toEqual([{ text: `${DIFF_COMMAND} src`, surface: 'terminal' }])
    await ui.unmount()
  })
})

describe('preview and diff: copy path and @ to prompt', () => {
  for (const surface of SURFACES) {
    test(`copy path copies the path on the surface that pressed it, and @ to prompt fills it without sending, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
      const copies: { text: string; surface: string | undefined }[] = []
      const fills: { text: string; mode: string | undefined }[] = []
      const submitted: string[] = []
      on('ui.copy', (_$, e) => {
        copies.push({ text: e.text, surface: e.surface })
        return { value: { isCopied: true as const } }
      })
      on('prompt.fill', (_$, e) => {
        fills.push({ text: e.text, mode: e.mode })
        return { isFilled: true }
      })
      on('prompt.submit', (_$, e) => {
        submitted.push(e.text)
        return { text: e.text }
      })
      textFile(seen, 'docs/design.md', 'text\n')
      const ui = await openFiles($, seen, surface)
      await openRow(ui, ['docs'], 'docs/design.md')
      await ui.press({ key: 'copy-path' })
      await ui.press({ key: 'to-prompt' })
      await ui.press({ key: 'preview' })
      await ui.press({ key: 'copy-path' })
      expect(copies).toEqual([
        { text: 'docs/design.md', surface },
        { text: 'docs/design.md', surface },
      ])
      expect(fills).toEqual([{ text: '@docs/design.md', mode: 'insert' }])
      expect(submitted).toEqual([])
      await ui.unmount()
    })
  }

  test('@ to prompt quotes a path with a space', async ($, on) => {
    const seen = gitWorld(on, [['.', [file('a b.md')]]], { kind: 'ok', stdout: CLEAN })
    const fills: string[] = []
    on('prompt.fill', (_$, e) => {
      fills.push(e.text)
      return { isFilled: true }
    })
    const ui = await openFiles($, seen)
    await openRow(ui, [], 'a b.md')
    await ui.press({ key: 'to-prompt' })
    expect(fills).toEqual(['@"a b.md"'])
    await ui.unmount()
  })
})

const ONE_LINE_HUNK = ['@@ -1 +1 @@', '-x', '+X'].join('\n')

function quotedDiff(quoted: string): string {
  return [
    `diff --git "a/${quoted}" "b/${quoted}"`,
    'index 587be6b..62d8fe9 100644',
    `--- "a/${quoted}"`,
    `+++ "b/${quoted}"`,
    ONE_LINE_HUNK,
    '',
  ].join('\n')
}

describe('preview and diff: names, renames and cuts as git prints them', () => {
  test('a diff finds the files whose names git quotes, escapes or ends with a tab', async ($, on) => {
    const names = ['café.txt', 'nl\nname.txt', 'q"uote.txt', 'sp ace.txt']
    const seen = gitWorld(
      on,
      [
        ['.', [folder('n')]],
        ['n', names.map(file)],
      ],
      {
        kind: 'ok',
        stdout: statusOf(names.map((name) => changed('.M', `n/${name}`))),
      },
    )
    const space = [
      'diff --git a/n/sp ace.txt b/n/sp ace.txt',
      'index 587be6b..62d8fe9 100644',
      '--- a/n/sp ace.txt\t',
      '+++ b/n/sp ace.txt\t',
      ONE_LINE_HUNK,
      '',
    ].join('\n')
    seen.diffAnswer = {
      kind: 'ok',
      stdout: [
        quotedDiff(`n/caf${BACKSLASH}303${BACKSLASH}251.txt`),
        quotedDiff(`n/nl${BACKSLASH}nname.txt`),
        quotedDiff(`n/q${BACKSLASH}"uote.txt`),
        space,
      ].join(''),
    }
    const ui = await openFiles($, seen)
    await ui.press({ key: 'diff:n' })
    expect(diffRuns(seen).map((run) => run.argv)).toEqual([
      [...DIFF_ARGV, ...names.map((name) => `n/${name}`)],
    ])
    const lines = await screen(ui)
    expect(lines).not.toContain('no change against HEAD')
    expect(lines.filter((line) => line.endsWith('M +1 -1'))).toHaveLength(4)
    const codes = await ui.findAll({ type: 'Code' })
    expect(codes.map((code) => code.props.source)).toEqual(names.map(() => ONE_LINE_HUNK))
    await ui.unmount()
  })

  test('a name that starts with a colon or holds a glob goes to git as a literal path', async ($, on) => {
    const seen = gitWorld(on, [['.', [file(':k.txt')]]], {
      kind: 'ok',
      stdout: statusOf([changed('.M', ':k.txt')]),
    })
    seen.diffAnswer = { kind: 'ok', stdout: fileDiff(':k.txt', [ONE_LINE_HUNK]) }
    const ui = await openFiles($, seen)
    await openRow(ui, [], ':k.txt')
    await ui.press({ key: 'diff' })
    expect(diffRuns(seen).map((run) => run.argv)).toEqual([[...DIFF_ARGV, ':k.txt']])
    expect(DIFF_ARGV.indexOf('--literal-pathspecs')).toBeLessThan(DIFF_ARGV.indexOf('diff'))
    expect((await codeOf(ui))?.source).toBe(ONE_LINE_HUNK)
    await ui.unmount()
  })

  test('a file moved by hand shows the deleted file and the new file, each with its lines', async ($, on) => {
    const seen = gitWorld(
      on,
      [
        ['.', [folder('r')]],
        ['r', [file('new.txt')]],
      ],
      {
        kind: 'ok',
        stdout: statusOf([changed('A.', 'r/new.txt'), changed('.D', 'r/old.txt')]),
      },
    )
    const added = ['@@ -0,0 +1,3 @@', '+moved', '+lines', '+here'].join('\n')
    const removed = ['@@ -1,3 +0,0 @@', '-moved', '-lines', '-here'].join('\n')
    seen.diffAnswer = {
      kind: 'ok',
      stdout: [
        'diff --git a/r/new.txt b/r/new.txt',
        'new file mode 100644',
        'index 0000000..147176a',
        '--- /dev/null',
        '+++ b/r/new.txt',
        added,
        'diff --git a/r/old.txt b/r/old.txt',
        'deleted file mode 100644',
        'index 147176a..0000000',
        '--- a/r/old.txt',
        '+++ /dev/null',
        removed,
        '',
      ].join('\n'),
    }
    const ui = await openFiles($, seen)
    await ui.press({ key: 'diff:r' })
    expect(diffRuns(seen)[0]?.argv).toContain('--no-renames')
    expect((await ui.findAll({ type: 'Code' })).map((code) => code.props.source)).toEqual([
      added,
      removed,
    ])
    expect((await screen(ui)).slice(4)).toEqual([
      'r/new.txt  A +3 -0',
      '(Code)',
      'r/old.txt  D +0 -3',
      '(Code)',
    ])
    await ui.unmount()
  })

  test('the copied git diff command quotes each argument for a shell', async ($, on) => {
    const folderName = "it's src"
    const names = numbered(51).map((entry) => `${folderName}/${entry.name}`)
    const seen = gitWorld(
      on,
      [
        ['.', [folder(folderName)]],
        [folderName, numbered(51)],
      ],
      {
        kind: 'ok',
        stdout: statusOf(names.map((name) => changed('.M', name))),
      },
    )
    const copies: string[] = []
    on('ui.copy', (_$, e) => {
      copies.push(e.text)
      return { value: { isCopied: true as const } }
    })
    const ui = await openFiles($, seen)
    await ui.press({ key: `diff:${folderName}` })
    await ui.press({ key: 'copy-command' })
    expect(copies).toEqual([`${DIFF_COMMAND} 'it'${BACKSLASH}''s src'`])
    await ui.unmount()
  })

  test('after the 4 MiB cut, the files that git did not reach say so, not no change', async ($, on) => {
    const names = ['c/a.ts', 'c/b.ts', 'c/d.ts']
    const seen = gitWorld(
      on,
      [
        ['.', [folder('c')]],
        ['c', [file('a.ts'), file('b.ts'), file('d.ts')]],
      ],
      { kind: 'ok', stdout: statusOf(names.map((name) => changed('.M', name))) },
    )
    const whole = `${fileDiff('c/a.ts', [ONE_LINE_HUNK])}${fileDiff('c/b.ts', [HUNK_A])}`
    seen.diffAnswer = { kind: 'ok', stdout: whole.slice(0, whole.indexOf('+const c')), isCut: true }
    const ui = await openFiles($, seen)
    await ui.press({ key: 'diff:c' })
    const lines = await screen(ui)
    expect(lines.slice(lines.indexOf(RULE_41) + 1)).toEqual([
      'c/a.ts  M +1 -1',
      '(Code)',
      'c/b.ts  M',
      'not shown; git diff was cut at 4 MiB',
      'c/d.ts  M',
      'not shown; git diff was cut at 4 MiB',
    ])
    await ui.unmount()
  })

  test('one hunk larger than the pane shows its first lines under a recounted header and says the hunk is cut', async ($, on) => {
    const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: APP_CHANGES })
    const removed = Array.from({ length: 1500 }, (_, index) => `-old ${String(index)}`)
    const added = Array.from({ length: 1500 }, (_, index) => `+new ${String(index)}`)
    const big = ['@@ -1,1500 +1,1500 @@ export function pane', ...removed, ...added].join('\n')
    seen.diffAnswer = { kind: 'ok', stdout: fileDiff('hooks/pane.tsx', [big, HUNK_B]) }
    const ui = await openFiles($, seen)
    await openRow(ui, ['hooks'], 'hooks/pane.tsx')
    await ui.press({ key: 'diff' })
    expect((await screen(ui)).slice(2, 5)).toEqual([
      'hooks/pane.tsx  M · +1,501 -1,501 vs HEAD',
      'hunk cut: 1,999 of 3,000 lines shown',
      'first 1 of 2 hunks shown',
    ])
    const source = String((await codeOf(ui))?.source)
    expect(source).toBe(
      ['@@ -1,1500 +1,499 @@ export function pane', ...removed, ...added.slice(0, 499)].join('\n'),
    )
    await ui.unmount()
  })

  test('an untracked folder and a folder inside it draw their counts with no diff button, and a file in it diffs from its text', async ($, on) => {
    const seen = gitWorld(
      on,
      [
        ['.', [folder('scratch')]],
        ['scratch', [file('notes.md'), folder('deep')]],
        ['scratch/deep', [file('g.ts')]],
      ],
      { kind: 'ok', stdout: statusOf([untracked('scratch/')]) },
    )
    textFile(seen, 'scratch/deep/g.ts', 'g\n')
    const ui = await openFiles($, seen)
    await ui.press({ key: 'open:scratch' })
    await ui.press({ key: 'open:scratch/deep' })
    expect((await treeLines(ui)).slice(0, 2)).toEqual(['▾ scratch/  ?', '  ▾ deep/  ?'])
    expect(await ui.find({ key: 'diff:scratch' })).toBeUndefined()
    expect(await ui.find({ key: 'diff:scratch/deep' })).toBeUndefined()
    const before = seen.runs.length
    await ui.press({ key: 'file:scratch/deep/g.ts' })
    await ui.press({ key: 'diff' })
    expect(seen.runs).toHaveLength(before)
    expect((await codeOf(ui))?.source).toBe('@@ -0,0 +1,1 @@\n+g')
    await ui.unmount()
  })

  test('when the session folder is inside an untracked folder, no folder has a diff button and a file diffs from its text', async ($, on) => {
    const seen = world(on, [
      ['.', [folder('deep'), file('a.ts')]],
      ['deep', [file('g.ts')]],
    ])
    seen.files.set('/work/.git', { kind: 'dir', text: '', mtimeMs: 1 })
    gitFolder(seen, '/work/.git')
    seen.answer = { kind: 'ok', stdout: statusOf([untracked('app/')]) }
    textFile(seen, 'a.ts', 'a\n')
    const ui = await openFiles($, seen)
    expect(await treeLines(ui)).toEqual(['▸ deep/  ?', '? a.ts'])
    expect(await ui.find({ key: 'diff:deep' })).toBeUndefined()
    const before = seen.runs.length
    await openRow(ui, [], 'a.ts')
    await ui.press({ key: 'diff' })
    expect(seen.runs).toHaveLength(before)
    expect((await codeOf(ui))?.source).toBe('@@ -0,0 +1,1 @@\n+a')
    await ui.unmount()
  })
})

const WORK_APP: [string, FsEntry[]][] = [
  ...GIT_APP.map(([path, entries]): [string, FsEntry[]] =>
    path === '.' ? [path, [...entries, folder('scratch')]] : [path, entries],
  ),
  ['scratch', [file('notes.md')]],
]

const WORK_CHANGES = statusOf([...APP_RECORDS, untracked('scratch/')], { ab: '+1 -0' })

const WORK_CONTROLS = '[ all files ] {agent: all} [ refresh ]'

const WORK_NOTE = 'work view: touched and changed files'

async function mountWork($: Engine, seen: World, surface: RenderSurface, columns = 41) {
  await openTab($)
  const ui = await mountFiles($, surface, 'dock', columns, 'work')
  await seen.clock.settle()
  return ui
}

async function mountDefault($: Engine, surface: RenderSurface) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: DOCKED_PANE,
  })
}

async function workTouches($: Engine, seen: World): Promise<void> {
  await read($, 'hooks/register.tsx', SCOUT)
  await seen.clock.advance(36_000)
  await mainEditsScoutReads($, seen)
}

const WORK_TREE = [
  '▾ docs/  M2 ?1            ◦ scout      2s',
  '  M design.md             ◦ scout      2s',
  '  ? filetree.md',
  '  M mocks.md',
  '▾ hooks/  M1 D1           ✎ main       4s',
  '  D old-pane.tsx',
  '  M pane.tsx              ✎ main       4s',
  '    register.tsx          ◦ scout     40s',
  '▸ scratch/  ?',
  'M README.md',
  WORK_NOTE,
]

const ALL_TREE = [
  '▸ .git/  not listed',
  '▸ node_modules/  not listed',
  '▸ docs/  M2 ?1            ◦ scout      2s',
  '▸ hooks/  M1 D1           ✎ main       4s',
  '▸ scratch/  ?',
  '▸ scripts/',
  '  .gitignore',
  'M README.md',
]

describe('the work view', () => {
  for (const surface of SURFACES) {
    test(`the docked tab opens on the work view: only touched or changed files under their folders, with the all files button, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, WORK_APP, { kind: 'ok', stdout: WORK_CHANGES })
      fakeTools(on, seen, new Map())
      boardKnowsScout(on)
      await openTab($)
      const ui = await mountDefault($, surface)
      await seen.clock.settle()
      await workTouches($, seen)
      await ui.redraw(DOCKED_PANE)
      expect(await screen(ui)).toEqual([
        'Files  app · main ↑1 · 7 changed',
        WORK_CONTROLS,
        'Now  2 agents',
        '✎ main      hooks/pane.tsx             4s',
        '◦ scout     docs/design.md             2s',
        RULE_41,
        ...WORK_TREE,
      ])
      expect((await ui.find({ type: 'Text', text: WORK_NOTE }))?.props.dimColor).toBe(true)
      expect((await ui.find({ key: 'view' }))?.props.hotkey).toBe('v')
      expect(new Set(seen.listed)).toEqual(new Set(['.']))
      await ui.unmount()
    })

    test(`all files shows the whole tree, and the button returns to the work view, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, WORK_APP, { kind: 'ok', stdout: WORK_CHANGES })
      fakeTools(on, seen, new Map())
      boardKnowsScout(on)
      const ui = await mountWork($, seen, surface)
      await workTouches($, seen)
      await ui.press({ key: 'view' })
      expect((await headerOf(ui))[1]).toBe(CONTROLS)
      expect(await treeLines(ui)).toEqual(ALL_TREE)
      await ui.unmount()
      const again = await mountDefault($, surface)
      expect(await treeLines(again)).toEqual(ALL_TREE)
      await again.press({ key: 'view' })
      expect((await headerOf(again))[1]).toBe(WORK_CONTROLS)
      expect(await treeLines(again)).toEqual(WORK_TREE)
      await again.unmount()
    })

    test(`with nothing touched or changed, the work view says so and points to all files, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
      const ui = await mountWork($, seen, surface)
      expect(await screen(ui)).toEqual([
        'Files  app · main · clean',
        WORK_CONTROLS,
        NOW_EMPTY,
        RULE_41,
        'No changed or touched files.',
        '[ all files ] shows the whole tree.',
      ])
      await ui.press({ key: 'all-files' })
      expect((await headerOf(ui))[1]).toBe(CONTROLS)
      expect(await treeLines(ui)).toContain('▸ docs/')
      await ui.unmount()
    })

    test(`an empty repo with no commit says the folder is empty in the work view, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, [['.', []]], {
        kind: 'ok',
        stdout: '# branch.oid (initial)\0# branch.head main\0',
      })
      const ui = await mountWork($, seen, surface)
      expect(await screen(ui)).toEqual([
        'Files  app · main · no commits yet',
        WORK_CONTROLS,
        NOW_EMPTY,
        RULE_41,
        'This folder is empty.',
      ])
      await ui.unmount()
    })

    test(`a narrow dock moves the filter below the buttons at body 30, and beside refresh at body 24, on the ${surface}`, async ($, on) => {
      const seen = gitWorld(on, GIT_APP, { kind: 'ok', stdout: CLEAN })
      const narrow = await mountWork($, seen, surface, 30)
      expect((await screen(narrow, 30)).slice(1, 3)).toEqual([
        '[ all files ] [ refresh ]',
        '{agent: all}',
      ])
      await narrow.unmount()
      const ui = await mountFiles($, surface, 'dock', 24, 'work')
      expect((await screen(ui, 24)).slice(1)).toEqual([
        '[ all files ]',
        '[ refresh ] {agent: all}',
        'Now  nothing read or ed…',
        '─'.repeat(24),
        'No changed or touched',
        'files.',
        '[ all files ]',
        'shows the whole tree.',
      ])
      await ui.unmount()
    })
  }

  test('inline at 80 columns, the work view is a flat list of at most 8 rows, the files in Now first, and the more line', async ($, on) => {
    const stdout = statusOf([...APP_RECORDS, untracked('scratch/'), untracked('notes.txt')])
    const seen = gitWorld(on, WORK_APP, { kind: 'ok', stdout })
    fakeTools(on, seen, new Map())
    boardKnowsScout(on)
    await openTab($)
    await edit($, 'scratch/notes.md', HELPER)
    await seen.clock.advance(120_000)
    await edit($, 'hooks/old-pane.tsx', HELPER)
    await read($, 'docs/mocks.md', SCOUT)
    await seen.clock.advance(120_000)
    await edit($, 'docs/mocks.md')
    await seen.clock.advance(20_000)
    await read($, 'hooks/register.tsx', SCOUT)
    await seen.clock.advance(10_000)
    await edit($, 'docs/filetree.md')
    await seen.clock.advance(26_000)
    await edit($, 'hooks/pane.tsx')
    await seen.clock.advance(2000)
    await read($, 'docs/design.md', SCOUT)
    await seen.clock.advance(2000)
    for (const surface of SURFACES) {
      const ui = await mountSettled($, seen, surface, 'inline', 76)
      const lines = await screen(ui, 76)
      expect(lines).toEqual([
        'Files  app · main · 8 changed{agent: all}  [ refresh ]',
        inlineRow('M hooks/pane.tsx', '✎ main          4s'),
        inlineRow('D hooks/old-pane.tsx', '✎ f00dfeed      3m'),
        inlineRow('M docs/design.md', '◦ scout         2s'),
        inlineRow('? docs/filetree.md', '✎ main         30s'),
        inlineRow('M docs/mocks.md', '✎ main +1       1m'),
        inlineRow('  hooks/register.tsx', '◦ scout        40s'),
        inlineRow('  scratch/  ?', '✎ f00dfeed      5m'),
        '+2 more: a dock (fullscreen, 110 columns) shows the tree',
      ])
      expect(lines.length - 1).toBe(8)
      expect(await ui.find({ key: 'view' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a press on a folder in the work view closes and opens it, and an untracked folder opens to its listing', async ($, on) => {
    const seen = gitWorld(on, WORK_APP, { kind: 'ok', stdout: WORK_CHANGES })
    fakeTools(on, seen, new Map())
    boardKnowsScout(on)
    const ui = await mountWork($, seen, 'terminal')
    await workTouches($, seen)
    await ui.press({ key: 'open:docs' })
    await ui.press({ key: 'open:scratch' })
    expect(await treeLines(ui)).toEqual([
      '▸ docs/  M2 ?1            ◦ scout      2s',
      ...WORK_TREE.slice(4, 8),
      '▾ scratch/  ?',
      '  ? notes.md',
      'M README.md',
      WORK_NOTE,
    ])
    await ui.press({ key: 'view' })
    expect(await treeLines(ui)).toContain('▸ docs/  M2 ?1            ◦ scout      2s')
    expect(await treeLines(ui)).toContain('▾ scratch/  ?')
    await ui.press({ key: 'view' })
    await ui.press({ key: 'open:docs' })
    expect((await treeLines(ui)).slice(0, 4)).toEqual(WORK_TREE.slice(0, 4))
    await ui.unmount()
  })

  test('with an agent picked, the work view shows only the files that agent touched', async ($, on) => {
    const seen = gitWorld(on, WORK_APP, { kind: 'ok', stdout: WORK_CHANGES })
    fakeTools(on, seen, new Map())
    boardKnowsScout(on)
    await openTab($)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'Pane',
      requestId: PANE,
      props: DOCKED_PANE,
    })
    await seen.clock.settle()
    await workTouches($, seen)
    await ui.select({ key: 'agent', value: 'main' })
    expect(await treeLines(ui)).toEqual([
      '▾ hooks/  M1 D1           ✎ main       4s',
      '  M pane.tsx              ✎ main       4s',
      WORK_NOTE,
    ])
    await ui.unmount()
  })

  test('a touched file inside a folder that the tree does not list shows in the work view', async ($, on) => {
    const seen = gitWorld(on, APP, { kind: 'ok', stdout: CLEAN })
    fakeTools(on, seen, new Map())
    const ui = await mountWork($, seen, 'terminal')
    await read($, 'node_modules/lib/index.d.ts')
    await ui.redraw(DOCKED_PANE)
    expect(await treeLines(ui)).toEqual([
      '▾ node_modules/           ◦ main       0s',
      '  ▾ lib/                  ◦ main       0s',
      '      index.d.ts          ◦ main       0s',
      WORK_NOTE,
    ])
    expect(seen.listed).not.toContain('node_modules')
    await ui.unmount()
  })
})
