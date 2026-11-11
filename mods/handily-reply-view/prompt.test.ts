import type { ConfigRow, On, PromptOrigin, RenderPropsOf, UiScrollResult } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'
import { jumpTo, PROMPTS_PANE, type RailPort } from './hooks/jump'
import { drawnPrompt } from './hooks/prompt'
import { addPrompt, newRail, promptNumberOf, promptsOf } from './hooks/rail'
import { displayWidth } from './hooks/width'

const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const TYPED_AT = new Date(2026, 9, 30, 10, 51).getTime()
const MOCK_PROMPT = 'summarize ingest p95 and errors per hour from logs/hourly.csv in a table'
const LABEL_9 = 'you · 9 · 10:51'
const FRAME_CHARACTERS = ['│', '╭', '╮', '╰', '╯', '▌', '─'] as const
const RAW_CONTROLS = /[\p{Cc}\p{Cf}]/u
const UNMARKED = /[\^~]/g

type Surface = 'terminal' | 'desktop'

type World = { copies: string[]; debugLogs: string[] }

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

type Scene = { options?: Record<string, string>; pluginConfigs?: unknown }

function engineBeneath(on: On, scene: Scene): World {
  const world: World = { copies: [], debugLogs: [] }
  const config: ConfigRow[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('config.list', () => ({ value: config }))
  on('settings.read', () => ({
    value: scene.pluginConfigs === undefined ? {} : { pluginConfigs: scene.pluginConfigs },
  }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    world.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLogs.push(e.text)
    return { value: undefined }
  })
  return world
}

function fakeElement(type: string) {
  return (props: Record<string, unknown>) => {
    const { children, ...rest } = props
    return { type, props: rest, children: children === undefined ? [] : [children].flat() }
  }
}

const FAKE_ELEMENTS = {
  Box: fakeElement('Box'),
  Text: fakeElement('Text'),
} as unknown as Parameters<typeof drawnPrompt>[0]

function railPort(scrolled: string[], drawnRows: ReadonlySet<string>): RailPort {
  return {
    scroll: (requestId): Promise<UiScrollResult> => {
      scrolled.push(requestId)
      return Promise.resolve(drawnRows.has(requestId) ? {} : { deny: 'nothing drawn' })
    },
    pane: () => Promise.resolve(undefined),
    open: () => Promise.resolve({ isPlaced: true }),
    close: () => Promise.resolve(),
    showToast: () => undefined,
    log: () => undefined,
    redraw: () => Promise.resolve(),
    hasEarlierPrompts: () => Promise.resolve(false),
  }
}

async function started(
  $: Engine,
  on: On,
  scene: Scene = {},
  surface: Surface = 'terminal',
): Promise<World> {
  const world = engineBeneath(on, scene)
  mock.clock(on, { now: TYPED_AT })
  await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
  return world
}

function prompt(text: string, extra: Partial<RenderPropsOf['UserMessage']> = {}) {
  return { text, origin: { kind: 'composer' as const }, isExpanded: false, ...extra }
}

async function appendPrompt($: Engine, text: string, uuid: string, origin?: PromptOrigin) {
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
    door: 'prompt',
    origin: origin ?? { kind: 'composer' },
    uuid,
  })
}

async function appendPrompts($: Engine, count: number, last = MOCK_PROMPT): Promise<void> {
  for (let number = 1; number < count; number += 1) {
    await appendPrompt($, `Prompt ${String(number)}`, `prompt-${String(number)}`)
  }
  await appendPrompt($, last, `prompt-${String(count)}`)
}

async function mountPrompt(
  $: Engine,
  text: string,
  options: { columns?: number; requestId?: string; surface?: Surface; isExpanded?: boolean } = {},
) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface: options.surface ?? 'terminal',
    component: 'UserMessage',
    props: prompt(text, { isExpanded: options.isExpanded ?? false }),
    requestId: options.requestId ?? 'prompt-9',
    viewport: { columns: options.columns ?? 80, rows: 40 },
  })
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null
}

function isAbsolute(node: unknown): boolean {
  return isNode(node) && node.props?.position === 'absolute'
}

function isGrower(node: unknown): boolean {
  return isNode(node) && Number(node.props?.flexGrow ?? 0) > 0
}

function marked(props: Record<string, unknown>, text: string, marks: boolean): string {
  if (!marks || text.trim() === '') return text
  const dimmed = props.dimColor === true ? `~${text}~` : text
  return props.color === 'suggestion' ? `^${dimmed}^` : dimmed
}

function textOf(node: unknown, marks: boolean): string {
  if (typeof node === 'string') return node
  if (!isNode(node)) return ''
  const inner = (node.children ?? []).map((child) => textOf(child, marks)).join('')
  return marked(node.props ?? {}, inner, marks)
}

function widthOf(line: string, marks: boolean): number {
  return displayWidth(marks ? line.replace(UNMARKED, '') : line)
}

function clipped(node: unknown, room: number, marks: boolean): string {
  const text = isNode(node) ? node.children?.[0] : undefined
  const plain = Array.from(textOf(text, false)).slice(0, room).join('')
  return isNode(text) ? marked(text.props ?? {}, plain, marks) : plain
}

function rowLine(
  props: Record<string, unknown>,
  children: unknown[],
  width: number,
  marks: boolean,
) {
  const fixed = children.map((child) =>
    isGrower(child) ? '' : (linesOf(child, width, marks)[0] ?? ''),
  )
  const used = fixed.reduce((sum, line) => sum + widthOf(line, marks), 0)
  const line = children
    .map((child, index) => (isGrower(child) ? clipped(child, width - used, marks) : fixed[index]))
    .join('')
  const flush = props.justifyContent === 'flex-end' ? width - widthOf(line, marks) : 0
  return ' '.repeat(Math.max(flush, 0)) + line
}

function linesOf(node: unknown, width: number, marks: boolean): string[] {
  if (typeof node === 'string') return [node]
  if (!isNode(node)) return []
  if (node.type === 'Text') return [textOf(node, marks)]
  if (node.type === 'engine') return ['', '(engine)']
  const props = node.props ?? {}
  const children = node.children ?? []
  const margin = Array<string>(Number(props.marginTop ?? 0)).fill('')
  if (props.flexDirection !== 'column') return [...margin, rowLine(props, children, width, marks)]
  const lines = children
    .filter((child) => !isAbsolute(child))
    .flatMap((child) => linesOf(child, width, marks))
  for (const placed of children.filter(isAbsolute)) {
    const top = isNode(placed) ? Number(placed.props?.top ?? 0) : 0
    linesOf(placed, width, marks).forEach((line, row) => {
      lines[top + row] = line
    })
  }
  return [...margin, ...lines]
}

async function seen(ui: { drawn: () => Promise<unknown> }, columns = 80): Promise<string[]> {
  return linesOf(await ui.drawn(), columns, false)
}

async function coloured(ui: { drawn: () => Promise<unknown> }, columns = 80): Promise<string[]> {
  return linesOf(await ui.drawn(), columns, true)
}

function spansOf(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (!isNode(node)) return []
  return (node.children ?? []).flatMap(spansOf)
}

function pad(count: number): string {
  return ' '.repeat(count)
}

function ruleOf(count: number): string {
  return '─'.repeat(count)
}

async function railRow($: Engine) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface: 'terminal',
    component: 'Pane',
    requestId: PROMPTS_PANE.id,
    props: {
      title: PROMPTS_PANE.title,
      isFocused: false,
      bodyColumns: 41,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns: 120, rows: 40, isFullscreen: true },
  })
}

async function toggleText($: Engine): Promise<string> {
  const result = await $.command.run({
    command: 'replies',
    args: '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return result.text ?? ''
}

describe('the prompt styles', () => {
  test(
    'with promptStyle rule a typed prompt draws as today and its label carries the rail number',
    { options: { promptStyle: 'rule' } },
    async ($, on) => {
      await started($, on)
      await appendPrompts($, 9)
      const ui = await mountPrompt($, MOCK_PROMPT)
      expect(await seen(ui)).toEqual([
        '',
        `── ${LABEL_9} ${ruleOf(80 - 3 - LABEL_9.length - 1)}`,
        '(engine)',
      ])
      expect(await coloured(ui)).toEqual([
        '',
        `^── ${LABEL_9} ^^${ruleOf(80 - 3 - LABEL_9.length - 1)}^`,
        '(engine)',
      ])
      await ui.unmount()
    },
  )

  test('with no promptStyle setting a prompt draws under the rule, and a prompt that the rail does not hold draws you alone', async ($, on) => {
    await started($, on)
    await appendPrompt($, 'Read the design', 'prompt-1')
    const numbered = await mountPrompt($, 'Read the design', { requestId: 'prompt-1' })
    expect((await seen(numbered))[1]).toBe(`── you · 1 · 10:51 ${ruleOf(80 - 19)}`)
    const resumed = await mountPrompt($, 'From before the resume', { requestId: 'old-prompt' })
    expect((await seen(resumed))[1]).toBe(`── you ${ruleOf(80 - 7)}`)
    await numbered.unmount()
    await resumed.unmount()
  })

  test('a peer message keeps no number, because the rail counts typed prompts only', async ($, on) => {
    await started($, on)
    await appendPrompt($, 'Read the design', 'prompt-1')
    await appendPrompt($, 'A message from release', 'peer-1', { kind: 'peer' })
    const ui = await mountPrompt($, 'A message from release', { requestId: 'peer-1' })
    expect((await seen(ui))[1]).toBe(`── you ${ruleOf(80 - 7)}`)
    await ui.unmount()
  })

  test(
    'with promptStyle bubble at 80 columns the prompt draws flush right in a frame as wide as its text plus 4',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      await appendPrompts($, 9)
      const ui = await mountPrompt($, MOCK_PROMPT)
      expect(await seen(ui)).toEqual([
        '',
        `${pad(65)}${LABEL_9}`,
        `${pad(31)}╭${ruleOf(47)}╮`,
        `${pad(31)}│ summarize ingest p95 and errors per hour from │`,
        `${pad(31)}│ logs/hourly.csv in a table                    │`,
        `${pad(31)}╰${ruleOf(47)}╯`,
      ])
      expect((await coloured(ui))[3]).toBe(
        `${pad(31)}^│ ^summarize ingest p95 and errors per hour from^ │^`,
      )
      await ui.unmount()
    },
  )

  test(
    'a bubble is at most 3/4 of the width: 60 at 80 columns and 90 at 120',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const long = 'x'.repeat(300)
      for (const [columns, widest, rows] of [
        [80, 60, 8],
        [120, 90, 6],
      ] as const) {
        const ui = await mountPrompt($, long, { columns })
        const frame = (await seen(ui, columns)).slice(2)
        expect(frame).toHaveLength(rows)
        expect(frame.every((line) => displayWidth(line) === columns)).toBe(true)
        expect(frame.every((line) => displayWidth(line.trimStart()) === widest)).toBe(true)
        expect(frame[1]).toBe(`${pad(columns - widest)}│ ${'x'.repeat(widest - 4)} │`)
        await ui.unmount()
      }
    },
  )

  test(
    'at a terminal of exactly 40 columns a bubble draws, 30 wide, as the mock of 40 columns shows',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      await appendPrompts($, 9)
      const ui = await mountPrompt($, MOCK_PROMPT, { columns: 40 })
      expect(await seen(ui, 40)).toEqual([
        '',
        `${pad(25)}${LABEL_9}`,
        `${pad(10)}╭${ruleOf(28)}╮`,
        `${pad(10)}│ summarize ingest p95 and   │`,
        `${pad(10)}│ errors per hour from       │`,
        `${pad(10)}│ logs/hourly.csv in a table │`,
        `${pad(10)}╰${ruleOf(28)}╯`,
      ])
      await ui.unmount()
    },
  )

  test(
    'at 39 columns a bubble draws as a bar',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      await appendPrompts($, 9)
      const ui = await mountPrompt($, MOCK_PROMPT, { columns: 39 })
      expect(await seen(ui, 39)).toEqual([
        '',
        '▌ summarize ingest p95 and errors per',
        '▌ hour from logs/hourly.csv in a table',
        `▌ ${LABEL_9}`,
      ])
      await ui.unmount()
    },
  )

  test(
    'at 30 columns a bubble draws as a bar with the label under the text, as the mock of 30 columns shows',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      await appendPrompts($, 9)
      const ui = await mountPrompt($, MOCK_PROMPT, { columns: 30 })
      expect(await seen(ui, 30)).toEqual([
        '',
        '▌ summarize ingest p95 and',
        '▌ errors per hour from',
        '▌ logs/hourly.csv in a table',
        `▌ ${LABEL_9}`,
      ])
      await ui.unmount()
    },
  )

  test(
    'with promptStyle bar at 80 columns the bar costs no row above the prompt and the label goes under it',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on)
      await appendPrompts($, 9)
      const ui = await mountPrompt($, MOCK_PROMPT)
      expect(await seen(ui)).toEqual(['', `▌ ${MOCK_PROMPT}`, `▌ ${LABEL_9}`])
      expect(await coloured(ui)).toEqual(['', `^▌ ^${MOCK_PROMPT}`, `^▌ ${LABEL_9}^`])
      await ui.unmount()
    },
  )

  test('with promptStyle rule a prompt of more than 6 lines keeps the engine row under the rule', async ($, on) => {
    await started($, on)
    await appendPrompts($, 9, 'unused')
    const text = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].join('\n')
    const ui = await mountPrompt($, text, { columns: 80 })
    expect(await seen(ui)).toEqual([
      '',
      `── ${LABEL_9} ${ruleOf(80 - 3 - LABEL_9.length - 1)}`,
      '(engine)',
    ])
    await ui.unmount()
  })

  test(
    'a bubble of more than 6 lines shows 5 lines and N more lines (ctrl+o shows all)',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      await appendPrompts($, 9, 'unused')
      const text = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].join(
        '\n',
      )
      const ui = await mountPrompt($, text)
      const note = '… 4 more lines (ctrl+o shows all)'
      expect(await seen(ui)).toEqual([
        '',
        `${pad(65)}${LABEL_9}`,
        `${pad(43)}╭${ruleOf(35)}╮`,
        `${pad(43)}│ one${pad(30)} │`,
        `${pad(43)}│ two${pad(30)} │`,
        `${pad(43)}│ three${pad(28)} │`,
        `${pad(43)}│ four${pad(29)} │`,
        `${pad(43)}│ five${pad(29)} │`,
        `${pad(43)}│ ${note} │`,
        `${pad(43)}╰${ruleOf(35)}╯`,
      ])
      expect((await coloured(ui))[8]).toBe(`${pad(43)}^│ ^~${note}~^ │^`)
      await ui.unmount()
    },
  )

  test(
    'a bar of more than 6 lines shows 5 lines and N more lines (ctrl+o shows all)',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on)
      const text = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].join('\n')
      const ui = await mountPrompt($, text)
      expect(await seen(ui)).toEqual([
        '',
        '▌ one',
        '▌ two',
        '▌ three',
        '▌ four',
        '▌ five',
        '▌ … 2 more lines (ctrl+o shows all)',
        '▌ you',
      ])
      await ui.unmount()
    },
  )

  test(
    'a prompt of exactly 6 lines shows all 6 lines and no count',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on)
      const text = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n')
      const ui = await mountPrompt($, text)
      expect(await seen(ui)).toEqual([
        '',
        '▌ one',
        '▌ two',
        '▌ three',
        '▌ four',
        '▌ five',
        '▌ six',
        '▌ you',
      ])
      await ui.unmount()
    },
  )

  test(
    'a long line counts its wrapped rows, so one paragraph of 10 rows shows 5 and 5 more lines',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on)
      const text = 'abcdefgh '.repeat(10).trim()
      const ui = await mountPrompt($, text, { columns: 18 })
      expect(await seen(ui, 18)).toEqual([
        '',
        '▌ abcdefgh',
        '▌ abcdefgh',
        '▌ abcdefgh',
        '▌ abcdefgh',
        '▌ abcdefgh',
        '▌ … 5 more lines',
        '▌ you',
      ])
      await ui.unmount()
    },
  )

  test(
    'a folded bubble at a terminal of 40 columns keeps 6 rows, and its count drops the ctrl+o words that do not fit',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      await appendPrompts($, 9, 'unused')
      const text = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].join(
        '\n',
      )
      const ui = await mountPrompt($, text, { columns: 40 })
      expect(await seen(ui, 40)).toEqual([
        '',
        `${pad(25)}${LABEL_9}`,
        `${pad(22)}╭${ruleOf(16)}╮`,
        `${pad(22)}│ one${pad(11)} │`,
        `${pad(22)}│ two${pad(11)} │`,
        `${pad(22)}│ three${pad(9)} │`,
        `${pad(22)}│ four${pad(10)} │`,
        `${pad(22)}│ five${pad(10)} │`,
        `${pad(22)}│ … 4 more lines │`,
        `${pad(22)}╰${ruleOf(16)}╯`,
      ])
      await ui.unmount()
    },
  )

  test(
    'a folded bar at a terminal of 30 columns keeps 6 rows, and a count too wide for one row is cut',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on)
      const text = Array.from({ length: 1200 }, (_, index) => `line ${String(index + 1)}`).join(
        '\n',
      )
      const wide = await mountPrompt($, text, { columns: 30 })
      const rows = await seen(wide, 30)
      expect(rows.slice(1, -1)).toEqual([
        '▌ line 1',
        '▌ line 2',
        '▌ line 3',
        '▌ line 4',
        '▌ line 5',
        '▌ … 1195 more lines',
      ])
      const narrow = await mountPrompt($, text, { columns: 12, requestId: 'prompt-2' })
      expect((await seen(narrow, 12)).slice(1, -1)).toEqual([
        '▌ line 1',
        '▌ line 2',
        '▌ line 3',
        '▌ line 4',
        '▌ line 5',
        '▌ … 1195 mo…',
      ])
      await wide.unmount()
      await narrow.unmount()
    },
  )

  test(
    'the ctrl+o view of a bubble prompt is the engine row with no frame',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, 'line\n'.repeat(20), { isExpanded: true })
      const drawn = await ui.drawn()
      expect(drawn).toEqual(ENGINE_ROW)
      expect(FRAME_CHARACTERS.some((frame) => JSON.stringify(drawn).includes(frame))).toBe(false)
      await ui.unmount()
    },
  )

  test(
    'the ctrl+o view of a bar prompt is the engine row with no bar',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, 'line\n'.repeat(20), { isExpanded: true })
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      await ui.unmount()
    },
  )
})

describe('the prompt text in a bubble or a bar', () => {
  const hostile = 'a\u202Eb\u001b[31mred\tcell\r\nnext \u200Fline 漢字'

  test(
    'a bubble escapes control and bidi characters and keeps every frame row at one width',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, hostile)
      const drawn = await ui.drawn()
      expect(spansOf(drawn).filter((span) => RAW_CONTROLS.test(span))).toEqual([])
      const lines = await seen(ui)
      expect(lines.slice(2)).toEqual([
        `${pad(47)}╭${ruleOf(31)}╮`,
        `${pad(47)}│ a\\u202eb\\u001b[31mred    cell │`,
        `${pad(47)}│ next \\u200fline 漢字${pad(9)} │`,
        `${pad(47)}╰${ruleOf(31)}╯`,
      ])
      expect(lines.slice(2).map((line) => displayWidth(line))).toEqual([80, 80, 80, 80])
      await ui.unmount()
    },
  )

  test(
    'a bar escapes control and bidi characters in every drawn span',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, hostile)
      expect(spansOf(await ui.drawn()).filter((span) => RAW_CONTROLS.test(span))).toEqual([])
      expect(await seen(ui)).toEqual([
        '',
        '▌ a\\u202eb\\u001b[31mred    cell',
        '▌ next \\u200fline 漢字',
        '▌ you',
      ])
      await ui.unmount()
    },
  )

  test(
    'a pasted line keeps its indent on each wrapped row inside the bubble',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const text = `Fix this:\n    ${'value '.repeat(12).trim()}`
      const ui = await mountPrompt($, text)
      expect((await seen(ui)).slice(3, 6).map((line) => line.trim())).toEqual([
        `│ Fix this:${pad(42)} │`,
        '│     value value value value value value value value │',
        `│     value value value value${pad(24)} │`,
      ])
      await ui.unmount()
    },
  )

  test(
    'an indent wider than half the bubble stays, cut to half the columns inside the frame',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, `Fix:\n${pad(20)}value value`, { columns: 40 })
      expect((await seen(ui, 40)).slice(3, 5)).toEqual([
        `${pad(12)}│ Fix:${pad(20)} │`,
        `${pad(12)}│ ${pad(13)}value value │`,
      ])
      await ui.unmount()
    },
  )

  test(
    'a prompt of more than 60000 characters draws under the rule with the engine row, as a long reply does',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, 'x'.repeat(60_001))
      expect(await seen(ui)).toEqual(['', `── you ${ruleOf(80 - 7)}`, '(engine)'])
      await ui.unmount()
    },
  )

  test(
    'a prompt just under 60000 characters in one word still shows 5 rows and the count of the rest',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, 'x'.repeat(59_000))
      const lines = await seen(ui)
      expect(lines.slice(3, 9)).toEqual([
        ...Array<string>(5).fill(`${pad(20)}│ ${'x'.repeat(56)} │`),
        `${pad(20)}│ … 1049 more lines (ctrl+o shows all)${pad(20)} │`,
      ])
      expect(lines).toHaveLength(10)
      await ui.unmount()
    },
  )

  test(
    'a long prompt of wide characters counts its hidden rows by their columns',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, '\u{6F22}'.repeat(2000))
      const lines = await seen(ui)
      expect(lines[3]).toBe(`${pad(20)}│ ${'\u{6F22}'.repeat(28)} │`)
      expect(lines[8]).toBe(`${pad(20)}│ … 67 more lines (ctrl+o shows all)${pad(22)} │`)
      await ui.unmount()
    },
  )

  test(
    'copy prompt in the prompts tab copies the prompt text, never a frame or bar character',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      const world = await started($, on)
      const text = 'Draw the mocks\nand check every width'
      await appendPrompt($, text, 'prompt-1')
      const row = await mountPrompt($, text, { requestId: 'prompt-1' })
      expect((await seen(row))[3]).toContain('│ Draw the mocks')
      const pane = await railRow($)
      await pane.press({ key: 'copy-prompt' })
      expect(world.copies).toEqual([text])
      expect(FRAME_CHARACTERS.some((frame) => world.copies.join('').includes(frame))).toBe(false)
      await row.unmount()
      await pane.unmount()
    },
  )
})

describe('a rail jump to a redrawn prompt', () => {
  test(
    'the bubble row of a typed prompt draws under the request id that the prompts tab keeps, with the number of its tab row',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      await appendPrompt($, 'Read the design', 'prompt-1')
      await appendPrompt($, 'Run the checks', 'prompt-2')
      const bubble = await mountPrompt($, 'Run the checks', { requestId: 'prompt-2' })
      expect((await seen(bubble)).slice(1, 4)).toEqual([
        `${pad(65)}you · 2 · 10:51`,
        `${pad(62)}╭${ruleOf(16)}╮`,
        `${pad(62)}│ Run the checks │`,
      ])
      const pane = await railRow($)
      expect((await pane.find({ key: 'prompt-2' }))?.text).toMatch(/^▸ 2 10:51 Run the checks/)
      await bubble.unmount()
      await pane.unmount()
    },
  )

  test('a rail jump to prompt 2 scrolls to the request id of the rail, under which the redrawn bubble of prompt 2 draws', async () => {
    const rail = newRail()
    addPrompt(rail, 'prompt-1', 'Read the design', TYPED_AT)
    addPrompt(rail, 'prompt-2', 'Run the checks', TYPED_AT)
    const rows = new Map(
      promptsOf(rail).map((kept) => [
        kept.requestId,
        drawnPrompt(FAKE_ELEMENTS, kept.text, {
          style: 'bubble',
          columns: 80,
          mark: { number: promptNumberOf(rail, kept.requestId), submittedAt: kept.at },
        }),
      ]),
    )
    const scrolled: string[] = []
    const port = railPort(scrolled, new Set(rows.keys()))
    expect(await jumpTo(rail, port, 2, true)).toEqual({ isMoved: true })
    expect(scrolled).toEqual(['prompt-2'])
    const target = scrolled[0] ?? ''
    expect(linesOf(rows.get(target), 80, false).slice(1, 4)).toEqual([
      `${pad(65)}you · 2 · 10:51`,
      `${pad(62)}╭${ruleOf(16)}╮`,
      `${pad(62)}│ Run the checks │`,
    ])
  })

  test('a rail jump to a bar prompt scrolls to the request id of the rail, under which the bar draws', async () => {
    const rail = newRail()
    addPrompt(rail, 'prompt-1', 'Read the design', TYPED_AT)
    const drawn = drawnPrompt(FAKE_ELEMENTS, 'Read the design', {
      style: 'bar',
      columns: 80,
      mark: { number: promptNumberOf(rail, 'prompt-1'), submittedAt: TYPED_AT },
    })
    const scrolled: string[] = []
    expect(await jumpTo(rail, railPort(scrolled, new Set(['prompt-1'])), 1, true)).toEqual({
      isMoved: true,
    })
    expect(scrolled).toEqual(['prompt-1'])
    expect(linesOf(drawn, 80, false)).toEqual(['', '▌ Read the design', '▌ you · 1 · 10:51'])
  })
})

describe('the promptStyle setting', () => {
  test(
    'a bubble prompt draws as the engine draws it on the desktop app',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on, {}, 'desktop')
      const ui = await mountPrompt($, MOCK_PROMPT, { surface: 'desktop' })
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      await ui.unmount()
    },
  )

  test(
    'a bar prompt draws as the engine draws it on the desktop app',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on, {}, 'desktop')
      const ui = await mountPrompt($, MOCK_PROMPT, { surface: 'desktop' })
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      await ui.unmount()
    },
  )

  test(
    'a bubble prompt draws as the engine draws it while /replies is off',
    { options: { promptStyle: 'bubble' } },
    async ($, on) => {
      await started($, on)
      const ui = await mountPrompt($, MOCK_PROMPT)
      expect(await toggleText($)).toBe(
        'off for this session. Replies and prompts draw as Claude Code draws them.',
      )
      expect(await ui.drawn()).toEqual(ENGINE_ROW)
      expect(await toggleText($)).toMatch(
        / Each prompt that you type draws in a frame at the right under the label you\.$/,
      )
      expect((await seen(ui))[2]).toContain('╭')
      await ui.unmount()
    },
  )

  test(
    '/replies names the bar when promptStyle is bar',
    { options: { promptStyle: 'bar' } },
    async ($, on) => {
      await started($, on)
      await toggleText($)
      expect(await toggleText($)).toMatch(
        / Each prompt that you type draws with a bar at its left and the label you under it\.$/,
      )
    },
  )

  test(
    'a stored promptStyle outside the options draws the rule and the debug log names the value',
    { options: { promptStyle: 'wide' } },
    async ($, on) => {
      const world = await started($, on, {
        pluginConfigs: { 'handily-reply-view': { options: { promptStyle: 'wide' } } },
      })
      expect(world.debugLogs).toContain(
        'handily-reply-view: userConfig promptStyle is "wide"; set it to rule or bar or bubble in /config. Drawing rule.',
      )
      const ui = await mountPrompt($, MOCK_PROMPT)
      expect((await seen(ui))[1]).toBe(`── you ${ruleOf(80 - 7)}`)
      await ui.unmount()
    },
  )
})
