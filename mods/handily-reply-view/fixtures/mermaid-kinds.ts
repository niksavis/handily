import { diagramOf } from '../hooks/draw'
import { C4_FAMILY, C4_KIND } from '../hooks/hint'

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
  requirementDiagram: 'requirementDiagram\n  requirement login {\n    id: 1\n  }',
  C4Context: 'C4Context\n  Person(user, "User")\n  System(app, "App")\n  Rel(user, app, "Uses")',
  C4Container: 'C4Container\n  Container(web, "Web", "TypeScript")',
  C4Component: 'C4Component\n  Component(api, "API", "Go", "Serves the data")',
  C4Dynamic:
    'C4Dynamic\n  Person(user, "User")\n  Container(web, "Web")\n  RelIndex(1, user, web, "Opens")',
  C4Deployment: 'C4Deployment\n  Deployment_Node(box, "Server") {\n    Container(web, "Web")\n  }',
}

export function drawsSample(kind: string): boolean {
  const sample = KIND_SAMPLES[kind]
  return sample !== undefined && diagramOf(sample, SAMPLE_WIDTH, 'terminal').kind === 'drawing'
}

const HINT_KINDS = /These kinds draw: ([^.]+)\./

function expandedKind(named: string): string[] {
  if (!named.endsWith(` ${C4_FAMILY}`)) return [named]
  const first = named.slice(0, -C4_FAMILY.length - 1)
  return [first, ...MERMAID_KINDS.filter((kind) => C4_KIND.test(kind) && kind !== first)]
}

export function hintKinds(hint: string): string[] {
  return (HINT_KINDS.exec(hint)?.[1]?.split(', ') ?? []).flatMap(expandedKind)
}
