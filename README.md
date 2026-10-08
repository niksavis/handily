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
| `handily` | The bundle of all the mods above. `/handily` shows which mods loaded |

## Install

Type this at the prompt of a Claude Code session in a terminal. It adds the marketplace
and installs every mod. The `handily` plugin is a bundle: it lists each mod as a
dependency, and Claude Code installs and enables them with it.

```text
/plugin install handily --marketplace niksavis/handily
```

When the marketplace is already added, this line is enough:

```text
/plugin install handily@handily
```

Each install line opens the details of the plugin. Select **Install**, then close the
panel.

Then type `/handily`. It lists each mod with its version and whether it loaded, and it
ends with one line such as `handily: 5 of 5 mods loaded`. When a mod is missing, the
list gives the line that installs it.

Claude Code does not load the bundle when one of its mods is disabled. Then `/handily`
is not available, and `/plugin` shows which mod to enable.

To install one mod only, use its name, for example
`/plugin install quiet-items@handily`. A mod that needs `workitems` installs it too. You
can also open `/plugin` and pick the mods from the handily marketplace.

To remove the bundle, type the first line in Claude Code and the second line in a shell.
The uninstall leaves the mods in place. `claude plugin prune` then removes each mod that
Claude Code installed only for the bundle. A mod that you installed by its own name
stays until you uninstall it by name.

```text
/plugin uninstall handily@handily
claude plugin prune
```

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
