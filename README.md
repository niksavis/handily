# handily

Mods for Claude Code: panes, bands and quiet rows that show your work, your tasks and your
sessions. They work with any tracker (basicly, beads, br, beans, or your own through a CLI
adapter), and they need no harness.

Mods show and ask. They never enforce. Rules that must hold for every agent belong in git
hooks, not in a Claude Code mod.

Status: in development. No mod is released yet. See [docs/design.md](docs/design.md).

## Mods (planned)

| Mod | What you see |
| --- | --- |
| `workitems` | Nothing. It is the provider that reads work items for the other mods |
| `quiet-items` | One short row in place of a raw tracker file write |
| `task-pane` | Claude's task list in a sidebar. You can add and remove tasks |
| `session-board` | All local Claude sessions: task, worktree, time worked, estimate |
| `item-toasts` | A toast when a work item changes outside your session |

## Install

Type these at the prompt of a Claude Code session in a terminal. The first line adds the
marketplace and installs one mod. A mod that needs `workitems` installs it too.

```text
/plugin install quiet-items --marketplace niksavis/handily
/plugin install task-pane@handily
/plugin install session-board@handily
/plugin install item-toasts@handily
```

You can also open `/plugin` and pick the mods from the handily marketplace.

The mods run in Claude Code only. Codex reads this repository's `.agents/plugins/marketplace.json`
first, which lists no plugins, so Codex offers none of them. If you installed a handily mod in
Codex before that file existed, remove it with `codex plugin remove <name>@handily`.

## Requirements

- Claude Code with mod support (function hooks). The mod API is early access, so each
  release names the Claude Code version that it was tested on.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Work is tracked in the repository's own tracker
(`.basicly/ledger/`), managed by [basicly](https://github.com/niksavis/basicly).

## License

[MIT](LICENSE)
