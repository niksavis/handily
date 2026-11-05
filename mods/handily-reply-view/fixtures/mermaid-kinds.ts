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
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'mindmap',
  'timeline',
  'zenuml',
  'sankey',
  'xychart',
  'block',
  'packet',
  'kanban',
  'architecture-beta',
  'radar-beta',
  'treemap-beta',
  'cynefin-beta',
  'eventmodeling',
  'ishikawa-beta',
  'swimlane-beta',
  'treeView-beta',
  'usecase-beta',
  'venn-beta',
  'wardley-beta',
]

export const KIND_SAMPLES: Readonly<Record<string, string>> = {
  flowchart: 'flowchart TD\n  A --> B',
  sequenceDiagram: 'sequenceDiagram\n  A->>B: hi',
  classDiagram: 'classDiagram\n  Fleet o-- Car : owns',
  'stateDiagram-v2': 'stateDiagram-v2\n  [*] --> Still\n  Still --> [*]',
  erDiagram: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
  pie: 'pie\n  "Cats" : 3\n  "Dogs" : 1',
  xychart: 'xychart\n  x-axis [a, b]\n  bar [1, 2]',
  gantt: 'gantt\n  dateFormat YYYY-MM-DD\n  Plan : 2024-01-01, 3d\n  Build : 2d',
  gitGraph: 'gitGraph\n  commit\n  commit',
  mindmap: 'mindmap\n  root\n    leaf',
  timeline: 'timeline\n  2002 : LinkedIn\n  2004 : Facebook',
}

export function drawsSample(kind: string): boolean {
  const sample = KIND_SAMPLES[kind]
  return sample !== undefined && diagramOf(sample, SAMPLE_WIDTH, 'terminal').kind === 'drawing'
}

const HINT_KINDS = /These kinds draw: ([^.]+)\./

export function hintKinds(hint: string): string[] {
  return HINT_KINDS.exec(hint)?.[1]?.split(', ') ?? []
}
