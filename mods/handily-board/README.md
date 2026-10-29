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
| `/board edit <n> <title>`  | Gives task `n` a new title                                              |
| `/board done <n>`          | Marks task `n` done                                                     |
| `/board start <n>`         | Marks task `n` in progress                                              |
| `/board open <n>`          | Marks task `n` pending                                                  |
| `/board plan`              | Adds the steps of the approved plan as tasks of `claude`                |
| `/board answer <n> <text>` | Answers task `n` for you, a question                                    |
| `/board pick <n> <option>` | Picks option number `option` of task `n` for you, a decision            |
| `/board reject <n> [why]`  | Rejects task `n` for you, with an optional reason                       |
| `/board undo <n>`          | Opens task `n` for you again, before your next prompt                   |
| `/board clear`             | Removes every done task                                                 |
| `/board list`              | Prints the list as text. With no tasks, it lists the open tracker items |
| `/board stats`             | Prints the session figures and the agents as text                       |
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
/board edit 3 Ship it now  Task 3 is now titled: Ship it now. Claude is told at your next prompt.
/board edit 3            Not changed: the new title is empty. /board edit needs a task number and a title, for example /board edit 2 Write the tests.
/board frob              Unknown argument "frob". Use /board, /board machine, /board add <text|id>, /board rm <n>, /board mv <n> before <m>|top|bottom, /board edit <n> <title>, /board done <n>, /board start <n>, /board open <n>, /board answer <n> <text>, /board pick <n> <option>, /board reject <n> [reason], /board undo <n>, /board plan, /board clear, /board list, /board stats or /board close.
/board plan              Added tasks 3-7 from the approved plan. Claude is told at your next prompt.
/board plan              The approved plan is already tasks 3-7. Nothing changed.
/board plan              No approved plan with numbered steps in this session. Nothing changed.
```

- `/board` and `/board machine` open both panes, so Claude Code shows them as two tabs. When the
  tab that you asked for is hidden, the mod opens it with `focus`, so it comes forward and takes
  the keyboard. Esc gives the keyboard back. When the tab is already shown, the mod opens it
  without `focus`, and the keyboard stays at the prompt.
- When Claude Code does not show the board yet, the reply says why and names `/board list`.
- `/board stats` prints the figures of the Session line, its details and the agent rows as
  text, for a screen reader or a session that cannot show the pane. The board does not need to
  be open. A reply from the tests:

  ```text
  Session  ◆ 1 waits · ctx 62% · $4.80 · last +$0.62
      ◆ scout waits for permission: Bash npm test
      context 124k of 200k · 1 compaction
      trend after 2 turns
      no breakdown on this host
      last turn 3m · +$0.62 · 1 edit · 0 errors · 1 agent spawned
      limits 5h 31% · 7d 13% · resets 5h in 2h · 7d in 4d
      checks 2 · 1 allowed · 1 asked
  Agents  2 · 1 needs you
      scout: needs you · ctx —
      Explore: running · ctx 48k
  ```

  Each line follows the same rules as the board. The waits are the agents that need you. Each
  agent line has the state of its row, such as `slow 45s`, and the context of its latest model
  request, or `ctx —` before the first one. When the host gives no usage, the first line is
  `Session  no context or cost on this host`, and the reply shows no context, cost or limit.

  The reply counts the context parts each time, and prints every part. A reply from the tests,
  on a host that gives the parts:

  ```text
  Session  ctx 62% · $1.70 · last +$0.10
      context 124k of 200k · 0 compactions
      trend ▁▂▄▄▅▅▅▅ 8 turns · +6k a turn
      auto-compact at 167k · in ~7 turns
      Messages              71k  36%
      System tools          18k   9%
      MCP tools             12k   6%
      Memory files           9k   5%
      Custom agents          5k   3%
      Skills                 4k   2%
      System prompt          3k   2%
      Plugins                2k   1%
      free 43k · compact buffer 33k
      estimated; /context counts exactly
      last turn 1m · +$0.10 · 0 edits · 0 errors · 0 agents spawned
      limits: none reported
  No agents yet.
  ```

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
- `/board edit` keeps the author of the task and its place in the list. It refuses an empty
  title, a title of more than 200 characters and a title with a line break, a control character
  or a bidi control character by name, as `/board add` does, and keeps the old title.
- An argument of one word with a hyphen, such as `app-cd34`, is read as an item id. When the
  tracker has no such item, the mod adds the word as text and says so.
- `/board add <item id>` says why by name when `workitems` cannot read the item, and names
  `/board add -- <id>`.
- An item that is closed or deferred is not open. `/board add <item id>` refuses it by name, and
  `/board list` and the board do not count or list it.
- Task numbers do not move when a task is removed. A command with a missing number echoes it as
  you typed it and lists the numbers that exist. A number too large for an exact integer is
  refused as too large.

## Keyboard

You can press every button on both tabs with the keyboard alone. A live check on Claude Code
2.1.300 in a terminal measured these keys:

| Key                        | Effect                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/board`, `/board machine` | A hidden tab comes forward and takes the keyboard                                                                           |
| ctrl+x, then Tab           | From the prompt, gives the keyboard to the first tab. From a tab, to the next tab, and from the last tab back to the prompt |
| Tab, Shift+Tab             | Moves the focus to the next or the previous button, in reading order                                                        |
| Enter                      | Presses the button that has the focus                                                                                       |
| Esc                        | Gives the keyboard back to the prompt. The board stays open                                                                 |

- `/board` already gives the keyboard to the tab it brings forward. Press Tab, not ctrl+x tab.
  ctrl+x tab there moves the keyboard to the this machine tab, whose cards have no button, so
  Tab then walks only the tab row and the close mark. A live check in tmux on Claude Code
  2.1.312 measured this (handily-9uj3n.10).

- Claude Code keeps the focus at the same place in the order of the buttons, not on the same
  button. A live check on 2.1.300 measured this with `up` and `down`: the task moved, and the
  focus went to the next or the previous button of the task. Now, after `up` or `down`, the
  mod asks Claude Code to put the focus on the same button of the moved task. The key of an
  `up` or `down` button holds the place of the task, so the mod asks for a button that only
  the next drawing has. This is tested through the requested key only. No live check has
  confirmed it: the test kit has no focus ring, and a tmux check on 2.1.311 could not reach the
  task buttons, because Tab cycled only the tab row and the close mark.
- The `+N more agents` and `all N open` folds add their rows before the button, so by the same
  rule the focus goes to the first row that the fold shows. Use Tab or Shift+Tab to go back to
  the button.
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
| `task_add`    | `title`, or `titles` for several, and an optional `before` task id     | Adds pending tasks                   |
| `task_update` | `id`, and `status`: `pending`, `in_progress`, `completed` or `removed` | Sets the status, or removes the task |
| `task_move`   | `id` and `before`: two task ids                                        | Moves task `id` before task `before` |
| `task_assign` | `kind`: `do`, `answer` or `decide`, `title`, and `options` and `why`   | Assigns a task to you                |
| `task_list`   | none                                                                   | Returns the list                     |

- The mod registers the tools at `session.start`. The model calls them as
  `mcp__handily-board__<name>`. Each answer is the whole list, in the order of the work.
- `task_add` with `titles` adds several tasks in one call, in the given order, and the answer
  names the new ids: `Added tasks 2, 3, 4.` With `before`, the new tasks go before that task;
  without it, they go at the end. A batch that would pass the limit of 100 tasks, or that holds
  one bad title, is refused whole, and no task is added. The refusal names the title by its
  place, such as `title 2`. A call of several titles draws the transcript row of Claude Code,
  because the kept row names one task.
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
Session  ctx — until the first reply
Tasks  ▰▰▱▱ 1/4 · ▶1 ○2 · 14m
▶ 2 Write the tab mocks         4m [ rm ]
    ▸ Edit docs/mocks.md          9 tools
○ 3 Review the mocks with Codex    [ rm ]
○ 4 You: Ask the person about tabs [ rm ]
[ +1 done ]

[ Add a task ][Add]
```

The same list inline above the prompt, at 80 columns:

```text
Session  ctx — until the first reply
Tasks  ▰▰▱▱ 1/4 · ▶1 ○2 · 14m
▶ 2 Write the tab mocks                 ▸ Edit docs/mocks.md · 9 tools 4m [ rm ]
○ 3 Review the mocks with Codex                                           [ rm ]
○ 4 You: Ask the person about tabs                                        [ rm ]
[ +1 done ]

[ Add a task ][Add]
```

- The first line is the Session line. The next section describes it.
- The header shows a bar, the done count of all tasks, the counts of the tasks in progress
  (`▶`) and pending (`○`), and the time since the first tool call of the main loop. The bar
  has one cell for each task, at most 8. Its cells are done in `success`, in progress in
  `claude` and pending in a dim `▱`. A count of 0 is left out. Times use one short form: `9s`,
  `5m`, `1h`, `2d`. They round down. A narrow pane cuts the time first.
- When every task is done, the header shows `✓ all 4 done · 22m` in `success`. The time runs
  from the first tool call to the moment that the last task was done, so it stops when the
  work ends.
- When the current run of a task in progress passes 15 minutes, its time turns to the
  `warning` colour. A done task that you start again begins a new run. Its row still shows the
  time since its first start.
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
- When the slash command `/tree` of handily-filetree is listed, an opened task ends with a
  `[ files ]` button. It runs `/tree task 2`, so the files tab shows only the files that were
  read or edited while the task ran. When `/tree` is not listed, the button is not drawn. When
  the run fails, the board logs why and says so in a toast.
- A task that is not in progress also gets `[ up ] [ down ]` on the next line. `up` and `down`
  move the task past its neighbour with the same status, as `task_move` does, and Claude is
  told. The mod then asks Claude Code for the focus on the same button of the moved task. The
  Keyboard section says what is tested.
- The columns before the title have a fixed width. The title fills the room that is left and is
  cut with `…`, so a row never wraps. The tests check this at 30, 41 and 80 columns.
- The mobile app has no input, so the tab says `Add tasks with /board add <text>.`

### An approved plan

When you approve a plan of Claude that has numbered steps, the board offers the steps as tasks.
It adds nothing by itself. A capture from the tests, docked at 41 columns:

```text
Plan  approved · 3 numbered steps
  1 Create a.txt
  2 Create b.txt
  … 1 more step
  [ add 3 as tasks ]  [ dismiss ]
```

- The steps are the items of the first top-level numbered list with at least 2 items. The
  board removes the markdown marks and makes each run of spaces one space. A step of more than
  200 characters is cut to 199 characters and `…`, and the reply of `/board plan` names it.
- The offer shows in three places: a line under the plan row in the transcript, the Plan block
  above `Tasks`, and `/board plan`. The transcript button takes a click only, because Claude
  Code gives the keyboard only to a pane and to the band above the prompt. Use the Plan block
  or `/board plan` from the keyboard.
- A press adds every step as a pending task of `claude`, in order, at the end of the list. Your
  next prompt tells Claude: `it added tasks 3, 4, 5 from the approved plan.` A successful add
  shows no toast, because the board shows the new tasks.
- A rejected plan, a plan of a subagent, a plan that waits for a team leader and a plan with no
  numbered list of 2 items get no offer.
- When the list has no room for every step, or a step has a control or a bidi control
  character, nothing is added. The Plan block and the transcript line say why, and the button
  stays for a retry.
- When Claude adds tasks with `task_add` after the approval, the offer warns that the steps may
  repeat. The board never removes a repeat by itself.
- A later approved plan replaces the offer. The line under the older plan says so and has no
  button. `[ dismiss ]` hides the Plan block. The transcript button stays.
- `/board list` prints an offered plan above the tasks.

### Tasks for you

Claude assigns a task to you with `task_assign`: something to do (`do`), a question
(`answer`) or a choice of 2 to 4 options (`decide`). The section `For you` comes first, above
`Tasks`. A capture from the tests, docked at 41 columns:

```text
For you  ◆ 3 open
◆ 2 do      Rotate the staging API key
    [ done ] [ reject ]
◆ 3 answer  Which port does staging use?
    [ Your answer ][Send]
    [ reject ]
◆ 4 decide  Which cache store for now?
    [ Postgres ] [ SQLite ] [ Redis ]
    [ reject ]
─────────────────────────────────────────
```

- `◆` marks an open task. `✓` marks a task that you did, answered or decided, and `■` with the
  word `rejected` marks a rejected one.
- `[ reject ]` asks for an optional reason first, so one press cannot reject a task. The
  mobile app has no input, so the row names `/board answer`.
- Each result waits for your next prompt and shows `to send` with `[ undo ]`. That prompt
  carries one note for Claude with every result, after your list changes. After the prompt the
  results fold under `[ +N answered ]`. `[ clear done ]` and `/board clear` remove them.
- An empty answer, an answer of more than 1000 characters and an answer with a line break or a
  bidi control character are refused on the row, by name. Nothing is sent.
- Claude withdraws a task with `task_update` and the status `removed`. The row stays, dim, as
  `withdrawn by Claude`, until your next prompt. Claude cannot set another status on a task for
  you, and `task_move`, `/board edit` and `/board mv` leave it in place.
- When you answered a task before Claude withdraws it, the answer of `task_update` gives
  Claude your answer once, and the row reads `withdrawn by Claude · answer sent`.
- At the end of a turn in which Claude assigned tasks, one toast names them while the
  `this session` tab is not shown.
- A subagent cannot assign a task. At most 20 tasks for you are open at a time. The tasks for
  you count against the limit of 100 tasks. The `Tasks` header and the this machine card count
  only the other tasks.
- The open rows and the unfolded groups are kept in `$.state` under `expanded`. `/clear`
  closes them.

### The Session line

The Session line shows the context and the cost of this session. Captures from the tests, docked
at 41 columns. A main turn runs:

```text
Session  ctx 62% · $4.49 · turn +$0.31
```

The turn ended:

```text
Session  ctx 62% · $4.80 · last +$0.62
```

The context is at 80 percent or more:

```text
Session  ctx 80% high · $12.40
```

- `ctx 62%` is the context percent of the engine event `session.measure`. It is the figure that
  the Claude Code status line shows. `$4.49` is the cost of the session, to the cent.
- From 80 percent, the percent shows the word `high`, and both take the theme colour `warning`.
- While a main turn runs, `turn +$0.31` is the cost that the turn added since it started. It
  shows when the turn added one cent or more. After the turn, `last +$0.62` is the cost of the
  last turn. When the turn ends before its measure, `last` waits for that measure. A subagent
  turn does not start or end a turn here.
- When the cost total goes down, the turn counts from the new total, so the line never shows a
  negative cost.
- Before the first reply, the line reads `ctx — until the first reply`, also when the engine
  reports a cost of `$0.00`. A resumed session shows the figures that `$.session.usage()` gives
  at session start.
- `/clear` empties the line to `ctx — until the first reply`. When no measure comes between
  `/clear` and the next turn, that turn shows no turn cost, because the board does not know the
  cost at its start.
- When the host gives no usage, the line reads `no context or cost on this host` and draws no
  number. This is the case when `$.session.usage()` refuses at session start and no measure
  came.
- A narrow tab cuts whole pieces from the right: the turn cost first, then the cost. At 30
  columns, `Session  ctx 62% · $4.18 · turn +$0.31` reads `Session  ctx 62% · $4.18`. The first
  piece stays, and a body too narrow for it cuts it with `…`. The tests check the line at 30,
  41, 76 and 89 columns.
- A measure changes only the units that it names as changed. The board draws again only when
  the text of the line changes, so a cost change under one cent does not redraw it.
- When a subagent needs you, the line starts with the count of the waits, in the theme colour
  `warning`. A narrow tab never cuts the waits. At 30 columns the line reads
  `Session  ◆ 1 waits · ctx 62%`. Two waits read `◆ 2 wait`.
- After the first reply, the first main turn, the first compaction or the first permission check
  of the session, the line is a button. A press opens the details under it. The next section
  describes them.

### The Session details

Press the Session line to open its details. A capture from the tests, docked at 41 columns, on a
host that gives no context parts:

```text
Session  ctx 62% · $4.80 · last +$0.62
    context 124k of 200k · 1 compaction
    trend after 2 turns
    no breakdown on this host
    last turn 3m · +$0.62 · 3 edits
    0 errors · 2 agents spawned
    limits 5h 31% · 7d 13%
    resets 5h in 2h · 7d in 4d
    checks 5 · 5 allowed
    [ last 5 checks ]
```

Near the limit, captured from the tests at 41 columns:

```text
Session  ctx 91% high · $12.40
    context 182k of 200k · 2 compactions
    trend after 2 turns
    no breakdown on this host
    Claude Code compacts it near the
    limit. /compact or /clear frees it.
    last turn 6m · +$1.90 · 9 edits
```

After 8 main turns on a host that gives the context parts, with `[ context parts ]` pressed,
captured from the tests at 41 columns:

```text
Session  ctx 62% · $1.70 · last +$0.10
    context 124k of 200k · 0 compactions
    trend ▁▂▄▄▅▅▅▅ 8 turns · +6k a turn
    auto-compact at 167k · in ~7 turns
    [ hide parts ]
    Messages              71k  36%
    System tools          18k   9%
    MCP tools             12k   6%
    Memory files           9k   5%
    Custom agents          5k   3%
    Skills                 4k   2%
    System prompt          3k   2%
    [ +1 more part ]
    free 43k · compact buffer 33k
    estimated; /context counts exactly
```

- `context 124k of 200k` is the context of the window, from `context.tokens` and
  `context.window` of `session.measure`. `1 compaction` counts each compaction of the main
  conversation that the engine event `session.compact` reports as done. A compaction of a
  subagent, a `precompute` and a skipped compaction do not count.
- `trend` has one bar for each main turn: `context.tokens` at the end of the turn, against the
  window. It keeps the last 20 turns. `+6k a turn` is the mean growth of the last 5 main turns.
  A turn of a subagent adds no bar. A compaction of the main conversation starts the trend again
  from the next reading. Before 2 readings the line reads `trend after 2 turns`, and a trend that
  does not grow reads `no growth`.
- `auto-compact at 167k` is the threshold of the context parts. `in ~7 turns` is the room left
  under it, from the last bar, divided by the mean growth. The count is approximate, because the
  parts count against the compaction window and the bars against the model window. From 2 turns
  left the line reads `auto-compact soon: ~2 turns`, with `soon` in the theme colour `warning`.
  With auto-compact off the line reads `auto-compact is off`.
- The board counts the parts with `$.session.usage({ breakdown: 'summary' })`. That is a local
  estimate with no request to the model. It counts them when you open the details or press
  `[ context parts ]`, and again at the end of each main turn while the details are open. It
  never counts them while the details are closed, and it starts no timer.
- `[ context parts ]` lists each used part with the name that Claude Code gives it, its tokens and
  its percent of the compaction window, the largest first. It shows 7 lines, then
  `[ +1 more part ]`. From 76 columns it shows two parts on a line. `free` is the free space and
  `compact buffer` the reserve for the compaction. Tool schemas loaded on demand add
  `on demand 20k, not in the window`. `/context` counts the parts exactly.
- A host that gives no parts shows `no breakdown on this host`, with no number and no button. A
  count that fails shows `parts failed; /context shows them`, and a row in the transcript names
  the cause.
- From 80 percent, the details add that Claude Code compacts the context near the limit, and that
  `/compact` or `/clear` frees it.
- `last turn 3m` is the duration of the last main turn, from `turn.complete`. `+$0.62` is the
  cost that the turn added, as `last +$0.62` on the line. While the next turn runs, the details
  keep the last turn and its cost.
- `3 edits` counts the Edit, Write and NotebookEdit calls of the main loop in the last turn that
  ended without an error. `0 errors` counts the tool calls of the main loop that ended with an
  error. A count above 0 takes the theme colour `error`. `2 agents spawned` counts the subagents
  that the main loop spawned in the last turn. The calls and the spawns of a subagent do not
  count.
- `limits 5h 31% · 7d 13%` are the rate limits of `session.measure`, with the percent used, and
  `resets 5h in 2h` is the time until each limit resets. A reset time that is past reads
  `5h now`. A measure that names only the context and the cost but carries the limits updates
  them too, so the limits stay after `/clear`. A plan that reports no rate limits, as off a
  subscription, shows `limits: none reported`. Before the first reply, and on a host that gives
  no usage, the details show no context, and they show the limits only when a measure carried
  some.
- The permission checks follow. A later section describes them.
- A narrow tab moves each part that does not fit to the next line. The trend, the auto-compact
  line and the parts take a shorter form, such as `compact at 167k · ~7 turns`. The tests check
  the details at 30, 41 and 76 columns.
- The trend and the context parts follow glowup and claude-flightdeck
  (github.com/scasella/claude-flightdeck), both MIT. The survey of
  github.com/karanb192/awesome-claude-code-mods found them on 2026-10-28. handily only read them.
  It copies no code and adds no dependency.
- The board draws again when a compaction or a measure changes the details.

### The status line

While you do not see the `this session` tab, the board sets the Claude Code status line under
the prompt when a subagent needs you. You see the tab when it is shown and placed. Captures from
the tests:

```text
◆ scout waits for permission: Bash npm test
◆ 2 agents wait for permission
```

- A wait is the same wait that the agent rows show as `needs you`: an ask of a subagent that is
  not settled after 3 seconds. One wait names the agent and the call. Two or more waits show
  their count. An agent that the engine lists as `waiting` (`on hold`) is no wait, and an ask
  that the auto mode classifier settles before 3 seconds sets no line.
- The line never names the context, because the Claude Code status line already shows it. A
  context of 80 percent or more shows `high` on the Session line of the board.
- The board clears the line when nothing waits, and while the `this session` tab is shown and
  placed. When the board closes, the line comes back. A tab
  that waits undrawn, as with the mode `always` on a narrow terminal, does not clear it. The board checks
  which tab is shown every 10 seconds while a tab is open, so a switch to `this machine` shows the
  line within 10 seconds.
- The call target is masked as in the permission checks.
- The setting `statusLine` turns the line off. The Settings section names it.

### The desktop notice

When a permission ask of this session is still not settled after 3 seconds, and you do not see
the `this session` tab, the board sends one desktop notice through `$.ui.notify`.
Captures from the tests, for a session in the folder `app`:

```text
app needs you: scout waits for permission: Bash npm test
app needs you: Claude waits for permission: Bash npm test
```

- The notice names the folder of the session, who waits and the call. `Claude` is the main
  loop. A subagent is named as on its agent row.
- Each wait sends at most one notice. The board decides at the 3 second mark. A wait that starts
  while the `this session` tab is shown and placed sends no notice, also when the tab closes
  later.
- An ask that is settled before 3 seconds, such as an ask that the auto mode classifier settles
  in about 0.6 seconds, sends no notice. A classifier that takes longer than 3 seconds looks like
  a wait, because Claude Code gives a mod no event for an open permission dialog.
- Claude Code sends the notice through the notification channel of your settings
  (`preferredNotifChannel`). When it reports that it sent nothing, for example on the desktop
  app, with notifications turned off, or when a hook refused it, the board shows the same text as
  a toast.
- The notice and the status line escape a control character or a bidi control in the folder
  name and in the agent name, as `\u001b` or `\u202e`.
- Claude Code gives a mod no signal that you left the terminal window. So the board reads "you
  are away" as "the `this session` tab is not shown and placed". While the board is closed, every
  wait sends a notice, also when you look at the terminal. This reading waits for a decision of
  the person.

### Permission checks

The board keeps the last 20 permission checks of the session, from the engine event
`tool.check`, with their verdict. Press the Session line, then `last 5 checks`. A capture from
the tests, docked at 41 columns:

```text
Session  ctx — until the first reply
    checks 6 · 3 allowed · 2 asked
    1 denied
    [ hide checks ]
    denied   Bash GITHUB_TOKEN=*** git p…
    allowed  Bash curl -H "Authorization…
    asked    Edit docs/mocks.md
    asked    Bash npm test   scout
    allowed  Read hooks/agents…   Explore
```

- The first line counts every check of the session, and each verdict that is not zero:
  `allowed`, `asked` and `denied`. `denied` takes the theme colour `error`.
- Each check shows the verdict word, the tool and the target, newest first. A check of a
  subagent ends with the agent name.
- The board masks the credentials in a target before it keeps the check, with `***`: a
  password in a URL, a value after a key such as `token=`, `password:` or `--api-key`, a
  `Bearer` or `Basic` value, `-u user:password`, and token shapes such as `ghp_…`, `sk-…`,
  `AKIA…` and a JSON Web Token. The tests check each kind.
- The board counts only the checks of the calls that Claude Code raises for the model. It keeps
  the checks in memory, so a reload of the mod or `/clear` empties them.
- The masking covers the checks and the `waits for:` line. The agent rows and the task rows draw
  the target of a call as the call gives it.

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

A subagent that waits for your permission answer, captured from the tests, docked at 41 columns:

```text
Agents  1 · 1 needs you
◆ scout     needs you            open  2m
    waits for: permission · Bash npm test
```

In the same test, the Session line reads `Session  ◆ 1 waits · ctx 62% · $4.18`.

- Each agent is one row: the mark, the name, the state, the current tool and the time since the
  spawn. The time stops when the agent ends.
- The name is the name of the Agent call, else the agent type, else the first 8 characters of
  the id. A name of more than 9 characters keeps its first 4 and its last characters around `…`,
  such as `gene…pose`. When two rows show the same name, the later one gets a number, such as
  `Explore 2` or `gene…se 2`.
- The state is `needs you`, `asked`, `running`, `plan 2/7` while a running agent keeps a task
  list, `slow 45s`, `quiet 3m`, `on hold`, `pending`, `idle`, `failed`, `done`, `killed` or
  `not listed`.

  | Mark | State                                      | Colour    |
  | ---- | ------------------------------------------ | --------- |
  | `◆`  | `needs you`                                | `warning` |
  | `■`  | `failed`                                   | `error`   |
  | `▶`  | `asked`, `running`, `on hold`              | `claude`  |
  | `○`  | `pending`, `idle`                          | `subtle`  |
  | `✓`  | `done`, `killed`                           | `success` |
  | `?`  | `not listed`: Claude Code does not list it | `subtle`  |

- A running agent whose current tool call has run for more than 30 seconds reads `slow` and the
  time of that call. A running agent with no event for 2 minutes reads `quiet` and the time since
  its last event. An event is a model request (`turn.step`), a permission check (`tool.check`) or
  a tool call (`tool.call`) of the agent, or its spawn. `slow` comes before `quiet` and before
  `plan 2/7`. The word takes the theme colour `warning`, and the mark stays `▶`. Captures from the
  tests, docked at 41 columns:

  ```text
  ▶ Explore   slow 45s  ▸ Bash np… open  3m
  ▶ Explore   quiet 2m  Read src/… open  5m
  ```

  The board starts no timer for these states. It reads them when it draws, and a shown tab draws
  again every 10 seconds. The board keeps the times in memory, and each end of the session clears
  them with the agent rows.

- `on hold` is the engine status `waiting`: the agent waits for its own background work, an
  Agent call or a plan approval. The status does not say which, so the board does not draw it
  as a wait for you.
- `asked` and `needs you` come from the engine event `tool.check`. When the verdict for a call of
  a subagent is `ask`, the row says `asked`. When the call is still not settled 3 seconds later,
  the row says `needs you`, the header counts it, and the Session line counts it as a wait.
  Docked, the row gets a second line, `waits for: permission ·` and the call. Inline, that text
  is in the tool column.
- The mark clears when the call ends, because it ran or because the answer refused it, and when
  the turn of the agent ends. An ask that the auto mode classifier settles before 3 seconds, as
  it does in about 0.6 seconds (measured on Claude Code 2.1.312), never shows `needs you`.
- Claude Code gives a mod no event when a permission dialog opens or when its answer comes. So
  the board reads an ask that is not settled after 3 seconds as a wait for you. An allowed call
  ends only after it ran. While it runs, the row still says `needs you`. A call that the
  classifier allows and that then runs longer than 3 seconds also shows `needs you` until it
  ends.
- The tool column shows `▸` and the call that runs now, or the last call. Below 36 columns the
  tool column is left out. Docked, a failed agent gets a second line, `failed after` its last
  call. Inline, that text is in the tool column.
- From a body of 80 columns, docked or inline, each agent row adds a `ctx` column and a lane.
  `ctx` is the context of the latest model request of the agent, or `ctx —` before the first
  one. The lanes share one time axis, from the first spawn of the drawn rows to now, in 20
  cells. An agent in a closed fold does not move the axis. The header names the axis. A lane
  draws `━` while the agent ran and `·` before and after. The lane of an agent that waits for
  you ends in `◆` in the theme colour `warning`, and the lane of a failed agent ends in `■` in
  the theme colour `error`. The `waits for:` and `failed after` text moves into the tool
  column, so each agent keeps one line. A capture from the tests, docked at 89 columns:

  ```text
  Agents  3 · 1 needs you · 1 failed · lanes from 20m ago to now
  ◆ scout     needs you waits for: permission · Bash… ctx 31k ············━━━━━━━◆ open  8m
  ■ lane-b    failed    failed after Bash npm run bu… ctx —   ━━━━━━━■············       8m
  ▶ Explore   running   Read src/a.ts                 ctx 48k ·················━━━ open  3m
  ```

  Below a body of 80 columns, the rows keep the form above, with no `ctx` and no lane.

- Order: needs you first, then failed, then asked and running, on hold, pending and idle, each
  in spawn order. Ended agents fold into `+N ended`. At most 6 active agents show. The rest fold
  into `+N more agents`, so the Add input stays on screen.
- A running agent row, and an agent row that says `asked` or `needs you`, has an `open` button
  before the time. A press runs `/tasks`, which opens Claude Code's view of the background
  agents: with one running agent its detail view, with more the list, where you pick the agent.
  Claude Code has no way for a plugin to pick the agent. An agent that is on hold, pending, idle,
  failed or ended has no button. When Claude Code refuses the run, the board logs why and says so
  in a toast. At 30 columns the button takes the place of the tool column:
  `▶ Explore   plan 2/7  open  1m`.
- Press an agent name to open it. The opened row shows the task description, the parent and the
  spawn age (`under scout · spawned 1m ago`), the count of finished tool calls and the task list
  of the agent. A list of more than 5 tasks shows the task in progress with 2 tasks before and
  2 after it, and `all 7` shows every task.
- After the first model request of the agent, the line of the tool calls also shows its context
  and its output tokens, as `7 tool calls · ctx 48k · out 6.1k`. Both come from the latest
  request of the agent, from the usage that the engine event `turn.step` reports. The context
  adds the three kinds of input tokens: uncached, written to the cache and read from the cache.
  When the latest request stopped at its output limit, the line below reads
  `stopped at max_tokens · ctx 198k`, with `stopped at max_tokens` in the theme colour `warning`.
  A request with no usage changes nothing. The board keeps the tokens in memory, and each end of
  the session clears them with the agent rows.
- The board reads the result of a request of a subagent only. It passes the response of a main
  loop request on as it arrives, and reads no part of it.
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
Session  ctx — until the first reply
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

## The task band

While the `this session` tab is not shown, one line above the prompt shows the current task.
Captures from the tests, at 80 columns (the band body is 75 columns):

```text
▶ 2 Write the tab mocks                               4m ▰▰▱▱ 1/4 [ board ]
○ 3 Review the mocks with Codex                     next ▰▱▱▱ 1/4 [ board ]
◆ 3 for you · ▶ 2 Write the tab mocks                20m ▰▰▱▱ 1/4 [ board ]
Plan  approved · 3 steps  [ add 3 as tasks ]                      [ board ]
```

- The current task is the first task in progress, or else the first pending task with the dim
  word `next`. The time turns to the `warning` colour after 15 minutes, as on the board.
- While the band shows a task in progress, it draws again every 10 seconds, so the time moves.
- A switch to the `this machine` tab shows the band at once. Claude Code tells a plugin nothing
  about a switch to the tab of another mod, so the band shows within 10 seconds then.
- Open tasks for you come first. While an approved plan waits, the band shows the plan offer,
  and its button adds the steps as the Plan block does.
- `[ board ]` acts as `/board`: it shows the `this session` tab and gives it the keyboard. The
  band then goes. The band buttons have no hotkey, because Claude Code presses a band button
  with a digit typed into an empty prompt.
- The time and the bar never cut. The title cuts first. Below 50 columns the bar drops, and
  below 30 columns the time drops.
- The band draws nothing while the `this session` tab is shown, with no open task and no plan,
  while a survey holds the band, and with the setting `band` at `off`. Claude Code draws the
  band on the terminal and the desktop app only.
- When another mod beneath the board draws the band, the board shows that drawing unchanged.
  The board draws only over the engine drawing.

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
- A session that runs the board with a context of 80 percent or more gets a context line under
  the place line: the percent with the word `high` in the theme colour `warning`, and the cost
  of the session. Under 80 percent, the card has no context line. Inline, the line is under the
  row. A capture from the tests, docked at 41 columns:

  ```text
  ▶ mocks  interactive  this  busy
    ▶ Write the tab mocks ▰▱▱▱ 1/4
    app · main · 14m worked · est. 30m left
    ctx 91% high · $12.40
    agents 3 · 1 failed
  ```

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
- The key also keeps the context percent and the cost from the engine event `session.measure`.
  The board writes them when the rounded percent or the cost in cents changes, and at each
  session start. A key from an earlier version without them reads as no context.
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

| `userConfig` `statusLine` | Effect                                                |
| ------------------------- | ----------------------------------------------------- |
| `attention` (default)     | The status line names a wait, as The status line says |
| `off`                     | The board never sets a status line                    |

- When the mod loads, it refuses any other `statusLine` value by name, for example
  `handily-board: userConfig statusLine is "sometimes"; set it to attention or off in /config.`

| `userConfig` `band` | Effect                                                         |
| ------------------- | -------------------------------------------------------------- |
| `on` (default)      | The band above the prompt shows, as The task band section says |
| `off`               | The board draws no band                                        |

- When the mod loads, it refuses any other `band` value by name.

## Lifetime

- The list and the tool calls live in `$.state`, so they survive a hot reload of the mod.
- The figures of the Session line and of its details live in memory. A hot reload or a new
  process asks `$.session.usage()` again at session start, and counts the compactions and the
  last turn from zero. `/clear` and a resume empty them, because each starts a new session id.
  The permission checks stay until `/clear`.
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
