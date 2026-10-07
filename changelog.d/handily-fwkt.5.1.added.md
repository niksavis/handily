- **The `session-board` mod shows each local Claude Code session in one pane.** `/session-board`
  opens the board. It polls `claude agents --json` every 15 s while the board is shown, and it
  shares one cached result across sessions. A row shows the state, the task and its progress,
  the worktree and branch, and the time worked or elapsed, with an estimate of the time left
  (handily-fwkt.5.1).
