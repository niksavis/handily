import type { ConfigRow, On } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { codeDrawingOf, shellLines, type ShellKind } from './hooks/syntax'

const MOCHA = 'catppuccin-mocha'
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const SHELL_TAGS = ['sh', 'bash', 'zsh', 'shell', 'console'] as const
const LOOK_PROPS = ['color', 'bold', 'dimColor', 'italic'] as const

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

async function lookOf(ui: Mounted, text: string): Promise<Look | undefined> {
  const found = (await ui.findAll({ type: 'Text', text })).at(-1)
  if (found === undefined) return undefined
  const { props } = found
  return Object.fromEntries(
    LOOK_PROPS.flatMap((name) => (name in props ? [[name, props[name]]] : [])),
  )
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
