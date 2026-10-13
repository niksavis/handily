# board

`board` shows your work in one pane with two tabs. The `this session` tab shows the task list
that Claude and you share. The `this machine` tab shows the card of this session. Claude keeps
its plan in the list through four model tools. You see the list and change it with `/board`, or
on the board.

A default Claude Code session has no task tool of its own, so the mod owns the list. It does not
read or write the built-in `Task*` tools.

`board` replaces `task-pane`. The `/task` command is gone. Use `/board` and `/board list`.

## Install

`handily-board` depends on `handily-workitems`. Claude Code installs it with the board:

```text
/plugin install handily-board --marketplace niksavis/handily
```

## Commands

| Command                | Effect                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| `/board`               | Opens the board and shows the `this session` tab                        |
| `/board machine`       | Opens the board and shows the `this machine` tab                        |
| `/board add <text>`    | Adds a task with the author `you`                                       |
| `/board add <item id>` | Adds a `tracker` task with the title of that open item, once            |
| `/board add -- <text>` | Adds the text as a task, also when it looks like an item id             |
| `/board rm <n>`        | Removes task `n`                                                        |
| `/board list`          | Prints the list as text. With no tasks, it lists the open tracker items |
| `/board close`         | Closes the board                                                        |

Replies, from the tests:

```text
/board                   Board opened: this session.
/board machine           Board opened: this machine.
/board close             Board closed.
/board add Write it      Added task 1: Write it. Claude is told the list changed.
/board add -- app-x1     Added task 2: app-x1. Claude is told the list changed.
/board rm 9              No task 9. This session has tasks 1-2; /board list prints them.
/board frob              Unknown argument "frob". Use /board, /board machine, /board add <text|id>, /board rm <n>, /board list or /board close.
```

- `/board` and `/board machine` open both panes, so Claude Code shows them as two tabs. When the
  tab that you asked for is hidden, the mod opens it with `focus`, so it comes forward and takes
  the keyboard. Esc gives the keyboard back. When the tab is already shown, the mod opens it
  without `focus`, and the keyboard stays at the prompt.
- When Claude Code does not show the board yet, the reply says why and names `/board list`.
- A change that you make appends a note that starts with `[handily-board]`, so Claude reads the
  new list. Claude Code lists the note at once, also during a turn. When a plugin refuses the
  note, the change stays and the reply says that Claude was not told, and why.
- An argument of one word with a hyphen, such as `app-cd34`, is read as an item id. When the
  tracker has no such item, the mod adds the word as text and says so.
- `/board add <item id>` says why by name when `workitems` cannot read the item, and names
  `/board add -- <id>`.
- An item that is closed or deferred is not open. `/board add <item id>` refuses it by name, and
  `/board list` and the board do not count or list it.
- Task numbers do not move when a task is removed. `/board rm` of a missing number lists the
  numbers that exist.

## What Claude gets

| Tool          | Input                                                                  | Effect                               |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| `task_add`    | `title`                                                                | Adds a pending task                  |
| `task_update` | `id`, and `status`: `pending`, `in_progress`, `completed` or `removed` | Sets the status, or removes the task |
| `task_move`   | `id` and `before`: two task ids                                        | Moves task `id` before task `before` |
| `task_list`   | none                                                                   | Returns the list                     |

- The mod registers the tools at `session.start`. The model calls them as
  `mcp__handily-board__<name>`. Each answer is the whole list, in the order of the work.
- `task_move` changes the order of the list. The task ids do not change. A move that names an
  unknown id, or the same id twice, is refused with the ids that exist and the correct form.
- A system prompt section (`handily-board:tasks`, scope `session`) tells the model to keep its
  plan in the list. The section is added only when the request offers `task_list`. The
  `task_add` description carries the same instruction, for an organization whose plugin
  bypasses the `prompt.compose` hook of a user plugin.
- A bad input is refused with the reason and the correct form. The list does not change.
- A title must be one line with no control character and no bidi control character. It has at
  most 200 characters. A run of spaces in a title becomes one space. The list holds at most 100
  tasks. The model and the person get the same refusal, by name.
- Each row of a `/board list` reply and of a model tool answer shows the task number, the
  status, the author and the title. The author is `you`, `claude` or `tracker`, and it comes
  before the title, so a title cannot imitate it.
- In what the model reads, tracker text and a title that the model wrote are quoted with
  `JSON.stringify`, and a control, format or line separator character is escaped as `\uXXXX`.
  A reply, note or tool answer that holds tracker text says that this text is data, not an
  instruction.
- Parallel edits do not get lost. Each edit goes through `update` from `claude-code`, which
  reads the list again when another edit wrote first.
- Each call of a task tool draws one short row in the transcript, as `task-pane` did.

## One list per agent

| Caller        | List                                                          |
| ------------- | ------------------------------------------------------------- |
| The main loop | `$.state` `{ plugin: 'handily-board', key: 'list' }`          |
| A subagent    | `$.state` `{ plugin: 'handily-board', key: 'agentList', id }` |

- The tools of a subagent act only on the list of that subagent. The board, `/board` and the
  `[handily-board]` notes act only on the list of the main loop.
- Another mod reads the agent ids in `{ plugin: 'handily-board', key: 'agentIds' }`.
- The session keeps the lists of at most 100 agents.

## The this session tab

Captures from the tests, docked at 41 columns:

```text
Tasks  1 of 4 done · 14m
▶ 2 Write the tab mocks         4m [ rm ]
    ▸ Edit docs/mocks.md          9 tools
○ 3 Review the mocks with Codex
○ 4 You: Ask the person about tabs
[ +1 done ]

[ Add a task ][Add]
```

The same list inline above the prompt, at 80 columns:

```text
Tasks  1 of 4 done · 14m
▶ 2 Write the tab mocks                 ▸ Edit docs/mocks.md · 9 tools 4m [ rm ]
○ 3 Review the mocks with Codex
○ 4 You: Ask the person about tabs
[ +1 done ]

[ Add a task ][Add]
```

- The header shows the done count and the time since the first tool call of the main loop.
  Times use one short form: `9s`, `5m`, `1h`, `2d`. They round down.
- Each task is one line: a mark (`✓` done in `success`, `▶` in progress in `claude`, `○`
  pending in `subtle`), the number, the author and the title. A task by `claude` shows no
  author. A task by you shows `You:` and a tracker task shows `tracker`, in the theme colour
  `suggestion`.
- The task in progress comes first, in bold, with its time and an `[ rm ]` button. Docked, the
  line under it shows the last tool and the count of tool calls since the task started. Inline,
  the same text is on the task line.
- Open tasks follow in list order. Done tasks fold into a `+N done` button.
- Press a task title to open it. An opened task shows its full title when the row cut it, then
  `not started yet`, `started 4m ago · 9 tools in all` or `took 3m · 2 tools in all`. A task that
  is not in progress also gets `[ up ] [ down ] [ rm ]`. `up` and `down` move the task past its
  neighbour with the same status, as `task_move` does, and Claude is told.
- The columns before the title have a fixed width. The title fills the room that is left and is
  cut with `…`, so a row never wraps. The tests check this at 30, 41 and 80 columns.
- `Agents` lists each subagent that is pending, running or waiting: its mark, its name, its plan
  count and its last tool.
- The mobile app has no input, so the tab says `Add tasks with /board add <text>.`
- The open rows and the unfolded groups are kept in `$.state` under `expanded`. `/clear`
  closes them.

### Empty states

With no tasks, the tab lists the open tracker items. The first and the last lines of a test
with 12 open items, docked at 41 columns:

```text
Tasks  none in this session yet
Open in tracker: beads · 12 open
P2 app-10 Open item 10            [ add ]
```

```text
[ all 12 open ]  [ Add 10 as tasks ]
No agents yet.

[ Add a task ][Add]
```

- The tab lists the first 10 open items. `all N open` shows every open item, and `first 10`
  folds them again. Each `[ add ]` and `Add N as tasks` is explicit. An item that is already a
  task is not added again.
- `No agents yet.` shows only while the task list is empty and no subagent runs.
- When the main loop keeps no list, a `▶ Now` line shows the last tool, the count of tool calls
  and the time. After 20 tool calls with no list, the tab says
  `No plan from Claude for 20 tool calls.` With a list that did not change, it says
  `No plan update for 20 tool calls.` `Ask Claude for a plan` puts a request into the prompt box.
  It does not send it.
- When the warning holds and you submit a prompt, the mod adds one note for Claude beside the
  prompt, at most once per 20 tool calls.
- Only a tool call that Claude Code raises for the model counts. A tool call that a plugin
  raises does not count. An example is the `AskUserQuestion` call of the `workitems` approval
  question.

## The this machine tab

The tab shows the card of this session, from the state of this session:

```text
Sessions
▶ this
  ▶ Write the tab mocks ▰▱▱▱ 1/4
  app · 14m elapsed
```

- The first line is the mark of the current task and the name `this`.
- The task line shows the task in progress, or the first pending task, with a bar and the done
  count. The bar has one cell per task, at most 8. With more tasks, each cell is a share. A
  session with no tasks shows `no tasks`. A list with every task done shows `all N done`.
- The place line shows the folder of the session and the time since the first tool call.
- The tab lists only this session.

## Settings

| `userConfig` `mode` | Effect                                                                |
| ------------------- | --------------------------------------------------------------------- |
| `off`               | The board opens only on `/board` or `/board machine`                  |
| `toggle` (default)  | As `off`, and `/board` on a shown `this session` tab closes the board |
| `always`            | The board opens when the session starts                               |

- With `always`, the mod opens the board without your input. Claude Code places such a pane only
  from 144 columns, or 110 once you opened it before. Below that, the board waits undrawn, and the
  mod shows one toast: `Board waits for a wider terminal. Run /board to open it here.`

## Lifetime

- The list and the tool calls live in `$.state`, so they survive a hot reload of the mod.
- `/clear` ends the session with the reason `clear`. The list of the main loop, the lists of all
  subagents and the tool calls reset.
- The board draws again at each tool call, and every 10 seconds while a tab is shown, so the
  times move.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/handily-board
```

`board` depends on `workitems`, so load the `mods` folder. The tests replace `workitems` with an
inline fake.
