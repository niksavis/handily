- **Breaking change: `handily-task-pane`, `handily-agent-board` and `handily-session-board`
  are removed, with no alias and no deprecation version.** `/task`, `/agent-board` and
  `/session-board` are gone. `/board` replaces them, and `/board machine` shows the board of
  every local session. An update does not remove an old plugin. With an old plugin and
  `handily-board` both installed, Claude gets two sets of task tools. To move, run this line
  in a shell, then type `/reload-plugins` in each open session. The line updates the
  marketplace, installs `handily-board`, uninstalls the three old plugins and updates the
  bundle. A command for a plugin that you did not install fails for that plugin only
  (handily-fwkt.8.19.4).

  ```sh
  claude plugin marketplace update handily; claude plugin install handily-board@handily; for p in handily-task-pane handily-agent-board handily-session-board; do claude plugin uninstall "$p@handily"; done; claude plugin update handily@handily
  ```
