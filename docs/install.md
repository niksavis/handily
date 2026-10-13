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

The marketplace name is `niksavis`, so every plugin id ends with `@niksavis`. The name comes
from the file `.claude-plugin/marketplace.json`, not from the repository name. Each install line
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
/plugin install handily@niksavis
```

In a shell:

```sh
claude plugin install handily@niksavis
```

A session install line opens the details of the plugin. Select **Install**, then close the
panel. After an install, type `/reload-plugins` in each open session, or restart Claude Code.

## Install one mod or several mods

Install a mod by its plugin id. Claude Code installs the mods that it needs with it.

| Mod | Plugin id | Needs |
| --- | --- | --- |
| [handily-workitems](../mods/handily-workitems/README.md) | `handily-workitems@niksavis` | nothing |
| [handily-quiet-items](../mods/handily-quiet-items/README.md) | `handily-quiet-items@niksavis` | `handily-workitems` |
| [handily-item-toasts](../mods/handily-item-toasts/README.md) | `handily-item-toasts@niksavis` | `handily-workitems` |
| [handily-simple-view](../mods/handily-simple-view/README.md) | `handily-simple-view@niksavis` | `handily-quiet-items`, and through it `handily-workitems` |
| [handily-reply-view](../mods/handily-reply-view/README.md) | `handily-reply-view@niksavis` | nothing |
| [handily-board](../mods/handily-board/README.md) | `handily-board@niksavis` | `handily-workitems` |
| [handily](../mods/handily/README.md) | `handily@niksavis` | every mod above |

For example, to install the board in a session, type:

```text
/plugin install handily-board@niksavis
```

To install several mods, run one install line for each mod. This example installs the board,
the simple view and the reply view:

```sh
claude plugin install handily-board@niksavis
claude plugin install handily-simple-view@niksavis
claude plugin install handily-reply-view@niksavis
```

You can also type `/plugin` in a session, open the `niksavis` marketplace and select the mods.

Each mod has a plugin name that starts with `handily-`. Its slash commands keep their short
names, such as `/board` and `/simple`. Each command description in the menu starts with
`handily ·`.

## Update

In a Claude Code session, update the marketplace. In a session this line does two things. It
gets the new versions, and it updates each plugin that you installed from the marketplace:

```text
/plugin marketplace update niksavis
```

To update one plugin in a session, type `/plugin`, open the **Installed** tab, select the
plugin and select **Update now**.

In a shell, the marketplace update only gets the new versions. It does not update an installed
plugin:

```sh
claude plugin marketplace update niksavis
```

Then update each plugin that you installed. `claude plugin update` takes one plugin. An update
of the bundle does not update a mod that is already installed, so update each mod:

```sh
claude plugin update handily-board@niksavis
```

To update the bundle and every mod, run this line in bash or zsh. A mod that came into the
bundle after your install fails its update with `Plugin "<name>" is not installed`. The line
then installs that mod by its name.

```sh
claude plugin marketplace update niksavis; for p in handily handily-workitems handily-quiet-items handily-board handily-item-toasts handily-simple-view handily-reply-view; do claude plugin update "$p@niksavis" || claude plugin install "$p@niksavis"; done
```

After an update, type `/reload-plugins` in each open session, or restart Claude Code.

An update keeps the folder of the old version in `~/.claude/plugins/cache/niksavis/`. Claude
Code loads only the version that `claude plugin list` shows.

### Commands that you can run again

These shell commands exit with 0 and change nothing when you run them a second time. This was
measured with Claude Code 2.1.296, with the marketplace added from a local folder:

| Command | Output of the second run |
| --- | --- |
| `claude plugin marketplace add <source>` | `Marketplace 'niksavis' already on disk` |
| `claude plugin install handily@niksavis` | `Plugin "handily@niksavis" is already installed` |
| `claude plugin marketplace update niksavis` | `Successfully updated marketplace: niksavis` |

These commands fail with exit code 1 when you run them a second time:

| Command | Output of the second run |
| --- | --- |
| `claude plugin uninstall <id>` | `Plugin "<id>" not found in installed plugins` |
| `claude plugin marketplace remove handily` | `Marketplace 'handily' not found` |

## Check the installed versions

| Where | What to do |
| --- | --- |
| Claude Code session | Type `/handily`. It shows the version, the state and the mode of each mod |
| Claude Code session | Type `/plugin` and open the **Installed** tab |
| Shell | Run `claude plugin list` |

## Disable and uninstall

Claude Code does not load the bundle when one of its mods is disabled. Then `/handily` is not
available, and `/plugin` shows which mod to enable. `claude plugin disable` refuses to disable
a mod while the bundle is enabled, so disable the bundle first.

To uninstall one mod, use its plugin id:

```text
/plugin uninstall handily-reply-view@niksavis
```

To remove the bundle, type the first line in Claude Code and run the second line in a shell.
The uninstall leaves the mods in place. `claude plugin prune` then removes each mod that Claude
Code installed only for the bundle. A mod that you installed by its own plugin id stays until
you uninstall it by that id.

```text
/plugin uninstall handily@niksavis
claude plugin prune
```

To remove the marketplace:

```sh
claude plugin marketplace remove niksavis
```

## Codex

Codex reads the file `.agents/plugins/marketplace.json` of this repository first. That file
lists no plugins, so Codex offers none of the mods. Its marketplace name is `niksavis`. If you
installed a handily mod in Codex before that file existed, remove it with
`codex plugin remove <name>@handily`.

## Move from the handily marketplace

Before handily 0.6.0 the marketplace name was `handily`, and the install id of the bundle was
`handily@handily`. A plugin from that marketplace does not change to `@niksavis` by itself.
Keep only one of the two ids installed.

To move, do these steps in a shell. Skip a line for a plugin that you did not install.

1. Uninstall each plugin from the old marketplace. Start with the bundle and end with
   `handily-workitems`, because the other mods need it:

   ```sh
   claude plugin uninstall handily@handily
   claude plugin uninstall handily-board@handily
   claude plugin uninstall handily-item-toasts@handily
   claude plugin uninstall handily-simple-view@handily
   claude plugin uninstall handily-quiet-items@handily
   claude plugin uninstall handily-reply-view@handily
   claude plugin uninstall handily-workitems@handily
   ```

2. Remove the old marketplace. This also uninstalls each plugin from it that is still installed
   in the user scope. This was measured with Claude Code 2.1.296:

   ```sh
   claude plugin marketplace remove handily
   ```

3. Add the marketplace again under its new name, and install the bundle:

   ```sh
   claude plugin marketplace add niksavis/handily
   claude plugin install handily@niksavis
   ```

4. Type `/reload-plugins` in each open session, or restart Claude Code.

5. Type `/handily`. It names each plugin id from the marketplace `handily` that a scope still
   holds, such as the project settings. Under each id it prints the command that uninstalls it,
   and then the command that removes the marketplace.

[CHANGELOG.md](../CHANGELOG.md) lists every old plugin name and its new name.

## Troubleshooting

Type `/handily` in a session. It lists each mod of the bundle with its version, its state and
its mode. It ends with one line such as `handily: 6 of 6 mods loaded, 0 off or paused`.

| The list says | Do this |
| --- | --- |
| `not installed` | Run the `/plugin install` line that the list gives |
| `disabled` | Run the `/plugin enable` line that the list gives |
| `not loaded` | Run `claude --debug` to see why |
| `old id of` a mod | Run the `claude plugin uninstall` line that the list gives |
| `old marketplace of these ids` | Run the `claude plugin marketplace remove handily` line that the list gives |

Then type `/reload-plugins`. [mods/handily/README.md](../mods/handily/README.md) describes the
list in full.
