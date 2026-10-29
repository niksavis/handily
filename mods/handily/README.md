# handily

`handily` is the bundle. One install of it installs and enables every handily mod. It also adds
the `/handily` command, which shows the version, the state, the mode and the purpose of each mod.
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
- `handily-filetree`

`/handily` reads the same list, so it always checks the mods that the bundle installs.

## What /handily prints

`/handily` with no argument prints one line for each mod in the list, in five columns. The only
argument that it takes is `glyphs` (see "Glyphs" below).

| Column      | What it shows                                                                   |
| ----------- | ------------------------------------------------------------------------------- |
| name        | The mod name                                                                    |
| version     | The version in the `plugin.json` of the mod that loaded, or `-`                 |
| state       | `loaded`, `disabled`, `not installed` or `not loaded`                           |
| mode        | The mode that the mod stores for this session, and its setting when they differ |
| description | The first sentence of the `description` in its `plugin.json`, cut to fit a line |

The mode column has these values:

| Mode                                   | Meaning                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `on`, `off`                            | The mode of `handily-quiet-items`, `handily-item-toasts`, `handily-simple-view` and `handily-reply-view`   |
| `off (default on)`, `on (default off)` | The mode of this session differs from the `mode` setting of the mod. A new session starts from the setting |
| `polling`                              | `handily-workitems` reads the tracker                                                                      |
| `paused`                               | `handily-workitems` is paused with `/workitems pause`                                                      |
| `-`                                    | The mod has no mode, such as `handily-board`, or it stored none yet                                        |
| `?`                                    | `/handily` cannot read the mode. The debug log has the reason                                              |

Each line fits in 80 columns. This is the output when every mod loaded:

```text
handily-workitems    0.8.0  loaded  polling  Provider of one typed work item…
handily-quiet-items  0.5.0  loaded  on       One short row in place of each…
handily-board        0.4.0  loaded  -        A board with two tabs
handily-item-toasts  0.6.0  loaded  on       A toast when a work item changes…
handily-simple-view  0.7.0  loaded  on       One short row for each tool call…
handily-reply-view   0.6.0  loaded  on       Long replies fold to their first…
handily-filetree     0.2.0  loaded  -        A files tab beside the board

handily: 7 of 7 mods loaded, 0 off or paused
```

A mod that did not load gets a second line with the command that fixes it. This is the output
when `handily-board` is not installed and `/item-toasts off` turned the toasts off.
`handily-filetree` needs `handily-board`, so it does not load either:

```text
handily-workitems    0.8.0  loaded         polling  Provider of one typed work…
handily-quiet-items  0.5.0  loaded         on       One short row in place of…
handily-board        -      not installed  -
  Run /plugin install handily-board@niksavis
handily-item-toasts  0.6.0  loaded         off      A toast when a work item…
handily-simple-view  0.7.0  loaded         on       One short row for each…
handily-reply-view   0.6.0  loaded         on       Long replies fold to their…
handily-filetree     -      not loaded     -
  Run claude --debug to see why

handily: 5 of 7 mods loaded, 1 off or paused
```

`/handily` reads the `mode` setting of each mod from the rows of the `/config` menu. When the
mode of this session differs from the setting, the mode column shows both. This is the output
when `/item-toasts`, `/simple` and `/replies` turned their mode off and each `mode` setting is
`on`:

```text
handily-workitems    0.8.0  loaded  polling           Provider of one typed…
handily-quiet-items  0.5.0  loaded  on                One short row in place…
handily-board        0.4.0  loaded  -                 A board with two tabs
handily-item-toasts  0.6.0  loaded  off (default on)  A toast when a work item…
handily-simple-view  0.7.0  loaded  off (default on)  One short row for each…
handily-reply-view   0.6.0  loaded  off (default on)  Long replies fold to…
handily-filetree     0.2.0  loaded  -                 A files tab beside the…

handily: 7 of 7 mods loaded, 3 off or paused
```

| State         | Second line                     | Theme colour |
| ------------- | ------------------------------- | ------------ |
| loaded        | none                            | `success`    |
| disabled      | `Run /plugin enable <id>`       | `error`      |
| not installed | `Run /plugin install <id>`      | `error`      |
| not loaded    | `Run claude --debug to see why` | `warning`    |

`/handily` tells a disabled mod from a missing one by the `enabledPlugins` setting. A mod set to
`false` there is disabled. A mod that is not there is not installed.

The last line counts the mods that loaded and the mods that are `off` or `paused`. The line has
the `success` colour when every mod loaded and no old plugin id is found. Otherwise it has the
`warning` colour.

## Glyphs

The setting Glyphs in `/config` under `handily` takes `plain` or `nerd`. The default is `plain`.

- `plain`: the marks draw in any font, such as `▶`, `✓`, `○`, `■` and `◆`.
- `nerd`: the marks are Nerd Font icons. Each icon is one cell wide only with a Nerd Font Mono
  font. A terminal without such a font draws boxes or blank cells.

`/handily glyphs` tests this terminal. It names the setting, then prints each mark of both sets
between bars, with the name of the icon. When each icon fills one cell between its bars, the
setting `nerd` is safe in this terminal. A box, a `?` or a moved bar means that the terminal
has no Nerd Font Mono. This is the output with the setting `nerd`. Each circled letter stands
for the icon, which this page cannot draw:

```text
Glyphs nerd · set in /config › handily
role      plain nerd
doing     |▶|   |Ⓟ| nf-cod-play
done      |✓|   |Ⓒ| nf-cod-check
to do     |○|   |Ⓞ| nf-cod-circle_large
blocked   |■|   |Ⓧ| nf-cod-error
needs you |◆|   |Ⓑ| nf-cod-bell
edited    |✎|   |Ⓔ| nf-cod-edit
read      |◦|   |Ⓡ| nf-cod-eye
folder    |▸|   |Ⓕ| nf-fa-folder
open      |▾|   |ⓕ| nf-fa-folder_open
branch    |·|   |Ⓨ| nf-oct-git_branch
Each mark fills one cell between bars.
A box, a ? or a moved bar: this terminal has no Nerd Font Mono. Set Glyphs to plain in /config.
```

A stored value other than `plain` or `nerd` draws plain. `/handily glyphs` names that value on
its first line. In this release no mod draws the nerd set yet: the setting and the test come
first (handily-5jdtf).

## Old plugin ids

`/handily` reads the `enabledPlugins` setting in the user, project and local settings. It looks
for each plugin id from the old marketplace `handily`. These are the bundle, each mod, and each
mod name that a handily release replaced:

| Old plugin id                                                                               | Replaced by               |
| ------------------------------------------------------------------------------------------- | ------------------------- |
| `handily@handily` and each `handily-<mod>@handily`                                          | the same name `@niksavis` |
| `workitems@handily`                                                                         | `handily-workitems`       |
| `quiet-items@handily`                                                                       | `handily-quiet-items`     |
| `item-toasts@handily`                                                                       | `handily-item-toasts`     |
| `simple-view@handily`                                                                       | `handily-simple-view`     |
| `reply-view@handily`                                                                        | `handily-reply-view`      |
| `task-pane@handily`, `session-board@handily`, `agent-board@handily`                         | `handily-board`           |
| `handily-task-pane@handily`, `handily-session-board@handily`, `handily-agent-board@handily` | `handily-board`           |

For each old id that it finds, `/handily` prints the id and its scope, and under it the command
that uninstalls it. Then it prints the command that removes the old marketplace. This is the
end of the output when the user settings still hold `handily@handily` and
`handily-workitems@handily`:

```text
handily@handily            old id of handily, user settings
  Run claude plugin uninstall handily@handily --scope user
handily-workitems@handily  old id of handily-workitems, user settings
  Run claude plugin uninstall handily-workitems@handily --scope user
handily marketplace        old marketplace of these ids
  Run claude plugin marketplace remove handily

handily: 7 of 7 mods loaded, 0 off or paused
Run each command above, then type /reload-plugins
```

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/handily
```

The bundle depends on every other mod, so load the `mods` folder.
