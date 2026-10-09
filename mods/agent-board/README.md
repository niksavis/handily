# agent-board

`agent-board` shows the subagents of this session in one pane. Each subagent is a card: its
type, its state, the time since its spawn, its task, the tool that it runs now, its count of
tool calls and, when the subagent keeps one in `task-pane`, its task list.

## Use

```text
/agent-board          opens the board
/agent-board close    closes the board
```

- Each card has a header line, up to two detail lines and the task list of the agent. A dim
  rule line separates two cards.
- The header shows a status mark in a theme colour, the name or the type in bold, the state
  word and the time since the spawn. A dim badge shows the type when the agent has a name.

  | Mark | State                                    | Colour    |
  | ---- | ---------------------------------------- | --------- |
  | `●`  | `running`                                | `success` |
  | `◐`  | `waiting`                                | `warning` |
  | `○`  | `pending`, `idle`, `done`, `killed`      | dim       |
  | `✕`  | `failed`                                 | `error`   |
  | `?`  | `unknown`: the engine no longer lists it | dim       |

- The first detail line is the task description of the Agent call. When the agent has a
  parent, `under <parent>` follows. `<parent>` is the name of the parent, else its description,
  else the first 8 characters of its id.
- The second detail line is the tool call: `▸ Read docs/design.md · 3 tools` while a call runs,
  and a dim `last Read docs/design.md · 4 tools` after it. The target is the first line of the
  file path, pattern, path, URL, query, command, description or skill of the call, at most 200
  characters, cut to fit.
- A `SubagentHandback` call adds 1 to the count, but the line keeps the tool and target of the
  last other call. The line shows `SubagentHandback` only when it was the one call.
- The task list starts with a dim `plan 2/7 done` line, then one line per task in list order:

  | Mark | Task        | Title                |
  | ---- | ----------- | -------------------- |
  | `✓`  | done        | dim, mark in success |
  | `▶`  | in progress | bold                 |
  | `○`  | open        | plain, mark dim      |

- A list of more than 5 tasks folds. The card shows the task in progress, the 2 tasks before
  it and the 2 tasks after it, and `· 5 of 7 shown`. With no task in progress, the fold centres
  on the first open task, else on the last task.
- On a folded list, `plan 2/7 done` is a button. Tab or the arrows move the focus of the pane
  onto it, and Enter unfolds the whole list: `· all 7 shown`. Enter again folds it.
- A subagent with no task list, or a session without `task-pane`, draws the card without the
  list.
- The time counts every second while the agent runs. It stops when the agent ends. For an
  `unknown` row, it stops at the last moment that the board saw the agent.
- An agent whose `turn.complete` arrived stays `done` when `$.agent.list()` no longer lists it.
  An agent that the list drops before its turn ends becomes `unknown`.
- The header counts the cards: `2 active · 1 done`. When every listed subagent is `done`,
  `failed` or `killed`, it reads `all N done`.
- With no subagent, the pane shows `No subagents in this session yet.`
- Order: the active cards first, then the `unknown` ones, then the ended ones, then the loops
  that the engine does not list. Inside a group, the order of the first sight.

## What it reads

| Source                         | What the board takes from it                                    |
| ------------------------------ | --------------------------------------------------------------- |
| `$.agent.list()`               | id, type, status, description, name and parent id, at each draw |
| `agent.spawn`                  | the agent id from the result, and the spawn time                |
| `tool.call` with `agentId`     | the tool, its target, and the count when the call resolves      |
| `turn.complete` with `agentId` | the end time of the run of a subagent                           |
| `task-pane` `agentList` state  | the task list of each agent, by its agent id, at each draw      |

- A `tool.call` with no `agentId` is a call of the main loop. The mod passes it on at once and
  changes no card.
- Each `session.end` clears every card. A `/clear` and a resume end the session in the same
  process, and no `session.start` follows, so the cards of the last conversation do not stay.
- The `session.end`, `tool.call`, `agent.spawn`, `turn.complete` and `ui.close` hooks have a
  `.catch` that answers `next(e)`. A hook that fails never changes the result of the call, the
  spawn or the turn. The `ui.render` hook logs a failure to the debug log and answers `next(e)`.
- The board reads the `task-pane` state with a type of its own and no plugin dependency, so it
  loads and draws without `task-pane`. A later write of a list draws the board again.
- The board redraws every second while its pane is the shown tab. While the pane is a hidden
  tab, the timer only reads the list of panes. The board reads `$.agent.list()` only when it
  draws. The timer stops when the pane closes.

## Loops that the engine does not list

A `tool.call` can carry an `agentId` that `$.agent.list()` never names. The engine types say
that the agents of a workflow and the own forks of the engine (compaction, memory) carry such
ids. A live probe on Claude Code 2.1.294 saw two of them, and the consumer run of this mod saw
one that called `AskUserQuestion`.

The board keeps such a loop as a card, so no tool call is hidden. The card shows the first 8
characters of the id, a dim `not listed` badge, and `running` while a call runs. After its
`turn.complete` it shows `done`, else `unknown`.

An agent that `agent.spawn` started, with no list row and no loop event, gets the same badge. A
remote workflow agent is one: no local loop carries its id. Its card shows its type and
`unknown`.

The header counts all of these cards apart, as `N not listed`, so that they do not block
`all N done`.

The board keeps at most 20 cards that the list never named and that run no call. When a 21st
comes, it drops the card that it saw least recently. It never drops a card that the list named
or a card with a call in flight.

## Limits

- The board keeps its cards in the memory of the hooks module. A reload of the mod, for
  example after a change to its files, clears them. A subagent that ended before the reload
  comes back only while `$.agent.list()` still lists it. An ended Explore agent stayed listed
  for at least 90 s in the probe.
- An agent that the board saw first in `$.agent.list()` gets the time of that sight as its spawn
  time. Only an `agent.spawn` that this mod saw gives the true spawn time.
- The board does not drop the card of a subagent that the list named. Only the cards that the
  list never named have a bound, of 20.
- Two panes do not show at once. With `session-board` open, the two boards are tabs.

## Develop

```sh
claude --plugin-dir mods/agent-board
claude plugin test mods/agent-board
```
