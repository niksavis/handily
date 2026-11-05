- **The diagram hint names every kind of diagram that draws.** In reply-view, the hint that
  `diagramHints` adds to a typed prompt names `flowchart`, `sequenceDiagram`, `stateDiagram-v2`,
  `classDiagram`, `erDiagram`, `gitGraph`, `mindmap` and `timeline`. Before, it named only
  `flowchart` and `sequenceDiagram`. The names come from the list that the parser checks, and a
  test fails when the hint names a kind that does not draw. The hint now costs about 210 tokens,
  measured with `claude -p` on Claude Code 2.1.318. (handily-2dpxv0.27)
