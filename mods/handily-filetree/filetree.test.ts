import type { FsEntry, On, RenderPropsOf, RenderSurface } from 'claude-code'
import { describe, expect, test, type Engine, type Mounted } from 'claude-code/testing'
import { displayWidth } from './hooks/width'

const ROOT = '/work/app'
const PLUGIN = 'handily-filetree'
const PANE = 'files'
const SURFACES: readonly RenderSurface[] = ['terminal', 'desktop']
const RULE_41 = '─'.repeat(41)

type FakeFolder = FsEntry[] | string

type World = {
  folders: Map<string, FakeFolder>
  listed: string[]
  commands: string[]
  panes: Set<string>
  shown: string | undefined
  opens: { id: string; title: string | undefined; focus: boolean }[]
  closes: string[]
  logs: string[]
}

type WorldOptions = { unplacedReason?: string }

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
    listed: [],
    commands: [],
    panes: new Set(),
    shown: undefined,
    opens: [],
    closes: [],
    logs: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
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
        'Files  app',
        '[ refresh ]',
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
      'Cannot list hooks/: permission denied.',
      '  README.md',
    ])
    const line = await ui.find({ type: 'Text', text: /Cannot list/ })
    expect(line?.props.color).toBe('error')
    expect(seen.logs.some((log) => log.includes('EACCES'))).toBe(true)
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
        'Files  app[ refresh ]',
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
