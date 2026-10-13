# handily

`handily` is the bundle. One install of it installs and enables every handily mod. It also adds
the `/handily` command, which shows which mods are installed and loaded.
[docs/install.md](../../docs/install.md) gives the install, update and uninstall steps.

## What the bundle installs

The `dependencies` list in `.claude-plugin/plugin.json` names the mods. Claude Code installs
each mod in the list with the bundle:

- `handily-workitems`
- `handily-quiet-items`
- `handily-board`
- `handily-item-toasts`
- `handily-simple-view`
- `handily-reply-view`

`/handily` reads the same list, so it always checks the mods that the bundle installs.

## What /handily prints

`/handily` takes no argument. It prints one row for each mod in the list, with the version that
loaded and a state:

| State         | Row text                                                      | Theme colour |
| ------------- | ------------------------------------------------------------- | ------------ |
| loaded        | `loaded`                                                      | `success`    |
| disabled      | `disabled. Run /plugin enable <id>`                           | `error`      |
| not installed | `not installed. Run /plugin install <id>`                     | `error`      |
| not loaded    | `enabled, but it did not load. Run claude --debug to see why` | `warning`    |

The last line counts the mods that loaded, such as `handily: 6 of 6 mods loaded`. The line has
the `success` colour when every mod loaded and no old plugin id is found. Otherwise it has the
`warning` colour.

## Old plugin ids

`/handily` reads the `enabledPlugins` setting in the user, project and local settings. It looks
for each plugin id that a handily release replaced:

| Old plugin id                                                                               | Replaced by           |
| ------------------------------------------------------------------------------------------- | --------------------- |
| `workitems@handily`                                                                         | `handily-workitems`   |
| `quiet-items@handily`                                                                       | `handily-quiet-items` |
| `item-toasts@handily`                                                                       | `handily-item-toasts` |
| `simple-view@handily`                                                                       | `handily-simple-view` |
| `reply-view@handily`                                                                        | `handily-reply-view`  |
| `task-pane@handily`, `session-board@handily`, `agent-board@handily`                         | `handily-board`       |
| `handily-task-pane@handily`, `handily-session-board@handily`, `handily-agent-board@handily` | `handily-board`       |

For each old id that it finds, `/handily` prints one row with the scope and the command that
uninstalls it, such as `claude plugin uninstall task-pane@handily --scope user`. The last line
then adds `Run each uninstall command above, then type /reload-plugins`.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/handily
```

The bundle depends on every other mod, so load the `mods` folder.
