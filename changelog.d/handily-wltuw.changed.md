- **Every mod has a new plugin name that starts with `handily-`, and an update does not move
  you to it.** Claude Code keeps each old plugin installed and does not install the new one. When
  both are installed, the two copies collide: Claude Code refuses the commands of one copy, and
  `handily-workitems` does not load beside `workitems` (measured on Claude Code 2.1.295). The
  bundle keeps the name `handily`. The slash commands keep their short names, and each command
  description now starts with `handily ·`. The new versions are handily 0.4.0,
  handily-workitems 0.5.0, handily-quiet-items 0.4.0, handily-task-pane 0.5.0,
  handily-session-board 0.3.0, handily-item-toasts 0.4.0, handily-agent-board 0.3.0,
  handily-simple-view 0.3.0 and handily-reply-view 0.2.0. New release tags are
  `handily-<mod>--v<version>`. The old tags stay (handily-wltuw).

  | Old plugin id | New plugin id |
  | --- | --- |
  | `workitems@handily` | `handily-workitems@handily` |
  | `quiet-items@handily` | `handily-quiet-items@handily` |
  | `task-pane@handily` | `handily-task-pane@handily` |
  | `session-board@handily` | `handily-session-board@handily` |
  | `item-toasts@handily` | `handily-item-toasts@handily` |
  | `agent-board@handily` | `handily-agent-board@handily` |
  | `simple-view@handily` | `handily-simple-view@handily` |
  | `reply-view@handily` | `handily-reply-view@handily` |

  To move, run these lines in a shell. The first line updates the marketplace and the bundle.
  The second line installs each new id. The third line uninstalls each old id, each mod before
  the mod that it depends on. A command for a plugin that you did not install fails for that
  plugin only. Then restart Claude Code.

  ```sh
  claude plugin marketplace update handily; claude plugin update handily@handily
  for p in workitems quiet-items task-pane session-board item-toasts agent-board simple-view reply-view; do claude plugin install "handily-$p@handily"; done
  for p in reply-view simple-view agent-board item-toasts session-board task-pane quiet-items workitems; do claude plugin uninstall "$p@handily"; done
  ```

  To move one mod only, install its new id and uninstall its old id, for example
  `claude plugin install handily-task-pane@handily` and
  `claude plugin uninstall task-pane@handily`. `claude plugin uninstall` works on the user scope
  when you give no `--scope`. For an old id in the project or local settings, type `/handily`
  after the restart. It names each old id that is still installed, with its scope, and prints the
  exact command, such as `claude plugin uninstall workitems@handily --scope project`.

  The new ids start with their own settings and store. Set the `mode` and `titleLength` of
  handily-quiet-items and the `mode` of handily-task-pane again in `/config` if you changed them.
  Expect handily-workitems to ask once again before it runs `basicly` or `br`. A permission rule
  for the task-pane tools names `mcp__handily-task-pane__<name>` now.
