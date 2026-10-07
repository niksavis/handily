# session-board

`session-board` shows each Claude Code session on this machine in one pane. A row shows the
state of the session, its current task, its worktree and branch, and the time worked.

## Use

```text
/session-board          opens the board
/session-board close    closes the board
```

- Below 100 body columns, the board draws three lines per session. From 100 columns, it draws
  one table line per session.
- Ended background sessions come last, in dim text.

## What it reads

- `claude agents --json --all`, every 15 s, only while the board is shown. The mod keeps one
  result with its time in its `$.store` under the key `agents`. When another session polled
  less than 15 s ago, the board uses that result and does not run the command again.
- `git -C <cwd> rev-parse` and `git -C <cwd> branch --show-current`, only when the working
  directory of a session changes.
- Each session that runs `session-board` writes its own store key `session:<session id>`. The
  key holds the current task, the done and total counts, and the time worked.
- The task list comes from the `$.state` list of the `task-pane` mod. When `task-pane` is not
  loaded, the row says `no handily task data`.

The mod never reads the task files of the engine on disk, because their format is internal.

## The columns

- `state` is the word that `claude agents --json` gives: `status` for an interactive session
  (`busy`, `idle`, `waiting`) and `state` for a background session (`working`, `blocked`,
  `done`, `failed`, `stopped`). Claude Code 2.1.293 writes these words. A `waitingFor` value
  follows after a colon.
- `worked` is the sum of the main-loop turns, from `turn.start` to `turn.complete`. Only a
  session that runs `session-board` has it. Other sessions show the time `elapsed` since
  `startedAt`.
- `est. <time> left` divides the completed tasks by all tasks and applies the result to the
  time since the first task. The board shows no estimate before one task is complete, and none
  for 5 minutes after a task is added.
- A store key whose session `claude agents` does not list shows `(stale)`. The next poll
  deletes a stale key that is older than 24 hours.

## Errors

- `claude agents --json failed: exit <n>.` when the command exits with an error.
- `claude agents --json failed: the output is not a JSON list.` when the output cannot be read.
- `claude is not on PATH, so other sessions cannot be listed.` when the command cannot start.

## Limits

- `claude agents` gives no end time. So an ended session shows `ended` with no age.
- A session with no terminal surface, for example a session that the desktop app hosts, does
  not run `claude agents`. The board then shows this session and its subagents from
  `$.agent.list()`. Whether `claude` is on `PATH` in a desktop session is not measured.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/session-board
```
