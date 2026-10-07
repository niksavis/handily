# handily — research and design

Status: research done, no mod code yet. The implementation session starts from this file.
Claude Code build used for the research: 2.1.293.

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

## 2. Decisions from the interview (2026-10-07)

| # | Decision | Choice |
|---|---|---|
| 1 | Where the mods live | This separate repo, a Claude plugin marketplace |
| 2 | Name | `handily` (repo and marketplace) |
| 3 | Tracker extension | Provider mod `workitems` with built-in readers and a CLI adapter contract |
| 4 | quiet-items scope | The screen only. The model still reads the full tool result |
| 5 | task-pane source | Claude's session tasks plus a saved queue per project |
| 6 | session-board scope | All local sessions |
| 7 | Extra mods | Keep `work-status` and `item-toasts` (low priority). Drop `commit-link` and `handover` |
| 8 | Mod names | `workitems`, `quiet-items`, `task-pane`, `session-board`, `work-status`, `item-toasts` |
| 9 | Toolchain | npm plus `typescript` as a dev dependency, for `tsc` checks |
| 10 | Setup scope | Local repo, basicly install, this doc, the first epics. No GitHub remote yet |

Why `commit-link` and `handover` were dropped:

| Mod | Existing mechanism in basicly | Verdict |
|---|---|---|
| commit-link | `tracker-commit-msg` and `tracker-claim` git hooks (commit-msg stage) | The git hook is the right layer and covers every agent |
| handover | basicly writes and reads `[session handover` notes and shows the last one at session start | Process logic belongs to the harness |

## 3. Facts about the mod API

Sources: the bundled `plugin-authoring` skill (its `reference.md` and the generated
`claude-code.d.ts`), and the docs at
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

API surfaces each mod needs:

| Need | API |
|---|---|
| Replace a tool row on screen | `ui.render` on `{ component: 'ToolUse' }`, props `tool`, `input`, `result`, `isRunning`, `isErrored` |
| Follow Claude's tasks | `tool.call` on `TaskCreate`, `TaskUpdate`, `TodoWrite`; results carry task ids and status |
| Sidebar or band | `$.ui.open({ id, title })` with `ui.render` on `Pane`; `ui.render` on `AbovePrompt` |
| Toggle | `$.command.register` and `command.run`; a `userConfig` field for the default mode |
| Persist across sessions | `$.store` (JSON, max 4 MiB per plugin) |
| Agents of this session | `$.agent.list()`: id, description, type, status, parentId |
| Run a CLI | `$.process.run({ argv })` |
| Status line and toasts | `$.ui.status(text)`, `$.ui.toast(text)` |

## 4. The mods

### 4.1 workitems (provider)

Adds the noun `$.workitems` with a typed contract. Other mods list `workitems` under
`dependencies`.

Normalized work item:

| Field | Meaning |
|---|---|
| `id` | The tracker's id, for example `handily-ab12` |
| `title` | The title |
| `status` | One of `open`, `in_progress`, `blocked`, `deferred`, `closed`, `other` |
| `rawStatus` | The tracker's own status word |
| `priority` | A number when the tracker has one |
| `type` | The work type when the tracker has one |
| `assignee` | The holder when the tracker has one |
| `updatedAt` | ISO time when the tracker has one |
| `source` | The adapter name |

Sources, in order of detection:

| Tracker | Files | Read path |
|---|---|---|
| basicly | `.basicly/ledger/events-*.jsonl`, `snapshot.jsonl` | Open question 1 |
| beads (`bd`), beads_rust (`br`) | `.beads/issues.jsonl` | Built-in JSONL reader |
| beans | `.beans/*.md` with front matter | Built-in front-matter reader |
| Any other | Globs and a field map in the repo config | Generic JSON, JSONL or front-matter reader |
| Any other | A command in the repo config | CLI adapter contract |

CLI adapter contract (version 1):

- `<command> items --json` prints a JSON array of normalized work items to stdout, exit 0.
- `<command> describe --json` prints `{ "name", "version", "contract": 1, "watch": [globs] }`.
  The provider re-reads when a file under `watch` changes.
- A non-zero exit or bad JSON makes the provider report the adapter as failed. It never
  guesses.

The provider also tells the other mods which paths and which CLI commands are tracker
writes. quiet-items reads that list.

### 4.2 quiet-items (mod 1)

- Hooks `ui.render` on `ToolUse` for `Write`, `Edit` and `Bash`.
- Matches a Write or an Edit whose path is a tracker file, and a Bash command that is a
  tracker write (`br create|update|close`, `bd ...`, `basicly-tracker ...`,
  `.basicly/core/kit/tracker/cli.py create|update|close|...`).
- Draws one row: `work item created  handily-ab12  <title cut to N chars>  open  P2`.
  The verb is created, updated, closed or commented. N comes from `userConfig`
  (default 60).
- When the row cannot be parsed, it returns `next(e)`. The engine row is drawn as before.
- When the row is expanded (ctrl+o), it returns `next(e)`. Verify the prop name in the types.
- It never rewrites what the model reads.

### 4.3 task-pane (mod 2)

- Follows `TaskCreate`, `TaskUpdate` and `TodoWrite` results into `$.state`.
- Shows the list in a `Pane` (a sidebar from 144 terminal columns) or in an `AbovePrompt`
  band when the terminal is narrower.
- `/task-pane` toggles it. `userConfig` `mode`: `off`, `toggle` or `always`.
- The person adds a task through an `Input` in the pane and removes one through a `Button`.
  During a session, the mod calls `TaskCreate` or `TaskUpdate status=deleted` through
  `$.tool.call`. It also appends a note so that the model knows the person changed the list.
- Outside a session, added tasks wait in a queue in `$.store`, keyed by the repo root. At
  `session.start` the queue enters the session as tasks.
- Optional action: promote a task to the tracker through the workitems CLI adapter.
- Risk: Claude can ignore a task added mid-turn until the turn ends.

### 4.4 session-board (mod 3)

- Main source: `claude agents --json`. It lists interactive and background sessions on
  this machine with `sessionId`, `name`, `cwd`, `kind`, `startedAt`, `state` or `status`,
  and `waitingFor`. One call takes 0.73 s (measured three times with `/usr/bin/time`).
- Poll it every 15 s, and only while the pane is visible.
- Worktree and branch: `git -C <cwd> rev-parse --show-toplevel` and
  `git -C <cwd> branch --show-current`.
- Optional extra data from sessions that run handily: the current task and task progress, in
  a sidecar file per session (open question 3).
- Completion estimate: completed tasks divided by all tasks, applied to the elapsed time.
  Always labelled `est.`. No estimate when the session has no task list.
- This session's own subagents come from `$.agent.list()`.

### 4.5 work-status (low priority)

A status line entry: the work item that this session holds, and the count of ready items.
Note: a `statusLine` shell script can do most of this. The mod's gain is event-driven updates
that share the provider cache.

### 4.6 item-toasts (lowest priority)

A toast when a work item changes state outside this session. It needs a rate limit.

## 5. Repo layout (proposed)

```text
handily/
  .claude-plugin/marketplace.json
  mods/
    workitems/      .claude-plugin/plugin.json, hooks/, types/index.d.ts, tests
    quiet-items/
    task-pane/
    session-board/
    work-status/
    item-toasts/
  docs/design.md
  package.json      typescript, linter, scripts that run tsc, validate and test on each mod
```

## 6. TypeScript gates as a basicly pilot

handily is the first TypeScript repo that basicly manages. It pilots the TypeScript gates and
rules that basicly can later distribute as a `typescript` technology tag.

- Fact: the basicly catalog has only the `python` technology tag.
- Fact: the basicly comments gate already covers `.ts` and `.tsx`.
- Plan: add `[[verify.checks]]` entries in `basicly.toml` for `tsc --noEmit` (strict),
  the linter, `claude plugin validate` and `claude plugin test`. Add TypeScript rules as
  overlay fragments in `.basicly-local/fragments`. Move them upstream once they prove out.
- The basicly session was told about this pilot on 2026-10-07.

## 7. Open questions for the implementation session

1. **basicly read path.** Fold the event log in TypeScript, read `snapshot.jsonl` (derived
   and gitignored, so possibly stale), or call `cli.py list --json` through the adapter
   contract. Recommendation: the CLI, because the fold rules are basicly's and change.
   Failure mode: a Python process per refresh.
2. **Repo config file.** Name and format of the per-repo config (globs, field map, adapter
   command). The mods have no TOML parser. Recommendation: `.handily.json` at the repo root.
3. **Sidecar location** for session-board. Whether `$.store` is safe for concurrent writes
   from several sessions is unknown. Recommendation: one file per session under the user's
   Claude config folder, written through `$.fs`.
4. **Linter.** Biome (one tool, lint and format) or typescript-eslint (typed rules such as
   `no-floating-promises`, which matter for async hooks). Decide with the basicly session,
   because basicly may distribute the choice.
5. **Task tools.** Whether `$.tool.call` on `TaskCreate` adds to the main session's task list,
   and which of `TaskCreate` or `TodoWrite` this build uses by mode. Test it first.
6. **Ignore rules.** Add `.claude-plugin/types/` and `node_modules/` to `.gitignore`. The
   person must confirm edits to ignore files.
