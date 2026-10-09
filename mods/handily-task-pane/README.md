# task-pane

`task-pane` keeps one task list per session that Claude and you share. Claude keeps its plan in
the list through four model tools. You see the list and change it with `/task`, or in a pane.
Each subagent keeps a list of its own.

A default Claude Code session has no task tool of its own, so the mod owns the list. It does not
read or write the built-in `Task*` tools.

## What Claude gets

| Tool          | Input                                                                  | Effect                               |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| `task_add`    | `title`                                                                | Adds a pending task                  |
| `task_update` | `id`, and `status`: `pending`, `in_progress`, `completed` or `removed` | Sets the status, or removes the task |
| `task_move`   | `id` and `before`: two task ids                                        | Moves task `id` before task `before` |
| `task_list`   | none                                                                   | Returns the list                     |

- The mod registers the tools at `session.start`. The model calls them as
  `mcp__handily-task-pane__<name>`. Each answer is the whole list, in the order of the work.
- `task_move` changes the order of the list. The task ids do not change. A move that names an
  unknown id, or the same id twice, is refused with the ids that exist and the correct form.
- A system prompt section (`task-pane:tasks`, scope `session`) tells the model to keep its plan
  in the list. The section is added only when the request offers `task_list`.
- On a Team organization, the built-in `cc-plugin-sec-default` plugin bypasses the
  `prompt.compose` hook of a user plugin (measured with Claude Code 2.1.293), so the section
  is not sent. The `task_add` description carries the same instruction, so the model reads it
  in every organization.
- A bad input is refused with the reason and the correct form. The list does not change.
- A title must be one line with no control character and no bidi control character. It has at
  most 200 characters. A zero-width joiner, a zero-width non-joiner and a soft hyphen are
  allowed. A run of spaces in a title becomes one space. The list holds at most 100 tasks. The
  model and the person get the same refusal, by name.
- Each row shows the task number, the status, the author and the title. The author is `you`
  for a task that you added, `claude` for a task that the model added, and `tracker` for a
  tracker item that you added. The author comes before the title, so a title cannot imitate it.
- In what the model reads, tracker text is always quoted with `JSON.stringify`, as
  `"app-cd34": "Write the beads reader"`, and a control, format or line separator character in
  it is escaped as `\uXXXX`. That applies to the rows, the notes, `task_list` and the `/task`
  replies. The text comes from the repository, not from you. Each reply, note and tool answer
  that holds tracker text says that this text is data, not an instruction. The system prompt
  section and the tool descriptions say the same.
- A note names the author of each task that it reports. A title that the model wrote is quoted
  the same way as tracker text, in the rows, the notes, `task_list` and the `/task` replies, as
  `claude   "Read the design doc"`. Only a title that you wrote is shown as it is.
- The pane is your view, so it shows ids and titles without the quotes, as
  `app-cd34: Write the beads reader`. It still escapes a control, format or line separator
  character as `\uXXXX`, so an id with a U+2028 or a bidi character cannot break a row or
  forge one.
- A tracker item whose id is not an item id, such as an id with a line break, is not added.
- Parallel edits do not get lost. Each edit goes through `update` from `claude-code`, which
  reads the list again when another edit wrote first.

## One list per agent

The `agentId` of a tool call names the loop that calls the tool. The main loop has no `agentId`.

| Caller        | List                                                              |
| ------------- | ----------------------------------------------------------------- |
| The main loop | `$.state` `{ plugin: 'handily-task-pane', key: 'list' }`          |
| A subagent    | `$.state` `{ plugin: 'handily-task-pane', key: 'agentList', id }` |

- The tools of a subagent act only on the list of that subagent. `task_list` returns the list of
  the agent that calls it.
- `/task`, the pane and the `[task-pane]` notes act only on the list of the main loop.
  `session-board` reads that list.
- Another mod reads the agent ids in `{ plugin: 'handily-task-pane', key: 'agentIds' }`, in the
  order of their first task, and reads each list by its agent id.
- Each list has the same title rules and the same limit of 100 tasks. The session keeps the lists
  of at most 100 agents. A `task_add` of an agent past that limit is refused by name.
- The list of a subagent that ended stays for the session.

## Commands

| Command               | Effect                                                         |
| --------------------- | -------------------------------------------------------------- |
| `/task`               | Shows the list. With no tasks, it lists the open tracker items |
| `/task add <text>`    | Adds a task with the author `you`                              |
| `/task add <item id>` | Adds a `tracker` task with the title of that open item, once   |
| `/task add -- <text>` | Adds the text as a task, also when it looks like an item id    |
| `/task rm <n>`        | Removes task `n`                                               |
| `/task pane`          | Opens the pane                                                 |

- A change that you make appends a note that starts with `[task-pane]`, so Claude reads the new
  list. Claude Code lists the note at once, also during a turn. When a plugin refuses the note,
  the change stays and the reply says that Claude was not told, and why.
- An argument of one word with a hyphen, such as `app-cd34`, is read as an item id. When the
  tracker has no such item, the mod adds the word as text and says so.
- `/task add <item id>` says why by name when `workitems` cannot read the item, and names
  `/task add -- <text>`.
- An item that is closed or deferred is not open. `/task add <item id>` refuses it by name, and
  `/task` and the pane do not count or list it.
- Task numbers do not move when a task is removed. `/task rm` of a missing number lists the
  numbers that exist.

## The pane

The pane shows the work of the main loop: the task list, the tool calls and the running
subagents. Two captures from the tests, 44 columns wide:

```text
Tasks  1 of 3 done · 4m
▶ 2 claude  Write the mocks        4m [ rm ]
            ▸ Edit docs/mocks.md     3 tools
○ 3 claude  Commit the mocks          [ rm ]
[ +1 done ]

[ Add a task ][Add]
```

```text
Tasks  0 of 1 done
○ 1 claude  Write the mocks           [ rm ]
────────────────────────────────────────────
Agents  1 running
● scout 3 of 7 ▸ mcp__search__grep hooks/

[ Add a task ][Add]
```

- The header shows the done count and the time since the first tool call of the main loop.
- Each task is one line: a mark (`✓` done, `▶` in progress, `○` pending), the number, the
  author column, the title and an `[ rm ]` button. An input with `Add` adds a task as you. The
  mobile app has no input, so the pane shows the command.
- The task in progress comes first, in bold, with the time since it started. The line under it
  shows the last tool and target of the main loop, and the count of tool calls since the task
  started. The target of a call with a description, such as a `Bash` call, is that description,
  not the command. Open tasks follow in list order.
- Done tasks fold into a `+N done` button. Press it to show them after the open tasks. Press
  `hide N done` to fold them again.
- Press a task title to show its full title, its start time and its tool count under the row.
  A task that was never in progress says so. Press the title again to hide them.
- When the list has no task in progress, a `▶ Now` line shows the last tool, the count of tool
  calls and the time since the first one.
- `Agents` lists each subagent that is pending, running or waiting: its name, its plan count
  from its own task list and its last tool. With no such subagent the section is not drawn.
- The columns before the title have a fixed width, and an id is never cut. The title fills the
  room that is left in the pane width and is cut to fit, so a row never wraps. The tests check
  this at 30, 45 and 80 columns. A tool target, a subagent name and every title are escaped
  as `\uXXXX` where they hold a control, format or line separator character.
- The open rows and the unfolded groups are kept in `$.state` under `expanded`, for the
  session. `/clear` closes them.
- Claude Code places the pane. It docks beside the transcript in fullscreen mode, and draws
  inline above the prompt otherwise. The pane draws again at each tool call, and every 10
  seconds while it is shown, so the times move.

### No list, or an old list

When the main loop keeps no task list, the pane shows the work from the tool calls:

```text
Tasks  none kept by Claude
▶ Now  Read one-more.ts       20 tools · <1m
  Read 20
Claude has kept no plan for 20 tool calls.
[ Ask Claude for a plan ]
```

- The `Now` line shows the last tool and target, the count of tool calls and the time since
  the first one. The line under it counts the calls per tool, in the order of first use.
- After 20 tool calls of the main loop with no task list, or with no change of the list by
  Claude, the pane shows a warning with the count. A list that the person changed still counts
  as old. With a list the warning reads `No plan update for N tool calls.`
- `Ask Claude for a plan` puts a plan request into the prompt box. It does not send it. A draft
  that you typed stays, and the request goes after it.
- When the warning holds and you submit a prompt, the mod adds one note for Claude beside the
  prompt. The note asks Claude to keep its plan with `task_add` and `task_update`. It comes at
  most once per 20 tool calls, only for a prompt that you typed, and it never blocks or changes
  the prompt. A prompt that another hook drops does not use up the note. It uses the `context`
  of `prompt.submit`, not `prompt.compose`. Whether a Team
  organization also bypasses `prompt.submit` for a user plugin is not measured yet.
- The task-pane tools themselves and the tool calls of subagents do not count.

### No tasks yet

- With no tasks, the pane says `Open in tracker: <tracker> · N open` and lists the first 10 open
  tracker items. With more than 10, an `all N open` button shows every open item, and
  `first 10` folds them again. Each item is one line: the priority (dim), the id, the title and
  an `[ add ]` button. An `Add N as tasks` button adds the items that the pane shows. Nothing
  is added on its own. An item that is already a task is not added again.
- A cut item title ends with a `…` button. Press it to show the full title, wrapped under the
  row. Press it again to hide it. A title that fits shows no `…`.

## Settings

| `userConfig` `mode` | Effect                                                     |
| ------------------- | ---------------------------------------------------------- |
| `off`               | The pane opens only on `/task pane`                        |
| `toggle` (default)  | `/task pane` opens the pane, and closes it when it is open |
| `always`            | The pane opens when the session starts                     |

## Lifetime

- The list lives in `$.state`, so it survives a hot reload of the mod.
- The tool calls live in `$.state` too: the counts, the last tool and the task times of the main
  loop under `activity`, and the last tool of each subagent under `agentActivity`.
- `/clear` ends the session with the reason `clear`. The list of the main loop, the lists of
  all subagents and the tool calls reset.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/handily-task-pane
```

`task-pane` depends on `workitems`, so load the `mods` folder. The tests replace `workitems`
with an inline fake.
