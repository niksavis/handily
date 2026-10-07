# task-pane

`task-pane` keeps one task list per session that Claude and you share. Claude keeps its plan in
the list through three model tools. You see the list and change it with `/task`, or in a pane.

A default Claude Code session has no task tool of its own, so the mod owns the list. It does not
read or write the built-in `Task*` tools.

## What Claude gets

| Tool          | Input                                                                  | Effect                               |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| `task_add`    | `title`                                                                | Adds a pending task                  |
| `task_update` | `id`, and `status`: `pending`, `in_progress`, `completed` or `removed` | Sets the status, or removes the task |
| `task_list`   | none                                                                   | Returns the list                     |

- The mod registers the tools at `session.start`. The model calls them as
  `mcp__task-pane__<name>`. Each answer is the whole list.
- A system prompt section (`task-pane:tasks`, scope `session`) tells the model to keep its plan
  in the list. The section is added only when the request offers `task_list`.
- On a Team organization, the built-in `cc-plugin-sec-default` plugin bypasses the
  `prompt.compose` hook of a user plugin (measured with Claude Code 2.1.293), so the section
  is not sent. The `task_add` description carries the same instruction, so the model reads it
  in every organization.
- A bad input is refused with the reason and the correct form. The list does not change.
- A title must be one line with no control character, and at most 200 characters. The list
  holds at most 100 tasks. The model and the person get the same refusal, by name.
- Parallel edits do not get lost. Each edit goes through `update` from `claude-code`, which
  reads the list again when another edit wrote first.

## Commands

| Command               | Effect                                                         |
| --------------------- | -------------------------------------------------------------- |
| `/task`               | Shows the list. With no tasks, it lists the open tracker items |
| `/task add <text>`    | Adds a task as you, marked `(you)`                             |
| `/task add <item id>` | Adds a task with the title of that work item, once             |
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
- Task numbers do not move when a task is removed. `/task rm` of a missing number lists the
  numbers that exist.

## The pane

- Each task has a mark (`✓` done, `▶` in progress, `○` pending) and an `[rm]` button. An input
  with `Add` adds a task as you. The mobile app has no input, so the pane shows the command.
- With no tasks, the pane lists up to 10 open tracker items, each with an `[add]` button, and an
  `Add N as tasks` button. Nothing is added on its own. An item that is already a task is not
  added again.
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
- `/clear` ends the session with the reason `clear`, and the list resets.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/task-pane
```

`task-pane` depends on `workitems`, so load the `mods` folder. The tests replace `workitems`
with an inline fake.
