# handily

Mods for Claude Code: panes, bands and quiet rows that show your work, your tasks and your
sessions. They work with any tracker (basicly, beads, br, beans, or your own through a CLI
adapter), and they need no harness.

Mods show and ask. They never enforce. Rules that must hold for every agent belong in git
hooks, not in a Claude Code mod.

Status: in development. No mod is released yet. See [docs/design.md](docs/design.md).

## Mods (planned)

Each mod has a plugin name that starts with `handily-`. Its slash commands keep their short
names, such as `/task` and `/simple`, and each command description in the menu starts with
`handily ·`.

| Mod | What you see |
| --- | --- |
| `handily-workitems` | Nothing. It is the provider that reads work items for the other mods |
| `handily-quiet-items` | One short row in place of a raw tracker file write |
| `handily-task-pane` | Claude's task list in a sidebar. You can add and remove tasks |
| `handily-session-board` | All local Claude sessions: task, worktree, time worked, estimate |
| `handily-item-toasts` | A toast when a work item changes outside your session |
| `handily-agent-board` | A pane with what each subagent of this session does |
| `handily-simple-view` | One concise row per Bash, Edit and Write call, with buttons to open and copy its output; `/simple` switches it |
| `handily-reply-view` | Long replies fold after 12 lines, tables draw without box lines, and tables and code blocks get copy buttons; `/replies` switches it |
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
ends with one line such as `handily: 8 of 8 mods loaded`. When a mod is missing, the
list gives the line that installs it.

To update, run this line in a shell, then type `/reload-plugins` in each open session, or
restart Claude Code. `claude plugin update` takes
one plugin, and the bundle install does not update a mod that is already installed, so the
line updates the bundle and each mod in turn. A mod that came into the bundle after your
install fails the update with `Plugin "<name>" is not installed`, and the line installs it by
its name instead. It then
stays until you uninstall it by name. The line is safe to run again.

```sh
claude plugin marketplace update handily; for p in handily handily-workitems handily-quiet-items handily-task-pane handily-session-board handily-item-toasts handily-agent-board handily-simple-view handily-reply-view; do claude plugin update "$p@handily" || claude plugin install "$p@handily"; done
```

An update keeps the folder of the old version in `~/.claude/plugins/cache/handily/`. Claude
Code loads only the version that `claude plugin list` shows.

Claude Code does not load the bundle when one of its mods is disabled. Then `/handily`
is not available, and `/plugin` shows which mod to enable. `claude plugin disable` refuses
to disable a mod while the bundle is enabled, so disable the bundle first.

To install one mod only, use its name, for example
`/plugin install handily-quiet-items@handily`. A mod that needs `handily-workitems` installs it
too. You can also open `/plugin` and pick the mods from the handily marketplace.

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

### Move from the old plugin names

Before handily 0.4.0 the mods had plugin names without `handily-`, such as `workitems@handily`.
An update does not move an old name to the new one. Claude Code keeps the old plugin installed
and does not install the new one. When both are installed, the two copies collide: Claude Code
refuses the commands of one copy, and `handily-workitems` does not load beside `workitems`.

To move, run this line in a shell, then type `/reload-plugins` in each open session. It updates
the marketplace, installs each new name and uninstalls each old name. A command for a plugin
that you did not install fails for that plugin only.

```sh
claude plugin marketplace update handily; for p in workitems quiet-items task-pane session-board item-toasts agent-board simple-view reply-view; do claude plugin install "handily-$p@handily"; done; for p in reply-view simple-view agent-board item-toasts session-board task-pane quiet-items workitems; do claude plugin uninstall "$p@handily"; done; claude plugin update handily@handily
```

Then type `/handily`. It must end with `handily: 8 of 8 mods loaded`. It names each old plugin
that is still installed, with its scope, and prints the command that uninstalls it.
[CHANGELOG.md](CHANGELOG.md) lists every old name and its new name.

## Requirements

- The latest Claude Code. The mod API is early access and changes between releases, so the
  mods support only the newest version, and CI tests them on it. Update Claude Code before
  you update a mod.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Work is tracked in the repository's own tracker
(`.basicly/ledger/`), managed by [basicly](https://github.com/niksavis/basicly).

## License

[MIT](LICENSE)
