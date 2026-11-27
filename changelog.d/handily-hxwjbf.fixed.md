- **handily-board: the plan note reaches a session that never called a board tool.** After 20
  tool calls with an empty task list, the next prompt of the person carries the note that asks
  Claude to add its plan with `task_add`. Before, the note went out only after the session had
  called a board tool once, so a session that never started a plan never got it. On local
  transcripts from 2026-11-20 to 2026-11-27, 0 of 55 sessions without the note added a plan.
  (handily-hxwjbf)
