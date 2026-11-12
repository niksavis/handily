import type { ConfigRow, On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { codeDrawingOf, shellLines, type ShellKind } from './hooks/syntax'

const MOCHA = 'catppuccin-mocha'
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const SHELL_TAGS = ['sh', 'bash', 'zsh', 'shell', 'console'] as const
const LOOK_PROPS = ['color', 'bold', 'dimColor', 'italic', 'underline'] as const

type World = { copies: string[] }

type Scene = { options?: Record<string, string>; config?: ConfigRow[] }

type Look = Partial<Record<(typeof LOOK_PROPS)[number], unknown>>

function configRow(key: string, value: string, plugin: string): ConfigRow {
  return {
    key,
    label: key,
    kind: 'choice',
    value,
    provider: { plugin, tier: plugin === 'engine' ? 'core' : 'user' },
    isLocked: false,
  }
}

function engineBeneath(on: On, config: ConfigRow[]): World {
  const world: World = { copies: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('config.list', () => ({ value: config }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    world.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  return world
}

function sceneTest(name: string, scene: Scene, body: (world: World, $: Engine) => Promise<void>) {
  test(name, { options: scene.options ?? {} }, async ($, on) => {
    const world = engineBeneath(on, scene.config ?? [])
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

function fenced(tag: string, content: string): string {
  return ['Here it is:', '', `\`\`\`${tag}`, content, '```'].join('\n')
}

function numbered(count: number, line: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => line(index + 1)).join('\n')
}

async function mountReply(
  $: Engine,
  text: string,
  surface: 'terminal' | 'desktop' = 'terminal',
  columns = 80,
) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId: 'message-1',
    viewport: { columns, rows: 40 },
  })
}

type Mounted = Awaited<ReturnType<typeof mountReply>>

type Found = Awaited<ReturnType<Mounted['findAll']>>[number]

function looksOf(found: Found | undefined): Look | undefined {
  if (found === undefined) return undefined
  const { props } = found
  return Object.fromEntries(
    LOOK_PROPS.flatMap((name) => (name in props ? [[name, props[name]]] : [])),
  )
}

async function lookOf(ui: Mounted, text: string): Promise<Look | undefined> {
  return looksOf((await ui.findAll({ type: 'Text', text })).at(-1))
}

async function spanLook(ui: Mounted, text: string): Promise<Look | undefined> {
  const found = await ui.findAll({ type: 'Text', text })
  return looksOf(found.filter((element) => element.text === text).at(-1))
}

async function codeLines(ui: Mounted, block = 'block-1'): Promise<string[]> {
  const lines: string[] = []
  for (;;) {
    const line = await ui.find({ key: `${block}-line-${String(lines.length + 1)}` })
    if (line === undefined) return lines
    lines.push(line.text)
  }
}

function coloured(line: string): [string, ShellKind][] {
  return (shellLines([line])[0] ?? []).flatMap((token) =>
    token.kind === 'plain' ? [] : [[token.text, token.kind] as [string, ShellKind]],
  )
}

const SHELL_LINE =
  'NODE_ENV=production npm run deploy -- --service "ingest $USER" > deploy.log # ship it'

const MOCK_SHELL = [
  '# Check that the tag exists, then restore the pool size',
  'git fetch --tags && git show v2.3.0:config/prod.yaml | grep pool_size',
  "sed -i 's/pool_size: 4/pool_size: 32/' config/prod.yaml",
  'NODE_ENV=production npm run deploy -- --service "ingest" > deploy.log',
  'echo "deployed $(git rev-parse --short HEAD)" ; exit $?',
].join('\n')

describe('the shell tokens of mocks 15.2b (handily-36bsx.4)', () => {
  test('each token class of a shell line has its own kind, and the assignment before the command stays plain', () => {
    expect(coloured(SHELL_LINE)).toEqual([
      ['npm', 'command'],
      ['--', 'flag'],
      ['--service', 'flag'],
      ['"ingest ', 'string'],
      ['$USER', 'variable'],
      ['"', 'string'],
      ['>', 'operator'],
      ['# ship it', 'comment'],
    ])
  })

  test('the word after a pipe, a list operator or a semicolon is a command again, with or without spaces', () => {
    for (const [line, operator] of [
      ['a|b', '|'],
      ['a | b', '|'],
      ['a&&b', '&&'],
      ['a && b', '&&'],
      ['a||b', '||'],
      ['a;b', ';'],
      ['a ; b', ';'],
    ] as const) {
      expect(coloured(line)).toEqual([
        ['a', 'command'],
        [operator, 'operator'],
        ['b', 'command'],
      ])
    }
  })

  test('the line of the engine capture colours grep after the pipe and every flag, and leaves the argument done plain', () => {
    expect(coloured('cat a.txt | grep -n foo && echo done ; ls -la')).toEqual([
      ['cat', 'command'],
      ['|', 'operator'],
      ['grep', 'command'],
      ['-n', 'flag'],
      ['&&', 'operator'],
      ['echo', 'command'],
      [';', 'operator'],
      ['ls', 'command'],
      ['-la', 'flag'],
    ])
  })

  test('a comment that follows code on the same line is a comment, and a hash inside a word is not', () => {
    expect(coloured('ls -la # list the files')).toEqual([
      ['ls', 'command'],
      ['-la', 'flag'],
      ['# list the files', 'comment'],
    ])
    expect(coloured('echo a#b')).toEqual([['echo', 'command']])
  })

  test('a here-doc body draws plain, so a quote in it opens no string, and the line after its end word is a command again', () => {
    const [head = [], body = [], end = [], after = []] = shellLines([
      'cat <<EOF',
      "don't stop",
      'EOF',
      'ls -la',
    ])
    expect(head.filter((token) => token.kind !== 'plain')).toEqual([
      { text: 'cat', kind: 'command' },
      { text: '<<', kind: 'operator' },
    ])
    expect(body).toEqual([{ text: "don't stop", kind: 'plain' }])
    expect(end).toEqual([{ text: 'EOF', kind: 'plain' }])
    expect(after.filter((token) => token.kind !== 'plain')).toEqual([
      { text: 'ls', kind: 'command' },
      { text: '-la', kind: 'flag' },
    ])
  })

  test('a quote that stays open at the end of a line goes on to the next line, and the command after its close is coloured again', () => {
    const [, middle = [], last = []] = shellLines(['echo "a', 'b | c', 'end" ; ls'])
    expect(middle).toEqual([{ text: 'b | c', kind: 'string' }])
    expect(last.filter((token) => token.kind !== 'plain')).toEqual([
      { text: 'end"', kind: 'string' },
      { text: ';', kind: 'operator' },
      { text: 'ls', kind: 'command' },
    ])
    const [, single = [], close = []] = shellLines(["echo 'a", 'b | c', "d' && ls"])
    expect(single).toEqual([{ text: 'b | c', kind: 'string' }])
    expect(close.filter((token) => token.kind !== 'plain')).toEqual([
      { text: "d'", kind: 'string' },
      { text: '&&', kind: 'operator' },
      { text: 'ls', kind: 'command' },
    ])
  })

  test('a single-quoted string, a command substitution, a backtick and an exit status draw as strings and variables', () => {
    expect(coloured("sed -i 's/4/32/' f")).toEqual([
      ['sed', 'command'],
      ['-i', 'flag'],
      ["'s/4/32/'", 'string'],
    ])
    expect(coloured('echo "deployed $(git rev-parse --short HEAD)" ; exit $?')).toEqual([
      ['echo', 'command'],
      ['"deployed ', 'string'],
      ['$(git rev-parse --short HEAD)', 'variable'],
      ['"', 'string'],
      [';', 'operator'],
      ['exit', 'command'],
      ['$?', 'variable'],
    ])
    expect(coloured('echo `date` ${HOME}')).toEqual([
      ['echo', 'command'],
      ['`date`', 'variable'],
      ['${HOME}', 'variable'],
    ])
  })

  test('the file after a redirect is not a command, and the command after it is', () => {
    expect(coloured('> out.log echo hi 2>&1')).toEqual([
      ['>', 'operator'],
      ['echo', 'command'],
      ['>&', 'operator'],
    ])
  })

  test('a keyword stands where a command would, and the word after then or do is a command', () => {
    expect(coloured('for f in *; do echo $f; done')).toEqual([
      ['for', 'keyword'],
      [';', 'operator'],
      ['do', 'keyword'],
      ['echo', 'command'],
      ['$f', 'variable'],
      [';', 'operator'],
      ['done', 'keyword'],
    ])
    expect(coloured('if test -f x; then make; fi')).toEqual([
      ['if', 'keyword'],
      ['test', 'command'],
      ['-f', 'flag'],
      [';', 'operator'],
      ['then', 'keyword'],
      ['make', 'command'],
      [';', 'operator'],
      ['fi', 'keyword'],
    ])
  })

  test('a line that ends in a backslash continues its command on the next line', () => {
    const [first = [], second = []] = shellLines(['docker run \\', '  --rm alpine', 'ls'])
    expect(first.filter((token) => token.kind === 'command').map((token) => token.text)).toEqual([
      'docker',
    ])
    expect(second.filter((token) => token.kind !== 'plain')).toEqual([
      { text: '--rm', kind: 'flag' },
    ])
    expect(shellLines(['docker run \\', '  --rm alpine', 'ls'])[2]).toEqual([
      { text: 'ls', kind: 'command' },
    ])
  })

  test('the tokens of each line join back to the line, with a tab as 4 spaces', () => {
    const lines = [
      ...MOCK_SHELL.split('\n'),
      SHELL_LINE,
      '\tmake\t-j4',
      'echo "open',
      "a 'b",
      'cat <<-EOF',
      '\tbody',
      '\tEOF',
    ]
    expect(shellLines(lines).map((tokens) => tokens.map((token) => token.text).join(''))).toEqual(
      lines.map((line) => line.replaceAll('\t', '    ')),
    )
  })
})

describe('shell fences in the roles of mocks 15.9 (handily-36bsx.4)', () => {
  for (const tag of SHELL_TAGS) {
    sceneTest(
      `a fence tagged ${tag} on the terminal draws each token class in its theme key`,
      {},
      async (world, $) => {
        const ui = await mountReply($, fenced(tag, MOCK_SHELL))
        expect(await ui.find({ type: 'Code' })).toBeUndefined()
        expect(await lookOf(ui, 'grep')).toEqual({ color: 'suggestion', bold: true })
        expect(await lookOf(ui, '--tags')).toEqual({ color: 'permission' })
        expect(await lookOf(ui, "'s/pool_size: 4/pool_size: 32/'")).toEqual({ color: 'planMode' })
        expect(await lookOf(ui, '$(git rev-parse --short HEAD)')).toEqual({ color: 'merged' })
        expect(await lookOf(ui, '&&')).toEqual({ color: 'inactive' })
        expect(await lookOf(ui, '# Check that the tag exists, then restore the pool size')).toEqual(
          { dimColor: true, italic: true },
        )
        expect(await codeLines(ui)).toEqual(MOCK_SHELL.split('\n'))
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([MOCK_SHELL])
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'a shell fence under catppuccin-mocha on a dark theme draws the hex colours of the roles table',
    {
      config: [
        configRow('theme', 'dark', 'engine'),
        configRow('handily.palette', MOCHA, 'handily@niksavis'),
      ],
    },
    async (_world, $) => {
      const ui = await mountReply($, fenced('sh', MOCK_SHELL))
      expect(await lookOf(ui, 'grep')).toEqual({ color: '#89b4fa', bold: true })
      expect(await lookOf(ui, '--tags')).toEqual({ color: '#89dceb' })
      expect(await lookOf(ui, "'s/pool_size: 4/pool_size: 32/'")).toEqual({ color: '#a6e3a1' })
      expect(await lookOf(ui, '$?')).toEqual({ color: '#cba6f7' })
      expect(await lookOf(ui, '|')).toEqual({ color: '#9399b2' })
      expect(await lookOf(ui, '# Check that the tag exists, then restore the pool size')).toEqual({
        color: '#9399b2',
        dimColor: true,
        italic: true,
      })
      await ui.unmount()
    },
  )

  sceneTest(
    'with highlight off a shell fence draws its own lines with no token colour',
    { options: { highlight: 'off' } },
    async (_world, $) => {
      const ui = await mountReply($, fenced('sh', MOCK_SHELL))
      expect(await codeLines(ui)).toEqual(MOCK_SHELL.split('\n'))
      expect(await lookOf(ui, 'grep')).toEqual({})
      expect(await lookOf(ui, '--tags')).toEqual({})
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      await ui.unmount()
    },
  )
})

describe('fences that go to the engine Code element (handily-36bsx.4)', () => {
  sceneTest(
    'a fence with another tag goes to the engine Code element with that language',
    {},
    async (_world, $) => {
      for (const tag of ['ts', 'python', 'rust', 'fish', 'json']) {
        const ui = await mountReply($, fenced(tag, 'print(1)'))
        const code = await ui.find({ type: 'Code' })
        expect(code?.props).toEqual({ source: 'print(1)', language: tag })
        await ui.unmount()
      }
    },
  )

  sceneTest(
    'on the desktop every fence goes to the engine Code element, also a shell fence and a folded one',
    {},
    async (world, $) => {
      for (const tag of ['sh', 'bash', 'ts']) {
        const ui = await mountReply($, fenced(tag, 'ls -la | grep x'), 'desktop')
        expect((await ui.find({ type: 'Code' }))?.props).toEqual({
          source: 'ls -la | grep x',
          language: tag,
        })
        expect(await ui.find({ key: 'block-1-lines' })).toBeUndefined()
        await ui.unmount()
      }
      const long = numbered(30, (line) => `echo ${String(line)}`)
      const ui = await mountReply($, fenced('sh', long), 'desktop')
      expect((await ui.find({ type: 'Code' }))?.props).toEqual({
        source: long.split('\n').slice(0, 15).join('\n'),
        language: 'sh',
        startLine: 1,
      })
      await ui.press({ key: 'block-1-copy' })
      expect(world.copies).toEqual([long])
      await ui.unmount()
    },
  )
})

const ROLLUP = numbered(45, (line) => `const value${String(line)} = ${String(line)}`)

describe('a block over 20 lines folds (mocks 15.2d, handily-36bsx.4)', () => {
  sceneTest(
    'a block of 45 lines shows its first 15 with numbers, a count and more, and copy takes the whole block without numbers',
    {},
    async (world, $) => {
      const ui = await mountReply($, fenced('ts', ROLLUP))
      expect((await ui.find({ type: 'Text', text: /^── ts/ }))?.text).toMatch(
        /^── ts · 45 lines ─+$/,
      )
      expect((await ui.find({ type: 'Code' }))?.props).toEqual({
        source: ROLLUP.split('\n').slice(0, 15).join('\n'),
        language: 'ts',
        startLine: 1,
      })
      expect((await ui.find({ type: 'Text', text: /more line/ }))?.text).toBe('… 30 more lines')
      expect((await ui.find({ key: 'block-1-fold' }))?.props.label).toBe('more')
      expect(await ui.find({ key: 'fold' })).toBeUndefined()
      await ui.press({ key: 'block-1-copy' })
      expect(world.copies).toEqual([ROLLUP])
      await ui.press({ key: 'block-1-fold' })
      expect((await ui.find({ type: 'Code' }))?.props.source).toBe(ROLLUP)
      expect((await ui.find({ key: 'block-1-fold' }))?.props.label).toBe('less')
      expect(await ui.find({ type: 'Text', text: /more line/ })).toBeUndefined()
      await ui.press({ key: 'block-1-fold' })
      expect((await ui.find({ type: 'Code' }))?.props.source).toBe(
        ROLLUP.split('\n').slice(0, 15).join('\n'),
      )
      await ui.unmount()
    },
  )

  sceneTest(
    'a shell block of 25 lines numbers its first 15 lines and builds rows only for them',
    {},
    async (_world, $) => {
      const long = numbered(25, (line) => `echo ${String(line)}`)
      const ui = await mountReply($, fenced('sh', long))
      const rows = await codeLines(ui)
      expect(rows).toHaveLength(15)
      expect(rows.slice(0, 2)).toEqual([' 1echo 1', ' 2echo 2'])
      expect((await ui.find({ type: 'Text', text: /more line/ }))?.text).toBe('… 10 more lines')
      expect(await lookOf(ui, ' 1')).toEqual({ dimColor: true })
      await ui.press({ key: 'block-1-fold' })
      expect(await codeLines(ui)).toHaveLength(25)
      await ui.unmount()
    },
  )

  sceneTest(
    'a block of 20 lines draws whole, and a block of 21 lines folds',
    {},
    async (_world, $) => {
      const twenty = numbered(20, (line) => `x = ${String(line)}`)
      const whole = await mountReply($, fenced('py', twenty))
      expect((await whole.find({ type: 'Code' }))?.props).toEqual({
        source: twenty,
        language: 'py',
      })
      expect(await whole.find({ key: 'block-1-fold' })).toBeUndefined()
      await whole.unmount()
      const folded = await mountReply($, fenced('py', `${twenty}\nx = 21`))
      expect((await folded.find({ type: 'Code' }))?.props.startLine).toBe(1)
      expect((await folded.find({ type: 'Text', text: /more line/ }))?.text).toBe('… 6 more lines')
      await folded.unmount()
    },
  )

  sceneTest('under 40 columns a folded block shows no line numbers', {}, async (_world, $) => {
    const ts = await mountReply($, fenced('ts', ROLLUP), 'terminal', 30)
    expect((await ts.find({ type: 'Code' }))?.props.startLine).toBeUndefined()
    expect((await ts.find({ type: 'Text', text: /more line/ }))?.text).toBe('… 30 more lines')
    await ts.unmount()
    const long = numbered(25, (line) => `echo ${String(line)}`)
    const sh = await mountReply($, fenced('sh', long), 'terminal', 30)
    expect((await codeLines(sh)).slice(0, 2)).toEqual(['echo 1', 'echo 2'])
    await sh.unmount()
  })

  sceneTest(
    'the fold state of a block follows its content, not its place in the reply',
    {},
    async (_world, $) => {
      const shell = numbered(25, (line) => `echo ${String(line)}`)
      const first = fenced('sh', shell)
      const second = ['```ts', ROLLUP, '```'].join('\n')
      const ui = await mountReply($, [first, '', second].join('\n'))
      await ui.press({ key: 'fold' })
      await ui.press({ key: 'block-2-fold' })
      expect((await ui.find({ key: 'block-2-fold' }))?.props.label).toBe('less')
      expect((await ui.find({ key: 'block-1-fold' }))?.props.label).toBe('more')
      await ui.redraw({ text: [second, '', first].join('\n'), isFirstOfReply: true })
      expect((await ui.find({ key: 'block-0-fold' }))?.props.label).toBe('less')
      expect((await ui.find({ type: 'Code' }))?.props.source).toBe(ROLLUP)
      expect((await ui.find({ key: 'block-2-fold' }))?.props.label).toBe('more')
      await ui.unmount()
    },
  )
})

describe('a block too long to colour draws plain (mocks 15.2g, handily-36bsx.4)', () => {
  sceneTest(
    'a block of more than 2,000 lines draws plain under one note, and a block of 2,000 lines keeps its language',
    {},
    async (_world, $) => {
      const content = numbered(2001, (line) => String(line))
      const ui = await mountReply($, fenced('json', content))
      expect((await ui.find({ type: 'Text', text: /^── json/ }))?.text).toMatch(
        /^── json · 2,001 lines ─+$/,
      )
      const notes = await ui.findAll({ type: 'Text', text: /^too long to colour/ })
      expect(notes.map((note) => [note.text, note.props.dimColor])).toEqual([
        ['too long to colour: over 2,000 lines, so it draws plain.', true],
      ])
      expect((await ui.find({ type: 'Code' }))?.props).toEqual({
        source: content.split('\n').slice(0, 15).join('\n'),
        startLine: 1,
      })
      await ui.unmount()
      const coloured = await mountReply(
        $,
        fenced(
          'json',
          numbered(2000, (line) => String(line)),
        ),
      )
      expect((await coloured.find({ type: 'Code' }))?.props.language).toBe('json')
      expect(await coloured.find({ type: 'Text', text: /^too long to colour/ })).toBeUndefined()
      await coloured.unmount()
    },
  )

  test('a block of more than 100,000 characters draws plain under one note, and one of 100,000 does not', () => {
    const over = 'x'.repeat(100_001)
    expect(codeDrawingOf('json', [over], true, 10_000)).toEqual({
      kind: 'plain',
      note: 'too long to colour: over 100,000 characters, so it draws plain.',
    })
    const at = 'x'.repeat(100_000)
    expect(codeDrawingOf('json', [at], true, 10_000)).toEqual({ kind: 'engine' })
  })

  sceneTest(
    'a block of control characters counts the 6 characters that each one draws against the 100,000 limit',
    {},
    async (_world, $) => {
      const content = Array<string>(17).fill('\u0001'.repeat(1000)).join('\n')
      expect(content.length).toBeLessThan(100_000)
      const ui = await mountReply($, fenced('json', content))
      expect((await ui.find({ type: 'Text', text: /^too long to colour/ }))?.text).toBe(
        'too long to colour: over 100,000 characters, so it draws plain.',
      )
      expect((await ui.find({ type: 'Code' }))?.props.language).toBeUndefined()
      await ui.unmount()
    },
  )

  sceneTest(
    'two shell blocks share one budget of parts, so the second block draws plain when the first spent it',
    {},
    async (_world, $) => {
      const block = Array<string>(700).fill('echo x').join('\n')
      const text = ['Two runs:', '', '```sh', block, '```', '', '```sh', block, '```'].join('\n')
      const ui = await mountReply($, text)
      const notes = await ui.findAll({ type: 'Text', text: /^too long to colour/ })
      expect(notes.map((note) => note.text)).toEqual([
        'too long to colour: over 10,000 drawn parts, so it draws plain.',
      ])
      expect(await ui.find({ key: 'block-1-line-1' })).toBeDefined()
      expect(await ui.find({ key: 'block-2-line-1' })).toBeUndefined()
      expect((await ui.find({ key: 'block-2-plain' }))?.text).toBe(
        'too long to colour: over 10,000 drawn parts, so it draws plain.',
      )
      await ui.unmount()
      const alone = await mountReply($, fenced('sh', block))
      expect(await alone.find({ type: 'Text', text: /^too long to colour/ })).toBeUndefined()
      await alone.unmount()
    },
  )

  sceneTest(
    'a shell block with a word over 1,000 characters draws plain under one note, and a word of 1,000 is coloured',
    {},
    async (_world, $) => {
      const long = `echo ${'a'.repeat(1001)}`
      const ui = await mountReply($, fenced('sh', long))
      expect((await ui.find({ type: 'Text', text: /^too long to colour/ }))?.text).toBe(
        'too long to colour: a word over 1,000 characters, so it draws plain.',
      )
      expect((await ui.find({ type: 'Code' }))?.props).toEqual({ source: long })
      await ui.unmount()
      const fits = await mountReply($, fenced('sh', `echo ${'a'.repeat(1000)}`))
      expect(await fits.find({ type: 'Code' })).toBeUndefined()
      expect(await lookOf(fits, 'echo')).toEqual({ color: 'suggestion', bold: true })
      await fits.unmount()
    },
  )

  test('a shell block that would draw more than 10,000 parts draws plain under one note', () => {
    const lines = Array<string>(1500).fill('a|b|c|d|e')
    expect(codeDrawingOf('sh', lines, true, 10_000)).toEqual({
      kind: 'plain',
      note: 'too long to colour: over 10,000 drawn parts, so it draws plain.',
    })
    expect(codeDrawingOf('sh', ['a|b'], true, 10_000).kind).toBe('shell')
    expect(codeDrawingOf('sh', ['a|b'], true, 10)).toEqual({
      kind: 'plain',
      note: 'too long to colour: over 10,000 drawn parts, so it draws plain.',
    })
    expect(codeDrawingOf('sh', ['a|b'], false, 10_000)).toEqual({ kind: 'engine' })
  })
})

const MOCK_MD = [
  '## Rollback',
  '### Steps',
  '- Restore `pool_size` to **32**; see [the run](https://ci.example.com).',
  '1. Wait for _the green check_ and read *the log*',
  '> Quote of the night',
  '#### Small print',
  'plain text with snake_case_name and 2 * 3',
].join('\n')

const MOCK_DIFF = [
  'diff --git a/config/prod.yaml b/config/prod.yaml',
  '--- a/config/prod.yaml',
  '+++ b/config/prod.yaml',
  '@@ -3,3 +3,3 @@ ingest:',
  '-  pool_size: 4',
  '+  pool_size: 32',
  '   acquire_timeout_ms: 2000',
  '\\ No newline at end of file',
].join('\n')

function kindsOf(tag: string, lines: string[]): [string, string][][] {
  const drawing = codeDrawingOf(tag, lines, true, 10_000)
  if (drawing.kind === 'engine' || drawing.kind === 'plain') return []
  return drawing.lines.map((tokens) =>
    tokens.flatMap((token) =>
      token.look === null ? [] : [[token.text, JSON.stringify(token.look)] as [string, string]],
    ),
  )
}

describe('markdown fences in the roles of mocks 15.9 (handily-dnjvgf)', () => {
  for (const tag of ['md', 'markdown']) {
    sceneTest(
      `a fence tagged ${tag} on the terminal draws each token class in its theme key`,
      {},
      async (world, $) => {
        const ui = await mountReply($, fenced(tag, MOCK_MD))
        expect(await ui.find({ type: 'Code' })).toBeUndefined()
        expect(await spanLook(ui, '## Rollback')).toEqual({ color: 'claude', bold: true })
        expect(await spanLook(ui, '### Steps')).toEqual({ color: 'merged', bold: true })
        expect(await spanLook(ui, '#### Small print')).toEqual({ bold: true })
        expect(await spanLook(ui, '-')).toEqual({ color: 'inactive' })
        expect(await spanLook(ui, '1.')).toEqual({ color: 'inactive' })
        expect(await spanLook(ui, '>')).toEqual({ color: 'inactive' })
        expect(await spanLook(ui, 'Quote of the night')).toEqual({ italic: true })
        expect(await spanLook(ui, '`pool_size`')).toEqual({ color: 'permission' })
        expect(await spanLook(ui, '**32**')).toEqual({ bold: true })
        expect(await spanLook(ui, '_the green check_')).toEqual({ italic: true })
        expect(await spanLook(ui, '*the log*')).toEqual({ italic: true })
        expect(await spanLook(ui, 'the run')).toEqual({ color: 'suggestion', underline: true })
        expect(await spanLook(ui, 'plain text with snake_case_name and 2 * 3')).toEqual({})
        expect(await codeLines(ui)).toEqual(MOCK_MD.split('\n'))
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([MOCK_MD])
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'a markdown fence under catppuccin-mocha on a dark theme draws the hex colours of the roles table',
    {
      config: [
        configRow('theme', 'dark', 'engine'),
        configRow('handily.palette', MOCHA, 'handily@niksavis'),
      ],
    },
    async (_world, $) => {
      const ui = await mountReply($, fenced('md', MOCK_MD))
      expect(await spanLook(ui, '## Rollback')).toEqual({ color: '#f9e2af', bold: true })
      expect(await spanLook(ui, '### Steps')).toEqual({ color: '#cba6f7', bold: true })
      expect(await spanLook(ui, '-')).toEqual({ color: '#cba6f7' })
      expect(await spanLook(ui, 'Quote of the night')).toEqual({ color: '#a6adc8', italic: true })
      expect(await spanLook(ui, '`pool_size`')).toEqual({ color: '#89dceb' })
      expect(await spanLook(ui, 'the run')).toEqual({ color: '#89b4fa', underline: true })
      await ui.unmount()
    },
  )

  sceneTest(
    'with highlight off a markdown fence draws its own lines with no token colour',
    { options: { highlight: 'off' } },
    async (_world, $) => {
      const ui = await mountReply($, fenced('md', MOCK_MD))
      expect(await codeLines(ui)).toEqual(MOCK_MD.split('\n'))
      expect(await spanLook(ui, '## Rollback')).toEqual({})
      expect(await spanLook(ui, 'the run')).toBeUndefined()
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      await ui.unmount()
    },
  )

  test('a hash with no space, a glob, a word with underscores and a lone star stay plain', () => {
    expect(
      kindsOf('md', ['#include <stdio.h>', '#!/bin/sh', 'ls **/*.md', 'a_b_c', '2 * 3 * 4']),
    ).toEqual([[], [], [], [], []])
  })

  test('a code span wins over the marks inside it, and a line in a nested fence is no heading', () => {
    const code = JSON.stringify({ key: 'permission', mocha: '#89dceb' })
    const [span = [], open = [], comment = [], close = [], heading = []] = kindsOf('md', [
      'run `**x**` now',
      '```sh',
      '# not a heading',
      '```',
      '# Heading',
    ])
    expect(span).toEqual([['`**x**`', code]])
    expect(open).toEqual([['```sh', code]])
    expect(comment).toEqual([['# not a heading', code]])
    expect(close).toEqual([['```', code]])
    expect(heading.map(([text]) => text)).toEqual(['# Heading'])
  })

  test('the tokens of each markdown line join back to the line, with a tab as 4 spaces', () => {
    const lines = [...MOCK_MD.split('\n'), '\t- tab `code', '[a] [b](c) ![d](e)', '> > - x']
    const drawing = codeDrawingOf('md', lines, true, 10_000)
    expect(drawing.kind).toBe('markdown')
    if (drawing.kind !== 'markdown') return
    expect(drawing.lines.map((tokens) => tokens.map((token) => token.text).join(''))).toEqual(
      lines.map((line) => line.replaceAll('\t', '    ')),
    )
  })

  test('a markdown line of many open marks scans in time', () => {
    const line = '*a _a **a __a [a '.repeat(5000)
    const started = performance.now()
    expect(codeDrawingOf('md', [line], true, 10_000).kind).toBe('markdown')
    expect(performance.now() - started).toBeLessThan(250)
  })
})

describe('diff fences in the roles of mocks 15.9 (handily-dnjvgf)', () => {
  for (const tag of ['diff', 'patch']) {
    sceneTest(
      `a fence tagged ${tag} on the terminal draws each token class in its theme key`,
      {},
      async (world, $) => {
        const ui = await mountReply($, fenced(tag, MOCK_DIFF))
        expect(await ui.find({ type: 'Code' })).toBeUndefined()
        expect(await spanLook(ui, 'diff --git a/config/prod.yaml b/config/prod.yaml')).toEqual({
          bold: true,
        })
        expect(await spanLook(ui, '--- a/config/prod.yaml')).toEqual({ bold: true })
        expect(await spanLook(ui, '+++ b/config/prod.yaml')).toEqual({ bold: true })
        expect(await spanLook(ui, '@@ -3,3 +3,3 @@')).toEqual({ color: 'inactive' })
        expect(await spanLook(ui, '-  pool_size: 4')).toEqual({ color: 'error' })
        expect(await spanLook(ui, '+  pool_size: 32')).toEqual({ color: 'success' })
        expect(await spanLook(ui, '   acquire_timeout_ms: 2000')).toEqual({})
        expect(await spanLook(ui, '\\ No newline at end of file')).toEqual({})
        expect(await codeLines(ui)).toEqual(MOCK_DIFF.split('\n'))
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([MOCK_DIFF])
        await ui.unmount()
      },
    )
  }

  sceneTest(
    'a diff fence under catppuccin-mocha keeps the state keys of added and removed lines',
    {
      config: [
        configRow('theme', 'dark', 'engine'),
        configRow('handily.palette', MOCHA, 'handily@niksavis'),
      ],
    },
    async (_world, $) => {
      const ui = await mountReply($, fenced('diff', MOCK_DIFF))
      expect(await spanLook(ui, '@@ -3,3 +3,3 @@')).toEqual({ color: '#9399b2' })
      expect(await spanLook(ui, '-  pool_size: 4')).toEqual({ color: 'error' })
      expect(await spanLook(ui, '+  pool_size: 32')).toEqual({ color: 'success' })
      expect(await spanLook(ui, '--- a/config/prod.yaml')).toEqual({ bold: true })
      await ui.unmount()
    },
  )

  test('a removed line that reads as three dashes stays a removed line when no plus header follows it', () => {
    const removed = JSON.stringify({ key: 'error' })
    const added = JSON.stringify({ key: 'success' })
    expect(kindsOf('diff', ['@@ -1,2 +1,1 @@', '--- x', '-- y', '+++ z'])).toEqual([
      [['@@ -1,2 +1,1 @@', JSON.stringify({ key: 'inactive', mocha: '#9399b2' })]],
      [['--- x', removed]],
      [['-- y', removed]],
      [['+++ z', added]],
    ])
  })
})

describe('own colours share the fold, the copy and the limits of a shell block (handily-dnjvgf)', () => {
  sceneTest(
    'a markdown block of 25 lines shows its first 15 with numbers, and copy and more take the whole block',
    {},
    async (world, $) => {
      const long = numbered(25, (line) => `- item ${String(line)}`)
      const ui = await mountReply($, fenced('md', long))
      const rows = await codeLines(ui)
      expect(rows).toHaveLength(15)
      expect(rows.slice(0, 2)).toEqual([' 1- item 1', ' 2- item 2'])
      expect((await ui.find({ type: 'Text', text: /^── md/ }))?.text).toMatch(
        /^── md · 25 lines ─+$/,
      )
      expect((await ui.find({ type: 'Text', text: /more line/ }))?.text).toBe('… 10 more lines')
      expect(await spanLook(ui, '-')).toEqual({ color: 'inactive' })
      await ui.press({ key: 'block-1-copy' })
      expect(world.copies).toEqual([long])
      await ui.press({ key: 'block-1-fold' })
      expect(await codeLines(ui)).toHaveLength(25)
      await ui.unmount()
    },
  )

  test('a markdown or diff block over 2,000 lines draws plain, and one past the parts budget too', () => {
    const many = Array<string>(2001).fill('# x')
    for (const tag of ['md', 'diff']) {
      expect(codeDrawingOf(tag, many, true, 10_000)).toEqual({
        kind: 'plain',
        note: 'too long to colour: over 2,000 lines, so it draws plain.',
      })
      expect(codeDrawingOf(tag, ['# x', '+ y'], true, 1)).toEqual({
        kind: 'plain',
        note: 'too long to colour: over 10,000 drawn parts, so it draws plain.',
      })
      expect(codeDrawingOf(tag, ['# x'], false, 10_000)).toEqual({ kind: 'engine' })
    }
  })
})

describe('fences that still go to the engine Code element (handily-dnjvgf)', () => {
  sceneTest(
    'on the terminal a fence tagged ts, js, py, json, yaml or rust goes to the engine Code element with that language',
    {},
    async (_world, $) => {
      for (const tag of ['ts', 'js', 'py', 'json', 'yaml', 'rust']) {
        const ui = await mountReply($, fenced(tag, '# x'))
        expect((await ui.find({ type: 'Code' }))?.props).toEqual({ source: '# x', language: tag })
        expect(await ui.find({ key: 'block-1-lines' })).toBeUndefined()
        await ui.unmount()
      }
    },
  )

  sceneTest(
    'on the desktop a markdown and a diff fence go to the engine Code element with their language',
    {},
    async (_world, $) => {
      for (const [tag, source] of [
        ['md', MOCK_MD],
        ['markdown', MOCK_MD],
        ['diff', MOCK_DIFF],
        ['patch', MOCK_DIFF],
      ] as const) {
        const ui = await mountReply($, fenced(tag, source), 'desktop')
        expect((await ui.find({ type: 'Code' }))?.props).toEqual({ source, language: tag })
        expect(await ui.find({ key: 'block-1-lines' })).toBeUndefined()
        await ui.unmount()
      }
    },
  )
})
