import { describe, expect, test } from 'claude-code/testing'
import {
  CYCLE,
  bodyWidth,
  drawnRows,
  lines,
  mountDiagram,
  noteOf,
  rowText,
  shownSource,
  SURFACES,
  titleOf,
  tooWideNote,
  tooWideRows,
  viewTest,
  WIDTHS,
} from './fixtures/diagram-view'
import { diagramOf } from './hooks/draw'
import { parseMermaid } from './hooks/mermaid'

const CHERRY_PICK = lines(
  'gitGraph',
  '    commit id: "ZERO"',
  '    branch develop',
  '    branch release',
  '    commit id:"A"',
  '    checkout main',
  '    commit id:"ONE"',
  '    checkout develop',
  '    commit id:"B"',
  '    checkout main',
  '    merge develop id:"MERGE"',
  '    commit id:"TWO"',
  '    checkout release',
  '    cherry-pick id:"MERGE" parent:"B"',
  '    commit id:"THREE"',
  '    checkout develop',
  '    commit id:"C"',
)

const CHERRY_PICK_ROWS = [
  '╷ main',
  '● ZERO',
  '├─╮ develop',
  '├─│─╮ release',
  '│ │ ● A',
  '● │ │ ONE',
  '│ ● │ B',
  '◉─┤ │ MERGE merge develop',
  '● │ │ TWO',
  '  │ ● cherry-pick of MERGE',
  '  │ ● THREE',
  '  ● C',
]

const MERGE = lines(
  'gitGraph',
  '   commit id: "1"',
  '   commit id: "2"',
  '   branch nice_feature',
  '   checkout nice_feature',
  '   commit id: "3"',
  '   checkout main',
  '   commit id: "4"',
  '   checkout nice_feature',
  '   branch very_nice_feature',
  '   checkout very_nice_feature',
  '   commit id: "5"',
  '   checkout main',
  '   commit id: "6"',
  '   checkout nice_feature',
  '   commit id: "7"',
  '   checkout main',
  '   merge nice_feature id: "customID" tag: "customTag" type: REVERSE',
  '   checkout very_nice_feature',
  '   commit id: "8"',
  '   checkout main',
  '   commit id: "9"',
)

const MERGE_ROWS = [
  '╷ main',
  '● 1',
  '● 2',
  '├─╮ nice_feature',
  '│ ● 3',
  '│ ├─╮ very_nice_feature',
  '● │ │ 4',
  '│ │ ● 5',
  '● │ │ 6',
  '│ ● │ 7',
  '⊗─╯ │ customID merge nice_feature (tag: customTag)',
  '│   ● 8',
  '● 9',
]

const MANY_BRANCHES = lines(
  'gitGraph',
  ...'abcdefghijk'.split('').map((name) => `  branch ${name}`),
  '  branch l order: 99',
  '  commit id: "a long commit label"',
)

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function refusedLine(line: number, reason: string) {
  return { kind: 'refused', reason, line, limit: null }
}

describe('a mermaid git graph', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a git graph draws one lane per branch and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, CHERRY_PICK, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(rows).toEqual(CHERRY_PICK_ROWS)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(await titleOf(ui)).toStartWith('── mermaid · gitgraph ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn git graph copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, CHERRY_PICK, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([CHERRY_PICK, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the gitgraph source', '17 lines'],
          ['✓ Copied the gitgraph drawing', '12 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, columns, note] of [
      ['the direction BT', lines('gitGraph BT:', '  commit'), 80, 'gitGraph BT does not draw yet'],
      [
        'a checkout of a branch that does not exist',
        lines('gitGraph', '  commit', '  checkout dev'),
        80,
        'line 3: the branch dev does not exist',
      ],
      [
        'a commit with a key it does not know',
        lines('gitGraph', '  commit sha: "a"'),
        80,
        'line 2 does not parse',
      ],
    ] as const) {
      viewTest(
        `a git graph with ${what} shows its source under a note that names the reason on ${surface}`,
        async (world, $) => {
          const ui = await mountDiagram($, source, surface, columns)
          expect(await noteOf(ui)).toBe(`diagram not drawn: ${note}.`)
          const shown = await shownSource(ui)
          expect(source.split('\n').filter((line) => !shown.includes(line.trim()))).toEqual([])
          expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([source])
          await ui.unmount()
        },
      )
    }

    viewTest(
      `a git graph too wide for 30 columns names its width and the remedy and shows its source on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, MANY_BRANCHES, surface, 30)
        expect(await noteOf(ui)).toBe(tooWideNote(36, bodyWidth(surface, 30)))
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([MANY_BRANCHES])
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a git graph draws each lane in its cycle colour and a merge join in the colour of the merged branch on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, CHERRY_PICK, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text, span.style])
      const [main, develop, release] = CYCLE
      expect([looks(0), looks(3), looks(7)]).toEqual([
        [
          ['╷', { color: main }],
          ['main', { color: main, bold: true }],
        ],
        [
          ['├', { color: main }],
          ['─', { color: release }],
          ['│', { color: develop }],
          ['─╮', { color: release }],
          ['release', { color: release, bold: true }],
        ],
        [
          ['◉', { color: main }],
          ['─┤', { color: develop }],
          ['│', { color: release }],
          [' MERGE ', {}],
          ['merge develop', { italic: true }],
        ],
      ])
      await ui.unmount()
    },
  )

  test('a label too wide for the screen wraps under its lanes and keeps every word', () => {
    expect(drawnLines(MERGE)).toEqual(MERGE_ROWS)
    expect(drawnLines(MERGE, 38).slice(10, 13)).toEqual([
      '⊗─╯ │ customID merge nice_feature',
      '│   │ (tag: customTag)',
      '│   ● 8',
    ])
  })

  test('commit types, tags, messages, a title, a quoted branch name and switch draw as written', () => {
    const source = lines(
      'gitGraph TB:',
      '  title Release flow',
      '  commit id: "Normal" tag: "v1.0.0"',
      '  commit id: "Reverse" type: REVERSE',
      '  commit "fix the build" type: HIGHLIGHT',
      '  commit msg: "tidy" tag: "a" tag: "b"',
      '  branch "cherry-pick"',
      '  switch cherry-pick',
      "  commit id: 'x'",
      '  switch main',
      '  merge cherry-pick type: HIGHLIGHT',
    )
    expect(drawnLines(source)).toEqual([
      'Release flow',
      '╷ main',
      '● Normal (tag: v1.0.0)',
      '⊗ Reverse',
      '▮ fix the build',
      '● tidy (tag: a, tag: b)',
      '├─╮ cherry-pick',
      '│ ● x',
      '▮─╯ merge cherry-pick',
    ])
  })

  test('main comes first, then branches with no order as written, then by their order', () => {
    const source = lines(
      'gitGraph',
      '  commit',
      '  branch test1 order: 3',
      '  branch test2 order: 2',
      '  branch test3 order: 1',
    )
    expect(drawnLines(source)).toEqual(['╷ main', '●', '├────── test1', '├──── test2', '╰── test3'])
  })

  test('the directions LR and TB draw as the graph with no direction', () => {
    const body = MERGE.split('\n').slice(1)
    expect(drawnLines(lines('gitGraph LR:', ...body))).toEqual(MERGE_ROWS)
    expect(drawnLines(lines('gitGraph TB:', ...body))).toEqual(MERGE_ROWS)
    expect(drawnLines(lines('gitGraph:', ...body))).toEqual(MERGE_ROWS)
  })

  for (const [source, line, reason] of [
    [
      lines('gitGraph', '  commit', '  branch dev', '  branch dev'),
      4,
      'line 4: the branch dev exists already',
    ],
    [lines('gitGraph', '  merge main'), 2, 'line 2: a branch cannot merge itself'],
    [
      lines('gitGraph', '  commit', '  merge main'),
      3,
      'line 3: the branch main cannot merge into itself',
    ],
    [
      lines('gitGraph', '  commit', '  branch dev', '  checkout main', '  merge dev'),
      5,
      'line 5: both branches have the same head',
    ],
    [
      lines('gitGraph', '  branch dev', '  commit', '  checkout main', '  merge dev'),
      5,
      'line 5: the branch main has no commits',
    ],
    [lines('gitGraph', '  commit', '  cherry-pick id: "x"'), 3, 'line 3: no commit has the id x'],
    [
      lines('gitGraph', '  commit id: "a"', '  cherry-pick id: "a"'),
      3,
      'line 3: the commit a is on this branch',
    ],
    [
      lines(
        'gitGraph',
        '  commit id: "a"',
        '  branch dev',
        '  commit id: "b"',
        '  checkout main',
        '  merge dev id: "m"',
        '  branch rel',
        '  commit',
        '  cherry-pick id: "m"',
      ),
      9,
      'line 9: the merge commit m needs the id of a parent',
    ],
    [lines('gitGraph', '  commit', '  cherry-pick'), 3, 'line 3 does not parse'],
    [lines('gitGraph', '  commit type: SQUARE'), 2, 'line 2 does not parse'],
    [lines('gitGraph', '  branch dev order: first'), 2, 'line 2 does not parse'],
    [lines('gitGraph LR', '  commit'), 1, 'line 1 does not parse'],
    [lines('gitGraph BT:', '  commit'), 1, 'gitGraph BT does not draw yet'],
  ] as const) {
    test(`a git graph refuses line ${String(line)} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})

describe('git graph review findings (handily-2dpxv0.1)', () => {
  test('a branch made from an older commit starts its lane right under that commit', () => {
    const source = lines(
      'gitGraph',
      '  commit id:"A"',
      '  branch dev',
      '  checkout main',
      '  commit id:"B"',
      '  checkout dev',
      '  branch feat',
      '  commit id:"F"',
    )
    expect(drawnLines(source)).toEqual([
      '╷ main',
      '● A',
      '├── dev',
      '├───╮ feat',
      '●   │ B',
      '    ● F',
    ])
  })

  test('a merge of a branch with no commits joins from the lane of that branch, not from a newer commit', () => {
    const source = lines(
      'gitGraph',
      '  commit id:"A"',
      '  branch dev',
      '  commit id:"B"',
      '  branch feat',
      '  checkout dev',
      '  commit id:"C"',
      '  checkout main',
      '  merge feat id:"M"',
    )
    expect(drawnLines(source)).toEqual([
      '╷ main',
      '● A',
      '├─╮ dev',
      '│ ● B',
      '│ ├─╮ feat',
      '│ ● │ C',
      '◉───╯ M merge feat',
    ])
  })

  test('a branch with order 0 sorts after main and before the branches with no order, as Mermaid sorts them', () => {
    const source = lines('gitGraph', '  commit', '  branch b0 order: 0', '  branch b1')
    expect(drawnLines(source)).toEqual(['╷ main', '●', '├── b0', '╰──── b1'])
  })

  test('branches with no order sort by the number 0 and their index, as Mermaid sorts them', () => {
    const names = Array.from({ length: 11 }, (_, at) => `b${String(at + 1)}`)
    const drawn = drawnLines(lines('gitGraph', ...names.map((name) => `  branch ${name}`)))
    const lanes = Object.fromEntries(
      drawn.slice(1).map((row) => [row.slice(row.indexOf('╷') + 2), row.indexOf('╷') / 2]),
    )
    expect(['b1', 'b10', 'b11', 'b2', 'b9'].map((name) => lanes[name])).toEqual([1, 2, 3, 4, 11])
  })

  test('a cherry-pick with a parent that is an immediate parent of a plain commit draws', () => {
    const source = lines(
      'gitGraph',
      '  commit id:"p"',
      '  commit id:"a"',
      '  branch dev',
      '  commit',
      '  cherry-pick id:"a" parent:"p"',
    )
    expect(drawnLines(source).at(-1)).toBe('  ● cherry-pick of a')
  })

  for (const [what, source, line, reason] of [
    [
      'a merge into the branch that the head came from',
      lines(
        'gitGraph',
        '  commit',
        '  branch dev',
        '  commit id:"X"',
        '  branch feat',
        '  checkout dev',
        '  commit id:"Y"',
        '  checkout feat',
        '  merge dev',
      ),
      9,
      'line 9: the branch dev cannot merge into itself',
    ],
    [
      'a merge id that exists already',
      lines(
        'gitGraph',
        '  commit id:"a"',
        '  branch dev',
        '  commit',
        '  checkout main',
        '  merge dev id:"a"',
      ),
      6,
      'line 6: the commit id a exists already',
    ],
    [
      'a commit id that exists already, which a cherry-pick of the last one would hide',
      lines(
        'gitGraph',
        '  commit id:"a"',
        '  branch dev',
        '  commit id:"a"',
        '  checkout main',
        '  commit',
        '  cherry-pick id:"a"',
      ),
      4,
      'line 4: the commit id a exists already',
    ],
    [
      'a parent that is not an immediate parent of a plain commit',
      lines(
        'gitGraph',
        '  commit id:"p"',
        '  commit id:"a"',
        '  branch dev',
        '  commit',
        '  cherry-pick id:"a" parent:"x"',
      ),
      6,
      'line 6: the commit a has no parent x',
    ],
  ] as const) {
    test(`a git graph refuses ${what}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }

  const INIT = '%%{init: {"gitGraph": {"mainBranchName": "trunk"}}}%%'

  for (const [kind, body] of [
    ['gitGraph', lines('gitGraph', '  commit')],
    ['flowchart', lines('flowchart TD', '  A --> B')],
    ['sequenceDiagram', lines('sequenceDiagram', '  A->>B: hi')],
    ['mindmap', lines('mindmap', '  root')],
    ['timeline', lines('timeline', '  2002 : a')],
    ['stateDiagram-v2', lines('stateDiagram-v2', '  [*] --> A')],
    ['classDiagram', lines('classDiagram', '  A <|-- B')],
    ['erDiagram', lines('erDiagram', '  A ||--o{ B : has')],
  ] as const) {
    test(`a ${kind} with an init directive is refused by name, so no setting is lost`, () => {
      expect(parseMermaid(lines(INIT, body))).toEqual(
        refusedLine(1, '%%{init}%% does not draw yet'),
      )
    })
  }

  for (const surface of SURFACES) {
    viewTest(
      `a git graph with an init directive shows its source under a note that names it on ${surface}`,
      async (world, $) => {
        const source = lines(INIT, 'gitGraph', '  commit')
        const ui = await mountDiagram($, source, surface)
        expect(await noteOf(ui)).toBe('diagram not drawn: %%{init}%% does not draw yet.')
        expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
        await ui.press({ key: 'block-1-copy' })
        expect(world.copies).toEqual([source])
        await ui.unmount()
      },
    )
  }
})
