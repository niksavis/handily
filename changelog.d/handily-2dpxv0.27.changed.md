- **The diagram hint names every kind of diagram that draws.** In reply-view, the hint that
  `diagramHints` adds to a typed prompt names `flowchart`, `sequenceDiagram`, `stateDiagram-v2`,
  `classDiagram`, `erDiagram`, `gitGraph`, `mindmap` and `timeline`. Before, it named only
  `flowchart` and `sequenceDiagram`. The names come from the list that the parser checks, and a
  test fails when the hint names a kind that does not draw. The hint now says that a flowchart
  may group boxes in a `subgraph` that does not nest, and no longer forbids `subgraph`. It costs
  about 230 tokens, measured with `claude -p` on Claude Code 2.1.318. When the fold cuts a tall
  diagram, the fold row names the kind in plain words, such as `flowchart` or `ER diagram`.
  (handily-2dpxv0.27)
