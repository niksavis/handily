# item-toasts

`item-toasts` shows a toast when a work item changes outside this session. Another session, a
person at a shell or a sync can make that change. A change that a tool call of this session
made draws no toast, because `quiet-items` and the transcript already show it.

```text
handily-ab12 closed: Draw text mocks for the mods
handily-cd34 created: Write the beads reader
handily-cd34 updated: Write the beads reader (open -> in_progress)
3 work items changed: 2 closed, 1 created (handily-ab12, handily-cd34, +1)
Work items unavailable: basicly tracker items exited 2.
Work items are back: basicly · 14 open.
```

The approved mocks are in `docs/mocks.md`, section 4.

## How it finds a change

The mod reads the work items only through `workitems`. It keeps the snapshot `version` up to
which it has read the diffs.

1. Every 2 s, the mod reads the snapshot. When its `version` moved, the mod calls
   `$.workitems.refresh({ since })`. It holds the diff for the next toast.
2. Before a counted call runs (see "Which calls count"), the mod calls `refresh({ since })`
   the same way. A change from before the call is then a change made elsewhere.
3. While a counted call runs, the mod reads no diff.
4. After the last running counted call ends, the mod calls `refresh({ since })` and drops the
   diff. The call made this change, or the change came while the call ran.

When counted calls overlap, the mod drops the diff of every version from the start of the first call
to the end of the last call. A change made elsewhere in that time draws no toast.

### Which calls count

`isTrackerWrite` in `hooks/match.ts` decides which calls the mod treats as this session's own
tracker writes. Every other call runs as if the mod were not there, so a change made elsewhere
while it runs draws a toast.

| Tool            | Counts when                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `Bash`          | `$.workitems.classify` finds a tracker name: a write, an echoed write or an opaque command such as a loop |
| `Write`, `Edit` | `$.workitems.trackerFile` names a tracker file at the `workitems` root                                    |

- `--help`, `-h` and `--dry-run` make a command a non-write, so it does not count.
- When the mod cannot decide, it does not count the call, and it logs why. This happens when
  `$.workitems.classify` fails for a `Bash` call, when `$.workitems.trackerFile` fails for a
  `Write` or `Edit` call, and when `workitems` has no snapshot root yet for a `Write` or `Edit`
  call. A missed change made elsewhere is worse than a toast
  for this session's own change.
- `quiet-items` uses the same two rules of `workitems`, so both mods count the same calls.
  The command cases and their tests are in `mods/workitems`.

Known limits:

- A change made elsewhere while a counted call runs draws no toast.
- A script that writes the tracker without a tracker name in its command, such as
  `bash close.sh`, draws a toast for its own change.

### A call that runs on in the background

A `Bash` call with `run_in_background`, or a call that the person or the engine moves to the
background, returns before its command ends. The mod keeps such a call open until one of these
events:

- The task notification of the call arrives (`prompt.submit` with the origin
  `task-notification`). The mod reads the ids in its `<tool-use-id>` and `<task-id>` tags and
  compares them exactly with the `tool_use_id` of the call and the `backgroundTaskId` of its
  result. A notification without these tags closes nothing.
- A `Stop` hook lists the background tasks of the session, and the `backgroundTaskId` of the
  call is not in the list.
- 30 minutes pass. The Stop hook may not run, for example when a Team organisation's security
  plugin bypasses the user-tier settings hooks. This limit keeps the toasts from stopping
  for good.

Until then, a change made elsewhere draws no toast. A new session start closes every open
call. A reload of the mod forgets the open background calls, so a change that such a command
makes after the reload draws a toast. A call that ends after its session ended stays closed:
the mod counts a generation for each session and ignores a call from an older one.

### A change during a failure

While the snapshot is `failed`, `workitems` keeps the last good items. When it recovers, its
diff holds every change from the whole failure. When a call of this session was open at any time
during the failure, the mod drops that recovery diff. A change made elsewhere during that
failure then draws no toast either.

## The toast

- One change draws `<id> <created|updated|closed>: <title>`. An update that moved the status
  adds `(<old status> -> <new status>)`. The title is cut to 40 characters with `…`.
- The mod shows at most one toast every 30 s. A change inside that time waits, and every
  waiting change goes into the next toast: `N work items changed: <counts> (<id>, <id>, +N)`.
  The larger count comes first.
- When an item changes more than once before its toast, `created` wins over `closed`, and
  `closed` wins over `updated`, as in `workitems`. An update shows the status from before the
  first change.

## The snapshot state

| State                                                     | Toast                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `ok` after `failed`                                       | `Work items are back: <source> · <N> open.`, once               |
| `failed` after `ok`                                       | `Work items unavailable: <first sentence of the reason>.`, once |
| `failed` that stays `failed`                              | None                                                            |
| `no-tracker`, `approval-needed`, `terminal-only`, `stale` | None. The mod drops the waiting changes                         |

- A state toast also waits for the 30 s limit. A failure that recovers before its toast shows
  draws no toast.
- The mod keeps the state it last toasted (`announced`) and the time of its last toast
  (`lastToastAt`) in `$.state`, which outlives a reload of the mod. This is meant to keep a
  reload from repeating the failed toast or starting a new 30 s window. Tests cover it with a
  second session start only. A live reload is not tested.
- On desktop, a `basicly` source is `terminal-only`, so the mod shows nothing. A `beads` or
  `beans` source works as in a terminal.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/item-toasts
```

`item-toasts` depends on `workitems`, so load the `mods` folder. The tests load a fake
`workitems` provider, because `claude plugin test` loads only the mod under test.

The test kit has no module reload and no permission prompt. A test with a second session start
stands in for a reload, and a call that waits before it runs stands in for a prompt. No test
covers a live reload or a live permission prompt.
