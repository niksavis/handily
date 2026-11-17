import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'
import { displayWidth } from './hooks/width'
import { nodesOf, sketchOf, type DrawnNode } from './fixtures/sketch'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [120, 40] as const
const NARROW_BELOW = 60

type Surface = (typeof SURFACES)[number]

type CopyAnswer = { isCopied: true } | { isCopied: false; reason: 'no-clipboard' }

type World = { copies: string[]; answer: CopyAnswer }

type Mounted = Awaited<ReturnType<typeof mountReply>>

const FENCE = ['```sh', 'git status', 'git diff', '```'].join('\n')
const SECOND_FENCE = ['```python', 'print(1)', '```'].join('\n')
const FLOW = ['```mermaid', 'flowchart LR', '  A[Prompt] --> B[Reply]', '```'].join('\n')
const CHART = [
  '```mermaid',
  'xychart-beta horizontal',
  '  x-axis [a, b]',
  '  bar [1, 2]',
  '```',
].join('\n')
const REFUSED = ['```mermaid', 'flowchart RL', '  A --> B', '```'].join('\n')
const TABLE = ['| Mod | Gate |', '| --- | --- |', '| board | pass |', '| tree | fail |'].join('\n')
const LONG_CODE = [
  '```sh',
  ...Array.from({ length: 25 }, (_, index) => `echo ${String(index)}`),
  '```',
].join('\n')
const PROSE = Array.from({ length: 32 }, (_, index) => `- Step ${String(index + 1)}`).join('\n')

function together(...blocks: string[]): string {
  return blocks.join('\n\n')
}

function engineBeneath(on: On): World {
  const world: World = { copies: [], answer: { isCopied: true } }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.messages', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('config.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('ui.copy', (_$, e) => {
    if (world.answer.isCopied) world.copies.push(e.text)
    return { value: world.answer }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  return world
}

function markTest(name: string, body: (world: World, $: Engine) => Promise<void>): void {
  test(name, async ($, on) => {
    const world = engineBeneath(on)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

function reply(text: string): RenderPropsOf['AssistantMessage'] {
  return { text, isFirstOfReply: true }
}

async function mountReply(
  $: Engine,
  text: string,
  surface: Surface,
  columns: number,
  requestId = 'message-1',
) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: reply(text),
    requestId,
    viewport: { columns, rows: 40 },
  })
}

async function linesOf(ui: Mounted, columns: number): Promise<string[]> {
  return sketchOf(await ui.drawn(), columns)
}

function endOf(lines: readonly string[], label: string): { row: number; end: number } {
  const button = `[ ${label} ]`
  const row = lines.findIndex((line) => line.includes(button))
  const line = lines[row] ?? ''
  return { row, end: displayWidth(line.slice(0, line.indexOf(button))) + displayWidth(button) }
}

async function buttonKeysIn(ui: Mounted, key: string): Promise<string[]> {
  const box = await ui.find({ key })
  return nodesOf(box)
    .filter((node: DrawnNode) => node.type === 'Button')
    .map((node) => String(node.props?.key))
}

function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

async function textLook(ui: Mounted, text: string) {
  const found = await ui.find({ type: 'Text', text: exactly(text) })
  return found?.props
}

describe('the copy state on a copy button', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      markTest(
        `a pressed copy reads copied with a check in the success colour and the line keeps its place at ${String(columns)} columns on ${surface}`,
        async (world, $) => {
          const ui = await mountReply($, together('Run this:', FENCE), surface, columns)
          const before = await linesOf(ui, columns)
          await ui.press({ key: 'block-1-copy' })
          const after = await linesOf(ui, columns)
          expect(world.copies).toEqual(['git status\ngit diff'])
          expect((await ui.find({ key: 'block-1-copy' }))?.props.label).toBe('✓ copied')
          expect((await textLook(ui, '✓ copied'))?.color).toBe('success')
          expect(endOf(after, '✓ copied')).toEqual(endOf(before, 'copy'))
          expect(after.length).toBe(before.length)
          await ui.unmount()
        },
      )

      markTest(
        `a refused copy reads not copied in the error colour at ${String(columns)} columns on ${surface}`,
        async (world, $) => {
          world.answer = { isCopied: false, reason: 'no-clipboard' }
          const ui = await mountReply($, together('Run this:', FENCE), surface, columns)
          const before = await linesOf(ui, columns)
          await ui.press({ key: 'block-1-copy' })
          const after = await linesOf(ui, columns)
          expect((await ui.find({ key: 'block-1-copy' }))?.props.label).toBe('■ not copied')
          expect((await textLook(ui, '■ not copied'))?.color).toBe('error')
          expect(endOf(after, '■ not copied')).toEqual(endOf(before, 'copy'))
          await ui.unmount()
        },
      )

      markTest(
        `one space stands between the buttons at rest and after each press, and the right edge stays, at ${String(columns)} columns on ${surface}`,
        async (_world, $) => {
          const cases = [
            {
              text: FLOW,
              keys: ['block-1-copy', 'block-1-drawing'],
              rest: ['copy', 'copy drawing'],
            },
            { text: TABLE, keys: ['block-1-copy', 'block-1-text'], rest: ['copy', 'copy as text'] },
            { text: LONG_CODE, keys: ['block-1-copy'], rest: ['more', 'copy'] },
          ] as const
          for (const { text, keys, rest } of cases) {
            const ui = await mountReply($, together('Here:', text), surface, columns)
            const group = (labels: readonly string[]) =>
              labels.map((label) => `[ ${label} ]`).join(' ')
            const before = await linesOf(ui, columns)
            const restGroup = group(rest)
            expect(before.some((line) => line.endsWith(restGroup))).toBe(true)
            const edge = endOf(before, rest.at(-1) ?? '')
            for (const key of keys) {
              await ui.press({ key })
              const labels = await Promise.all(
                (await buttonKeysIn(ui, 'block-1-title')).map(async (found) =>
                  String((await ui.find({ key: found }))?.props.label),
                ),
              )
              const after = await linesOf(ui, columns)
              expect(after.some((line) => line.endsWith(group(labels)))).toBe(true)
              expect(endOf(after, labels.at(-1) ?? '').end).toBe(edge.end)
            }
            await ui.unmount()
          }
        },
      )

      markTest(
        `a press never cuts the head text, also after /replies copy table, at ${String(columns)} columns on ${surface}`,
        async (_world, $) => {
          const text = together('Here:', TABLE)
          await $.turn.complete({
            answer: text,
            durationMs: 1000,
            isAborted: false,
            turnId: 'turn-1',
            reason: 'answer',
          })
          const ui = await mountReply($, text, surface, columns)
          const headOf = (lines: readonly string[]) =>
            lines.find((line) => line.includes('── table')) ?? ''
          expect(headOf(await linesOf(ui, columns))).toContain('── table · 2 rows ──')
          await $.command.run({
            command: 'replies',
            args: 'copy table',
            origin: { kind: 'sdk' },
            presentation: { isFullscreen: false, columns },
          })
          await ui.redraw(reply(text))
          const pressed = await linesOf(ui, columns)
          expect(headOf(pressed)).toContain('── table · 2 rows ──')
          expect(headOf(pressed)).not.toContain('…')
          expect(pressed.some((line) => line.includes('[ ✓ copied ] [ copy as text ]'))).toBe(true)
          await ui.press({ key: 'block-1-text' })
          const second = await linesOf(ui, columns)
          expect(headOf(second)).toContain('── table · 2 rows ──')
          expect(headOf(second)).not.toContain('…')
          await ui.unmount()
        },
      )
    }

    markTest(
      `the mark stays on the last copied block until another block is copied on ${surface}`,
      async (_world, $) => {
        const ui = await mountReply($, together('Two:', FENCE, SECOND_FENCE), surface, 120)
        await ui.press({ key: 'block-1-copy' })
        expect((await ui.find({ key: 'block-1-copy' }))?.props.label).toBe('✓ copied')
        await ui.press({ key: 'block-2-copy' })
        expect((await ui.find({ key: 'block-1-copy' }))?.props.label).toBe('copy')
        expect((await ui.find({ key: 'block-2-copy' }))?.props.label).toBe('✓ copied')
        await ui.unmount()
      },
    )
  }

  markTest('a copy in another reply clears the mark of the first reply', async (_world, $) => {
    const first = await mountReply($, together('One:', FENCE), 'terminal', 120, 'message-1')
    await first.press({ key: 'block-1-copy' })
    expect((await first.find({ key: 'block-1-copy' }))?.props.label).toBe('✓ copied')
    const second = await mountReply($, together('Two:', SECOND_FENCE), 'terminal', 120, 'message-2')
    await second.press({ key: 'block-1-copy' })
    expect((await second.find({ key: 'block-1-copy' }))?.props.label).toBe('✓ copied')
    expect((await first.find({ key: 'block-1-copy' }))?.props.label).toBe('copy')
    await first.unmount()
    await second.unmount()
  })

  markTest('/replies copy code marks the button of the block it copied', async (world, $) => {
    const text = together('Run this:', FENCE)
    await $.turn.complete({
      answer: text,
      durationMs: 1000,
      isAborted: false,
      turnId: 'turn-1',
      reason: 'answer',
    })
    await $.command.run({
      command: 'replies',
      args: 'copy code',
      origin: { kind: 'sdk' },
      presentation: { isFullscreen: false, columns: 120 },
    })
    expect(world.copies).toEqual(['git status\ngit diff'])
    const ui = await mountReply($, text, 'terminal', 120)
    expect((await ui.find({ key: 'block-1-copy' }))?.props.label).toBe('✓ copied')
    await ui.unmount()
  })
})

describe('a head on every block', () => {
  const cases = [
    { name: 'a table', text: TABLE, kind: 'table', color: 'claude', buttons: ['copy', 'text'] },
    { name: 'code', text: FENCE, kind: 'sh', color: 'merged', buttons: ['copy'] },
    {
      name: 'a diagram',
      text: FLOW,
      kind: 'mermaid',
      color: 'suggestion',
      buttons: ['copy', 'drawing'],
    },
    {
      name: 'a chart',
      text: CHART,
      kind: 'mermaid',
      color: 'planMode',
      buttons: ['copy', 'drawing'],
    },
  ] as const
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      for (const { name, text, kind, color, buttons } of cases) {
        markTest(
          `${name} has a head with its kind word bold in ${color} and its buttons at the right edge at ${String(columns)} columns on ${surface}`,
          async (_world, $) => {
            const ui = await mountReply($, together('Here:', text), surface, columns)
            const look = await textLook(ui, kind)
            expect(look?.bold).toBe(true)
            expect(look?.color).toBe(color)
            expect(await buttonKeysIn(ui, 'block-1-title')).toEqual(
              buttons.map((button) => `block-1-${button}`),
            )
            const lines = await linesOf(ui, columns)
            const head = lines.findIndex((line) => line.includes(`── ${kind}`))
            const first = lines.findIndex((line) => line.includes('[ copy ]'))
            expect(head).toBeGreaterThanOrEqual(0)
            expect(first).toBeLessThanOrEqual(head + 1)
            const room = columns - (surface === 'terminal' ? 2 : 0)
            const lineEnd = displayWidth(lines[first] ?? '') - (surface === 'terminal' ? 2 : 0)
            expect(lineEnd).toBeLessThanOrEqual(room)
            if (kind !== 'table') expect(lineEnd).toBe(room)
            await ui.unmount()
          },
        )
      }

      markTest(
        `a folded code block has its more button first on its head at ${String(columns)} columns on ${surface}`,
        async (_world, $) => {
          const ui = await mountReply($, together('Here:', LONG_CODE), surface, columns)
          expect(await buttonKeysIn(ui, 'block-1-title')).toEqual(['block-1-fold', 'block-1-copy'])
          expect(await buttonKeysIn(ui, 'block-1-fold-row')).toEqual([])
          await ui.unmount()
        },
      )

      markTest(
        `a diagram that does not draw says not drawn in warning on its head and the reason dim under it at ${String(columns)} columns on ${surface}`,
        async (_world, $) => {
          const ui = await mountReply($, together('Here:', REFUSED), surface, columns)
          expect((await textLook(ui, 'not drawn'))?.color).toBe('warning')
          const lines = await linesOf(ui, columns)
          const head = lines.findIndex((line) => line.includes('not drawn') && line.includes('──'))
          expect(
            lines.slice(head + 1, head + 3).some((line) => /diagram not drawn:/.test(line)),
          ).toBe(true)
          const note = await ui.find({ type: 'Text', text: /^diagram not drawn:/ })
          expect(note?.props.dimColor).toBe(true)
          await ui.unmount()
        },
      )
    }
  }
})

describe('the fold row names what it hides', () => {
  const hidden = together(PROSE, TABLE, FENCE, FLOW)
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      markTest(
        `a folded reply names the kinds of its hidden blocks after the line count at ${String(columns)} columns on ${surface}`,
        async (_world, $) => {
          const ui = await mountReply($, hidden, surface, columns)
          const row = await ui.find({ key: 'fold-row' })
          const text = row?.text ?? ''
          expect(text).toMatch(/^▸ \d+ more lines/)
          expect(text).toContain('1 table')
          expect(text).toContain('1 sh block')
          expect(text).toContain('1 flowchart')
          expect(text.indexOf('more lines')).toBeLessThan(text.indexOf('1 table'))
          expect((await textLook(ui, '1 table'))?.color).toBe('claude')
          expect((await textLook(ui, '1 sh block'))?.color).toBe('merged')
          expect((await textLook(ui, '1 flowchart'))?.color).toBe('suggestion')
          const lines = await linesOf(ui, columns)
          const count = lines.findIndex((line) => line.includes('▸'))
          const buttons = lines.findIndex((line) => line.includes('[ more ]'))
          if (columns < NARROW_BELOW) {
            expect(await ui.find({ key: 'fold-kinds' })).toBeDefined()
            expect(buttons).toBeGreaterThan(count + 1)
          } else {
            expect(buttons).toBe(count)
          }
          await ui.unmount()
        },
      )

      markTest(
        `the fold count stays whole and under 60 columns the buttons stand under it at ${String(columns)} columns on ${surface}`,
        async (_world, $) => {
          for (const text of [together(TABLE, PROSE), hidden]) {
            const ui = await mountReply($, text, surface, columns)
            const count = await ui.find({ key: 'fold-count' })
            expect(count?.text).toMatch(/^▸ \d+ more lines$/)
            expect(nodesOf(count).some((node) => node.props?.wrap !== undefined)).toBe(false)
            const lines = await linesOf(ui, columns)
            const row = lines.findIndex((line) => line.includes(count?.text ?? '▸'))
            const buttons = lines.findIndex((line) => line.includes('[ more ]'))
            expect(row).toBeGreaterThanOrEqual(0)
            expect(lines[row]).not.toContain('…')
            if (columns < NARROW_BELOW) expect(buttons).toBeGreaterThan(row)
            else expect(buttons).toBe(row)
            await ui.unmount()
          }
        },
      )

      markTest(
        `a folded reply with no hidden block shows only the count, and the open reply shows the open mark, at ${String(columns)} columns on ${surface}`,
        async (_world, $) => {
          const ui = await mountReply($, together(TABLE, PROSE), surface, columns)
          const text = (await ui.find({ key: 'fold-row' }))?.text ?? ''
          expect(text).toMatch(/^▸ \d+ more lines/)
          expect(text).not.toContain('table')
          await ui.press({ key: 'fold' })
          expect((await ui.find({ key: 'fold-row' }))?.text).toMatch(/^▾/)
          await ui.unmount()
        },
      )
    }

    markTest(
      `the list of kinds is cut before the count at 64 columns on ${surface}`,
      async (_world, $) => {
        const many = together(PROSE, TABLE, FENCE, FLOW, CHART, SECOND_FENCE, LONG_CODE)
        const ui = await mountReply($, many, surface, 64)
        const row = await ui.find({ key: 'fold-row' })
        const [count, kinds] = (row?.children ?? []) as DrawnNode[]
        expect(count?.props?.flexShrink).toBe(0)
        expect(kinds?.props?.flexShrink).toBe(1)
        const list = (kinds?.children ?? [])[0] as DrawnNode | undefined
        expect(list?.props?.wrap).toBe('truncate-end')
        expect(row?.text).toMatch(/^▸ \d+ more lines · /)
        await ui.unmount()
      },
    )
  }
})
