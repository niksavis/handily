# handily

Mods for Claude Code: panes, bands and quiet rows that show your work, your tasks and your
sessions. They work with any tracker (basicly, beads, br, beans, or your own through a CLI
adapter) and they need no harness.

Status: design only. See [docs/design.md](docs/design.md).

## Mods (planned)

| Mod | What you see |
|---|---|
| `workitems` | Nothing. It is the provider that reads work items for the other mods |
| `quiet-items` | One short row in place of a raw tracker file write |
| `task-pane` | Claude's task list in a sidebar. You can add and remove tasks |
| `session-board` | All local Claude sessions: task, worktree, time worked, estimate |
| `work-status` | The held work item and the ready count in the status line |
| `item-toasts` | A toast when a work item changes outside your session |

## Install (after the first release)

```text
/plugin install task-pane --marketplace niksavis/handily
```
