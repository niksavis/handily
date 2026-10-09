# session-board

`session-board` shows each Claude Code session on this machine in one pane. Each session is a
card: the state, the current task with its progress, the worktree and branch, and the time
worked.

## Use

```text
/session-board          opens the board
/session-board close    closes the board
```

- Each card has a header line and up to two detail lines, at every width. A dim rule line separates
  two cards.
- The header shows a status mark in a theme colour, the name in bold, a dim `interactive` or
  `background` badge, `this` on the current session, and the state word in the colour of the
  mark.

  | Mark | Signal        | State                                     | Colour    |
  | ---- | ------------- | ----------------------------------------- | --------- |
  | `▶`  | Doing         | `busy`, `working`                         | `claude`  |
  | `◆`  | Waits for you | `waiting`, `blocked`, or any `waitingFor` | `warning` |
  | `○`  | To do         | `idle`, an unknown word                   | `subtle`  |
  | `✓`  | Done          | `done`, `stopped`                         | `success` |
  | `■`  | Blocked       | `failed`                                  | `error`   |

- The marks and colours are the signals of `docs/design.md`. `hooks/signals.ts` holds the
  table. `task-pane` and `agent-board` keep the same table, and `scripts/signals.test.mjs`
  fails when two tables differ.
- `idle` draws as To do, not as Waits for you. An idle session is between turns and asks you
  nothing. A `waitingFor` value, such as `permission`, draws as Waits for you. `stopped` draws
  as Done, because the session left the work. The state word still says `stopped`.
- The first detail line is the current task, cut to fit, and the count of done tasks:
  `Write the tests 2 of 4`. A session with no store key has no task line.
- The second detail line is `<worktree> · <branch> · <time>`, with `est. <time> left` when the
  board has an estimate.
- This session comes first. Then come the working sessions, the waiting ones, the idle ones,
  and the ended ones last.
- A background session whose state has not changed for over 24 hours is hidden. The board
  measures from `startedAt`, or from the last state change that a poll saw. A dim footer says
  `N older background job(s) hidden`. An interactive session and this session are never hidden.
- The count in the header, `Sessions  N local`, is the number of cards shown.
- The board draws only theme colours, so it follows the terminal theme. It never draws a fixed
  colour.

## What it reads

- `claude agents --json --all`, every 15 s, only while the board is shown. The mod keeps one
  result with its time in its `$.store` under the key `agents`. When another session polled
  less than 15 s ago, the board uses that result and does not run the command again. A cached
  time in the future, or a cached value that the mod cannot read, counts as expired. Only one
  poll runs at a time in a session.
- `git -C <cwd> rev-parse` and `git -C <cwd> branch --show-current`, only when the working
  directory of a session changes.
- Each session that runs `session-board` writes its own store key `session:<session id>`. The
  key holds the current task, the done and total counts, and the time worked.
- The task list comes from the `$.state` list of the `handily-task-pane` mod. A session with its own
  key and no task list, or an empty one, shows `no tasks`. A session with no key shows no task
  line.

The mod never reads the task files of the engine on disk, because their format is internal.

## The fields

- `state` is the word that `claude agents --json` gives: `status` for an interactive session
  (`busy`, `idle`, `waiting`) and `state` for a background session (`working`, `blocked`,
  `done`, `failed`, `stopped`). Claude Code 2.1.293 writes these words. A `waitingFor` value
  follows after a colon.
- `worked` is the sum of the main-loop turns, from `turn.start` to `turn.complete`. Only a
  session that runs `session-board` has it. Other sessions show the time `elapsed` since
  `startedAt`. An open turn that started before `startedAt` of the session does not count,
  and a stale key shows only its stored time.
- `est. <time> left` divides the completed tasks by all tasks and applies the result to the
  time since the first task. The board shows no estimate before one task is complete, and none
  for 5 minutes after a task is added. When the first list that the board sees already has a
  completed task, the time of the first task is unknown, and the board shows no estimate for
  that list.
- The board shows no card for a store key whose session `claude agents` does not list. The one
  exception is this session, before a poll lists it: its card shows `not listed` and `(stale)`.
- A listed session whose key was written more than 60 s before its `startedAt` shows `(stale)`
  after its task, and no estimate. The key then comes from an earlier run of the same session.
  The 60 s margin exists because a session writes its key at start, up to about 2 s before or
  after the `startedAt` that `claude agents` reports. One live run measured both (-1622 ms and
  +885 ms).
- A poll deletes a key of an unlisted session that is older than 24 hours before it saves its
  result. A session start deletes each key of another session that is older than 24 hours.

## Errors

- `claude agents --json failed: exit <n>.` when the command exits with an error.
- `claude agents --json failed: the output is not a JSON list.` when the output is not a list.
- `claude agents --json failed: the output is over 4 MiB and was cut.` when the output was cut.
- An entry of the list that the mod cannot read is left out. The debug log names the count.
- `claude is not on PATH, so other sessions cannot be listed.` when the command cannot start.

## Limits

- `claude agents` gives no end time. So an ended session shows `ended` with no age.
- A session with no terminal surface, for example a session that the desktop app hosts, does
  not run `claude agents`. The board then shows this session and its subagents from
  `$.agent.list()`. Whether `claude` is on `PATH` in a desktop session is not measured.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/handily-session-board
```
