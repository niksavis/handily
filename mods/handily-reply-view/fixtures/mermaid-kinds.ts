import { diagramOf } from '../hooks/draw'
import { MERMAID_KINDS } from '../hooks/mermaid'

export { MERMAID_KINDS }

const SAMPLE_WIDTH = 78

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
  journey: 'journey\n  section Work\n    Make tea: 5: Me',
  quadrantChart: 'quadrantChart\n  quadrant-1 Plan\n  Task A: [0.3, 0.6]',
  kanban: 'kanban\n  todo[Todo]\n    docs[Write the docs]',
  packet: 'packet\n  0-15: "Source Port"\n  16-31: "Destination Port"',
  sankey: 'sankey\n  Solar,Grid,60\n  Grid,Homes,40',
  'radar-beta': 'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}',
  'treemap-beta': 'treemap-beta\n  "Parts"\n    "Left": 3\n    "Right": 1',
  block: 'block\n  columns 3\n  a b c',
}

export function drawsSample(kind: string): boolean {
  const sample = KIND_SAMPLES[kind]
  return sample !== undefined && diagramOf(sample, SAMPLE_WIDTH, 'terminal').kind === 'drawing'
}

const HINT_EXCEPTED = /Each Mermaid kind draws except ([^.]+)\./

export function hintKinds(hint: string): string[] {
  const excepted = HINT_EXCEPTED.exec(hint)?.[1]
    ?.split(', ')
    .flatMap((kind) =>
      kind === 'C4' ? MERMAID_KINDS.filter((known) => known.startsWith('C4')) : [kind],
    )
  return excepted === undefined ? [] : MERMAID_KINDS.filter((kind) => !excepted.includes(kind))
}
