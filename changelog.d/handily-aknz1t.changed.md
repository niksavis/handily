- **handily-board asks Claude for a decide task before a release, a merge, a cleanup or a
  delete.** The `task_assign` description has one more sentence. When such an action waits for
  you, Claude assigns a decide task with the options `go` and `not now`, and acts only after
  the answer `go`. A permission prompt stays as it is. The sentence costs 59 input tokens for
  each model request, measured on 2026-11-12 with Claude Code 2.1.322 and the model
  `claude-opus-5-5`: `claude -p` used 27946 input tokens without the sentence and 28005 with
  it, three runs each. (handily-aknz1t)
