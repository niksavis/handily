# User guide

This page lists each handily mod, what it shows, its commands and its settings. It is for a
person who uses the mods. [docs/install.md](install.md) tells you how to install, update and
uninstall them.

## Which mod do I need

| You want to | Mod |
| --- | --- |
| Install every mod at once | [`handily`](#handily) |
| Give the other mods the work items of your tracker | [`handily-workitems`](#handily-workitems) |
| See one short row for each tracker write | [`handily-quiet-items`](#handily-quiet-items) |
| See a toast when a work item changes in another session | [`handily-item-toasts`](#handily-item-toasts) |
| See one short row for each tool call | [`handily-simple-view`](#handily-simple-view) |
| Fold long replies and find your prompts when you scroll | [`handily-reply-view`](#handily-reply-view) |
| Keep a task list with Claude and see every local session | [`handily-board`](#handily-board) |

Claude Code installs the mods that a mod needs with it. `handily-quiet-items`,
`handily-item-toasts` and `handily-board` need `handily-workitems`. `handily-simple-view` needs
`handily-quiet-items`.

A setting is a field in the `userConfig` of the plugin. Claude Code asks for it when you enable
the plugin.

## handily

The bundle. One install of it installs and enables every other mod on this page.

| Command | What it does |
| --- | --- |
| `/handily` | Prints one line for each mod: its name, its version, its state, its mode and a short description. The last line counts the loaded mods and the mods that are off or paused |

`/handily` takes no argument. A mod that did not load gets a second line with the command that
fixes it, such as `Run /plugin install handily-board@niksavis`. The mode is `on` or `off`,
`polling` or `paused` for `handily-workitems`, `-` for a mod with no mode, and `?` when
`/handily` cannot read it. When the mode differs from the `mode` setting of the mod, the line
shows both, such as `off (default on)`. The install id of the bundle is `handily@niksavis`.

Settings: none.

More: [mods/handily/README.md](../mods/handily/README.md).

## handily-workitems

It reads the work items of the tracker at the session root and gives them to the other mods. It
draws nothing of its own.

| Command | What it does |
| --- | --- |
| `/workitems` | Says if the mod polls the tracker or is paused |
| `/workitems pause` | Stops the poll and every tracker read for this session |
| `/workitems resume` | Polls the tracker again and reads it once |

While the mod is paused, the other mods show no new work items.

Settings: none. A tracker that the mod does not detect is described in a `.handily.json` file at
the repository root, or in `~/.config/handily/adapters.json`.

More: [mods/handily-workitems/README.md](../mods/handily-workitems/README.md).

## handily-quiet-items

It draws one short row in place of each tracker write in the transcript. The model still reads the
full tool result.

| Command | What it does |
| --- | --- |
| `/quiet-items` | Turns the short rows off or on for this session |
| `/quiet-items on` | Turns the short rows on for this session |
| `/quiet-items off` | Turns the short rows off for this session. Tracker commands draw in full |

When `/simple` is off, tracker writes draw in full, also when `/quiet-items` is on.

Settings:

- `mode`: `on` (default) or `off`. The mode when a session starts.
- `titleLength`: 10 to 200, default 60. The count of title characters in a row.

More: [mods/handily-quiet-items/README.md](../mods/handily-quiet-items/README.md).

## handily-item-toasts

It shows a toast when a work item changes outside this session. It shows at most one toast every
30 seconds.

| Command | What it does |
| --- | --- |
| `/item-toasts` | Turns the toasts off or on for this session |
| `/item-toasts on` | Turns the toasts on for this session |
| `/item-toasts off` | Turns the toasts off for this session |

Settings:

- `mode`: `on` (default) or `off`. The mode when a session starts.

More: [mods/handily-item-toasts/README.md](../mods/handily-item-toasts/README.md).

## handily-simple-view

It draws one short row for each tool call: a built-in tool, an MCP tool or a tool that a plugin
adds. Bash, Edit, Write, Read, Grep and Glob have rich rows. Every other tool has one row with its
name, a short summary of the input, its state, and the size of its result and its time. A call
that asks you or shows you a plan keeps the row of Claude Code. The row of another mod, such as a
`handily-board` task row, stays. A Bash row with output has a `more` button and a `copy` button.

| Command | What it does |
| --- | --- |
| `/simple` | Turns the short rows off or on for this session |
| `/simple on` | Turns the short rows on for this session |
| `/simple off` | Turns the short rows off for this session. Tool calls draw as Claude Code draws them |
| `/simple show N` | Prints the input, the output and the file diff of the N-th last tool call. 1 is the last call |

Settings:

- `mode`: `on` (default) or `off`. The mode when a session starts.

More: [mods/handily-simple-view/README.md](../mods/handily-simple-view/README.md).

## handily-reply-view

It folds a reply of more than 30 lines to its first lines. Tables draw without box lines, and each
table and code block gets a `copy` button. Each prompt that you type opens under a rule labelled
`you`.

| Command | What it does |
| --- | --- |
| `/replies` | Turns the reply view off or on for this session |

`/replies` takes no argument.

Settings:

- `mode`: `on` (default) or `off`. The mode when a session starts.

More: [mods/handily-reply-view/README.md](../mods/handily-reply-view/README.md).

## handily-board

It shows a board with two tabs. The `this session` tab shows the task list that Claude and you
share, and the agents of this session. The `this machine` tab shows a card for each local Claude
Code session, and the sessions that wait for you come first.

| Command | What it does |
| --- | --- |
| `/board` | Opens the board on the `this session` tab. With the `toggle` mode, it closes a shown `this session` tab |
| `/board machine` | Opens the board on the `this machine` tab |
| `/board add <text>` | Adds a task with your text |
| `/board add <item id>` | Adds a task with the title of that open work item, once |
| `/board add -- <text>` | Adds the text as a task, also when it looks like an item id |
| `/board rm <n>` | Removes task `n` |
| `/board list` | Prints the task list as text. With no tasks, it lists the open work items |
| `/board close` | Closes the board |

Claude keeps the list with four model tools: `task_add`, `task_update`, `task_move` and
`task_list`. You do not type them.

Settings:

- `mode`: `off`, `toggle` (default) or `always`. With `off`, the board opens only on `/board` or
  `/board machine`. With `toggle`, `/board` also closes a shown `this session` tab. With
  `always`, the board opens when a session starts.

More: [mods/handily-board/README.md](../mods/handily-board/README.md).
