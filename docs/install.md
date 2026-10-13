# Install, update and uninstall the handily mods

This page is for a person who uses the mods. The [README](../README.md) has the quick start.

## Requirements

- The latest Claude Code, in a terminal session. The mods support only the newest Claude Code
  version, and CI tests them on that version. Update Claude Code before you update a mod.
- The mods run in Claude Code only. Codex and other agents do not load them.

The mod API of Claude Code is in early access, and it changes between Claude Code releases. A
mod can stop working after a Claude Code update, until a new mod release follows.

Each command on this page has two forms:

- Type a line that starts with `/plugin` at the prompt of a Claude Code session.
- Run a line that starts with `claude plugin` in a shell.

## Register the marketplace

You register the marketplace once per machine. In a Claude Code session, type:

```text
/plugin marketplace add niksavis/handily
```

In a shell, run:

```sh
claude plugin marketplace add niksavis/handily
```

The marketplace name is `handily`, so every plugin id ends with `@handily`. Each install line
on this page also works without this step, when you add `--marketplace niksavis/handily` to it.
The flag registers the marketplace first:

```text
/plugin install handily --marketplace niksavis/handily
```

## Install all mods

The `handily` plugin is a bundle. It lists each mod as a dependency, and Claude Code installs
and enables each mod with it. [mods/handily/README.md](../mods/handily/README.md) describes the
bundle and its `/handily` command.

```text
/plugin install handily@handily
```

In a shell:

```sh
claude plugin install handily@handily
```

A session install line opens the details of the plugin. Select **Install**, then close the
panel. After an install, type `/reload-plugins` in each open session, or restart Claude Code.

## Install one mod or several mods

Install a mod by its plugin id. Claude Code installs the mods that it needs with it.

| Mod | Plugin id | Needs |
| --- | --- | --- |
| [handily-workitems](../mods/handily-workitems/README.md) | `handily-workitems@handily` | nothing |
| [handily-quiet-items](../mods/handily-quiet-items/README.md) | `handily-quiet-items@handily` | `handily-workitems` |
| [handily-item-toasts](../mods/handily-item-toasts/README.md) | `handily-item-toasts@handily` | `handily-workitems` |
| [handily-simple-view](../mods/handily-simple-view/README.md) | `handily-simple-view@handily` | `handily-quiet-items`, and through it `handily-workitems` |
| [handily-reply-view](../mods/handily-reply-view/README.md) | `handily-reply-view@handily` | nothing |
| [handily-board](../mods/handily-board/README.md) | `handily-board@handily` | `handily-workitems` |
| [handily](../mods/handily/README.md) | `handily@handily` | every mod above |

For example, to install the board in a session, type:

```text
/plugin install handily-board@handily
```

To install several mods, run one install line for each mod. This example installs the board,
the simple view and the reply view:

```sh
claude plugin install handily-board@handily
claude plugin install handily-simple-view@handily
claude plugin install handily-reply-view@handily
```

You can also type `/plugin` in a session, open the `handily` marketplace and select the mods.

Each mod has a plugin name that starts with `handily-`. Its slash commands keep their short
names, such as `/board` and `/simple`. Each command description in the menu starts with
`handily ·`.

## Update

First update the marketplace. Claude Code then knows the new versions.

```text
/plugin marketplace update handily
```

In a shell:

```sh
claude plugin marketplace update handily
```

Then update each mod that you installed. `claude plugin update` takes one plugin. An update of
the bundle does not update a mod that is already installed, so update each mod:

```sh
claude plugin update handily-board@handily
```

To update the bundle and every mod, run this line in bash or zsh. A mod that came into the
bundle after your install fails its update with `Plugin "<name>" is not installed`. The line
then installs that mod by its name. You can run the line again with no harm.

```sh
claude plugin marketplace update handily; for p in handily handily-workitems handily-quiet-items handily-board handily-item-toasts handily-simple-view handily-reply-view; do claude plugin update "$p@handily" || claude plugin install "$p@handily"; done
```

After an update, type `/reload-plugins` in each open session, or restart Claude Code.

An update keeps the folder of the old version in `~/.claude/plugins/cache/handily/`. Claude
Code loads only the version that `claude plugin list` shows.

## Disable and uninstall

Claude Code does not load the bundle when one of its mods is disabled. Then `/handily` is not
available, and `/plugin` shows which mod to enable. `claude plugin disable` refuses to disable
a mod while the bundle is enabled, so disable the bundle first.

To uninstall one mod, use its plugin id:

```text
/plugin uninstall handily-reply-view@handily
```

To remove the bundle, type the first line in Claude Code and run the second line in a shell.
The uninstall leaves the mods in place. `claude plugin prune` then removes each mod that Claude
Code installed only for the bundle. A mod that you installed by its own plugin id stays until
you uninstall it by that id.

```text
/plugin uninstall handily@handily
claude plugin prune
```

To remove the marketplace:

```sh
claude plugin marketplace remove handily
```

## Codex

Codex reads the file `.agents/plugins/marketplace.json` of this repository first. That file
lists no plugins, so Codex offers none of the mods. If you installed a handily mod in Codex
before that file existed, remove it with `codex plugin remove <name>@handily`.

## Move from the old plugin names

An update does not remove an old plugin. Use the section below that names your old plugins.
Then type `/handily`. It names each old plugin that is still installed, with its scope, and
prints the command that uninstalls it. [CHANGELOG.md](../CHANGELOG.md) lists every old name and
its new name.

### From handily-task-pane, handily-agent-board and handily-session-board

handily 0.5.1 removes `handily-task-pane`, `handily-agent-board` and `handily-session-board`.
`handily-board` replaces them. `/task`, `/agent-board` and `/session-board` are gone, and
`/board` replaces them.

To move, run this line in bash or zsh, then type `/reload-plugins` in each open session. The
line updates the marketplace, installs `handily-board`, uninstalls the three old plugins and
updates the bundle. A command for a plugin that you did not install fails for that plugin only.

```sh
claude plugin marketplace update handily; claude plugin install handily-board@handily; for p in handily-task-pane handily-agent-board handily-session-board; do claude plugin uninstall "$p@handily"; done; claude plugin update handily@handily
```

### From the names before handily 0.4.0

Before handily 0.4.0 the mods had plugin names without `handily-`, such as `workitems@handily`.
An update does not move an old name to the new one. Claude Code keeps the old plugin installed
and does not install the new one. When both are installed, the two copies collide. Claude Code
refuses the commands of one copy, and `handily-workitems` does not load beside `workitems`.

To move, run this line in bash or zsh, then type `/reload-plugins` in each open session. The
line updates the marketplace, installs each new name and uninstalls each old name. A command
for a plugin that you did not install fails for that plugin only.

```sh
claude plugin marketplace update handily; for p in workitems quiet-items board item-toasts simple-view reply-view; do claude plugin install "handily-$p@handily"; done; for p in reply-view simple-view agent-board item-toasts session-board task-pane quiet-items workitems; do claude plugin uninstall "$p@handily"; done; claude plugin update handily@handily
```

## Troubleshooting

Type `/handily` in a session. It lists each mod of the bundle with its version and whether it
loaded. It ends with one line such as `handily: 6 of 6 mods loaded`.

| The list says | Do this |
| --- | --- |
| `not installed` | Run the `/plugin install` line that the list gives |
| `disabled` | Run the `/plugin enable` line that the list gives |
| `enabled, but it did not load` | Run `claude --debug` to see why |
| `old id of` a mod | Run the `claude plugin uninstall` line that the list gives |

Then type `/reload-plugins`. [mods/handily/README.md](../mods/handily/README.md) describes the
list in full.
