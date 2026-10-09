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
  `mcp__task-pane__<name>`. Each answer is the whole list, in the order of the work.
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

| Caller        | List                                                      |
| ------------- | --------------------------------------------------------- |
| The main loop | `$.state` `{ plugin: 'task-pane', key: 'list' }`          |
| A subagent    | `$.state` `{ plugin: 'task-pane', key: 'agentList', id }` |

- The tools of a subagent act only on the list of that subagent. `task_list` returns the list of
  the agent that calls it.
- `/task`, the pane and the `[task-pane]` notes act only on the list of the main loop.
  `session-board` reads that list.
- Another mod reads the agent ids in `{ plugin: 'task-pane', key: 'agentIds' }`, in the order of
  their first task, and reads each list by its agent id.
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

- Each task is one line: a mark (`✓` done, `▶` in progress, `○` pending), the number, the
  author column, the title and an `[ rm ]` button. An input with `Add` adds a task as you. The
  mobile app has no input, so the pane shows the command.
- With no tasks, the pane says `Open in tracker: <tracker> · N open` and lists the first 10 open
  tracker items. With more than 10, an `all N open` button shows every open item, and
  `first 10` folds them again. Each item is one line: the priority (dim), the id, the title and
  an `[ add ]` button. An `Add N as tasks` button adds the items that the pane shows. Nothing
  is added on its own. An item that is already a task is not added again.
- The columns before the title have a fixed width, and an id is never cut. The title fills the
  room that is left in the pane width and is cut to fit, so a row never wraps. The tests check
  this at 30, 45 and 80 columns.
- A cut title ends with a `…` button. Press it to show the full title, wrapped under the row.
  Press it again to hide it. The open rows are kept in `$.state` under `expanded`, for the
  session. `/clear` closes them. A title that fits shows no `…`.
- Claude Code places the pane. It docks beside the transcript in fullscreen mode, and draws
  inline above the prompt otherwise. Inline, when the tasks and the frame need more than 6
  rows, the done tasks fold into a `+N done hidden` count.

## Settings

| `userConfig` `mode` | Effect                                                     |
| ------------------- | ---------------------------------------------------------- |
| `off`               | The pane opens only on `/task pane`                        |
| `toggle` (default)  | `/task pane` opens the pane, and closes it when it is open |
| `always`            | The pane opens when the session starts                     |

## Lifetime

- The list lives in `$.state`, so it survives a hot reload of the mod.
- `/clear` ends the session with the reason `clear`. The list of the main loop and the lists of
  all subagents reset.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/task-pane
```

`task-pane` depends on `workitems`, so load the `mods` folder. The tests replace `workitems`
with an inline fake.
