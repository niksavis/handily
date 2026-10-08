# handily — research and design

Status: revision 3 (record `handily-0m93`). Research and the plan review are done. No mod code
exists yet. The implementation session starts from this file.
Claude Code build used for the research: 2.1.293.

Revision 3 corrects errors in revision 2 and adds the decisions from the plan review and the
results of the P0 probes (handily-0m93). The approved mocks are in `docs/mocks.md`.

## 1. Purpose and boundary

handily is a general-purpose repository of Claude Code **mods** (plugins of function hooks)
and a Claude plugin marketplace. Any Claude Code user can install a mod. No mod needs basicly.
basicly, beads, br, beans and other trackers are supported through one provider mod.

**The boundary: mods show and ask. Mods never enforce.**

- A mod draws in Claude's screen and reacts in the session. No agent-agnostic layer can do that.
- Enforcement (commit rules, claim rules, tracker writes as process) belongs in git hooks or
  in a harness. A git hook holds for every agent and for a person at the shell.
- A mod writes to a tracker only on an explicit action of the person, and only through the
  tracker's own CLI, so the tracker's gates still apply.

basicly adapts to handily, not the reverse. basicly-side work is filed in the basicly tracker.

## 2. Decisions

### Decisions from the interview (2026-10-07)

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Where the mods live | This separate repo, a Claude plugin marketplace |
| 2 | Name | `handily` (repo and marketplace) |
| 3 | Tracker extension | Provider mod `workitems` with built-in readers and a CLI adapter contract |
| 4 | quiet-items scope | The screen only. The model still reads the full tool result |
| 5 | task-pane source | Claude's session tasks plus a saved queue per project. Changed by review decision 2 |
| 6 | session-board scope | All local sessions |
| 7 | Extra mods | Keep `work-status` and `item-toasts` (low priority). Drop `commit-link` and `handover`. Review decision 7 drops `work-status` |
| 8 | Mod names | `workitems`, `quiet-items`, `task-pane`, `session-board`, `item-toasts` (`work-status` dropped) |
| 9 | Toolchain | npm plus `typescript` as a dev dependency, for `tsc` checks |
| 10 | Setup scope | Repo, basicly install, this doc, the first epics, all gates and CI, public GitHub repo |
| 11 | Linter | typescript-eslint (strict type-checked) with Prettier |

Why `commit-link` and `handover` were dropped:

| Mod | Existing mechanism in basicly | Verdict |
| --- | --- | --- |
| commit-link | `tracker-commit-msg` and `tracker-claim` git hooks (commit-msg stage) | The git hook is the right layer and covers every agent |
| handover | basicly writes and reads `[session handover` notes and shows the last one at session start | Process logic belongs to the harness |

### Decisions from the plan review (2026-10-07)

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Mocks | The person approves an ASCII mock per mod, for terminal and desktop, before the lanes start |
| 2 | Tasks before a session | They come from the tracker's open items through `workitems`. `/task add` adds a task in any session. The out-of-session queue is dropped |
| 3 | Tracker source per repo | One source per repo. The first detected source is used, or the source named in `.handily.json`. The provider reports the other sources as ignored |
| 4 | Raw tracker edit | A direct `Write` or `Edit` of a tracker file draws a distinct "raw tracker edit" row |
| 5 | quiet-items toggle | The toggle is per session, in `$.state`. `userConfig` holds only the default |
| 6 | Mod versions | Each mod has one version. Bump only a mod that changed. Users update when the `plugin.json` version changes. `claude plugin tag mods/<name>` is secondary |
| 7 | work-status | Dropped |
| 8 | bd data | Items that come from `.beads/issues.jsonl` for `bd` carry the label "possibly stale" |
| 9 | basicly read path | `basicly tracker list --status <s>` from `PATH` only, after the person approves it. Without `basicly` on `PATH` the read fails by name. The repo's `cli.py` fallback was dropped by decision E |
| 10 | Approval key | For basicly: the repo root, the argv, the resolved `argv[0]` and the sha256 of every file under `.basicly/core/kit/tracker/`. A second key holds the same without the kit files. When the kit changed, the approved program's `--version` decides: 0.21.1 or later runs only the installed package, so the second key is enough. Below 0.21.1, or a version that does not parse, the kit files must match. No basicly command runs before approval (decision F). A program that resolves inside the repo root is refused. A CLI adapter needs no approval (decision E) |
| 11 | Repo config | `.handily.json` at the repo root holds data only: `source`, `globs`, `format` and `fields`. Its globs are confined to the root by `realPath`. It cannot name a command (decision E) |
| E | CLI adapter command (2026-10-08) | A repo never names a command to run. The person lists the adapter argv in `~/.config/handily/adapters.json`, keyed on the exact real path of the repo root. Typing that line is the consent, so the adapter runs with no approval ask. A repo `.handily.json` that names a command fails, names the user file and the root, and never repeats the command. The consent covers the command, not one version of the code |
| F | Ask once for basicly (2026-10-08, handily-szdh) | Ask once and keep the answer. No basicly command, `--version` included, runs before the person approves the repo. After approval, a kit change runs the approved program's `--version`, never kept, so a downgrade below 0.21.1 asks again. An approval from before this decision stays valid for the same program path. A read without approval through an isolated interpreter was dropped: two reviews each found a way for repo code to run before any check |

## 3. Facts about the mod API

Sources: the bundled `plugin-authoring` skill (its `reference.md` and the generated
`claude-code.d.ts` of build 2.1.293), and the docs at
<https://code.claude.com/docs/en/plugins/mods/overview.md>,
<https://code.claude.com/docs/en/plugins/mods/create.md> and
<https://code.claude.com/docs/en/plugins/mods/reference.md>.

- A mod is a folder with three files: `.claude-plugin/plugin.json`, `hooks/hooks.json`
  (`{ "modules": ["./register.tsx"] }`) and `hooks/register.tsx`, which exports
  `register(on, options)`.
- A hook has the shape `($, e, next)`. The module runs with no DOM and no Node. It reaches
  everything through `$`: `$.fs`, `$.process.run`, `$.store`, `$.state`, `$.ui`, `$.tool`,
  `$.agent`, `$.clock` and more.
- **The API is early access and changes between releases.** The generated `.d.ts` file is the
  authority, not memory. Load the `plugin-authoring` skill at the start of each session.
- The engine writes the type files into each mod's `.claude-plugin/types/` folder at each
  load. That folder is generated. Gitignore it. The basicly comments gate covers `.ts`, and
  those files hold doc comments.
- Checks: `claude plugin validate <mod>`, `claude plugin test <mod>` (`*.test.ts` with
  `claude-code/testing`) and `tsc -p <mod>`.
- Development load: `claude --plugin-dir <mod>` or `CLAUDE_CODE_PLUGIN_DIRS`.
- Sharing: `.claude-plugin/marketplace.json` at the repo root lists each mod by a relative
  `source`. The install line is `/plugin install <mod> --marketplace niksavis/handily`.
- A mod can add a typed noun to `$` in `engine.create` and ship its contract as
  `types/index.d.ts`. A dependent mod lists it under `dependencies` in `plugin.json`.
- `$.fs` has no watch function. A mod cannot watch a file through `$.fs`.

API surfaces each mod needs:

| Need | API |
| --- | --- |
| Replace a tool row on screen | `ui.render` on `{ component: 'ToolUse' }`. Props: `tool_use_id`, `tool`, `input`, `isRunning`, `isErrored`, `isInterrupted`, `output?`, `onScreen?` |
| Replace a tool's result row | `ui.render` on `{ component: 'ToolResult' }`. A standalone tool row draws its result in this separate component |
| Follow Claude's tasks | `tool.call` on `TaskCreate`, `TaskUpdate`, `TodoWrite`; results carry task ids and status |
| Sidebar or band | `$.ui.open({ id, title })` with `ui.render` on `Pane`; `ui.render` on `AbovePrompt` |
| Toggle | `$.command.register` and `command.run`; per-session state in `$.state`; a `userConfig` field for the default |
| Persist across sessions | `$.store` (JSON, max 4 MiB per plugin) |
| Agents of this session | `$.agent.list()`: id, description, type, status, parentId |
| Run a CLI | `$.process.run(argv, init)`. The argv is positional. The default timeout is 30 s. Each stream is cut at 4 MiB. CLI only, not in the desktop app |
| Status line and toasts | `$.ui.status(text)`, `$.ui.toast(text)` |

## 4. The mods

### 4.1 workitems (provider)

Adds the noun `$.workitems` with a typed contract. Other mods list `workitems` under
`dependencies`.

Detection:

- The provider detects the tracker at `$.session.root()` only. It does not walk up to an
  ancestor folder.
- It detects again on `classic.CwdChanged`.
- "No tracker" is its own state. It is not an error.
- One source per repo (review decision 3). The provider uses the first detected source, or
  the source that `.handily.json` names. It reports each other source as ignored.

Snapshot, published as a typed `$.state` ref:

| Field | Meaning |
| --- | --- |
| `state` | One of `ok`, `failed`, `approval-needed`, `stale`, `no-tracker`, `terminal-only` |
| `reason` | Why the state is not `ok` |
| `at` | The time of the read |
| `root` | The repo root |
| `source` | The adapter name |
| `items` | The normalized work items |

Normalized work item:

| Field | Meaning |
| --- | --- |
| `key` | `<source>:<id>`, unique across sources |
| `id` | The tracker's id, for example `handily-ab12` |
| `title` | The title |
| `status` | One of `open`, `in_progress`, `blocked`, `deferred`, `closed`, `other` |
| `rawStatus` | The tracker's own status word |
| `priority` | A number when the tracker has one |
| `type` | The work type when the tracker has one |
| `assignee` | The holder when the tracker has one |
| `updatedAt` | ISO time when the tracker has one |
| `source` | The adapter name |
| `url`, `labels`, `parent` | Optional, when the tracker has them |

Refresh:

- Refresh is single-flight and has a minimum interval.
- `refresh()` returns a diff: created, updated and closed items.
- Trigger: the provider polls file mtimes with `$.clock.every`. `watchPaths` with
  `classic.FileChanged` works for a file or a folder, but never for a glob. A team
  organization's security plugin can skip `classic.SessionStart` for user mods, so the mod
  does not use `watchPaths` (probe 2).

Sources, in order of detection:

| Tracker | Detect by | Read path |
| --- | --- | --- |
| basicly | `.basicly/ledger/template.json` | `basicly tracker list --status <s>`, once per open status |
| beads (`bd`), beads_rust (`br`) | `.beads/issues.jsonl` | Built-in JSONL reader |
| beans | `.beans/**/<id>--<slug>.md` | Built-in front-matter reader |
| Any other | Globs and a field map in `.handily.json` | Generic JSON, JSONL or front-matter reader |
| Any other | An entry for the repo root in `~/.config/handily/adapters.json` | CLI adapter contract |

basicly:

- The ledger holds `template.json`, `pending-<branch>.jsonl` and `snapshot.jsonl`. Files
  `events-*.jsonl` appear only after a fold. So the provider detects basicly by
  `template.json`.
- The provider runs `basicly tracker list --status <s>` from `PATH` (review decision 9).
  basicly 0.21.1 or later runs only the installed package for this command. An older basicly
  also runs the repo code in `.basicly/core/kit/tracker`. Every basicly command runs only after
  approval (decision F). The key is the root, the resolved `argv[0]`, the argv and the sha256 of
  every file under `.basicly/core/kit/tracker/`, in every subfolder. A second key holds the
  root, the argv and the resolved `argv[0]`. When only the kit files differ, the provider runs
  `<argv[0]> --version`, and a `basicly X.Y.Z` of 0.21.1 or later approves the read. Any other
  output, or a non-zero exit, asks again. The provider runs the recorded `argv[0]`, refuses one
  inside the repo root, and checks the approval again before each list run.
- Without `basicly` on `PATH`, the read fails with "basicly is not on PATH. Install it to read
  this tracker." The provider never runs the repo's `cli.py` (decision E).
- `basicly` and `basicly --version` run with `PYTHONDONTWRITEBYTECODE=1` and
  `PYTHONPYCACHEPREFIX` set to a new folder that does not exist, so no cached `.pyc` file from
  the repo runs.
- `isStdoutTruncated` makes the read fail, and the reason names it.
- The provider skips tombstoned records.
- Field map: `record` to `id`, `fields.title`, `status`, `fields.priority`,
  `fields.issue_type`, `fields.assignee` and `dates.updated`.
- `basicly tracker list` prints `{count, records, schema}`.

beads and br:

- Fields: `id`, `title`, `status`, `priority` (0 to 4), `issue_type`, `assignee`,
  `updated_at`.
- The reader skips a line whose `_type` is not `issue`. It skips a tombstone.
- `bd` stores its data in Dolt. So `.beads/issues.jsonl` can be stale. Items from `bd` carry
  the label "possibly stale" (review decision 8).

beans:

- Each item is a file `.beans/**/<id>--<slug>.md`.
- A file under `archive/` is closed.
- Priority is a word. The reader maps it to a number.
- beans has no assignee.

Limits and safety:

- A file over 4 MiB makes the read fail, and the reason names it.
- `.handily.json` globs are confined to the root by `realPath`.
- basicly needs approval (review decision 10). The provider never asks for approval when the
  session is not interactive (`!isInteractive`).
- A repo never names a command to run (decision E). The CLI adapter argv comes only from
  `~/.config/handily/adapters.json`, which the person writes. The key of an entry is the exact
  real path of the repo root, with no patterns. A clone at another path does not match.
- The consent in `adapters.json` covers the command, not one version of the code. A pull that
  changes the script runs new code with no new ask. A clone placed later at the same path
  inherits the entry. With the working folder at the root, `npx`, `python -m`, `uv run` and the
  `require` of `node` load repo code. The check that the program is outside the root covers
  only `argv[0]`.
- The provider refuses a program whose real path is inside the repo root, or whose real path
  the engine does not give. Program lookup skips a relative or empty `PATH` entry, such as `.`.
  On Windows the root comparison ignores case.
- A kit file over 4 MiB, or a covered file whose name holds a control character or is over 256
  characters, makes the read fail. A failure reason or caveat that holds a control character
  or is over 1000 characters becomes a fixed text, so a repo name is never echoed.
- The adapter `name`, `writes`, `watch` and `statusMap` keys are refused when one holds a control
  character or is over 256 characters, or when a list has more than 100 entries.
- Each reader refuses an item whose `id`, `title` or raw status holds a control character or is
  too long. Every read of a tracker file stays inside the repo root.
- `$.process.run` works only in the CLI. In the desktop app a CLI source shows the state
  `terminal-only`.

CLI adapter contract (version 1):

- The person names the command in `~/.config/handily/adapters.json`:
  `{ "<real path of the repo root>": ["prog", "args..."] }`. A repo can ship the adapter script
  and document the command. A repo `.handily.json` that names a command fails, and the reason
  names the user file and the root but never repeats the command.
- `<command> items --json` prints a JSON array of normalized work items to stdout, exit 0.
- `<command> describe --json` prints `{ "name", "version", "contract": 1, "watch": [globs],
  "writes": [argv prefixes], "statusMap": {...} }`. The provider re-reads when a file under
  `watch` changes.
- The provider refuses a contract other than the number 1, and names the value it got.
- A non-zero exit, output that was cut off or bad JSON makes the provider report the adapter
  as failed. It never guesses.

The provider also tells the other mods which paths and which CLI commands are tracker
writes. quiet-items reads that list.

### 4.2 quiet-items (mod 1)

Match:

- Hooks `tool.call` on `Bash`, `Write` and `Edit`.
- A command parser decides with an allowlist (handily-gvul). A denylist missed shapes that
  ran code, such as `$'…'`, `python3 -c'…'`, `uv run --default-index=…` and `/tmp/br`.
- A verb allow-list per tracker comes from each CLI's own help. No `basicly-tracker` binary
  exists.

| Tracker CLI | Write verbs, from |
| --- | --- |
| `br` | `br capabilities` |
| `.basicly/core/kit/tracker/cli.py` | Its help (16 write verbs) |
| `basicly tracker` | `close`, `comments add`, `create`, `dep add`, `dep remove`, `gate report`, `update` |

- A command goes quiet only when all of these hold:
  - Each segment starts with `br`, `bd` or `basicly` as a bare word, or with
    `.basicly/core/kit/tracker/cli.py`. It can also start with `python3` or `python`
    directly followed by that kit path.
  - `uv run` is not allowed. It syncs the project first, and a build backend in the tree
    can run any code.
  - Each segment is a tracker write, or `cd` with one word. `--help`, `-h` and `--dry-run`
    are not writes.
  - No `cd` comes before a segment that runs the kit path, because the relative path then
    names a script in another directory. A `cd` before `br`, `bd` or `basicly` is allowed.
  - Only `&&` joins two segments.
  - Every word is a bare word of `[A-Za-z0-9._/:=@,+%-]`, a single-quoted string, or a
    double-quoted string without `$`, a backtick or a backslash.
  - No option of `python` appears.
  - The command has at most 8192 characters. The parser does not read a longer command,
    and it gives `opaque` with reason `syntax` when a tracker name appears.
- Every other command falls back to the engine row. The parser returns `opaque` when the
  command names a tracker program or the kit path, and `none` when it names neither. A
  script such as `bash close.sh` gives `none`, because the parser cannot see inside it.
- A trailing `echo` is the one exception to the `&&` rule. It holds only allowed words, `$?`
  is the one `$` that it may hold, and no word starts with `-`. After `;` or a newline, the
  mod goes quiet only when the last output line shows `$?` as `0`. After `&&`, a plain echo
  stays quiet, because the exit status of the list is the tracker's. `br close a; echo ok`
  falls back to the engine row.

Draw:

- After `next(e)` succeeds, the mod calls `workitems.refresh()`. It stores the diff in
  `$.state`, keyed by `tool_use_id`.
- `ToolUse` and `ToolResult` render from that state. Without state they return `next(e)`.
- A call that is errored, interrupted or still running returns `next(e)`.
- One row: `work item created  handily-ab12  <title cut to N chars>  open  P2`. The verb is
  created, updated, closed or commented. N comes from `userConfig` (default 60).
- A direct `Write` or `Edit` of a tracker file draws a distinct "raw tracker edit" row
  (review decision 4).
- `ToolUse` has no `isExpanded` prop. The mod cannot see the ctrl+o expanded state.
- It never rewrites what the model reads.

Toggle:

- The toggle is per session, in `$.state` (review decision 5).
- `userConfig` holds only the default. A config write reloads the module and acts on all
  sessions.

### 4.3 task-pane (mod 2)

- Commands come first: `/task add` and `/task rm`. The `Pane` is optional, because the mobile
  app has no `Input`.
- The mod owns the task list (user decision, 2026-10-07). A default session has no task tool:
  probe 8 found neither `TaskCreate` nor `TodoWrite` in `$.tool.list()`. The `Task*` tools
  appear only with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, which a mod cannot set.
- At `session.start` the mod registers the model tools `task_add`, `task_update` and
  `task_list` through `$.tool.register`. It adds a system prompt section that tells the model
  to keep its plan in them. The list lives in `$.state`, so it survives a hot reload.
- The list resets on `session.end` with the reason `clear`.
- Failure mode: the model can ignore the tools. Where the variable is set, the built-in list
  also exists, and the pane does not show it.
- A `Pane` docks beside the transcript only in fullscreen mode. Unasked, it docks from 144
  columns. Once the person asks for it, it docks from 110 columns. When the person opens it,
  it docks at any width. Otherwise it draws inline, so the mod needs no `AbovePrompt` band.
- `/task pane` opens it. `userConfig` `mode`: `off`, `toggle` or `always`.
- When the person changes the list, the mod appends a note, so that the model knows. A pane
  Button that runs a tool opened no permission dialog (probe 8).
- Tasks before a session come from the tracker's open items through `workitems` (review
  decision 2). The out-of-session queue is dropped.
- No automatic replay. The person adds open items through an explicit "add N items" button.
- Optional action: promote a task to the tracker through the workitems CLI adapter.
- Risk: Claude can ignore a task added mid-turn until the turn ends.

### 4.4 session-board (mod 3)

- Main source: `claude agents --json`. It lists interactive and background sessions on
  this machine.

| Field | Meaning |
| --- | --- |
| `startedAt` | Epoch milliseconds |
| `id`, `state` | On a background row |
| `pid`, `status` | On an interactive row |
| `waitingFor` | Optional |

- `--all` adds sessions that ended.
- One call takes 0.73 s (measured three times with `/usr/bin/time`).
- Poll it every 15 s, and only while the pane is visible. One shared poll cache file holds
  the result and its age.
- Worktree and branch: `git -C <cwd> rev-parse --show-toplevel` and
  `git -C <cwd> branch --show-current`. The mod runs git only when a cwd changes.
- Time worked: the spans from `turn.start` to `turn.complete`, for sessions that run handily.
  Other sessions show the elapsed time.
- Completion estimate: completed tasks divided by all tasks, applied to the time since the
  first task. Always labelled `est.`.
  - No estimate until one task is complete.
  - No estimate for N minutes after a task is added.
- Optional extra data from sessions that run handily: the current task and task progress,
  under one `$.store` key per session id. `$.store` merges writes per key across concurrent
  sessions (probe 6). The mod writes its key on task events, with the current session id. A
  key is stale when its session is absent from `claude agents`. The board does not read the
  engine's task files on disk, because their format is internal.
- `claude` on `PATH` in a desktop session is not measured (probe 8 needs the person). Until it
  is, the desktop board shows this session and its subagents only.
- This session's own subagents come from `$.agent.list()`.

### 4.5 work-status

Dropped (review decision 7).

### 4.6 item-toasts (lowest priority)

A toast when a work item changes state outside this session. It needs a rate limit.

### 4.7 agent-board (handily-cr7r)

- Purpose: one pane that shows what each subagent of this session does. `session-board` shows
  the sessions of the machine. `agent-board` shows the subagents inside one session.
- Decision (2026-10-08, a design lane and a Codex second opinion): a new mod with its own
  `Pane`, not a second view of `session-board` and not an extension of the engine's own
  background agent view. No render component reaches the engine's task list.
- Two panes do not show at once. With both boards open, they are tabs.

Sources of a row:

| Source | Fields |
| --- | --- |
| `$.agent.list()` | `id`, `type`, `status`, `description`, `name?`, `parentId?` |
| `agent.spawn` | the result `{ model, agentId }`; the input `description`, `subagentType`, `name`, `parentAgentId` |
| `tool.call` | `agentId` in a subagent loop, none on the main loop; `tool`, `tool_use_id` and the tool's arguments |
| `turn.complete` | `agentId`, `durationMs`, `usage?` |

Facts from the live probe on Claude Code 2.1.294 (handily-v921):

- A `tool.call` of a subagent carries `agentId`. A main-loop call carries none.
- `agent.spawn` resolved with `model` and `agentId`. `agent.list` showed the Explore agent as
  `running`, then `completed`, and still listed it 90 s after the spawn. A main-loop spawn has
  no `parentId`.
- Two `agentId` values appeared in `tool.call` that `agent.list` never showed. The engine types
  say that the agents of a workflow and the own forks of the engine (compaction, memory) carry
  such ids. The consumer run of the mod saw one more, which called `AskUserQuestion`.

Design:

- Hot path: the `tool.call` hook passes a main-loop call on at once. For a subagent call it
  makes one `$.clock.now()` call and keeps the running call in memory until `next` settles.
  Memory per agent is bounded: a fixed set of fields, the calls in flight, and a target of at
  most 200 characters.
- Every hook on `session.end`, `tool.call`, `agent.spawn`, `turn.complete` and `ui.close` has a
  `.catch` that answers `next(e)`. The `next` of a `.catch` replays a settled call and does not
  run it again.
- Each `session.end` clears the rows. The types say that a `/clear` is a `session.end` with the
  reason `clear`, and that no `session.start` follows it. A resume also ends the session in the
  same process.
- The list and the drawing run only while the pane is drawn. A `$.clock.every(1000)` timer
  redraws while the pane is the shown tab, and stops when the pane closes.
- A loop that `agent.list` never names keeps its row, marked `not listed`. A spawned agent with
  no list row and no loop event gets the same mark, for example a remote workflow agent. The
  header counts these rows apart, so they do not block `all N done`.
- At most 20 rows that `agent.list` never named and that run no call stay. The row seen least
  recently goes first. A row that the list named, or a row with a call in flight, never goes.
- An agent that `agent.list` no longer shows keeps its row. When its turn ended, it stays
  `done`. When its last listed status was not an end and no turn end came, its status becomes
  `unknown` and its time stops at the last sight.

Limits:

- The rows live in the memory of the hooks module. A reload of the mod clears them.
- `agent.list` has no spawn time. An agent that the mod first saw in the list gets the time of
  that sight.
- The mod does not drop the row of an agent that `agent.list` named.

### 4.8 simple-view (handily-v921)

One row for each `Bash`, `Edit` and `Write` call, one `/simple` switch per session, and
`/simple show N` to print a call in full. The mocks are in `docs/mocks.md`, section 6.

Measured usage (2026-10-08, 94 local session transcripts, top level only): 13356 tool calls.
`Bash` made 11744 of them (88 percent), `Edit` 327 and `Write` 239. So the mod starts with
these three tools.

Engine facts (Claude Code 2.1.294, from the generated types and two live probes):

| Fact | Consequence |
| --- | --- |
| `ToolUse` props carry no start time | The mod reads `$.clock.now()` before and after `next(e)` in `tool.call`, and keeps the time in `$.state` by `tool_use_id`. The time includes a permission wait |
| A `$.state` read while drawing subscribes the row | A `$.clock.every` of 1 s writes the running time, so the running row redraws. The timer stops when the call ends |
| An errored `Bash` output is a string `Error: Exit code N` and the stderr lines | The row shows `exit N` and the first non-empty line after it. Another error text draws the engine row |
| A successful `Bash` output has no exit code | The row shows `exit 0`, or `returnCodeInterpretation` when the engine gives one |
| `bashEditDiff` holds the per-file hunks of a `Bash` call | The `ToolResult` shows one line per file with its totals. Replacing that `ToolResult` hides the engine's diff body |
| With Bash edit tracking on, a write call carries `bashEditDiff` and a read-only call carries no field. With tracking off, a write call also carries no field (live probe, handily-s43cv) | A missing field does not prove that the call changed no file. The row draws no result line, and `/simple show N` prints `File diff: not reported by the engine.` (user decision 2026-10-08, option B) |
| The `CLAUDE_CODE_BASH_EDIT_DIFF` variable wins. Else the `bashEditDiffEnabled` setting turns tracking on or off. Else tracking is on only in `auto` or `bypassPermissions` mode, behind a feature gate that the mod cannot read (read in the 2.1.294 binary) | The mod cannot tell whether tracking was on for a call. `/simple show N` prints `File diff: none.` only for a tracked `Bash` call with no changed file |
| `bashEditDiff` with `unavailable` or `skipped` means that the engine did not track the call | The row says `File changes were not tracked for this call`, and `/simple show N` prints `File diff: not tracked by the engine.` |
| An errored `Bash` output is a string, so it carries no `bashEditDiff`. A failed command can still change a file | `/simple show N` prints `File diff: not reported by the engine.` for an errored `Bash` call |
| `Edit` and `Write` outputs hold `structuredPatch` | The totals are the `+` and `-` lines of the patch. A new file counts its content. An update with no patch shows the path only |
| ctrl+o reuses the settled render | No row can expand in place, so `/simple show N` prints the call |
| The normal view folds runs of `Bash` calls into one `ToolGroup` line | The mod leaves the group line as the engine draws it. The ctrl+o transcript unfolds it into `ToolUse` rows |
| `$.state.set` on another plugin's key is refused (`quiet-items owns that value and only its owner writes it`) | `/simple` cannot set the `quiet-items` mode. It switches only its own mode |

Defer to quiet-items:

- `simple-view` lists `quiet-items` under `dependencies`, so the `quiet-items` contract types
  the read of its `rows` key.
- When `quiet-items` stored rows for a call and its `mode` key is not `off`, both renders go
  to `next(e)`. quiet-items stores rows also while its mode is off, so the mod reads the mode
  (unset means on, as in quiet-items).

`/simple show` memory:

- The mod keeps the last 50 calls of the main loop in a `StateFamily` of 50 slots, and a
  `count` key that it raises with `ifVersion`.
- It cuts each part (input, output, diff) at 8000 characters.
- `/simple show N` reads the slot of call `count - N` and checks the sequence number in it, so a
  slot that a lost write left behind is not shown as the wrong call.
- `session.end` (every reason, `/clear` and resume included) raises a `generation` key and
  sets `count` to 0. Each kept call holds its generation, and each time record is keyed
  `<generation>:<tool_use_id>`, so nothing of an ended session is reachable. `$.state` has no
  delete. The slots are written over, so they stay at 50. One time record stays per `Bash` call.

## 5. Repo layout (proposed)

```text
handily/
  .claude-plugin/marketplace.json   generated from mods/*/.claude-plugin/plugin.json
  mods/
    workitems/      .claude-plugin/plugin.json, hooks/, types/index.d.ts, tests
    quiet-items/
    task-pane/
    session-board/
    item-toasts/
  docs/design.md
  package.json      typescript, linter, scripts that run tsc, validate and test on each mod
```

## 6. TypeScript gates as a basicly pilot

handily is the first TypeScript repo that basicly manages. It pilots the TypeScript gates and
rules that basicly can later distribute as a `typescript` technology tag.

- Fact: the basicly catalog has only the `python` technology tag.
- Fact: the basicly comments gate already covers `.ts`, `.tsx` and `.mjs`.
- Fact: basicly reads skill sources only from `.basicly/core/skills`, which install manages.
  A consumer has no local skill overlay, so handily's mod rules are an overlay fragment
  scoped to `mods/**`.
- basicly tracks this pilot as `basicly-975f0xc` (filed 2026-10-07).

What is in place (handily-fwkt.1):

| Gate | Tool | `basicly.toml` check |
| --- | --- | --- |
| Validate | `claude plugin validate --strict`, plus a name check across folder, manifest and marketplace | `mods-validate` |
| Type check | `tsc` 6.0.3 per mod | `mods-typecheck` |
| Lint | ESLint 10 with typescript-eslint 8.71 `strictTypeChecked` | `eslint` |
| Format | Prettier 3.9 | `prettier` (with a fix command) |
| Test | `claude plugin test`; a mod with no test fails | `mods-test` |

Measured facts behind these choices:

- typescript-eslint 8.71.1 accepts TypeScript `>=4.8.4 <6.1.0` (from `npm view`), so
  TypeScript is pinned to 6.0.3, not 7.
- A headless `claude --plugin-dir <mod> -p ok` with an empty config folder and no login
  writes the mod's types and then exits "Not logged in". CI uses this to get the types.
- `no-misused-promises` with its default `checksVoidReturn` ran over 80 s on a 9-line mod,
  because it compares callbacks with the large overloads of `on`. With
  `checksVoidReturn: false` it takes about 0.5 s. `no-floating-promises` stays at full
  strength and refused a planted unawaited `$.store.set` in about 0.5 s.
- `claude plugin validate --strict` refuses a marketplace with no plugins. Until the first
  mod exists, the runner validates the marketplace without `--strict` and says so.
- `$.ui.toast` and `$.ui.status` return `void`, not a promise.

## 7. Open questions for the implementation session

Closed:

- **Q1. basicly read path.** Closed by review decision 9 and decision E: `basicly tracker list
  --status <s>` from `PATH` only. Every basicly read runs only after approval. The approval
  covers the kit files only for a basicly below 0.21.1 (decision F). The repo's `cli.py`
  fallback was dropped.
- **Q2. Repo config file.** Closed by review decision 11: `.handily.json` at the repo root.
- **Q4. Linter.** Decided 2026-10-07: typescript-eslint with Prettier (section 6).
- **Q6. Ignore rules.** Done 2026-10-07: `.claude-plugin/types/` and `node_modules/`.
- **Q7. basicly ready set.** Closed by review decision 9. The basicly tracker needs a recorded
  INVEST/C3 review before a record is ready. So the provider reads each open status, not
  only "ready" records.
- **Q8. Mod release process.** Closed by review decision 6. A release rests on the
  `plugin.json` version. Users update when that version changes. Each mod has one version,
  and only a changed mod gets a bump. `claude plugin tag mods/<name>` makes a
  `<name>--v<version>` tag. The tag is secondary. The command needs a clean tree and a
  marketplace version that matches.

Closed by the P0 probes (handily-0m93, Claude Code 2.1.293):

- **Q3. Sidecar location.** One `$.store` key per session. No write was lost in 4 rounds of
  concurrent sessions.
- **Q5. Task tools.** `$.tool.call` on `TaskCreate` reaches the main task list. It draws no
  row. It did not ask for permission in a headless session.

| # | Probe | Result |
| --- | --- | --- |
| 1 | `TaskCreate` through `$.tool.call` | Reaches the list. No row. No prompt when headless |
| 2 | `watchPaths` and `classic.FileChanged` | File and folder work. Globs fail. Blocked on a team org |
| 3 | Types of a dependency | Laid when both mods load. A dependent alone does not load |
| 4 | `claude plugin test` in parallel | Safe in 5 rounds |
| 5 | `$.config.set` on the mod's own `userConfig` | Not measured headless. Nothing depends on it |
| 6 | `$.store` from concurrent sessions | No loss. Merged per key |
| 7 | Task-list files on disk | One folder per session, one JSON file per task. Internal |
| 8 | Prompts from pane buttons; task tools in a TUI session | No dialog. No task tool unless the variable is set. Desktop not run |

## 8. Delivery plan

- Each child carries EARS criteria, a file scope, a budget, an integrity level, a demo
  command, the expected reading, and an ASCII mock for terminal and desktop.
- The person approves the mocks per mod before the lanes start (review decision 1).
- `basicly.toml` sets `[worktree] base_branch = "main"`. A lane branch name carries the
  record id.
- A generator writes `marketplace.json` from `mods/*/.claude-plugin/plugin.json`, with the
  versions. A `generate --check` gate refuses a stale file.
- Types are laid again when a dependency contract is newer. The development load is
  `claude --plugin-dir mods`.
- A full verify runs after each landing rebase.

| Phase | Content |
| --- | --- |
| P0 | Decisions, mocks, probes, this doc fix |
| P1 | workitems core: noun, contract, snapshot, beads reader, parser prefilter table, marketplace generator, types re-lay |
| P2 | Lanes A1 then A2, B, C, D, E1. E2 after P1, with a confirmed CI edit |
| P3 | Review, consumer runs, the person's review, then release |
| P4 | Extras |
