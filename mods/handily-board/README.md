# handily-board

`board` shows your work in one pane with two tabs. The `this session` tab shows the task list
that Claude and you share. The `this machine` tab shows a card for each Claude Code session on
this machine, and the session that waits for you comes first. Claude keeps
its plan in the list through four model tools. You see the list and change it with `/board`, or
on the board.

A default Claude Code session has no task tool of its own, so the mod owns the list. It does not
read or write the built-in `Task*` tools.

`board` replaces `task-pane`, `session-board` and `agent-board`. The `/task`, `/session-board`
and `/agent-board` commands are gone. Use `/board` and `/board list`.

[docs/install.md](../../docs/install.md) gives the install, update and uninstall steps.

## Commands

| Command                    | Effect                                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| `/board`                   | Opens the board and shows the `this session` tab                        |
| `/board machine`           | Opens the board and shows the `this machine` tab                        |
| `/board add <text>`        | Adds a task with the author `you`                                       |
| `/board add <item id>`     | Adds a `tracker` task with the title of that open item, once            |
| `/board add -- <text>`     | Adds the text as a task, also when it looks like an item id             |
| `/board rm <n>`            | Removes task `n`                                                        |
| `/board mv <n> before <m>` | Moves task `n` before task `m`                                          |
| `/board mv <n> top`        | Moves task `n` to the start of the list                                 |
| `/board mv <n> bottom`     | Moves task `n` to the end of the list                                   |
| `/board done <n>`          | Marks task `n` done                                                     |
| `/board start <n>`         | Marks task `n` in progress                                              |
| `/board open <n>`          | Marks task `n` pending                                                  |
| `/board clear`             | Removes every done task                                                 |
| `/board list`              | Prints the list as text. With no tasks, it lists the open tracker items |
| `/board close`             | Closes the board                                                        |

Replies, from the tests:

```text
/board                   Board opened: this session.
/board machine           Board opened: this machine.
/board close             Board closed.
/board add Write it      Added task 1: Write it. Claude is told at your next prompt.
/board add -- app-x1     Added task 2: app-x1. Claude is told at your next prompt.
/board rm 9              No task 9. This session has tasks 1-2; /board list prints them.
/board done 2            Task 2 is now done: app-x1. Claude is told at your next prompt.
/board done 2            Task 2 is already done. Nothing changed.
/board start 9           No task 9. This session has tasks 1-2; /board list prints them.
/board clear             Cleared 1 done task: 2. Claude is told at your next prompt.
/board clear             No done task to clear. Nothing changed.
/board add Ship it       Added task 3: Ship it. Claude is told at your next prompt.
/board mv 3 top          Moved task 3 to the top. Claude is told at your next prompt.
/board mv 3 before 1     Task 3 is already before task 1. Nothing changed.
/board frob              Unknown argument "frob". Use /board, /board machine, /board add <text|id>, /board rm <n>, /board mv <n> before <m>|top|bottom, /board done <n>, /board start <n>, /board open <n>, /board clear, /board list or /board close.
```

- `/board` and `/board machine` open both panes, so Claude Code shows them as two tabs. When the
  tab that you asked for is hidden, the mod opens it with `focus`, so it comes forward and takes
  the keyboard. Esc gives the keyboard back. When the tab is already shown, the mod opens it
  without `focus`, and the keyboard stays at the prompt.
- When Claude Code does not show the board yet, the reply says why and names `/board list`.
- A change that you make, by a command or a button, waits for your next prompt. That prompt
  carries one note for Claude, beside the prompt, that starts with `[handily-board]`. The note
  names each change since the last prompt, in order, and then shows the list as it is now. So
  three changes in one turn reach Claude as one note. A prompt that another hook drops keeps
  the note for the prompt after it. Any prompt that enters carries the note, also a prompt that
  Claude Code typed for a background task.
- Claude does not see a change during the turn in which you make it, unless it reads the list
  with a task tool. When the board cannot keep the note, the change stays, and the reply says
  that Claude was not told. The transcript log says why.
- `/board done`, `/board start` and `/board open` set the same statuses as `task_update`:
  `completed`, `in_progress` and `pending`. A task that already has the status does not change.
- `/board mv` changes the order of the list, as `task_move` does. `top` and `bottom` are the
  ends of the whole list. The board draws the tasks by status, so on the board the task moves
  inside its status group. A move to the place that the task already has changes nothing.
- An argument of one word with a hyphen, such as `app-cd34`, is read as an item id. When the
  tracker has no such item, the mod adds the word as text and says so.
- `/board add <item id>` says why by name when `workitems` cannot read the item, and names
  `/board add -- <id>`.
- An item that is closed or deferred is not open. `/board add <item id>` refuses it by name, and
  `/board list` and the board do not count or list it.
- Task numbers do not move when a task is removed. A command with a missing number lists the
  numbers that exist.

## Keyboard

You can press every button on both tabs with the keyboard alone. A live check on Claude Code
2.1.300 in a terminal measured these keys:

| Key                        | Effect                                                               |
| -------------------------- | -------------------------------------------------------------------- |
| `/board`, `/board machine` | A hidden tab comes forward and takes the keyboard                    |
| ctrl+x, then Tab           | Gives the keyboard to the tab that is shown                          |
| Tab, Shift+Tab             | Moves the focus to the next or the previous button, in reading order |
| Enter                      | Presses the button that has the focus                                |
| Esc                        | Gives the keyboard back to the prompt. The board stays open          |

- Claude Code keeps the focus at the same place in the order of the buttons, not on the same
  button. A live check on 2.1.300 measured this with `up` and `down`: the task moved, and the
  focus went to the next or the previous button of the task. Now, after `up` or `down`, the
  mod asks Claude Code to put the focus on the same button of the moved task. The key of an
  `up` or `down` button holds the place of the task, so the mod asks for a button that only
  the next drawing has. The tests check the request. They cannot check the focus, because the
  test kit has no focus ring. The `+N more agents` and `all N open` folds add their rows before
  the button, so by the same rule the focus goes to the first row that the fold shows. Use Tab
  or Shift+Tab to go back to the button.
- The focus shows as inverted text. Reading order is top to bottom, and left to right on a line.
  After the last button, Tab goes to the `Add a task` input, then to the tab row and the close
  mark of Claude Code, and then to the first button again.
- To unfold the plan of an agent, move to the agent name and press Enter. When the plan has more
  than 5 tasks, the opened row ends with a button such as `[ all 7 ]`. Move to it and press
  Enter to show every task. The button becomes `[ fold ]` in the same place, so the next Enter
  folds the plan.
- The `+N done` and `+N ended` folds add their rows after the button. The plan button adds only
  rows of text, which take no focus. So for these buttons the focus stays on the button.
- The tests check each tab on the terminal and desktop surfaces. Each button has its own key,
  the buttons come in reading order, and `/board` asks for the keyboard with `focus` only. The
  live check covered the terminal. The desktop app was not checked live.

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
  tasks, done tasks included. The model and the person get the same refusal, by name. When
  some of the 100 tasks are done, the refusal counts them and names the remedy of the caller.
  Your refusal names `/board clear`. The refusal of Claude or a subagent names `task_update`
  with the status `removed`, because `/board clear` is your command and clears only the list
  of the main loop. A refused add removes no task.
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
- The board also copies each agent list into one value, `{ plugin: 'handily-board', key:
'agentPlans' }`, so a draw reads every plan at once. `agentList` stays the source. Each plan
  change rewrites that one value: about 150 KB with 30 agents of 20 tasks.

## The this session tab

Captures from the tests, docked at 41 columns:

```text
Tasks  1 of 4 done · 14m
▶ 2 Write the tab mocks         4m [ rm ]
    ▸ Edit docs/mocks.md          9 tools
○ 3 Review the mocks with Codex    [ rm ]
○ 4 You: Ask the person about tabs [ rm ]
[ +1 done ]

[ Add a task ][Add]
```

The same list inline above the prompt, at 80 columns:

```text
Tasks  1 of 4 done · 14m
▶ 2 Write the tab mocks                 ▸ Edit docs/mocks.md · 9 tools 4m [ rm ]
○ 3 Review the mocks with Codex                                           [ rm ]
○ 4 You: Ask the person about tabs                                        [ rm ]
[ +1 done ]

[ Add a task ][Add]
```

- The header shows the done count and the time since the first tool call of the main loop.
  Times use one short form: `9s`, `5m`, `1h`, `2d`. They round down.
- Each task is one line: a mark (`✓` done in `success`, `▶` in progress in `claude`, `○`
  pending in `subtle`), the number, the author and the title. A task by `claude` shows no
  author. A task by you shows `You:` and a tracker task shows `tracker`, in the theme colour
  `suggestion`.
- Each task row ends with an `[ rm ]` button, so one press removes a task of any status.
- The task in progress comes first, in bold, with its time. Docked, the line under it shows the
  last tool and the count of tool calls since the task started. Inline, the same text is on the
  task line.
- Open tasks follow in list order. Done tasks fold into a `+N done` button. Pressed, the
  button shows the done tasks and a `[ clear done ]` button after them. It acts as
  `/board clear`: every done task leaves the list, and the toast is the reply.
- Press a task title to open it. An opened task shows its full title when the row cut it, then
  `not started yet`, `started 4m ago · 9 tools in all` or `took 3m · 2 tools in all`.
- An opened task then shows a line of status buttons: the two statuses that the task does not
  have, in the order `done`, `start` and `open`. They act as `/board done`, `/board start` and
  `/board open`, and the toast is the reply of the command. A task that you start or finish
  keeps its clock, as when Claude does it.
- A task that is not in progress also gets `[ up ] [ down ]` on the next line. `up` and `down`
  move the task past its neighbour with the same status, as `task_move` does, and Claude is
  told. The focus goes to the same button of the moved task.
- The columns before the title have a fixed width. The title fills the room that is left and is
  cut with `…`, so a row never wraps. The tests check this at 30, 41 and 80 columns.
- The mobile app has no input, so the tab says `Add tasks with /board add <text>.`
- The open rows and the unfolded groups are kept in `$.state` under `expanded`. `/clear`
  closes them.

### Agents

The subagents of this session follow the tasks. A capture from the tests, docked at 41 columns:

```text
Agents  3 · 1 failed
■ lane-b    failed                     4m
    failed after Bash npm test
▶ Explore   plan 2/7  ▸ Read pa… open  1m
▶ scout     on hold   ▸ Agent find t…  2m
[ +2 ended ]
```

- Each agent is one row: the mark, the name, the state, the current tool and the time since the
  spawn. The time stops when the agent ends.
- The name is the name of the Agent call, else the agent type, else the first 8 characters of
  the id. A name of more than 9 characters keeps its first 4 and its last characters around `…`,
  such as `gene…pose`. When two rows show the same name, the later one gets a number, such as
  `Explore 2` or `gene…se 2`.
- The state is `running`, `plan 2/7` while a running agent keeps a task list, `on hold`,
  `pending`, `idle`, `failed`, `done`, `killed` or `not listed`.

  | Mark | State                                      | Colour    |
  | ---- | ------------------------------------------ | --------- |
  | `■`  | `failed`                                   | `error`   |
  | `▶`  | `running`, `on hold`                       | `claude`  |
  | `○`  | `pending`, `idle`                          | `subtle`  |
  | `✓`  | `done`, `killed`                           | `success` |
  | `?`  | `not listed`: Claude Code does not list it | `subtle`  |

- `on hold` is the engine status `waiting`: the agent waits for its own background work, an
  Agent call or a plan approval. The status does not say which, so the board does not draw it
  as a wait for you.
- The tool column shows `▸` and the call that runs now, or the last call. Below 36 columns the
  tool column is left out. Docked, a failed agent gets a second line, `failed after` its last
  call. Inline, that text is in the tool column.
- Order: failed first, then running, on hold, pending and idle, each in spawn order. Ended
  agents fold into `+N ended`. At most 6 active agents show. The rest fold into
  `+N more agents`, so the Add input stays on screen.
- A running agent row has an `open` button before the time. A press runs `/tasks`, which opens
  Claude Code's view of the background agents: with one running agent its detail view, with more
  the list, where you pick the agent. Claude Code has no way for a plugin to pick the agent. An
  agent that is on hold, pending, idle, failed or ended has no button. When Claude Code refuses
  the run, the board logs why and says so in a toast. At 30 columns the button takes the place
  of the tool column: `▶ Explore   plan 2/7  open  1m`.
- Press an agent name to open it. The opened row shows the task description, the parent and the
  spawn age (`under scout · spawned 1m ago`), the count of finished tool calls and the task list
  of the agent. A list of more than 5 tasks shows the task in progress with 2 tasks before and
  2 after it, and `all 7` shows every task.
- An agent loop that Claude Code does not list, such as a fork of the engine, gets a `?` row with
  the first 8 characters of its id. It stays with the active agents while a call runs, and goes
  under `+N ended` after. The board keeps at most 20 such rows that run no call.
- Only a tool call that Claude Code raises for the model moves a row. A call that a plugin raises
  does not.
- The rows live in `$.state` under `agents`, so a hot reload keeps them. The board reads the list
  of agents each time it draws, and keeps the statuses every 10 seconds while a tab is shown, and
  at the end of each subagent turn.

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
- `No agents yet.` shows only while the task list is empty and the board knows no agent.
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

The tab shows a card for each Claude Code session on this machine:

```text
Sessions  4 · 1 needs you · 12s ago
◆ api-login  interactive  needs you
  waits for: permission
  ▶ Fix the login redirect ▰▰▱ 2/3
  api · feat/login · 2h worked
─────────────────────────────────────────
▶ mocks  interactive  this  busy
  ▶ Write the tab mocks ▰▱▱▱ 1/4
  app · main · 14m worked · est. 30m left
  agents 3 · 1 failed
─────────────────────────────────────────
▶ lane-a1  background  working
  ▶ Build the tab pane ▰▰▰▱▱▱ 3/6
  app.wt/lane-a1 · lane/a1 · 22m worked
─────────────────────────────────────────
✓ docs-pass  background  done
  docs · main · ended
1 older background job hidden
```

- The header counts the cards, the sessions that need you and the failed ones, and says how old
  the list is.
- The cards sort by attention: a session that needs you, then failed, working, idle and ended.
  This session goes first in its own group, not first overall.
- The first line of a card is the mark, the name, the `interactive` or `background` badge,
  `this` on this session, and the state.

  | Mark | State                                                      | Colour    |
  | ---- | ---------------------------------------------------------- | --------- |
  | `◆`  | `needs you`: a `waitingFor` value, or `waiting`, `blocked` | `warning` |
  | `■`  | `failed`                                                   | `error`   |
  | `▶`  | `busy`, `working`                                          | `claude`  |
  | `○`  | `idle`, or a word the board does not know                  | `subtle`  |
  | `✓`  | `done`, `stopped`                                          | `success` |

- A session that needs you has a `waits for:` line with its `waitingFor` value. With no value,
  the line says `waits for: an answer`.
- The task line shows the current task, a bar and the done count. The bar has one cell per task,
  at most 8. With more tasks, each cell is a share. A session that runs the board with an empty
  list shows `no tasks`. A session without the board has no task line.
- The place line is the worktree, the branch and the time. The time is `worked` for a session
  that runs the board: the sum of its turns. Other sessions show the time `elapsed` since they
  started. `est. <time> left` follows when the board has an estimate.
- This session's card reads the task list, the time worked and the agents of this session, not
  the poll. Its `agents` line counts the agents that did not end, and the failed ones.
- A card of another session that has not ended, with a key that is not stale and lists agents,
  has an `agents` line and at most 4 agent rows: the mark, the name, the current task and the
  done count. An agent that has no task list shows `no tasks`. A failed agent has the mark `■`.
  The other agents fold into a `+N more agents` button, which adds `· N need you` when a hidden
  agent needs you. A capture from the tests, docked at 41 columns:

  ```text
  agents 6 · 1 needs you · 1 failed
  ◆ scout         needs you         4/9
  ▶ Explore       Map the hooks     2/5
  ▶ tester        Run the unit te…  0/1
  ▶ reviewer      Review board.tsx  1/3
  [ +2 more agents ]
  ```

- An agent name on a card keeps up to 12 characters. A longer name keeps its first 4 and its last
  7 characters around `…`, such as `gene…purpose`. The task text is cut first. At 30 columns,
  `▶ gene…purpose Write…  1/4` keeps the whole name.

- The rows that need you come first. No source marks an agent as one that needs you yet; the
  board reads a `needsYou` flag in the store key when one is there.
- A background session whose state has not changed for over 24 hours is hidden, and a footer
  counts it.
- Below 36 columns, the badge, the age of the list and the words `worked` and `elapsed` drop.
- Inline above the prompt, from 60 columns, each session is one row: the name, `inter` or `bg`,
  the state, the place, the task count and the time. A name of more than 9 characters keeps its
  first 4 and last 4 characters. The agents of another session fold into one `N agents` button
  under the row. Pressed, it shows the agent rows and becomes `hide N agents`.

### Where the data comes from

- `claude agents --json --all`, every 15 seconds, only while the tab is shown. The mod keeps the
  result with its time in its `$.store` under the key `agents`. When another session polled less
  than 15 seconds ago, the tab uses that result.
- The worktree and the branch come from two git commands in the folder of the session. The mod
  runs them only when that folder changes.
- Each session that runs the board writes its store key `session:<session id>`: the current
  task, the done and total counts, and the time worked. Other sessions read it from the same
  store. A poll removes a key of a session that is not listed and is older than 24 hours.
- The key also lists the active subagents of the session: the name, the current task, the done
  and total counts and whether the agent failed. The board writes it when a subagent task list
  changes, when an agent starts and when an agent turn ends. The name keeps 40 characters and
  the task 80.
- A key is at most 4096 bytes. When it is larger, the board drops agents from the end of the
  list until it fits, and keeps the count of all agents. The opened fold then says how many are
  over the store limit. A key that is larger with no agent is not written, and the debug log
  says so.
- A key written more than 60 seconds before its session started is from an earlier run. Its task
  shows `(stale)`, with no estimate, and the card shows the elapsed time.
- The estimate divides the done tasks by all tasks and applies the result to the time since the
  first task. It shows after one task is done, and not for 5 minutes after a task is added.

### States

| State                                         | The tab shows                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| The first poll has not answered               | `Listing the local sessions…`                                          |
| The poll lists no session                     | `No local sessions are listed.`, and this card as `not listed (stale)` |
| Only this session runs                        | `Sessions  1` and `Only this session is running.`                      |
| A poll failed over 30 s after the last answer | `Last poll failed; showing 2m old data.` above the cards               |
| The command exits with an error               | `claude agents --json failed: exit 1.` and `retry in 15s`              |
| The output is no JSON list                    | `claude agents --json failed: the output is not a JSON list.`          |
| The output is over 4 MiB                      | `claude agents --json failed: the output is over 4 MiB and was cut.`   |
| `claude` does not start                       | `claude is not on PATH, so other sessions cannot be listed.`           |
| No terminal surface, such as the desktop app  | `Other sessions are listed only in a terminal session.`, and this card |

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
- Each end of the session, `/clear` and a resume included, clears the agent rows.
- The board draws again at each tool call, and every 10 seconds while a tab is shown, so the
  times move.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/handily-board
```

`board` depends on `workitems`, so load the `mods` folder. The tests replace `workitems` with an
inline fake.
