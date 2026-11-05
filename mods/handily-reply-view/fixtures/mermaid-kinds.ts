import { diagramOf } from '../hooks/draw'

const SAMPLE_WIDTH = 78

export const MERMAID_KINDS: readonly string[] = [
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'C4Context',
  'mindmap',
  'timeline',
  'zenuml',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'kanban',
  'architecture-beta',
  'radar-beta',
  'treemap-beta',
]

export const KIND_SAMPLES: Readonly<Record<string, string>> = {
  flowchart: 'flowchart TD\n  A --> B',
  sequenceDiagram: 'sequenceDiagram\n  A->>B: hi',
  classDiagram: 'classDiagram\n  Fleet o-- Car : owns',
  'stateDiagram-v2': 'stateDiagram-v2\n  [*] --> Still\n  Still --> [*]',
  erDiagram: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
  gitGraph: 'gitGraph\n  commit\n  commit',
  mindmap: 'mindmap\n  root\n    leaf',
  timeline: 'timeline\n  2002 : LinkedIn\n  2004 : Facebook',
}

export function drawsSample(kind: string): boolean {
  const sample = KIND_SAMPLES[kind]
  return sample !== undefined && diagramOf(sample, SAMPLE_WIDTH, 'terminal').kind === 'drawing'
}

export function namesKind(text: string, kind: string): boolean {
  const escaped = kind.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(text)
}
