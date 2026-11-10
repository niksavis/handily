import { describe, expect, test } from 'claude-code/testing'
import {
  CYCLE,
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

const WORKING_DAY = lines(
  'journey',
  '    title My working day',
  '    section Go to work',
  '      Make tea: 5: Me',
  '      Go upstairs: 3: Me',
  '      Do work: 1: Me, Cat',
  '    section Go home',
  '      Go downstairs: 5: Me',
  '      Sit down: 5: Me',
)

const WORKING_DAY_ROWS = [
  'My working day',
  `┄┄ Go to work ${'┄'.repeat(17)}`,
  '█████ 5  Make tea       Me',
  '███░░ 3  Go upstairs    Me',
  '█░░░░ 1  Do work        Me, Cat',
  `┄┄ Go home ${'┄'.repeat(20)}`,
  '█████ 5  Go downstairs  Me',
  '█████ 5  Sit down       Me',
]

const NARROW_ROWS = [
  'My working day',
  `┄┄ Go to work ${'┄'.repeat(8)}`,
  '█████ 5  Make tea',
  '         Me',
  '███░░ 3  Go upstairs',
  '         Me',
  '█░░░░ 1  Do work',
  '         Me, Cat',
  `┄┄ Go home ${'┄'.repeat(11)}`,
  '█████ 5  Go downstairs',
  '         Me',
  '█████ 5  Sit down',
  '         Me',
]

const LONG = lines(
  'journey',
  ...Array.from({ length: 70 }, (_, at) => `  Step ${String(at)}<br>and more: 3: Me, Cat`),
)

function drawnLines(source: string, width = 78): string[] {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines
}

function refusedLine(line: number | null, reason: string) {
  return { kind: 'refused', reason, line, limit: null }
}

describe('a mermaid user journey', () => {
  for (const surface of SURFACES) {
    for (const columns of WIDTHS) {
      viewTest(
        `a user journey draws a score bar for each task under its section and every line fits the body on ${surface} at ${String(columns)} columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, WORKING_DAY, surface, columns)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(tooWideRows(rows, surface, columns)).toEqual([])
          expect(rows).toEqual(columns === 30 ? NARROW_ROWS : WORKING_DAY_ROWS)
          expect(await titleOf(ui)).toStartWith('── mermaid · journey ──')
          await ui.unmount()
        },
      )
    }

    viewTest(
      `copy on a drawn user journey copies the source as written and copy drawing copies the drawn lines on ${surface}`,
      async (world, $) => {
        const ui = await mountDiagram($, WORKING_DAY, surface)
        const rows = (await drawnRows(ui, surface)).map(rowText)
        await ui.press({ key: 'block-1-copy' })
        await ui.press({ key: 'block-1-drawing' })
        expect(world.copies).toEqual([WORKING_DAY, rows.join('\n')])
        expect(world.toasts.map((toast) => toast.split(/\s{2,}/))).toEqual([
          ['✓ Copied the journey source', '9 lines'],
          ['✓ Copied the journey drawing', '8 lines'],
        ])
        await ui.unmount()
      },
    )

    for (const [what, source, note] of [
      ['a header it does not know', lines('journey LR', '  Tea: 5: Me'), 'line 1 does not parse'],
      ['a task with no score', lines('journey', '  Make tea'), 'line 2 does not parse'],
      [
        'a score that is not a number',
        lines('journey', '  Make tea: high: Me'),
        'line 2: "high" is not a number',
      ],
      [
        'a score above 5',
        lines('journey', '  Make tea: 7: Me'),
        'line 2: the score 7 is not from 1 to 5',
      ],
      ['no task', lines('journey', '  title Only a title'), 'the journey has no tasks'],
      ['more than 120 rows', LONG, '140 rows, at most 120 draw'],
    ] as const) {
      viewTest(
        `a user journey with ${what} shows its source under a note that names the reason on ${surface}`,
        async (world, $) => {
          const ui = await mountDiagram($, source, surface)
          expect(await noteOf(ui)).toBe(`diagram not drawn: ${note}.`)
          const shown = await shownSource(ui)
          const lines = source.split('\n').slice(0, 15)
          expect(lines.filter((line) => !shown.includes(line.trim()))).toEqual([])
          expect(await ui.find({ key: 'block-1-drawing' })).toBeUndefined()
          await ui.press({ key: 'block-1-copy' })
          expect(world.copies).toEqual([source])
          await ui.unmount()
        },
      )
    }

    viewTest(
      `a user journey too wide for a narrow screen shows its source under the width note on ${surface}`,
      async (_world, $) => {
        const ui = await mountDiagram($, WORKING_DAY, surface, 18)
        const screen = surface === 'terminal' ? 16 : 18
        expect(await noteOf(ui)).toBe(tooWideNote(19, screen))
        await ui.unmount()
      },
    )
  }

  viewTest(
    'a user journey draws each section and its bars in its cycle colour and the actors dim on terminal',
    async (_world, $) => {
      const ui = await mountDiagram($, WORKING_DAY, 'terminal')
      const rows = await drawnRows(ui, 'terminal')
      const looks = (at: number) =>
        (rows[at] ?? [])
          .filter((span) => span.text.trim() !== '')
          .map((span) => [span.text, span.style])
      const [first, second] = CYCLE
      expect([0, 1, 3, 6].map(looks)).toEqual([
        [['My working day', { bold: true }]],
        [
          ['┄┄ ', { color: 'inactive' }],
          ['Go to work', { color: first, bold: true }],
          [` ${'┄'.repeat(17)}`, { color: 'inactive' }],
        ],
        [
          ['███', { color: first }],
          ['░░', { color: 'inactive' }],
          [' 3  ', { color: first }],
          ['Go upstairs    ', {}],
          ['Me', { color: 'inactive' }],
        ],
        [
          ['█████ 5  ', { color: second }],
          ['Go downstairs  ', {}],
          ['Me', { color: 'inactive' }],
        ],
      ])
      await ui.unmount()
    },
  )

  test('a score with a fraction draws an eighth of a cell and its number as written', () => {
    expect(drawnLines(lines('journey', '  Wait: 3.5: Me', '  Leave: 4: Me'))).toEqual([
      '███▌░ 3.5  Wait   Me',
      '████░ 4    Leave  Me',
    ])
  })

  test('a task before any section, a task with no actor and a long name draw with no rule', () => {
    const source = lines(
      'journey',
      '  Arrive at the office early and find the coffee machine broken again: 2',
      '  Leave: 4: Me',
    )
    expect(drawnLines(source, 40)).toEqual([
      '██░░░ 2  Arrive at the office early and',
      '         find the coffee machine broken',
      '         again',
      '████░ 4  Leave',
      '         Me',
    ])
  })

  test('a task whose name is only a line break draws its score with an empty name', () => {
    expect(drawnLines(lines('journey', '  <br>: 3', '  Next: 4'))).toEqual([
      '███░░ 3',
      '████░ 4  Next',
    ])
  })

  test('keywords in any case, comments, accessibility lines, a third colon and empty actors draw as Mermaid reads them', () => {
    const source = lines(
      'journey',
      '  accTitle: A day',
      '  accDescr: The steps of a day',
      '  TITLE A day # with a comment',
      '  Section Morning %% a comment',
      '  Make tea: 5: Me,, Cat: ignored',
    )
    expect(drawnLines(source)).toEqual([
      'A day',
      `┄┄ Morning ${'┄'.repeat(15)}`,
      '█████ 5  Make tea  Me, Cat',
    ])
  })

  for (const [source, line, reason] of [
    [lines('journey', '  Make tea'), 2, 'line 2 does not parse'],
    [lines('journey', '  Make tea:'), 2, 'line 2 does not parse'],
    [lines('journey', '  : 5: Me'), 2, 'line 2 does not parse'],
    [lines('journey', '  section Go: home'), 2, 'line 2 does not parse'],
    [lines('journey', '  Make tea; now: 5'), 2, 'line 2 does not parse'],
    [lines('journey', '  Make tea: 0: Me'), 2, 'line 2: the score 0 is not from 1 to 5'],
    [lines('journey', '  T: -1: Me'), 2, 'line 2: the score -1 is not from 1 to 5'],
    [lines('journey', '  Make tea: : Me'), 2, 'line 2: "" is not a number'],
    [lines('journey', '  Make tea: 0x5: Me'), 2, 'line 2: "0x5" is not a number'],
    [lines('journey X'), 1, 'line 1 does not parse'],
    [lines('journey', '  section Empty'), null, 'the journey has no tasks'],
  ] as const) {
    test(`a user journey refuses ${line === null ? 'the block' : `line ${String(line)}`} with the reason ${reason}`, () => {
      expect(parseMermaid(source)).toEqual(refusedLine(line, reason))
    })
  }
})
