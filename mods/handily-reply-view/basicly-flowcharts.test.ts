import { describe, expect, test } from 'claude-code/testing'
import {
  drawnRows,
  lines,
  mountDiagram,
  noteOf,
  rowText,
  SURFACES,
  tooWideRows,
  viewTest,
} from './fixtures/diagram-view'
import { diagramOf } from './hooks/draw'

const COUNCIL = lines(
  'flowchart TD',
  '  q["Should the #quot;reply view#quot; draw every basicly diagram in one row of boxes that i..."]',
  '  o0["A: 2 of 4"]',
  '  o1["B: 1 of 4"]',
  '  nr["not run"]',
  '  q --> v0["skeptic: A"]',
  '  v0 --> o0',
  '  q --> v1["builder: B"]',
  '  v1 --> o1',
  '  q --> v2["user: A"]',
  '  v2 --> o0',
  '  q --> v3["late: not run"]',
  '  v3 --> nr',
  '  d["decision: A"]',
  '  o0 ==> d',
  '  v1 -. dissent .-> d',
)

const NO_WINNER = lines(
  'flowchart TD',
  '  q["Should the #quot;reply view#quot; draw every basicly diagram in one row of boxes that i..."]',
  '  o0["A: 1 of 2"]',
  '  o1["B: 1 of 2"]',
  '  nr["not run"]',
  '  q --> v0["x: A"]',
  '  v0 --> o0',
  '  q --> v1["y: B"]',
  '  v1 --> o1',
  '  d["decision: none, the user decides"]',
)

const SWARM = lines(
  'flowchart TD',
  '  q["Should the #quot;reply view#quot; draw every basicly diagram in one row of boxes that i..."]',
  '  q --> l0["correctness: fail"]',
  '  l0 --> f0_0["high: the #quot;fold#quot; drops a row"]',
  '  l0 --> f0_1["low: name"]',
  '  q --> l1["security: not run"]',
  '  r["result: incomplete, a lens did not run"]',
  '  l0 --> r',
  '  l1 --> r',
)

const SAMPLES = [
  { name: 'council', source: COUNCIL },
  { name: 'council with no winner', source: NO_WINNER },
  { name: 'swarm', source: SWARM },
] as const

function drawnText(source: string, width: number): string {
  const drawn = diagramOf(source, width, 'terminal')
  if (drawn.kind !== 'drawing') throw new Error(drawn.reason)
  return drawn.lines.join('\n')
}

describe('basicly flowcharts', () => {
  test('a dotted link with a label draws its label in the council diagram', () => {
    expect(drawnText(COUNCIL, 78)).toContain('dissent')
  })

  test('a dotted link with a label draws a dashed line as the plain dotted link does', () => {
    const labelled = drawnText(lines('flowchart TD', '  a["one"] -. why .-> b["two"]'), 78)
    const plain = drawnText(lines('flowchart TD', '  a["one"] -.->|why| b["two"]'), 78)
    expect(labelled).toBe(plain)
  })

  test('the quot entity in a label draws a double quote', () => {
    const text = drawnText(SWARM, 78)
    expect(text).not.toContain('#quot;')
    expect(text).toContain('"fold"')
  })

  test('a numeric entity in a label draws its character', () => {
    expect(drawnText(lines('flowchart TD', '  a["x #35; y"]'), 78)).toContain('x # y')
  })

  for (const surface of SURFACES) {
    for (const { name, source } of SAMPLES) {
      viewTest(
        `the basicly ${name} flowchart draws and every line fits the body on ${surface} at 80 columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, source, surface, 80)
          const rows = (await drawnRows(ui, surface)).map(rowText)
          expect(rows.length).toBeGreaterThan(0)
          expect(tooWideRows(rows, surface, 80)).toEqual([])
          await ui.unmount()
        },
      )

      viewTest(
        `the basicly ${name} flowchart wider than the screen shows the width note on ${surface} at 40 columns`,
        async (_world, $) => {
          const ui = await mountDiagram($, source, surface, 40)
          expect(await noteOf(ui)).toStartWith('diagram not drawn: it takes')
          await ui.unmount()
        },
      )
    }
  }
})
