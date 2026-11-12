import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { diagramOf } from './hooks/draw'
import { displayWidth } from './hooks/width'

const SURFACES = ['terminal', 'desktop'] as const
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const FRAME = { options: { replyStyle: 'frame' } } as const
const FRAME_CHARACTERS = /[╭╮╰╯│─]/u
const FORBIDDEN_CONTROLS = /[\p{Cc}\p{Cf}]/u
const ALLOWED_CONTROLS = /[\t\n]/gu
const LABEL = '╭─ ● Claude '

const MOCK_REPLY = [
  'Ingest p95 and errors per hour, from logs/hourly.csv:',
  '',
  'p95 jumped from 46 ms to 2 s at 14:00, and the timeouts started in the same hour.',
].join('\n')

const LONG_LINE = Array.from({ length: 40 }, (_, index) => `w${String(index % 10)}`).join(' ')

const TABLE_REPLY = [
  'The hours:',
  '',
  '| hour | p95 | errors |',
  '| --- | --- | --- |',
  '| 13:00 | 46 ms | 0 |',
  '| 14:00 | 2 s | 12 |',
].join('\n')

const CODE_SOURCE = 'const total = rows.length\nprint(total)'

const CODE_REPLY = ['Run this:', '', '```ts', CODE_SOURCE, '```'].join('\n')

const DIAGRAM_SOURCE = 'flowchart LR\n  A[ingest] --> B[store]'

const FAN_SOURCE = [
  'flowchart TD',
  '  A --> N0[0000]',
  '  A --> N1[1111]',
  '  A --> N2[2222]',
  '  A --> N3[3333]',
].join('\n')

const DIAGRAM_REPLY = ['The flow:', '', '```mermaid', DIAGRAM_SOURCE, '```'].join('\n')

const BLOCK_REPLIES = [
  ['a table', TABLE_REPLY, '┌'],
  ['a code block', CODE_REPLY, 'const total = rows.length'],
  ['a diagram', DIAGRAM_REPLY, 'ingest'],
] as const

type Surface = (typeof SURFACES)[number]

type World = { copies: string[]; toasts: string[]; debugLogs: string[] }

type Scene = { pluginConfigs?: unknown; surface?: Surface }

type DrawnNode = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

function engineBeneath(on: On, scene: Scene): World {
  const world: World = { copies: [], toasts: [], debugLogs: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.messages', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: [scene.surface ?? 'terminal'] }))
  on('config.list', () => ({ value: [] }))
  on('settings.read', () => ({
    value: scene.pluginConfigs === undefined ? {} : { pluginConfigs: scene.pluginConfigs },
  }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    world.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLogs.push(e.text)
    return { value: undefined }
  })
  return world
}

async function started($: Engine, on: On, scene: Scene = {}): Promise<World> {
  const world = engineBeneath(on, scene)
  await $.session.start({
    cwd: '/work/app',
    surface: scene.surface ?? 'terminal',
    isInteractive: true,
  })
  return world
}

function reply(text: string, isFirstOfReply = true): RenderPropsOf['AssistantMessage'] {
  return { text, isFirstOfReply }
}

async function mountReply(
  $: Engine,
  props: RenderPropsOf['AssistantMessage'],
  columns = 80,
  surface: Surface = 'terminal',
) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props,
    requestId: 'message-1',
    viewport: { columns, rows: 40 },
  })
}

type Mounted = Awaited<ReturnType<typeof mountReply>>

async function replyEnds($: Engine, answer: string): Promise<void> {
  await $.turn.complete({
    answer,
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
}

async function commandText($: Engine, args: string, columns = 80): Promise<string> {
  const result = await $.command.run({
    command: 'replies',
    args,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns },
  })
  return result.text ?? ''
}

function isDrawnNode(value: unknown): value is DrawnNode {
  return typeof value === 'object' && value !== null
}

function plainText(node: unknown): string {
  if (typeof node === 'string') return node
  if (!isDrawnNode(node)) return ''
  return (node.children ?? []).map(plainText).join('')
}

function padded(line: string, width: number): string {
  return line + ' '.repeat(Math.max(width - displayWidth(line), 0))
}

function isGrower(node: unknown): boolean {
  return isDrawnNode(node) && Number(node.props?.flexGrow ?? 0) > 0
}

function isAbsolute(node: unknown): boolean {
  return isDrawnNode(node) && node.props?.position === 'absolute'
}

function fixedWidth(node: unknown): number {
  return isDrawnNode(node) && typeof node.props?.width === 'number' ? node.props.width : 0
}

function rowLines(children: readonly unknown[], width: number, gap: number): string[] {
  const fixed = children.map((child) => (isGrower(child) ? null : sketchLines(child, width)))
  const widths = fixed.map((lines, index) =>
    lines === null
      ? 0
      : Math.max(fixedWidth(children[index]), ...lines.map((line) => displayWidth(line))),
  )
  const used =
    widths.reduce((total, value) => total + value, 0) + gap * Math.max(children.length - 1, 0)
  const filled = fixed.map((lines, index) => {
    if (lines !== null) return { lines, width: widths[index] ?? 0 }
    const room = Math.max(width - used, 0)
    const grown = sketchLines(children[index], room)
    return { lines: grown.length === 0 ? [''] : grown, width: room }
  })
  const height = Math.max(0, ...filled.map((block) => block.lines.length))
  return Array.from({ length: height }, (_, row) =>
    filled.map((block) => padded(block.lines[row] ?? '', block.width)).join(' '.repeat(gap)),
  )
}

function paintedOver(line: string, paint: string, left: number): string {
  const cells = Array.from(padded(line, left))
  Array.from(paint).forEach((character, index) => {
    cells[left + index] = character
  })
  return cells.join('')
}

function framedLines(lines: readonly string[], width: number, padding: number): string[] {
  const rule = '─'.repeat(width - 2)
  const side = ' '.repeat(padding)
  const inner = width - 2 - 2 * padding
  return [
    `╭${rule}╮`,
    ...lines.map((line) => `│${side}${padded(line, inner)}${side}│`),
    `╰${rule}╯`,
  ]
}

function boxLines(props: Record<string, unknown>, children: readonly unknown[], width: number) {
  const padding = Number(props.paddingX ?? 0)
  const isFramed = props.borderStyle !== undefined
  const inner = isFramed ? width - 2 - 2 * padding : width
  const gap = Number(props.gap ?? 0)
  const flowing = children.filter((child) => !isAbsolute(child))
  const flowed =
    props.flexDirection === 'column'
      ? flowing.flatMap((child, index) => [
          ...(index > 0 ? Array<string>(gap).fill('') : []),
          ...Array<string>(isDrawnNode(child) ? Number(child.props?.marginTop ?? 0) : 0).fill(''),
          ...sketchLines(child, inner),
        ])
      : rowLines(flowing, inner, gap)
  const lines = isFramed ? framedLines(flowed, width, padding) : flowed
  for (const placed of children.filter(isAbsolute)) {
    const top = isDrawnNode(placed) ? Number(placed.props?.top ?? 0) : 0
    const left = isDrawnNode(placed) ? Number(placed.props?.left ?? 0) : 0
    sketchLines(placed, width).forEach((line, row) => {
      lines[top + row] = paintedOver(lines[top + row] ?? '', line, left)
    })
  }
  return lines
}

function cutTo(line: string, width: number): string {
  let shown = ''
  for (const character of Array.from(line)) {
    if (displayWidth(shown + character) > width) break
    shown += character
  }
  return shown
}

function wrappedAt(line: string, width: number): string[] {
  if (displayWidth(line) <= width) return [line]
  const rows: string[] = []
  let row = ''
  for (const word of line.split(' ')) {
    const joined = row === '' ? word : `${row} ${word}`
    if (row !== '' && displayWidth(joined) > width) {
      rows.push(row)
      row = word
    } else {
      row = joined
    }
  }
  return [...rows, row]
}

function sketchLines(node: unknown, width: number): string[] {
  if (typeof node === 'string') return [node]
  if (!isDrawnNode(node)) return []
  const props = node.props ?? {}
  switch (node.type) {
    case 'Text':
      return plainText(node)
        .split('\n')
        .flatMap((line) =>
          typeof props.wrap === 'string' && props.wrap.startsWith('truncate')
            ? [cutTo(line, width)]
            : wrappedAt(line, width),
        )
    case 'Button':
      return [`[ ${String(props.label)} ]`]
    case 'Markdown':
      return String(props.text).split('\n')
    case 'Code':
      return String(props.source).split('\n')
    case 'Box':
      return boxLines(props, node.children ?? [], width)
    case 'engine':
      return ['(engine)']
    default:
      return []
  }
}

async function sketchOf(ui: Mounted, columns = 80): Promise<string[]> {
  return sketchLines(await ui.drawn(), columns).map((line) => line.trimEnd())
}

function nodesOf(node: unknown): DrawnNode[] {
  if (!isDrawnNode(node)) return []
  return [node, ...(node.children ?? []).flatMap(nodesOf)]
}

function textStrings(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (!isDrawnNode(node)) return []
  return (node.children ?? []).flatMap(textStrings)
}

function framesOf(tree: unknown): DrawnNode[] {
  return nodesOf(tree).filter((node) => node.props?.borderStyle !== undefined)
}

async function drawnTree($: Engine, text: string, columns: number, surface: Surface = 'terminal') {
  const ui = await mountReply($, reply(text), columns, surface)
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

function bodyOf(lines: readonly string[]): string[] {
  return lines.slice(1, -1).map((line) => line.slice(2, -2).trimEnd())
}

function tooWide(lines: readonly string[], columns: number): string[] {
  return lines.filter((line) => displayWidth(line) > columns)
}

function notWide(lines: readonly string[], columns: number): string[] {
  return lines.filter((line) => displayWidth(line) !== columns)
}

function unframed(lines: readonly string[]): string[] {
  return lines.slice(1, -1).filter((line) => !line.startsWith('│ ') || !line.endsWith(' │'))
}

describe('the reply frame', () => {
  test(
    'with replyStyle frame at 80 columns a reply draws in a frame headed ● Claude as the mock of 15.5d',
    FRAME,
    async ($, on) => {
      await started($, on)
      const ui = await mountReply($, reply(MOCK_REPLY))
      expect(await sketchOf(ui)).toEqual([
        `╭─ ● Claude ${'─'.repeat(67)}╮`,
        `│ Ingest p95 and errors per hour, from logs/hourly.csv:${' '.repeat(24)}│`,
        `│${' '.repeat(78)}│`,
        `│ p95 jumped from 46 ms to 2 s at 14:00, and the timeouts started in the same  │`,
        `│ hour.${' '.repeat(72)}│`,
        `╰${'─'.repeat(78)}╯`,
      ])
      await ui.unmount()
    },
  )

  test(
    'with replyStyle frame at 40 columns the frame spans the 40 columns and the first block carries ● Claude',
    FRAME,
    async ($, on) => {
      await started($, on)
      const ui = await mountReply($, reply(MOCK_REPLY), 40)
      const lines = await sketchOf(ui, 40)
      expect(lines[0]).toBe(`╭─ ● Claude ${'─'.repeat(27)}╮`)
      expect(lines.at(-1)).toBe(`╰${'─'.repeat(38)}╯`)
      expect(notWide(lines, 40)).toEqual([])
      expect(unframed(lines)).toEqual([])
      expect(bodyOf(lines)).toEqual([
        'Ingest p95 and errors per hour, from',
        'logs/hourly.csv:',
        '',
        'p95 jumped from 46 ms to 2 s at',
        '14:00, and the timeouts started in',
        'the same hour.',
      ])
      await ui.unmount()
    },
  )

  test(
    'a later text block of a reply draws in a frame of its own with no label',
    FRAME,
    async ($, on) => {
      await started($, on)
      for (const columns of [80, 40]) {
        const ui = await mountReply($, reply('Then the store answered.', false), columns)
        expect(await sketchOf(ui, columns)).toEqual([
          `╭${'─'.repeat(columns - 2)}╮`,
          `│ Then the store answered.${' '.repeat(columns - 27)}│`,
          `╰${'─'.repeat(columns - 2)}╯`,
        ])
        await ui.unmount()
      }
    },
  )

  test(
    'the frame is a round border in the claude colour with one column of space inside each side',
    FRAME,
    async ($, on) => {
      await started($, on)
      const tree = await drawnTree($, MOCK_REPLY, 80)
      const frames = framesOf(tree)
      expect(frames.map((frame) => frame.props)).toEqual([
        expect.objectContaining({ borderStyle: 'round', borderColor: 'claude', paddingX: 1 }),
      ])
      const label = nodesOf(tree).find((node) => isAbsolute(node))
      expect(label?.props).toEqual(expect.objectContaining({ top: 0, left: 2 }))
      expect(plainText(label)).toBe(' ● Claude ')
      expect(nodesOf(label).find((node) => node.type === 'Text')?.props?.color).toBe('claude')
    },
  )

  test(
    'with replyStyle frame under 40 columns no frame draws and the reply keeps its bullet',
    FRAME,
    async ($, on) => {
      await started($, on)
      for (const columns of [39, 30]) {
        const framed = await drawnTree($, MOCK_REPLY, columns)
        expect(framesOf(framed)).toEqual([])
        const ui = await mountReply($, reply(MOCK_REPLY), columns)
        const lines = await sketchOf(ui, columns)
        expect(lines[0]?.startsWith('● Ingest')).toBe(true)
        expect(lines.some((line) => FRAME_CHARACTERS.test(line))).toBe(false)
        await ui.unmount()
      }
    },
  )

  test('with no replyStyle setting a reply draws with its bullet and no frame', async ($, on) => {
    await started($, on)
    const ui = await mountReply($, reply(MOCK_REPLY))
    expect(await sketchOf(ui)).toEqual([
      '● Ingest p95 and errors per hour, from logs/hourly.csv:',
      '',
      '  p95 jumped from 46 ms to 2 s at 14:00, and the timeouts started in the same',
      '  hour.',
    ])
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`with replyStyle off a reply draws the same tree as with no setting on ${surface}`, async ($, on) => {
      await started($, on, { surface })
      const unset: unknown[] = []
      for (const text of [MOCK_REPLY, ...BLOCK_REPLIES.map(([, block]) => block)]) {
        unset.push(await drawnTree($, text, 80, surface))
      }
      expect(unset.flatMap(framesOf)).toEqual([])
      expect(JSON.stringify(unset)).not.toContain('Claude')
    })
  }

  test(
    'with replyStyle off the drawn tree equals the one of no setting',
    { options: { replyStyle: 'off' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountReply($, reply(MOCK_REPLY))
      expect(await sketchOf(ui)).toEqual([
        '● Ingest p95 and errors per hour, from logs/hourly.csv:',
        '',
        '  p95 jumped from 46 ms to 2 s at 14:00, and the timeouts started in the same',
        '  hour.',
      ])
      expect(framesOf(await ui.drawn())).toEqual([])
      await ui.unmount()
    },
  )

  test(
    'on the desktop a reply draws with no frame when replyStyle is frame',
    FRAME,
    async ($, on) => {
      await started($, on, { surface: 'desktop' })
      for (const text of [MOCK_REPLY, ...BLOCK_REPLIES.map(([, block]) => block)]) {
        const tree = await drawnTree($, text, 80, 'desktop')
        expect(framesOf(tree)).toEqual([])
        expect(JSON.stringify(tree)).not.toContain('● Claude')
      }
    },
  )

  for (const columns of [80, 40]) {
    for (const [name, text, mark] of BLOCK_REPLIES) {
      test(
        `${name} in a framed reply draws inside the frame at ${String(columns)} columns`,
        FRAME,
        async ($, on) => {
          await started($, on)
          const ui = await mountReply($, reply(text), columns)
          const lines = await sketchOf(ui, columns)
          expect(lines[0]?.slice(0, LABEL.length)).toBe(LABEL)
          expect(lines.at(-1)).toBe(`╰${'─'.repeat(columns - 2)}╯`)
          expect(notWide(lines, columns)).toEqual([])
          expect(unframed(lines)).toEqual([])
          expect(tooWide(bodyOf(lines), columns - 4)).toEqual([])
          expect(bodyOf(lines).some((line) => line.includes(mark))).toBe(true)
          await ui.unmount()
        },
      )
    }
  }

  test('with no frame a long line wraps 2 columns inside the screen: at most 78 at 80 columns and 38 at 40', async ($, on) => {
    await started($, on)
    for (const [columns, bulletRow] of [
      [80, 78],
      [40, 38],
    ] as const) {
      const ui = await mountReply($, reply(LONG_LINE), columns)
      const rows = (await sketchOf(ui, columns)).map((line) => line.slice(2))
      expect(Math.max(...rows.map(displayWidth))).toBeLessThanOrEqual(bulletRow)
      expect(Math.max(...rows.map(displayWidth))).toBeGreaterThan(bulletRow - 3)
      await ui.unmount()
    }
  })

  test(
    'a framed long line wraps 4 columns inside the screen: at most 76 at 80 columns and 36 at 40',
    FRAME,
    async ($, on) => {
      await started($, on)
      for (const [columns, framedRow] of [
        [80, 76],
        [40, 36],
      ] as const) {
        const ui = await mountReply($, reply(LONG_LINE), columns)
        const rows = bodyOf(await sketchOf(ui, columns))
        expect(Math.max(...rows.map(displayWidth))).toBeLessThanOrEqual(framedRow)
        expect(Math.max(...rows.map(displayWidth))).toBeGreaterThan(framedRow - 3)
        await ui.unmount()
      }
    },
  )

  test(
    'no Text of a framed reply holds a control character other than tab or newline',
    FRAME,
    async ($, on) => {
      await started($, on)
      for (const text of [MOCK_REPLY, ...BLOCK_REPLIES.map(([, block]) => block)]) {
        for (const isFirst of [true, false]) {
          const ui = await mountReply($, reply(text, isFirst))
          const strings = textStrings(await ui.drawn())
          expect(
            strings.filter((shown) =>
              FORBIDDEN_CONTROLS.test(shown.replaceAll(ALLOWED_CONTROLS, '')),
            ),
          ).toEqual([])
          await ui.unmount()
        }
      }
    },
  )
})

describe('copy of a framed reply', () => {
  test(
    'the copy buttons and /replies copy of a framed reply copy no frame character',
    FRAME,
    async ($, on) => {
      const world = await started($, on)
      const text = [CODE_REPLY, '', ...Array<string>(30).fill('A line.')].join('\n')
      const ui = await mountReply($, reply(text))
      const lines = await sketchOf(ui)
      expect(lines[0]?.slice(0, LABEL.length)).toBe(LABEL)
      expect(unframed(lines)).toEqual([])
      await ui.press({ key: 'block-1-copy' })
      await ui.press({ key: 'copy-reply' })
      await ui.unmount()
      await replyEnds($, text)
      expect(await commandText($, 'copy code')).toBe('')
      expect(await commandText($, 'copy reply')).toBe('')
      expect(world.copies).toEqual([CODE_SOURCE, text, CODE_SOURCE, text])
      expect(world.copies.filter((copy) => FRAME_CHARACTERS.test(copy))).toEqual([])
    },
  )

  test(
    '/replies copy diagram reads a framed reply at the width of the frame, as its copy button does',
    FRAME,
    async ($, on) => {
      const world = await started($, on)
      expect(diagramOf(FAN_SOURCE, 36, 'terminal').kind).toBe('refused')
      expect(diagramOf(FAN_SOURCE, 38, 'terminal').kind).toBe('drawing')
      const text = ['The flow:', '', '```mermaid', FAN_SOURCE, '```'].join('\n')
      const ui = await mountReply($, reply(text), 40)
      await ui.press({ key: 'block-1-copy' })
      await ui.unmount()
      await replyEnds($, text)
      expect(await commandText($, 'copy diagram', 40)).toBe('')
      expect(world.copies).toEqual([FAN_SOURCE, FAN_SOURCE])
      expect(world.toasts).toHaveLength(2)
      expect(world.toasts[1]).toBe(world.toasts[0])
    },
  )
})

describe('the replyStyle setting', () => {
  test(
    'a stored replyStyle outside the options draws no frame and the debug log names the value',
    { options: { replyStyle: 'wide' } },
    async ($, on) => {
      const world = await started($, on, {
        pluginConfigs: { 'handily-reply-view': { options: { replyStyle: 'wide' } } },
      })
      expect(world.debugLogs).toContain(
        'handily-reply-view: userConfig replyStyle is "wide"; set it to off or frame in /config. Reply style stays off.',
      )
      expect(framesOf(await drawnTree($, MOCK_REPLY, 80))).toEqual([])
    },
  )
})
