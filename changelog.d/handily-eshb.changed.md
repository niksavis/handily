- **quiet-items follows the simple-view mode, so `/simple` is one switch for the concise
  view.** While the simple-view mode is off, quiet-items draws every row as Claude Code draws
  it: the tool row, the result block and a folded group line. While simple-view is not
  installed or its mode is on, quiet-items follows its own mode, and `/quiet-items` still
  toggles it. quiet-items reads the simple-view mode without a dependency on simple-view,
  because simple-view already depends on quiet-items (handily-eshb).
