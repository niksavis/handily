# handily mods: approved text mocks (handily-0m93)

The person approved these mocks and each proposed look choice on 2026-10-07. The quiet-items
result block stays empty, because ctrl+o does not show the raw row. `/quiet-items` off shows it.

Sources: plan-v3 (wins), docs/design.md section 4, and the element table and component props in
the bundled plugin-authoring `claude-code.d.ts` (build 2.1.293). Every mock uses only:

- Elements: `Box`, `Text`, `Button`, `Input` (terminal and desktop; mobile has no `Input`).
- Text looks: `dimColor`, `bold`, `color` (theme keys `success`, `warning`, `error`, `subtle`),
  `wrap: 'truncate-end'`.
- Sites: `ToolUse` / `ToolResult` rows, `Pane` (`placement` `dock` from 110 columns in fullscreen,
  else `inline` above the prompt; `bodyColumns`), `$.ui.toast`, `$.ui.ask` (engine
  AskUserQuestion dialog, 2-4 options, header up to 12 characters), command replies
  (`command.run` returns `{ text }`).

Legend inside the blocks:

```text
~text~      dim / secondary (Text dimColor)
*text*      bold
!text!      warning colour          #text#   error colour        +text+   success colour
[Label]     Button                  [____ placeholder ____ ][Add]   Input with submitLabel
(engine)    drawn by Claude Code, not by the mod (frame, tab row, close mark, dialog chrome)
…           cut by Text wrap="truncate-end"
```

Sample names are generic: repo `app`, worktree `app.wt/lane-a1`, items `handily-ab12` and so on.

---

## 0. workitems (no UI of its own): state lines and the approval ask

Every dependent mod draws the same one-line state text from the snapshot, so the wording lives
in one place (workitems exports it). `ok` draws no line; the mods show their data instead.

| state | line (terminal) |
| --- | --- |
| ok | `~basicly · 14 open · read 12 s ago~` (only as a header, never as a warning) |
| ok, bd source | `~beads (bd) · 9 open · read 12 s ago · may be stale: bd keeps data in Dolt~` |
| stale | `!Work items may be out of date: last good read 6 min ago (basicly tracker list exited 1).!` |
| failed | `#Work items unavailable: basicly tracker list exited 2. Run it in a shell to see why.#` |
| failed (size) | `#Work items unavailable: .beads/issues.jsonl is over 4 MiB.#` |
| failed (cut) | `#Work items unavailable: basicly tracker list output was cut off.#` |
| failed (contract) | `#Work items unavailable: the adapter says contract 2; handily reads contract 1.#` |
| approval-needed | `!Work items need your approval to run python3 .basicly/core/kit/tracker/cli.py.!` + `~Asked at the next refresh in an interactive session.~` |
| no-tracker | `~No tracker found at the repo root (looked for basicly, beads, beans, .handily.json).~` |
| terminal-only | `~basicly is read through a CLI, which only a terminal session can run. Open this repo in a terminal to see its items.~` |
| ignored sources | `~Using beads; ignoring beans. Name one in .handily.json to change it.~` (once, under the header) |

Approval ask (terminal; engine-drawn AskUserQuestion, layout approximate):

```text
(engine) ──────────────────────────────────────────────────────────────────────────
 [workitems]  Allow handily to run this repo's tracker CLI to read work items?
              python3 .basicly/core/kit/tracker/cli.py list --status open
              (read-only; asked again if this file or the command changes)

 > 1. Allow for this repo
   2. Not now
   3. Other…                                                               (engine)
───────────────────────────────────────────────────────────────────────────────────
```

- `Allow for this repo`: stored under root + argv + sha256 of the named file + resolved argv0.
  No reply text; the data appears.
- `Not now` or dismissed: state `approval-needed` (line above).
- Non-interactive (`-p`, a background session): never asks; state `approval-needed`.
- Narrow terminal: the same dialog; `$.ui.ask` takes only a string, so the engine wraps it. The
  argv stays short (repo-relative path, never an absolute one).
- Desktop: never asks. A CLI source is `terminal-only` there (no `$.process.run`), so there is
  nothing to approve. beads and beans (file readers) work on desktop as on terminal.

Look choices (approved as proposed):

1. Wording and colour of the state lines above (stale and approval in warning, failed in error,
   no-tracker and terminal-only dim).
2. Approval options: `Allow for this repo` / `Not now` (two), or add a third `Allow once`.
3. When to re-ask after `Not now`: at the next session start only (proposed), or at every refresh.

---

## 1. quiet-items

### Terminal, normal (wide, 120 columns)

Before (engine rows):

```text
● Bash(python3 .basicly/core/kit/tracker/cli.py create --title "Draw text mocks for the mods" --priority 2 --type task)
  ⎿  {"record": "handily-ab12", "fields": {"title": "Draw text mocks for the mods", "status": "open", "priority": 2, ...
     … +18 lines (ctrl+o to expand)
```

After (one row each; the ToolResult block under it is drawn empty):

```text
● work item created    handily-ab12  Draw text mocks for the mods                                  open         P2
● work item updated    handily-ab12  Draw text mocks for the mods                                  in_progress  P2
● work item commented  handily-ab12  Draw text mocks for the mods                                  in_progress  P2
● work item closed     handily-ab12  Draw text mocks for the mods                                  closed       P2
● work item created    handily-cd34  Write the beads reader so the provider reads issues.jsonl wi…  open         P1
● !raw tracker edit!   .beads/issues.jsonl  ~Edit, not through the tracker CLI~
```

- `●` and the verb column keep the engine's tool-row colour; `handily-ab12` bold; status and
  priority `~dim~`. Title cut to 60 characters (userConfig) with `…`.
- One command that touches several items (`br close ab12 cd34`) draws one row per item, in the
  order of the diff.
- `raw tracker edit`: a direct Write or Edit of a tracker file. It names the file and the tool,
  in warning colour, because it skipped the tracker's own gates. No item id (the diff is read but
  not trusted to attribute it). Its result block is drawn empty too.

### Terminal, fallback cases (the engine row is drawn unchanged, `next(e)`)

```text
● Bash(br close handily-zz99)                          <- errored: engine row and error, as today
  ⎿  Error: issue handily-zz99 not found
● Bash(br update handily-ab12 --status in_progress)    <- still running, or interrupted (Esc)
  ⎿  Running…
● Bash(for i in a b; do br close $i; done)             <- loop, heredoc, --help or --dry-run: no match
● Bash(br update handily-ab12 --status in_progress)    <- matched, but the refresh diff was empty
                                                          or workitems is not ok (failed, stale,
                                                          no-tracker, terminal-only, approval-needed)
```

No error row of its own: quiet-items never hides a failure, so any doubt draws the full row.

### Terminal, narrow (80 columns)

```text
● work item created    handily-ab12  Draw text mocks for the mods   open  P2
● work item updated    handily-cd34  Write the beads reader so th…  in_progress  P1
● !raw tracker edit!   .beads/issues.jsonl  ~Edit, not through the…~
```

The title shrinks first (truncate-end) so id, status and priority stay on one line. No Pane here,
so nothing else changes.

### Desktop

- Same rows, drawn by the desktop from the same tree (no `●` glyph difference to design for; the
  desktop draws its own row chrome around `ToolUse`).
- basicly is `terminal-only` on desktop, so no refresh diff exists: every basicly command draws
  the engine row (`next(e)`). beads and beans repos get the quiet rows as on terminal.
- `raw tracker edit` works on desktop for every tracker (it needs only the file path).

### Command replies (`/quiet-items`)

```text
/quiet-items   -> quiet-items off for this session. Tracker commands draw in full.
/quiet-items   -> quiet-items on for this session. Tracker writes draw as one row.
/quiet-items   -> quiet-items on for this session, but work items are unavailable
                  (basicly tracker list exited 2), so tracker commands draw in full.
/quiet-items   -> quiet-items on for this session, but basicly needs a terminal session here,
                  so tracker commands draw in full.            (desktop, basicly repo)
/quiet-items x -> /quiet-items takes no argument; it toggles this session. Set the default
                  with the plugin's "mode" setting.
```

Look choices (approved as proposed):

1. Column order `verb  id  title  status  priority` (as decided) and two spaces between columns,
   with the verb column padded to `work item commented` so ids line up.
2. Result block under a quiet row: drawn empty.
3. `raw tracker edit` in warning colour with `Edit, not through the tracker CLI` (proposed), or
   plain like the other rows.

---

## 2. task-pane

Commands come first; the Pane is optional (`/task pane`). The same list text is the command
reply, so mobile (no `Input`) and a closed pane lose nothing.

### Command replies

```text
/task                          -> Tasks (2 of 5 done)
                                    1  done         Read the design doc
                                    2  done         Grep the element table
                                    3  in progress  Draw quiet-items mocks
                                    4  pending      Draw task-pane mocks
                                    5  pending      Write the summary          (you)
/task add Write the summary    -> Added task 5: Write the summary. Claude is told the list changed.
/task add handily-cd34         -> Added task 6 from handily-cd34: Write the beads reader.
/task rm 4                     -> Removed task 4: Draw task-pane mocks. Claude is told the list changed.
/task rm 9                     -> No task 9. This session has tasks 1-5; run /task to list them.
/task add                      -> /task add needs text or an item id, for example:
                                  /task add Write the summary   or   /task add handily-cd34
/task frob                     -> Unknown subcommand "frob". Use /task, /task add <text|id>,
                                  /task rm <n> or /task pane.
/task pane                     -> Task pane opened.
/task add … (TaskCreate fails) -> Could not add the task: TaskCreate refused it (<reason>).
                                  Nothing changed.
/task      (no tasks yet)      -> No tasks in this session yet. Open in the tracker (basicly, 3):
                                    handily-ab12  P1  Draw text mocks for the mods
                                    handily-cd34  P2  Write the beads reader
                                    handily-ef56  P2  Generate marketplace.json
                                  Add one with /task add <id>, or press "Add 3 as tasks" in /task pane.
/task      (no tasks, failed)  -> No tasks in this session yet. Work items unavailable:
                                  basicly tracker list exited 2.
```

### Terminal, normal: Pane docked (fullscreen, 120 columns; body about 40 columns)

```text
│ transcript …                                │ (engine frame)                 [x] │
│                                             │ *Tasks*  ~2 of 5 done~             │
│                                             │ +✓+ ~1 Read the design doc~      [rm] │
│                                             │ +✓+ ~2 Grep the element table~   [rm] │
│                                             │ ▶ 3 *Draw quiet-items mocks*     [rm] │
│                                             │ ○ 4 Draw task-pane mocks         [rm] │
│                                             │ ○ 5 Write the summary ~(you)~    [rm] │
│                                             │                                    │
│                                             │ [ Add a task ________ ][Add]       │
```

- Rows follow `TaskCreated` / `TaskCompleted` and the Task* results; subagent tasks are filtered
  out. Long titles truncate-end; the `[rm]` Button stays on the row.
- `[rm]` calls `TaskUpdate status=deleted` through `$.tool.call`; `[Add]` calls `TaskCreate`.

### Terminal, empty: no tasks yet (pre-session source = tracker open items)

```text
│ (engine frame)                     [x] │
│ *Tasks*  ~none in this session yet~    │
│ ~Open in tracker: basicly · 3 open~    │
│   handily-ab12 ~P1~ Draw text mo… [add]│
│   handily-cd34 ~P2~ Write the be… [add]│
│   handily-ef56 ~P2~ Generate mar… [add]│
│ [Add 3 as tasks]                       │
│                                        │
│ [ Add a task ________ ][Add]           │
```

Nothing is added on its own; `[Add 3 as tasks]` and each `[add]` are explicit. An item that is
already a task in this session is not added again, so a double press adds it once.

### Terminal, error states (same frame, line replaces the tracker block)

```text
│ *Tasks*  ~none in this session yet~    │
│ #Work items unavailable: basicly#      │
│ #tracker list exited 2.#               │
│                                        │
│ [ Add a task ________ ][Add]           │

│ *Tasks*  ~none in this session yet~    │
│ ~No tracker found at the repo root.~   │
│                                        │
│ [ Add a task ________ ][Add]           │
```

### Terminal, narrow (90 columns): Pane inline above the prompt, full width

```text
╭─ (engine) ───────────────────────────────────────────────────────────────────────── [x] ─╮
│ *Tasks*  ~2 of 5 done~                                                                    │
│ +✓+ ~1 Read the design doc~                                                         [rm] │
│ ▶ 3 *Draw quiet-items mocks*                                                        [rm] │
│ ○ 4 Draw task-pane mocks                                                            [rm] │
│ ○ 5 Write the summary ~(you)~                                                       [rm] │
│ ~+1 done hidden~   [ Add a task ______________________ ][Add]                             │
╰───────────────────────────────────────────────────────────────────────────────────────────╯
> prompt
```

Inline, the frame fits the tree and eats transcript room, so done tasks collapse to a count
(`~+1 done hidden~`) when more than 6 rows. A non-fullscreen terminal at any width looks like this.

### Desktop

- Same pane, docked where the desktop docks panes; `Input` and `Button` work.
- Tracker block: beads and beans as on terminal; basicly shows the terminal-only line:
  `~basicly is read through a CLI, which only a terminal session can run.~`
  `/task add handily-cd34` on desktop with basicly: `Cannot read handily-cd34 here: basicly needs a
  terminal session. Add it as text: /task add <text>.`
- Mobile: no `Input`; the pane drops the input row and shows `~Add tasks with /task add <text>.~`.

Look choices (approved as proposed):

1. Status marks `✓ ▶ ○` with done rows dim (proposed), or words `done / in progress / pending`
   as in the command reply.
2. Mark tasks the person added with `~(you)~` (proposed) or not at all.
3. Command set `/task`, `/task add <text|id>`, `/task rm <n>`, `/task pane` (proposed). Is
   `add <id>` (tracker item to task) wanted, or text only?

---

## 3. session-board

Opened with `/session-board`; polled while visible (every 15 s, one shared cache file).

### Terminal, normal: Pane docked (fullscreen, 140 columns; body about 46 columns) - two lines per session

```text
│ (engine frame)                                [x] │
│ *Sessions*  ~4 local · polled 12 s ago~           │
│                                                   │
│ *mocks*        ~inter~  +working+                 │
│   ~▶~ Draw quiet-items mocks ~2/5~                │
│   ~app · main · 41m worked · est. 30m left~       │
│ *lane-a1*      ~bg~     !waiting: permission!     │
│   ~▶~ Write the beads reader ~0/3~                │
│   ~app.wt/lane-a1 · lane/app-x1y2 · 18m worked~   │
│ *api-login*    ~inter~  idle                      │
│   ~no handily task data~                          │
│   ~api · feat/login · 2h 03m elapsed~             │
│ *docs-pass*    ~bg~     ~ended~                   │
│   ~—~                                             │
│   ~docs · main · ended 10 min ago~                │
```

### Terminal, wide inline (non-fullscreen, 120 columns): one line per session

```text
╭─ (engine) ────────────────────────────────────────────────────────────────────────────────────────────────────── [x] ─╮
│ *Sessions*  ~4 local · polled 12 s ago~                                                                                  │
│ ~name        kind   state                task                          worktree · branch              time~             │
│ *mocks*      inter  +working+            Draw quiet-items mocks  2/5   app · main                     41m worked  ~est. 30m left~ │
│ *lane-a1*    bg     !waiting: permission! Write the beads reader 0/3   app.wt/lane-a1 · lane/app-x1…  18m worked        │
│ *api-login*  inter  idle                 ~—~                           api · feat/login               2h 03m elapsed    │
│ *docs-pass*  bg     ~ended~              ~—~                           docs · main                    ~ended 10 min ago~│
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

- `state` is the word `claude agents --json` gives (`state` for background, `status` for
  interactive), `waitingFor` appended after a colon.
- `task` and `n/m` come from the sidecar of a handily session; others show `~—~`. A sidecar
  whose session is absent from `claude agents` gets no row. A listed session whose sidecar was
  written more than 60 s before its `startedAt` is stale: `~(stale)~` after the task, and no
  estimate.
- `worked` = sum of turn spans (handily sessions); `elapsed` = since `startedAt` (others).
- `est. 30m left` only with at least one completed task, measured from the first task, and
  hidden for N minutes after a task is added.
- Ended sessions (`--all`) sort last and dim.

### Terminal, empty and error

```text
│ *Sessions*  ~polled 3 s ago~                      │
│ ~Only this session is running.~                   │
│ *mocks*  ~inter~  +working+  …(as above)          │

│ *Sessions*                                        │
│ #claude agents --json failed: exit 1.#            │
│ #Run it in a shell to see why.#  ~retry in 15 s~  │

│ *Sessions*                                        │
│ #claude is not on PATH, so other sessions#        │
│ #cannot be listed.#                               │
```

### Terminal, narrow (90 columns, inline): the two-line layout at full width

Same as the docked block, wider: worktree and branch get the room before they truncate.

### Desktop

`claude agents` needs `$.process.run`, so the board cannot list other sessions. It shows this
session and its own subagents (`$.agent.list()`):

```text
│ *Sessions*                                        │
│ ~Other sessions are listed only in a terminal~    │
│ ~session (claude agents needs a CLI).~            │
│                                                   │
│ *this session*  +working+                         │
│   ~▶~ Draw quiet-items mocks ~2/5~                │
│   ~41m worked · est. 30m left~                    │
│ ~subagents~                                       │
│   Explore  ~running~  ~find the element table~    │
│   Plan     ~done~                                 │
```

### Command replies

```text
/session-board        -> Session board opened.
/session-board        -> Session board opened. Other sessions are listed only in a terminal session.
   (desktop)
/session-board close  -> Session board closed.
/session-board x      -> Unknown argument "x". Use /session-board or /session-board close.
```

Look choices (approved as proposed):

1. Layout switch: two lines per session below 100 body columns, one table line at 100 and above
   (proposed), or always one of the two.
2. Column order `name kind state task worktree·branch time` (as decided), and kind as `inter` /
   `bg`.
3. State colours: working success, waiting warning, idle plain, ended dim.

---

## 4. item-toasts

A toast when a work item changes outside this session (a diff not caused by a tool call that
quiet-items matched here). Rate limit: at most one toast per 30 s; changes inside the window merge
into the next toast. Engine draws the box (top right over the transcript, under the plugin name;
one line on the notification bar when not fullscreen).

### Terminal, normal

```text
                                                    ┌ item-toasts ──────────────────────────────┐
                                                    │ handily-ab12 closed: Draw text mocks for… │
                                                    └───────────────────────────────────────────┘
```

Toast texts (title cut to 40):

```text
handily-ab12 closed: Draw text mocks for the mods
handily-cd34 created: Write the beads reader
handily-cd34 updated: Write the beads reader (open -> in_progress)
3 work items changed: 2 closed, 1 created (handily-ab12, handily-cd34, +1)
Work items unavailable: basicly tracker list exited 2.          (once per failure, not repeated)
```

### Empty / error

- No change, no toast. `no-tracker`: silent. `approval-needed`: silent (the ask covers it).
- `failed`: one toast when the state turns failed, one `Work items are back: basicly · 14 open.`
  when it recovers; nothing in between.

### Narrow terminal

Same text; the engine wraps or cuts the box. Keep each toast under 60 characters before the title.

### Desktop

Same toast for beads and beans. basicly is `terminal-only`: no toasts at all, and no toast that
says so (the other mods show the line).

### Command reply

None proposed. If wanted: `/item-toasts` -> `item-toasts off for this session.` / `on`.

Look choices (approved as proposed):

1. Rate limit 30 s and merge format `3 work items changed: 2 closed, 1 created (…)`.
2. Show the status move `(open -> in_progress)` on updates, or the verb only.
3. A toast on failed and recovered (proposed), or silent.
