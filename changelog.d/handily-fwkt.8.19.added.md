- **handily-board 0.1.0 is a board with two tabs that replaces handily-task-pane,
  handily-session-board and handily-agent-board.** `/board` opens it. The `this session` tab
  shows the task list that Claude and you share, and the subagents of this session: a failed
  agent with a second line, an agent on hold, and at most 6 rows before a fold. The
  `this machine` tab shows every local Claude Code session, the ones that wait for you first,
  with a `waits for:` line. The tab polls `claude agents --json` only while it is shown.
  `/board add`, `/board rm`, `/board list` and `/board close` replace the `/task` forms. The
  model tools are `mcp__handily-board__task_add`, `task_update`, `task_move` and `task_list`
  (handily-fwkt.8.19).
