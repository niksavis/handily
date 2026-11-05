import { describe, expect, test } from 'claude-code/testing'
import { DIAGRAM_HINT, diagramHint, UNDRAWN_STATEMENTS } from './hooks/hint'
import { DRAWN_DIAGRAM_KINDS, parseMermaid } from './hooks/mermaid'
import { drawsSample, KIND_SAMPLES, MERMAID_KINDS, namesKind } from './fixtures/mermaid-kinds'

const UNDRAWN_SAMPLES: Readonly<Record<string, string>> = {
  subgraph: 'flowchart TD\n  A --> B\n  subgraph one\n  C\n  end',
  direction: 'flowchart TD\n  direction LR',
  box: 'sequenceDiagram\n  box Aqua Group\n  participant A\n  end',
  create: 'sequenceDiagram\n  A->>B: hi\n  create participant C',
  destroy: 'sequenceDiagram\n  A->>B: hi\n  destroy B',
}

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

describe('the diagram hint', () => {
  test('the hint names the kinds of the drawn list in its order and no other Mermaid kind', () => {
    expect(DIAGRAM_HINT).toBe(diagramHint(DRAWN_DIAGRAM_KINDS))
    expect(DIAGRAM_HINT).toContain(`These kinds draw: ${DRAWN_DIAGRAM_KINDS.join(', ')}.`)
    expect(MERMAID_KINDS.filter((kind) => namesKind(DIAGRAM_HINT, kind))).toEqual(
      MERMAID_KINDS.filter((kind) => DRAWN_DIAGRAM_KINDS.includes(kind)),
    )
  })

  test('a kind added to the drawn list joins the hint text', () => {
    const grown = diagramHint([...DRAWN_DIAGRAM_KINDS, 'xychart-beta'])
    expect(grown).not.toBe(DIAGRAM_HINT)
    expect(namesKind(DIAGRAM_HINT, 'xychart-beta')).toBe(false)
    expect(grown).toContain(`These kinds draw: ${DRAWN_DIAGRAM_KINDS.join(', ')}, xychart-beta.`)
  })

  test('each statement that the hint forbids is refused by the parser by its name', () => {
    expect(UNDRAWN_STATEMENTS.map((word) => refusalReason(UNDRAWN_SAMPLES[word] ?? ''))).toEqual(
      UNDRAWN_STATEMENTS.map((word) => `${word} does not draw yet`),
    )
    expect(DIAGRAM_HINT).toContain('Do not use subgraph, direction, box, create or destroy.')
  })

  test('the hint keeps the limits of the parser and its guidance on labels and prose', () => {
    expect(DIAGRAM_HINT).toContain('Use at most 40 boxes and 12 participants.')
    expect(DIAGRAM_HINT).toContain('Keep each label short.')
    expect(DIAGRAM_HINT).toContain('The reply must read well without the diagram.')
  })
})
