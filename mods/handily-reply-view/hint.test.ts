import { describe, expect, test } from 'claude-code/testing'
import { DIAGRAM_HINT, diagramHint, UNDRAWN_STATEMENTS } from './hooks/hint'
import { DRAWN_DIAGRAM_KINDS, parseMermaid } from './hooks/mermaid'
import { diagramOf } from './hooks/draw'
import { drawsSample, hintKinds, KIND_SAMPLES, MERMAID_KINDS } from './fixtures/mermaid-kinds'

const UNDRAWN_SAMPLES: Readonly<Record<string, string>> = {
  direction: 'flowchart TD\n  direction LR',
  box: 'sequenceDiagram\n  box Aqua Group\n  participant A\n  end',
  create: 'sequenceDiagram\n  A->>B: hi\n  create participant C',
  destroy: 'sequenceDiagram\n  A->>B: hi\n  destroy B',
}

const GROUPED = 'flowchart TD\n  subgraph Engine\n    A --> B\n  end\n  B --> C'
const NESTED = 'flowchart TD\n  subgraph one\n    subgraph two\n      A\n    end\n  end'

function refusalReason(source: string): string | null {
  const parsed = parseMermaid(source)
  return parsed.kind === 'refused' ? parsed.reason : null
}

describe('the drawn diagram kinds', () => {
  test('each kind in the drawn list is a Mermaid header keyword and draws its sample', () => {
    expect(DRAWN_DIAGRAM_KINDS.filter((kind) => !MERMAID_KINDS.includes(kind))).toEqual([])
    expect(DRAWN_DIAGRAM_KINDS.filter((kind) => !drawsSample(kind))).toEqual([])
  })

  test('each Mermaid kind outside the drawn list is refused by name on line 1', () => {
    const undrawn = MERMAID_KINDS.filter((kind) => !DRAWN_DIAGRAM_KINDS.includes(kind))
    expect(undrawn.map((kind) => refusalReason(kind))).toEqual(
      undrawn.map((kind) => `${kind} does not draw yet`),
    )
    expect(undrawn.filter((kind) => KIND_SAMPLES[kind] !== undefined)).toEqual([])
  })
})

describe('the names of the drawn kinds', () => {
  test('each drawn kind has a plain name for the fold row', () => {
    const names = DRAWN_DIAGRAM_KINDS.map((kind) => {
      const outcome = diagramOf(KIND_SAMPLES[kind] ?? '', 78, 'terminal')
      return outcome.kind === 'drawing' ? outcome.plain : `${kind} does not draw`
    })
    expect(names).toEqual([
      'flowchart',
      'sequence diagram',
      'state diagram',
      'class diagram',
      'ER diagram',
      'pie chart',
      'bar chart',
      'gantt chart',
      'git graph',
      'mind map',
      'timeline',
      'user journey',
      'quadrant chart',
      'kanban board',
      'packet diagram',
      'sankey diagram',
      'radar diagram',
      'treemap',
      'block diagram',
    ])
  })
})

describe('the diagram hint', () => {
  test('the hint names each Mermaid kind outside the drawn list, in the Mermaid order, and no drawn kind', () => {
    expect(DIAGRAM_HINT).toBe(diagramHint(DRAWN_DIAGRAM_KINDS))
    expect(DIAGRAM_HINT).toMatch(/Each Mermaid kind draws( except [^.]+)?\./)
    expect([...hintKinds(DIAGRAM_HINT)].sort()).toEqual([...DRAWN_DIAGRAM_KINDS].sort())
  })

  test('a kind added to the drawn list leaves the list of kinds that do not draw', () => {
    const grown = diagramHint([...DRAWN_DIAGRAM_KINDS, 'zenuml'])
    expect(grown).not.toBe(DIAGRAM_HINT)
    expect(hintKinds(DIAGRAM_HINT)).not.toContain('zenuml')
    expect(hintKinds(grown)).toContain('zenuml')
    expect(grown).not.toMatch(/except [^.]*zenuml/)
  })

  test('the hint names the C4 family once as C4 while none of its kinds draws', () => {
    const withoutC4 = DRAWN_DIAGRAM_KINDS.filter((kind) => !kind.startsWith('C4'))
    expect(diagramHint(withoutC4)).toMatch(/except [^.]*\bC4\b/)
    expect(diagramHint(withoutC4)).not.toContain('C4Context')
  })

  test('the hint says that each Mermaid kind draws when no kind is left out', () => {
    expect(diagramHint(MERMAID_KINDS)).toContain('Each Mermaid kind draws.')
  })

  test('each statement that the hint forbids is refused by the parser by its name', () => {
    expect(UNDRAWN_STATEMENTS.map((word) => refusalReason(UNDRAWN_SAMPLES[word] ?? ''))).toEqual(
      UNDRAWN_STATEMENTS.map((word) => `${word} does not draw yet`),
    )
    expect(DIAGRAM_HINT).toContain('Do not use direction, box, create or destroy.')
  })

  test('the hint allows a subgraph in a flowchart and the parser refuses one inside another', () => {
    expect(DIAGRAM_HINT).toContain('A flowchart is TD or LR and has no subgraph in a subgraph.')
    expect(diagramOf(GROUPED, 78, 'terminal').kind).toBe('drawing')
    expect(refusalReason(NESTED)).toBe('a subgraph inside a subgraph does not draw yet')
  })

  test('the hint keeps the limits of the parser and its guidance on labels and prose', () => {
    expect(DIAGRAM_HINT).toContain('Use at most 40 boxes and 12 participants.')
    expect(DIAGRAM_HINT).toContain('Keep each label short.')
    expect(DIAGRAM_HINT).toContain('The reply must read well without the diagram.')
  })
})
