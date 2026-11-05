import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { bodyWidth, lines, SURFACES, viewTest, WIDTHS, type Surface } from './fixtures/diagram-view'
import { displayWidth } from './hooks/width'

const BOX = lines(
  '┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌──────────────┐',
  '│ Claude Code  │────▶│ handily-reply-   │────▶│ handily-board    │────▶│ git hooks    │',
  '│ the engine   │     │ view draws       │     │ shows the tasks  │     │ enforce      │',
  '└──────────────┘     └──────────────────┘     └──────────────────┘     └──────────────┘',
)

const TREE = lines(
  'mods/',
  '├── handily-reply-view/',
  '│   ├── hooks/draw.ts            draws each block of a reply',
  '│   └── hooks/flowchart.ts       lays out the boxes and the edges of a flowchart',
  '└── handily-board/',
)

const TABLE = lines(
  '+------------+----------------------+-------------------------------------------+',
  '| Mod        | Surface              | What it shows                             |',
  '+------------+----------------------+-------------------------------------------+',
  '| reply-view | terminal and desktop | tables, code blocks and mermaid diagrams  |',
  '+------------+----------------------+-------------------------------------------+',
)

const NARROW_BOX = lines('┌──────┐', '│ Done │', '└──────┘')

const COMMAND =
  'npm ci && npm run types && npm run typecheck && npm run lint && npm test -- --reporter verbose --bail 1'

type Sample = { name: string; tag: string; content: string }

const DRAWINGS: readonly Sample[] = [
  { name: 'a box drawing', tag: 'text', content: BOX },
  { name: 'a tree', tag: '', content: TREE },
  { name: 'an ASCII table', tag: 'text', content: TABLE },
]

function fenced(sample: Sample): string {
  return ['Here it is:', '', `\`\`\`${sample.tag}`, sample.content, '```'].join('\n')
}

async function mountCode($: Engine, text: string, surface: Surface, columns: number) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId: 'message-1',
    viewport: { columns, rows: 40 },
  })
}

function widest(content: string): number {
  return Math.max(...content.split('\n').map(displayWidth))
}

function cutNote(columns: number, screen: number): string {
  return `drawing cut: it takes ${String(columns)} columns, the screen has ${String(screen)}. Widen the window to see this drawing.`
}

describe('a drawing in a code block that is wider than the body', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      for (const sample of DRAWINGS) {
        const width = bodyWidth(surface, columns)
        const isWide = widest(sample.content) > width
        viewTest(
          `${sample.name} at ${String(columns)} columns on ${surface} ${isWide ? 'keeps each line whole under a note' : 'draws as today'}`,
          async (world, $) => {
            const ui = await mountCode($, fenced(sample), surface, columns)
            const code = await ui.find({ type: 'Code' })
            expect(code?.props.source).toBe(sample.content)
            const note = await ui.find({ type: 'Text', text: /^drawing cut:/ })
            if (isWide) {
              expect(code?.props.wrap).toBe('truncate-end')
              expect(note?.text).toBe(cutNote(widest(sample.content), width))
              expect(note?.props.dimColor).toBe(true)
            } else {
              expect(code?.props.wrap).toBeUndefined()
              expect(note).toBeUndefined()
            }
            await ui.press({ key: 'block-1-copy' })
            expect(world.copies).toEqual([sample.content])
            await ui.unmount()
          },
        )
      }
    }
  }

  viewTest('a drawing that fits the body draws with no note and no cut', async (_world, $) => {
    const ui = await mountCode(
      $,
      fenced({ name: '', tag: '', content: NARROW_BOX }),
      'terminal',
      30,
    )
    expect((await ui.find({ type: 'Code' }))?.props.wrap).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^drawing cut:/ })).toBeUndefined()
    await ui.unmount()
  })

  viewTest(
    'a long line in a code block that holds no drawing wraps as today with no note',
    async (world, $) => {
      const ui = await mountCode(
        $,
        fenced({ name: '', tag: 'sh', content: COMMAND }),
        'terminal',
        80,
      )
      expect((await ui.find({ type: 'Code' }))?.props.wrap).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^drawing cut:/ })).toBeUndefined()
      await ui.press({ key: 'block-1-copy' })
      expect(world.copies).toEqual([COMMAND])
      await ui.unmount()
    },
  )

  viewTest(
    'a reply with a wide drawing counts one row for each line, so it does not fold',
    async (_world, $) => {
      const row = `│${' '.repeat(98)}│`
      const tall = [`┌${'─'.repeat(98)}┐`, ...Array<string>(23).fill(row), `└${'─'.repeat(98)}┘`]
      const content = tall.join('\n')
      const ui = await mountCode($, fenced({ name: '', tag: '', content }), 'terminal', 80)
      expect(await ui.find({ type: 'Text', text: /more line/ })).toBeUndefined()
      expect((await ui.find({ type: 'Code' }))?.props.source).toBe(content)
      await ui.unmount()
    },
  )

  viewTest('the preview of a long reply keeps the note above a cut drawing', async (_world, $) => {
    const row = `│${' '.repeat(98)}│`
    const tall = [`┌${'─'.repeat(98)}┐`, ...Array<string>(38).fill(row), `└${'─'.repeat(98)}┘`]
    const ui = await mountCode(
      $,
      fenced({ name: '', tag: '', content: tall.join('\n') }),
      'terminal',
      80,
    )
    expect((await ui.find({ type: 'Text', text: /^drawing cut:/ }))?.text).toBe(cutNote(100, 78))
    const shown = (await ui.find({ type: 'Code' }))?.props.source
    expect(typeof shown === 'string' ? shown.split('\n').length : 0).toBe(30 - 2 - 2 - 1)
    expect((await ui.find({ type: 'Text', text: /more line/ }))?.text).toBe('… 15 more lines')
    await ui.unmount()
  })
})

const LONG_CODE = 'return compose(parse(source), validate(schema), render(template, options))'
const LONG_URL =
  '  Downloading https://files.pythonhosted.org/packages/ab/cd/requests-2.32.3-py3-none-any.whl (64 kB)'

const ORDINARY_CODE: readonly Sample[] = [
  {
    name: 'a diff that adds a rule and a comment',
    tag: 'diff',
    content: lines('+---', '+-- comment', `+${LONG_CODE}`),
  },
  {
    name: 'a diff with no tag that adds a rule and a comment',
    tag: '',
    content: lines('+---', '+-- comment', `+${LONG_CODE}`),
  },
  {
    name: 'a python block with a ruled comment',
    tag: 'python',
    content: lines('# ─── helpers ───', 'def run(source):', `    ${LONG_CODE}`),
  },
  {
    name: 'a python block with no tag and one ruled comment',
    tag: '',
    content: lines('# ─── helpers ───', 'def run(source):', `    ${LONG_CODE}`),
  },
  {
    name: 'a text block that names a flag in backticks',
    tag: 'text',
    content: lines(
      '`--force` overwrites the branch on the remote, so use it only on a branch of your own',
      '`--force-with-lease` refuses when the remote moved',
    ),
  },
  {
    name: 'a pip log with progress bars',
    tag: '',
    content: lines(
      'Collecting requests',
      LONG_URL,
      '     ━━━━━━━━━━━━━━━━━━━━━━ 64.9/64.9 kB 2.1 MB/s',
      'Collecting idna',
      LONG_URL,
      '     ━━━━━━━━━━━━━━━━━━━━━━ 70.4/70.4 kB 3.0 MB/s',
    ),
  },
  {
    name: 'a box drawing in a python block',
    tag: 'python',
    content: BOX,
  },
]

const ARROWS = lines(
  'client ---> gateway ---> service ---> database ---> cache',
  'worker <--- scheduler',
)

const CORNERS = lines(
  `+-+${' '.repeat(40)}+-+`,
  `| |${' '.repeat(40)}| |`,
  `+-+${' '.repeat(40)}+-+`,
)

describe('the rule that tells a drawing from ordinary code', () => {
  for (const sample of ORDINARY_CODE) {
    viewTest(`${sample.name} wraps at 40 columns with no note`, async (_world, $) => {
      const ui = await mountCode($, fenced(sample), 'terminal', 40)
      expect((await ui.find({ type: 'Code' }))?.props.wrap).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^drawing cut:/ })).toBeUndefined()
      await ui.unmount()
    })
  }

  for (const [name, content] of [
    ['arrows of dashes with a head', ARROWS],
    ['boxes with plus corners', CORNERS],
  ] as const) {
    viewTest(`a drawing of ${name} is cut at 40 columns under the note`, async (_world, $) => {
      const ui = await mountCode($, fenced({ name, tag: '', content }), 'terminal', 40)
      expect((await ui.find({ type: 'Code' }))?.props.wrap).toBe('truncate-end')
      expect((await ui.find({ type: 'Text', text: /^drawing cut:/ }))?.text).toBe(
        cutNote(widest(content), 38),
      )
      await ui.unmount()
    })
  }
})
