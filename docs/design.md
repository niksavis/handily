# handily — research and design

Status: revision 3 (record `handily-0m93`), with later decisions added in place. The mods are
built and released. `CHANGELOG.md` lists each release. Sections 4.3, 4.4 and 4.7 are historical.
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
| 9 | basicly read path | `basicly tracker items --json --status open --status in_progress --status blocked` from `PATH` only, in one call, after the person approves it (handily-8mjdz; it was one `basicly tracker list --status <s>` per open status). Without `basicly` on `PATH` the read fails by name. The repo's `cli.py` fallback was dropped by decision E |
| 10 | Approval key | For basicly: the repo root, the argv, the resolved `argv[0]` and the sha256 of every file under `.basicly/core/kit/tracker/`. A second key holds the same without the kit files. When the kit changed, the approved program's `--version` decides: 0.21.1 or later runs only the installed package, so the second key is enough. Below 0.21.1, or a version that does not parse, the kit files must match. No basicly command runs before approval (decision F). A program that resolves inside the repo root is refused. A CLI adapter needs no approval (decision E) |
| 11 | Repo config | `.handily.json` at the repo root holds data only: `source`, `globs`, `format` and `fields`. Its globs are confined to the root by `realPath`. It cannot name a command (decision E) |
| E | CLI adapter command (2026-10-08) | A repo never names a command to run. The person lists the adapter argv in `~/.config/handily/adapters.json`, keyed on the exact real path of the repo root. Typing that line is the consent, so the adapter runs with no approval ask. A repo `.handily.json` that names a command fails, names the user file and the root, and never repeats the command. The consent covers the command, not one version of the code |
| F | Ask once for basicly (2026-10-08, handily-szdh) | Ask once and keep the answer. No basicly command, `--version` included, runs before the person approves the repo. After approval, a kit change runs the approved program's `--version`. The verdict is kept in memory only, keyed on the approval key and the size and modification time of the program file, so a kit change or a reinstall at the same path runs `--version` again. The guarantee that holds on every path is older: `tracker items` first shipped in basicly 0.21.1, the release that stopped running the repo kit, so a basicly that runs repo kit code fails this read by name before any kit code runs (handily-8mjdz). An approval of `basicly tracker list` does not cover `basicly tracker items`, so the person approves once again. A read without approval through an isolated interpreter was dropped: two reviews each found a way for repo code to run before any check |

### Plugin names (2026-10-09, handily-wltuw)

The person decided on 2026-10-09 to start the plugin name of each mod with `handily-`. The
marketplace lists many plugins, and a short name such as `workitems` did not show that it
belongs to handily.

| Part | Choice |
| --- | --- |
| Plugin name, folder and marketplace entry | `handily-<mod>`, such as `handily-workitems` |
| Bundle | Keeps the name `handily` |
| Slash commands | Keep their short names: `/task`, `/simple`, `/replies`, `/agent-board`, `/session-board`, `/quiet-items`, `/handily` |
| Command description | Starts with `handily ·`, so the menu shows where a command comes from |
| `$.state` keys, `dependencies` and contract folders | Use the new name, because `$.state.set` writes only the value of the calling plugin |
| Model tools of task-pane | `mcp__handily-task-pane__<name>`, because the engine names a tool after its plugin |
| Release | One release of every mod. A new tag is `handily-<mod>--v<version>`. The old tags stay |
| Old ids | `/handily` names each old id that the user, project or local settings still hold, and prints `claude plugin uninstall <old id> --scope <scope>` |

On Claude Code 2.1.295 an update of the bundle from 0.2.0 to 0.3.0 did not install its new
dependency `reply-view` (measured by the person). So an update after the rename leaves the old
ids installed and the new ids missing. With both installed, the two copies collide (measured
with `--plugin-dir` beside the old installed ids): Claude Code refused the commands of one
copy, and `handily-workitems` did not load, because `workitems` had already added
`$.workitems`.

### Signals and colours (2026-10-09, handily-fwkt.8.14)

The person approved this set of marks on 2026-10-09. Every pane draws a state with the same mark
and the same colour. Each mark is one column wide, because an emoji such as ⚡ is two columns
wide in most terminals and breaks the row alignment. A test measures the width of each mark.

| Signal | Kanban meaning | Mark | Colour | When the pane shows it |
| --- | --- | --- | --- | --- |
| Doing | in progress | `▶` | orange | the task in progress, a running agent |
| Done | finished | `✓` | green | done tasks and agents |
| To do | in the backlog | `○` | subtle | open tasks |
| Blocked | blocked tag | `■` | red | an agent or a task whose last tool call failed twice |
| Waits for you | needs a person | `◆` | yellow | a permission dialog, a question to you |
| Aging | aging dots | `·` `:` `⁝` | subtle, then yellow | the task in progress has run 5, 15 or 30 minutes without an update |
| Too much at once | limit on work in progress | `2▶` | yellow | more than one task in progress at the same time |
| Stale plan | no update | `⌀` | yellow | no plan change for 20 tool calls |
| Retry | rework | `↻` | subtle | the same tool call ran again after a failure |

The colours are theme colours of the engine, so they follow the person's theme: orange is
`claude`, green is `success`, red is `error`, yellow is `warning` and subtle is `subtle`. The
handover of 2026-10-09 also names `suggestion`; which signal uses it is open. The task pane
draws its author word in `suggestion`, so a title cannot imitate the author.

`handily-board` keeps the first five signals in its `hooks/signals.ts`, because mods share no
code at run time. `scripts/signals.test.mjs` fails when the table differs from this one, when
another mod keeps a `hooks/signals.ts` that the test does not compare, or when a mark is not one
column wide. The tabs of `handily-board` map their states to the signals as follows. The aging
dots, `2▶`, `⌀` and `↻` are not built yet.

| Signal | this session: tasks | this session: agents | this machine |
| --- | --- | --- | --- |
| Doing | a task in progress | `running`, `waiting` (drawn as `on hold`) | `busy`, `working` |
| Done | a done task | `done`, `killed` | a session that ended without a failure |
| To do | an open task | `pending`, `idle` | `idle`, an unknown word |
| Blocked | none | `failed` | a session that ended with `failed` |
| Waits for you | none | none | `waiting`, `blocked`, any `waitingFor` |

On 2026-10-09 the person also asked the task pane to drop the author `claude` from each row.
The pane shows the author only for `you` and `tracker`.

The approved example of the task pane:

```text
Tasks  3 of 7 done · 22m
▶ 4 claude  Build the reply view   :  12m   ▸ Edit fold.ts · 14 tools
◆ 5 claude  Ask about the colours          waits for you
○ 6 claude  Release the mods
○ 7 you     Read the mock
[ +3 done ]
Agents  2 running
▶ lane-b   Build compact view   ▸ Bash npm test
■ scout    Probe the engine     ✗ npm test failed twice
```

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
  `source`. The install line is `/plugin install handily-<mod> --marketplace niksavis/handily`.
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

Adds the noun `$.workitems` with a typed contract. Other mods list `handily-workitems` under
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

A poll that finds no change does not publish the snapshot again. It publishes only the small
`$.state` value `checked`: the snapshot `version` and the time `at` of the check. The header
age of `lines()` uses the newer of `snapshot.checkedAt` and `checked.at` when both have the same
version (handily-fwkt.2.5).

A poll sends its checks at once: the root, the time, the detection of every source and the
signature of the last source at the last root. When the root or the source changed, it checks
the new one again before it reads. An unchanged poll of a 26 MB beads file took 2 to 4 ms in a
live session, measured with a probe that times `await $.workitems.refresh()` (handily-fwkt.2.5).

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
| basicly | `.basicly/ledger/template.json` | `basicly tracker items --json`, one call for every open status |
| beads (`bd`), beads_rust (`br`) | `.beads/issues.jsonl` | Built-in JSONL reader; over 4 MiB, streamed through a fixed system reader with no approval |
| beans | `.beans/**/<id>--<slug>.md` | Built-in front-matter reader |
| Any other | Globs and a field map in `.handily.json` | Generic JSON, JSONL or front-matter reader |
| Any other | An entry for the repo root in `~/.config/handily/adapters.json` | CLI adapter contract |

basicly:

- The ledger holds `template.json`, `pending-<branch>.jsonl` and `snapshot.jsonl`. Files
  `events-*.jsonl` appear only after a fold. So the provider detects basicly by
  `template.json`.
- The provider runs this command from `PATH` (review decision 9):
  `basicly tracker items --json --status open --status in_progress --status blocked`.
  basicly 0.21.1 or later runs only the installed package for this command. An older basicly
  also runs the repo code in `.basicly/core/kit/tracker`. Every basicly command runs only after
  approval (decision F). The key is the root, the resolved `argv[0]`, the argv and the sha256 of
  every file under `.basicly/core/kit/tracker/`, in every subfolder. A second key holds the
  root, the argv and the resolved `argv[0]`. When only the kit files differ, the provider runs
  `<argv[0]> --version`, and a `basicly X.Y.Z` of 0.21.1 or later approves the read. Any other
  output, or a non-zero exit, asks again. The provider runs the recorded `argv[0]`, refuses one
  inside the repo root, and checks the approval once per read, before the call.
- Without `basicly` on `PATH`, the read fails with "basicly is not on PATH. Install it to read
  this tracker." The provider never runs the repo's `cli.py` (decision E).
- `basicly` and `basicly --version` run with `PYTHONDONTWRITEBYTECODE=1` and
  `PYTHONPYCACHEPREFIX` set to a new folder that does not exist, so no cached `.pyc` file from
  the repo runs.
- `isStdoutTruncated` makes the read fail, and the reason names it.
- basicly leaves out tombstoned records.
- Field map: `id`, `title`, `rawStatus`, `priority`, `type`, `assignee` and `updatedAt`.
- `basicly tracker items --json` prints a JSON array of items in the adapter contract shape.

beads and br:

- Fields: `id`, `title`, `status`, `priority` (0 to 4), `issue_type`, `assignee`,
  `updated_at`.
- The reader skips a line whose `_type` is not `issue`. It skips a tombstone.
- `bd` stores its data in Dolt. So `.beads/issues.jsonl` can be stale. Items from `bd` carry
  the label "possibly stale" (review decision 8).
- Over 4 MiB the engine cannot read the file. The provider then streams it through
  `$.process.spawn` with a fixed system reader: `/bin/cat <absolute path>` on Linux and macOS,
  `%SystemRoot%\System32\cmd.exe /d /c type .beads\issues.jsonl` at the root on Windows. No
  repo file can change the reader, so there is no approval and no `br` run. A reader whose real
  path is inside the root fails by name. Lines are parsed as they arrive; a line whose only
  `"status":` key is closed or tombstone is skipped before `JSON.parse`. Only items that are
  not closed are kept, so the outcome is open-only: a missing item reads as closed. The poll
  signature is the size and mtime, so an unchanged file is not read. On Dolt (`bd`) a file
  over 4 MiB fails by name and runs nothing (handily-vli6x, handily-fwkt.2.4).

beans:

- Each item is a file `.beans/**/<id>--<slug>.md`.
- A file under `archive/` is closed.
- Priority is a word. The reader maps it to a number.
- beans has no assignee.

Limits and safety:

- A file over 4 MiB makes the read fail, and the reason names it. The one exception is
  `.beads/issues.jsonl`, which the provider then streams.
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

Historical. Replaced by 4.9, `handily-board` (decision of the person, 2026-10-13). This section
stays as the record of the design. The plugin `handily-task-pane` is removed.

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

Historical. Replaced by 4.9, `handily-board` (decision of the person, 2026-10-13). This section
stays as the record of the design. The plugin `handily-session-board` is removed.

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

The toast layout (approved 2026-10-27, handily-ftx0x.2) rests on the measured toast surface in
`docs/mocks.md` section 4. `$.ui.toast` takes plain text and `{ timeoutMs }` only. The box text
is 40 columns wide and shows at most 3 lines. A line break draws as a replacement mark, but a
part padded with spaces to 40 columns starts the next part on its own line.

| Line | Item change | Merged changes |
| --- | --- | --- |
| 1 | `✓ handily-ab12 closed` or `▶ handily-cd34 open → in_progress` | `3 items changed` |
| 2 | `"Draw text mocks for the mods"`, the tracker title, quoted | `✓ 2 closed  ○ 1 created` |
| 3 | A hint, only when there is one | `handily-ab12 handily-cd34 +1` |

- The marks are the approved signals: `✓` done, `○` new or open, `▶` in progress, `■` failed or
  refused, `◆` you must act. An item change takes the mark of the normalised status of its new
  state. `deferred` and `other` take `○`. The status words are the tracker's raw words.
- The title is escaped as the board quotes tracker text, and cut at a whole grapheme with `…`
  to fit its line. Any part longer than its line is cut with `…`, never wrapped into the next
  part. A part that a next part follows keeps 39 columns, so that its line ends in a space. A
  part of exactly 40 columns wraps a word onto the next line (measured on Claude Code 2.1.312,
  handily-ftx0x.2 record comment).
- `timeoutMs` is `2000 + 80` for each visible cell of all parts, at least 6000 and at most 15000.
  A toast with `■` or `◆` outside a quoted title stays at least 10000.
- A failure toast is `■ Work items unavailable`, then the first sentence of the reason, then the
  rest of the reason as the hint. A sentence end inside double quotes, such as quoted adapter
  text, does not split the reason. A recovery toast is `✓ Work items are back`, then the source
  and the open count.
- The 40-column width is `TOAST_COLUMNS` in `hooks/toast.ts`. That file is the one call site of
  `$.ui.toast` in the mod. It exports `TOAST_MARKS`, `toastText`, `toastMs` and `showToast`, and
  it measures width with the mod's copy of `width.ts`.
- `scripts/toast.test.mjs` refuses a mod with a `hooks/toast.ts` that its keeper list does not
  name, two copies that differ, and any use of the `toast` of `ui` in any other file under
  `mods/*/hooks`: a call, a `bind`, a bracket, a plain read or a destructure. The
  board still calls `$.ui.toast` directly. The gate lists it as a known exception until
  handily-ftx0x.4 moves it. `TOAST_MARKS` must equal the approved signal marks in
  `scripts/fixtures/signals.mjs`, which `scripts/signals.test.mjs` also reads.
- reply-view and simple-view draw their copy toasts with `showToast` (handily-ftx0x.3). A copy
  toast is `✓ Copied the plan block` or `✓ Copied the output`, then the line count, such as
  `2 lines`. A refused copy is `■ Not copied`, then the reason. A copy that throws is
  `■ Not copied`, then `the transcript shows why`, and the transcript holds the error. The texts
  are in `hooks/copy-toast.ts` of each mod. `scripts/toast.test.mjs` keeps the copies of that
  file equal, as it does for `hooks/toast.ts`.

### 4.7 agent-board (handily-cr7r)

Historical. Replaced by 4.9, `handily-board` (decision of the person, 2026-10-13). This section
stays as the record of the design. The plugin `handily-agent-board` is removed.

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

One row for each tool call, one `/simple` switch per session, and `/simple show N` to print a
call in full. The mocks are in `docs/mocks.md`, section 6.

Measured usage (2026-10-08, 94 local session transcripts, top level only): 13356 tool calls.
`Bash` made 11744 of them (88 percent), `Edit` 327 and `Write` 239. So the mod started with
these three tools. `Read`, `Grep` and `Glob` followed.

Generic row (handily-fwkt.8.23, 2026-10-14). The person asked for a row for every tool, with no
list of supported tools. The 6 tools above keep their rich rows. Every other tool draws one
generic row: the tool name (`server · tool` for `mcp__server__tool`), a summary of the input,
the state (`…`, `running`, `done`, `error`), and the line count of the result and the time.

- The summary is the first non-empty text of a fixed list of common field names (`title`,
  `description`, `url`, `query`, `path`, `prompt` and others, in `hooks/generic.ts`), else the
  first non-empty text value of the input. It reads any input shape, so a tool that a new
  release adds gets the row with no change to the mod.
- The line count is the count of lines of `text` in the `tool.call` answer. The API documents
  that field for every tool, while the shape of `result` changes per tool. The mod keeps it in
  `$.state` beside the time.
- An exclusion list keeps the engine row for each tool of the 2.1.300 tool table whose row you
  must read or answer. That covers questions, plans, messages and files to you, findings,
  offers and approvals, and `request_computer`, whose schema has no description. The mod README
  lists each tool and the reason.
- The tests assert what the mod returns: its row, an empty result block, or the element that
  `next(e)` gave. They do not pin the output shape of a tool, so a change of an engine-owned
  output does not break them.

Hand-off to other mods. The order of two plugins in the `user` tier is not in the types. In a
live check on 2.1.300 the chain was `handily-board`, `handily-reply-view`,
`handily-simple-view`, `handily-quiet-items`, then `cc-plugin-diff@builtin`. So the `ToolUse`
and `ToolResult` hook calls `next(e)` first. It draws only when the answer is the engine row
(`type: 'engine'`), and returns any other tree unchanged. A plugin above simple-view draws
before simple-view is asked. So a `handily-board` task row and a `quiet-items` row stay in
either order. The tests load an inline board in the `prepend`, `user` and `append` tiers.

Engine facts (Claude Code 2.1.294, from the generated types and two live probes):

| Fact | Consequence |
| --- | --- |
| `ToolUse` props carry no start time | The mod reads `$.clock.now()` before and after `next(e)` in `tool.call`, and keeps the time in `$.state` by `tool_use_id`. The time includes a permission wait |
| A `$.state` read while drawing subscribes the row | A `$.clock.every` of 1 s writes the running time, so the running row redraws. The timer stops when the call ends |
| An errored `Bash` output is a string `Error: Exit code N` and the stderr lines. A timeout is `Error: Exit code 143` (local transcripts, 2026-10-27) | The row shows `exit N` and the first non-empty line after it |
| A call that a `PreToolUse` hook refused has the output `Error: PreToolUse:Bash hook error: [<hook command>]: <message>`, over many lines (198 such outputs in the local transcripts, grep, 2026-10-27) | The row shows `refused` and the first line of the message, and `more` opens the whole message (handily-fwkt.8.26). A generic row shows `error` and an empty result block. The same shape for a tool other than `Bash` is assumed, not measured |
| Other errored `Bash` outputs start with `Error:` too: a permission denial, a refusal at the permission question, a guard of the engine (local transcripts, 2026-10-27) | The row shows `error` and the first non-empty line after `Error:`. A text without `Error:` draws the engine row |
| A successful `Bash` output has no exit code | The row shows `exit 0`, or `returnCodeInterpretation` when the engine gives one |
| `bashEditDiff` holds the per-file hunks of a `Bash` call | The `ToolResult` shows one line per file with its totals. Replacing that `ToolResult` hides the engine's diff body |
| With Bash edit tracking on, a write call carries `bashEditDiff` and a read-only call carries no field. With tracking off, a write call also carries no field (live probe, handily-s43cv) | A missing field does not prove that the call changed no file. The row draws no result line, and `/simple show N` prints `File diff: not reported by the engine.` (user decision 2026-10-08, option B) |
| The `CLAUDE_CODE_BASH_EDIT_DIFF` variable wins. Else the `bashEditDiffEnabled` setting turns tracking on or off. Else tracking is on only in `auto` or `bypassPermissions` mode, behind a feature gate that the mod cannot read (read in the 2.1.294 binary) | The mod cannot tell whether tracking was on for a call. `/simple show N` prints `File diff: none.` only for a tracked `Bash` call with no changed file |
| `bashEditDiff` with `unavailable` or `skipped` means that the engine did not track the call | The row says `File changes were not tracked for this call`, and `/simple show N` prints `File diff: not tracked by the engine.` |
| An errored `Bash` output is a string, so it carries no `bashEditDiff`. A failed command can still change a file | `/simple show N` prints `File diff: not reported by the engine.` for an errored `Bash` call |
| `Edit` and `Write` outputs hold `structuredPatch` | The totals are the `+` and `-` lines of the patch. A new file counts its content. An update with no patch shows the path only |
| ctrl+o reuses the settled render | No row can expand in place, so `/simple show N` prints the call |
| The normal view folds runs of `Bash` calls into one `ToolGroup` line | While the mode is on, the mod unfolds a group whose calls are all foreground `Bash`, `Read`, `Grep` or `Glob` calls (`isExpanded: true` on `ToolGroup`), so each call draws as its own row (handily-vxxvq). Any other group stays as the engine draws it |
| `$.state.set` on another plugin's key is refused (`quiet-items owns that value and only its owner writes it`) | `/simple` cannot set the `quiet-items` mode. It switches only its own mode |
| The engine folds MCP calls too, as `Called claude-in-chrome` (live, 2.1.300) | The unfold rule also takes a group whose calls draw the generic row (handily-fwkt.8.23) |
| `next(e)` answered `{ type: 'engine', ref: 1 }` for a row that no plugin changed (live probe, 2.1.300). The types say that `ref` 0 draws the original props | The mod reads `type` only. It cannot see a plugin beneath it that only rewrites the props of the engine row |
| The engine draws no row for `ToolSearch` (live, 2.1.300) | `ToolSearch` keeps the engine row and does not keep a group folded |
| A plugin that serves its own tool and stands above simple-view answers `tool.call` without `next` (`handily-board`, live, 2.1.300) | simple-view sees no such call: `/simple show N` does not keep it, and its generic row has no time and no line count |

Defer to quiet-items:

- `handily-simple-view` lists `handily-quiet-items` under `dependencies`, so the `quiet-items`
  contract types the read of its `rows` key.
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
  delete. The slots are written over, so they stay at 50. One time record stays per `Bash` call
  and per call with the generic row, and one line count per call with the generic row.
- A call of a tool other than the 6 rich tools prints `File diff: not reported by the engine.`

### 4.9 handily-board (handily-fwkt.8.19)

- Decision of the person (2026-10-13): one plugin, `handily-board`, replaces `task-pane`,
  `agent-board` and `session-board`. It has two panes, which the engine shows as two tabs:
  `this session` (tasks and this session's agents) and `this machine` (every local session).
- The old plugins are removed with no alias and no deprecation version. A release note tells a
  person who installed one how to uninstall it and install `handily-board`.
- The bundle `handily` lists `handily-board` in place of the three old plugins. `/handily`
  names `handily-task-pane@handily`, `handily-session-board@handily` and
  `handily-agent-board@handily` as old ids of `handily-board`, with the command that uninstalls
  each (handily-fwkt.8.19.4).
- Command: `/board`. `/board machine` shows the second tab. `/task` is dropped, because it sits
  next to the built-in `/tasks` (background jobs) in the slash menu.
- One plugin, not two, because each plugin has its own `$.store`, and a plugin opens only its own
  panes. With two plugins, the agent data of other sessions would sit in two stores, and
  `/board` could not show the machine tab.
- Facts measured in tmux on Claude Code 2.1.296:
  - A pane in a hidden tab does not draw. The poll of `claude agents --json` also runs only while
    its pane `isShown` (`index.d.ts`, `UiPane`).
  - A command that opens both panes gets both placed at 90 and at 120 columns in fullscreen.
  - A second `ui.open` of a hidden pane without `focus` does not bring it forward. With
    `focus: true` it does, and the pane takes the keyboard. So `/board` passes `focus` only when
    the asked tab is hidden.
- Facts measured in tmux on Claude Code 2.1.312 (handily-9uj3n.10), with a probe mod that logged
  each `ui.focus` event:
  - ctrl+x tab moves the keyboard in a cycle: from the prompt to the first pane in tab order, from
    each pane to the next, and from the last pane back to the prompt. Each pane it reaches comes
    forward.
  - After `/board`, the shown pane already holds the keyboard, because the open passed `focus`.
    Tab then reaches the Session line, the task rows and their buttons. After Esc, ctrl+x tab and
    Tab do the same.
  - ctrl+x tab pressed while the this session tab holds the keyboard gives it to the this machine
    tab. That tab draws cards with no button, so its ring holds only the engine's tab row and close
    mark. Every `ui.focus` event then named `requestId` `sessions`. This was the cause of the
    report that Tab never reached a task row. Neither tmux nor the buttons of the mods caused it.
  - The files pane behaves the same: Tab right after `/tree` reaches its agent filter. The earlier
    finding that the hotkey `r` did not fire after ctrl+x tab may have the same cause and needs a
    recheck.
- Release 1 needs neither handily-fwkt.8.10 (needs you) nor handily-fwkt.8.11 (agents of other
  sessions). An agent with the status `waiting` draws as `on hold` until 8.10 proves which waits
  are the person's.
- The approved mock is `docs/mocks.md` section 8.
- The person drives the list as Claude does (handily-9uj3n). `/board done`, `/board start` and
  `/board open`, and the same buttons on an opened task, set a status through the `setStatus`
  that `task_update` uses. A change of the person no longer appends a note at once. It waits in
  `$.state` under `personChanges`, and the next prompt that enters carries one note with every
  change, as `prompt.submit` context. So the person can make many changes in one turn, and
  Claude reads them once. The cost: Claude does not see a change during the turn in which the
  person makes it, unless a task tool answer shows the list. A prompt takes the queue in one
  state update, which stores an empty queue. A prompt that is dropped or fails puts its changes
  back in front. So two prompts that overlap never tell one change twice or lose one.
- `/board clear` and `[ clear done ]` remove every done task (handily-9uj3n.2). Done tasks still
  count against the limit of 100 tasks, so the limit stays one simple rule. When the list is full
  and holds done tasks, the refusal counts them and names the remedy of the caller. The person
  gets `/board clear`. Claude and a subagent get `task_update` with the status `removed`. An
  add never removes a task to make room.
- Every task row has `[ rm ]`, and `/board mv` places a task before another task or at an end
  of the list (handily-9uj3n.3). `/board mv` and `task_move` share `moveTask`, which now also
  takes the end of the list. Claude Code keeps the focus ring at the same index when a pane
  draws again (measured on 2.1.300). So the key of an `up` or `down` button holds the place of
  its task, and after a move the mod calls `$.ui.focus` with the key at the new place. That key
  exists only in the next drawing, so the engine waits for it and moves the focus after the
  draw. This rests on the documented wait of `$.ui.focus`. It is tested through the requested
  key only. A tmux check on 2.1.311 could not reach the task buttons (Tab cycled only the tab row
  and the close mark), so no live check has confirmed it.

#### The Session line, the checks and the agent states (handily-xsjad)

The person approved the design on 2026-10-27 (handily-xsjad.2). The approved mock is
`docs/mocks.md` section 8.10. The board draws a number only when an engine event or an engine
call reports it. The event names and fields come from the generated `index.d.ts` that Claude Code
2.1.300 wrote.

The engine event behind each number:

| Number on the board | Engine source |
| --- | --- |
| `ctx 62%`, `context 124k of 200k` | `session.measure`: `context.percent`, `context.tokens` and `context.window` |
| `$4.18` | `session.measure`: `cost.usd`, the total of the session |
| `turn +$0.31`, `last +$0.62` | `session.measure`: the growth of `cost.usd` since `turn.start` |
| `last turn 3m` | `turn.start` and `turn.complete` |
| `limits 5h 31% · 7d 13%`, `resets 5h in 2h` | `session.measure`: `rateLimits`, each with `kind`, `percentUsed` and `resetsAt` |
| `ctx 48k · out 6.1k` on an agent | `turn.step`: `usage` of the last step with that `agentId`. Input tokens of all three kinds, and `output_tokens` |
| `stopped at max_tokens` | `turn.step`: `stopReason` |
| `checks 25 · 8 allowed · 16 asked · 1 denied` | `tool.check`: `decision`, with `tool`, `input` and `agentId` |
| `slow 45s`, `3 edits`, `0 errors` | `tool.call`: the time until `next(e)` settles, the count of edit calls, and `isError` |
| `quiet 3m` | the time since the last `turn.step`, `tool.check` or `tool.call` with the `agentId` of the agent |
| `failed`, `running`, `2 agents spawned` | `$.agent.list()`: `status` |
| `1 compaction` | `session.compact` |

The numbers that the engine does not give:

- No cost for each agent. `cost.usd` is the total of the session. `turn.step` gives tokens, not
  dollars, and the board does not price tokens.
- No context percent for an agent. `turn.step` gives no context window, so an agent row shows
  tokens only.
- No percent of the compaction window. `session.measure` never carries the breakdown, and only
  the breakdown measures against the compaction window. Release 1 shows no such percent.
- No sure signal that a permission dialog is open. A `tool.check` answer of `ask` is a verdict,
  and a classifier or a host can answer it with no dialog. The handily-xsjad.1 probe measured
  this on Claude Code 2.1.312 in tmux, with a subagent Bash call:
  - In the default mode, `tool.check` answered `ask` with the agent id and the tool use id. The
    dialog showed, and the `tool.call` of the same id ended 11 s later, after the approval.
  - `classic.PermissionRequest` never reached the probe. Claude Code said that the organisation
    plugin `cc-plugin-sec-default` runs first and sends the event on. `classic.Notification`
    recorded nothing.
  - While the dialog waited, `$.agent.list()` reported the agent as `running`, not `waiting`.
  - In auto mode, `tool.check` also answered `ask`, and the classifier settled the call in about
    0.6 s with no dialog.
  - With the files pane given the keyboard by ctrl+x tab, the hotkey `r` did not fire. So the
    hotkeys `s` and `c` are not adopted, and section 8.7 holds.

  So an `ask` that stays unsettled is the only sign of a waiting person.
- No cost and no context where the host gives no usage. Then the Session line reads
  `no context or cost on this host` and draws no number.

The named thresholds:

| Name | Value | Effect |
| --- | --- | --- |
| `CONTEXT_HIGH` | 80 (percent) | From this context percent, the board adds `high` in the warning colour |
| `SLOW_CALL_MS` | 30000 | A call of an agent that runs longer makes the agent `slow` |
| `QUIET_MS` | 120000 | A running agent with no event for this time is `quiet` |
| `LANES_FROM` | body 80 | From this body width, the agent rows have a `ctx` column and a lane |
| `CHECKS_KEPT` | 20 | The board keeps the last 20 checks. `[ last 5 checks ]` shows 5 of them |

### 4.10 reply-view: tables, code and diagrams (handily-5zzxk)

The person approved the design on 2026-10-27 (handily-5zzxk.2). reply-view draws the tables,
the code blocks and the mermaid diagrams of a reply for the terminal. The approved mocks are in
`docs/mocks.md`, section 9.

Reference: prismantis (github.com/NahumLitvin/prismantis) at commit `ed085d7c`, MIT licence,
by Nahum Litvin. handily copies no code from it and adds no dependency. prismantis bundles
diagram code of a third party, so handily writes its own text renderer.

Tables:

- A long cell wraps inside its column. A word stays whole when the column has room for it.
  Else the word splits at the column width.
- Below 40 columns, a table draws one block for each row.
- A table never scrolls sideways. `BoxProps.overflow` has only `visible` and `hidden`, and no
  `scroll` (engine types of reply-view, 2.1.300).

Code:

- The engine `Code` element highlights the code. reply-view has no highlighter of its own.

Diagrams:

- reply-view has its own text renderer for mermaid `flowchart` with `TD`, `TB` or `LR`, and for
  `sequenceDiagram`.
- Another diagram kind draws as its source. So do `subgraph`, `direction`, `box`, `create` and
  `destroy`. One dim note above the source names the reason.
- A diagram draws whole or as its source. It never draws in part.
- A flowchart `LR` that is too wide draws as `TD`. A label that is too wide is cut to 16
  columns, then to 12 columns.
- A drawn diagram has two buttons: `[ copy ]` and `[ copy drawing ]`.
- When the fold of a reply ends inside a diagram, only the title line of the diagram shows.

Limits of one diagram. Over a limit, the diagram draws as its source, and the note names the limit:

| Limit | Value |
| --- | --- |
| Source lines | 80 |
| Source characters | 8000 |
| Boxes | 40 |
| Edges | 60 |
| Participants | 12 |
| Drawn rows | 120 |

Settings and commands:

| Setting or command | Default or use | Record |
| --- | --- | --- |
| `diagrams` | On. Off, a mermaid block draws as today | handily-5zzxk.6 |
| `diagramHints` | Off. On, a typed prompt carries one hint about diagrams | handily-5zzxk.8 |
| `/replies hints` | The command of the diagram hints | handily-5zzxk.8 |
| `/replies copy diagram`, `/replies copy table`, `/replies copy code` | Copies a block of the last reply from the keyboard | handily-5zzxk.9 |

- The hint text is about 365 characters (estimate of the designer, 2026-10-27). prismantis states
  about 630 prompt tokens for its diagram hints (its README). The cost of the handily hint is
  measured before the release.
- A transcript button takes a click only. The `/replies copy` forms give a path from the keyboard.

### 4.11 handily-filetree (handily-02b2v)

The person approved the design on 2026-10-27 (handily-02b2v.1). handily-filetree shows a file
tree that marks which agent read or edited each file, and the git state of each file. The
approved mocks are in `docs/mocks.md`, section 10.

Reference: claude-code-filetree (github.com/data-goblin/claude-code-filetree) at commit
`b98495f8`, MIT licence, by Kurt Buhler. handily copies no code from it.

Decisions:

- Command: `/tree`. The tab label is `files`.
- handily-filetree is a new mod in the `handily` bundle, because a tree needs the full width of
  a pane.
- handily-filetree depends on handily-board. The board owns the task ids and the agent labels.
  So a row of the tree shows the same agent label as the board, and the board links a task to
  the files that were touched while it ran.
- The default view is the work view: only the files that an agent touched or that git shows
  as changed. `[ all files ]` shows the whole tree.
- Marks: `✎` an agent edited the file, `◦` an agent read it. The agent label and the age follow
  the mark.
- Release 1 marks no read by a Bash call.
- One `git status --porcelain=v2` call runs for each change. No call runs while nothing changes.
- The mod reads no environment variable.
- Out of scope: `find`, `du`, a treemap, a preview of media files, and open in an editor.

Keys, only while the pane has the focus:

| Key | Action |
| --- | --- |
| `p` | Preview |
| `d` | Diff |
| `y` | Copy the path |
| `v` | View |
| `r` | Refresh |
| `b` | Back |
| `c` | Clear the task filter |

Limits of release 1:

| Limit | Value |
| --- | --- |
| Entries drawn per folder, before a more button | 200 |
| Rows of the tree | 1000, to be measured |
| Rows of the work view | 40 |
| Rows inline above the prompt | 8 |
| Files revealed per Grep call | 12 |

## 5. Repo layout (proposed)

```text
handily/
  .claude-plugin/marketplace.json   generated from mods/*/.claude-plugin/plugin.json
  mods/
    handily/                the bundle
    handily-workitems/      .claude-plugin/plugin.json, hooks/, types/index.d.ts, tests
    handily-quiet-items/
    handily-board/
    handily-item-toasts/
    handily-simple-view/
    handily-reply-view/
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
  writes no types (measured on Claude Code 2.1.295, 2.1.296 and 2.1.299). The 2.1.299
  plugin-authoring reference says that Claude Code never writes in a `--plugin-dir` folder
  under `claude -p`. Only an interactive load of a logged-in session lays them, so each mod
  commits its engine type snapshot and CI typechecks against it. `npm run check` refuses a
  snapshot file that git does not track (handily-b1heu), and `npm run types` fails with the
  lay command when a laid tsconfig misses a dependency (handily-1fp3v). The types step also
  compares the `// Written by Claude Code X.` header of each laid `claude-code/index.d.ts`
  with `claude --version`. A header that names another version, or no header, fails by name
  with the lay command (handily-fwkt.24).
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
  fallback was dropped. handily-8mjdz replaced the three list calls with one
  `basicly tracker items` call.
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
