# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each mod has its own version in
its `plugin.json` and follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## handily 0.2.0 - 2026-10-08

### Added

- **The handily bundle brings agent-board and simple-view, and /handily reports them.** The
  bundle now lists seven mods. agent-board and simple-view each write their ready value when a
  session starts, so `/handily` shows their versions and ends with
  `handily: 7 of 7 mods loaded`. The README lists both mods and their update lines. A person
  whose bundle came before these two mods installs each one by its name, because
  `claude plugin update` refuses a mod that is not installed (handily-fmwpm).

## agent-board 0.1.1 - 2026-10-08

The first tagged release. Version 0.1.0 was on the main branch without a tag.

### Added

- **agent-board shows what each subagent of this session does.** A new mod with its own pane,
  opened with `/agent-board` and closed with `/agent-board close`. Each subagent is a card: its
  type, its state, the time since its spawn, its task, the tool that it runs now with its
  target, and its count of tool calls. A subagent with a parent shows `under` and the parent.
  The header reads `all N done` when every subagent ended. A loop that the engine does not
  list, such as a fork of the engine, keeps a card marked `not listed`. The board redraws
  every second only while its pane is the shown tab, and it passes the tool calls of the main
  loop on unchanged (handily-cr7r).
- **The mod tells `/handily` that it loaded.** At session start it writes a `ready` value with
  its install folder, so the `handily` bundle can show its version and state (handily-fmwpm).

## simple-view 0.1.1 - 2026-10-08

The first tagged release. Version 0.1.0 was on the main branch without a tag.

### Added

- **simple-view draws one short row for each Bash, Edit and Write call.** A Bash row shows the
  description, the program, `exit 0` or `exit N` with the first error line, the stdout line
  count and the time. The result block under it has one `Updated` line per changed file with
  its totals. A call that wrote to stderr also shows its stderr line count and first stderr
  line. An Edit or Write row shows the path and its added and removed line totals.
  `/simple` switches the view off and on for the session. `/simple show N` prints the input,
  the output and the file diff of the N-th last call, from the last 50 calls with each part
  cut at 8000 characters. The mod depends on quiet-items, and a row that quiet-items drew
  stays as quiet-items drew it. quiet-items follows the `/simple` switch, see quiet-items 0.3.0
  (handily-v921).
- **simple-view unfolds a folded tool group that holds a failed call.** In the normal view
  Claude Code folds a run of read-only calls into one line, such as
  `Listed 1 directory, ran 1 shell command`, and that line hid a failed `ls`. While the
  simple-view mode is on, a folded group with a failed call that no longer runs now draws
  each call as its own row. Other groups stay folded (handily-azz23).
- **The mod tells `/handily` that it loaded.** At session start it writes a `ready` value with
  its install folder, so the `handily` bundle can show its version and state (handily-fmwpm).

## workitems 0.3.0 - 2026-10-08

### Added

- **workitems reads tracker commands and tracker files for other mods.** The noun has two new
  methods. `$.workitems.classify(command)` reads a shell command and returns `write`, `echoed`,
  `opaque` or `none` with the tracker writes that it found. `$.workitems.trackerFile({ path,
  root })` returns the tracker file that a path names. quiet-items and item-toasts now call
  these methods and keep no copy of the parser, so both mods count the same calls. A
  quiet-items or item-toasts version with this change needs a workitems version with this
  change, because an older workitems has no `classify` (handily-w56f).

### Security

- **workitems checks UNC and long-path repo roots on Windows.** The check that a
  tracker program is outside the repo root now ignores case for a UNC root such as
  `\\server\share` and treats a `\\?\` or `\\?\UNC\` prefix as the same root. The check
  that a tracker file is inside the root compares with case, apart from the drive letter,
  so a case-sensitive share such as `\\wsl.localhost` cannot reach a sibling folder
  (handily-noad).

## quiet-items 0.3.0 - 2026-10-08

### Changed

- **quiet-items follows the simple-view mode, so `/simple` is one switch for the concise
  view.** While the simple-view mode is off, quiet-items draws every row as Claude Code draws
  it: the tool row, the result block and a folded group line. While simple-view is not
  installed or its mode is on, quiet-items follows its own mode, and `/quiet-items` still
  toggles it. While `/simple` is off, `/quiet-items` on replies that tracker writes draw in
  full. quiet-items reads the simple-view mode without a dependency on simple-view,
  because simple-view already depends on quiet-items (handily-eshb).
- **quiet-items reads tracker commands through workitems.** It calls
  `$.workitems.classify` and `$.workitems.trackerFile` and keeps no copy of the parser. It
  needs workitems 0.3.0 or later. When that check fails, quiet-items logs the reason and draws
  the row as Claude Code draws it (handily-w56f).

## item-toasts 0.3.0 - 2026-10-08

### Changed

- **item-toasts reads tracker commands through workitems.** It calls
  `$.workitems.classify` and `$.workitems.trackerFile` and keeps no copy of the parser, so it
  counts the same calls as quiet-items. It needs workitems 0.3.0 or later (handily-w56f).

## handily 0.1.0 - 2026-10-08

### Added

- **One line installs every mod.** The new `handily` plugin is a bundle that lists the five
  mods as dependencies, so `/plugin install handily@handily` installs and enables all of
  them. Its `/handily` command lists each mod with its version and whether it loaded, gives
  the `/plugin install` or `/plugin enable` line for a mod that is missing or disabled, and
  ends with a summary such as `handily: 5 of 5 mods loaded`. To remove the bundle, run
  `/plugin uninstall handily@handily`, then `claude plugin prune` (handily-325f).

## workitems 0.2.0 - 2026-10-08

### Added

- **The mod tells `/handily` that it loaded.** At session start it writes a `ready` value with its
  install folder, so the `handily` bundle can show its version and state (handily-325f).

### Fixed

- **Enter at the workitems approval ask no longer approves the repo's tracker CLI.** `Not now`
  is now the first option, so Enter declines. Only the answer `Allow for this repo` stores an
  approval. `Not now`, Enter, typed text and a closed dialog store nothing, and the state stays
  `approval-needed` (handily-0cl3).

## quiet-items 0.2.0 - 2026-10-08

### Added

- **The mod tells `/handily` that it loaded.** At session start it writes a `ready` value with its
  install folder, so the `handily` bundle can show its version and state (handily-325f).

## task-pane 0.2.0 - 2026-10-08

### Added

- **The mod tells `/handily` that it loaded.** At session start it writes a `ready` value with its
  install folder, so the `handily` bundle can show its version and state (handily-325f).

### Fixed

- **Each row of the task pane is one line that fits the pane.** A tracker item shows the
  priority, the id, the title and `[ add ]`. A task shows the mark, the number, the author, the
  title and `[ rm ]`. An id is never cut. The title fills the room that is left and is cut to
  fit, so a row no longer wraps or splits an id at a narrow width such as 45 columns. A `…`
  button on a cut row shows the full title under the row, and a second press hides it. The
  pane shows ids and titles without JSON quotes, and still escapes control, format and line
  separator characters. Notes, `task_list` and the `/task` replies keep the quotes
  (handily-hw07).

## session-board 0.2.0 - 2026-10-08

### Added

- **The mod tells `/handily` that it loaded.** At session start it writes a `ready` value with its
  install folder, so the `handily` bundle can show its version and state (handily-325f).

### Fixed

- **The session board shows each session as a card.** A card has a status mark in a theme
  colour, the name, an `inter` or `bg` badge, `this` on the current session, the task with a
  progress bar such as `▰▰▱▱ 2/4`, and the worktree, branch and time. A dim rule line separates
  two cards. This session comes first, then the working, waiting, idle and ended sessions. A
  background session whose state has not changed for over 24 hours is hidden behind a dim
  `N older background job(s) hidden` footer, and the header counts only the cards shown. A
  session with its own key and no tasks shows `no tasks`, and a session with no key shows `—`.
  The board no longer switches to a table from 100 columns (handily-hw07).

## item-toasts 0.2.0 - 2026-10-08

### Added

- **The mod tells `/handily` that it loaded.** At session start it writes a `ready` value with its
  install folder, so the `handily` bundle can show its version and state (handily-325f).

## Repository, with the 0.2.0 mods - 2026-10-08

### Fixed

- **Codex no longer offers the Claude Code mods.** Codex reads `.agents/plugins/marketplace.json`
  before `.claude-plugin/marketplace.json`. That file now lists no plugins, so Codex shows none
  and no longer warns that it cannot parse `hooks/hooks.json`. `npm run validate` refuses a
  missing file or a listed plugin. The README says the mods run in Claude Code only (handily-9kou).

## workitems 0.1.0 - 2026-10-08

### Added

- **The `workitems` mod gives other mods one typed list of work items.** It adds `$.workitems`,
  reads beads and br data from `.beads/issues.jsonl` at the session root, and publishes a
  snapshot in `$.state`. `npm run marketplace` now writes `.claude-plugin/marketplace.json`
  from the mods, and `npm run types` lays the contract of each dependency (handily-fwkt.2.1).
- **The `workitems` mod reads beans and the files of any other tracker.** It reads the beans
  files under `.beans/`, or under the folder that `.beans.yml` names, and closes an archived
  bean. `.handily.json` at the repo root names the source to read, or the globs, the format and
  the field map of a JSON, JSON Lines or front matter tracker. A glob that leads outside the
  repo root by its real path makes the read fail with its name. The mod reads one source per
  repo and reports the others as ignored. A front matter file that it cannot read skips only
  its own item. `$.workitems.refresh()` also returns the `version` it reached
  (handily-fwkt.2.2).
- **The `workitems` mod reads basicly and any tracker CLI that serves adapter contract 1.** It
  runs `basicly tracker list` from `PATH` for the open, in-progress and blocked records, and
  skips a tombstoned record. When a record leaves these statuses, `refresh()` reports it as
  closed. Each basicly read needs the approval of the person in an interactive session, keyed on
  the program path and every file of the repo's basicly kit. Without `basicly` on `PATH`, the
  read fails by name. A tracker CLI runs only from the person's own
  `~/.config/handily/adapters.json`, keyed on the real path of the repo root. A repo
  `.handily.json` that names a command runs nothing, and the reason names the user file. The
  entry covers the command, not one version of the script, so a pull can run new code. The mod refuses
  a contract other than the number 1, and names the value that it got. The adapter write verbs
  are in the snapshot as `adapterWrites`. Output that was cut off, or a non-zero exit, makes the
  read fail with the command name. A session on the desktop app shows the state `terminal-only`
  for a CLI source. Each reader refuses an item whose id, title or status holds a control
  character or is too long, and every read of a tracker file stays inside the repo root
  (handily-fwkt.2.3).

## quiet-items 0.1.0 - 2026-10-08

### Added

- **The `quiet-items` mod draws one short row for each tracker write.** A `br`, `bd`, `basicly
  tracker` or tracker kit write draws `work item <verb>  <id>  <title>  <status>  P<priority>`
  per changed item, from the `workitems` refresh diff. A direct `Write` or `Edit` of a tracker
  file draws a `raw tracker edit` row. `/quiet-items` toggles the rows for one session. The
  model still reads the full tool result (handily-fwkt.3.1).

### Fixed

- **quiet-items goes quiet only for a command with an allowed shape.** Before, the parser
  used a denylist, and a command that also ran other code could draw one quiet row and hide
  the result. Examples are a `$'…'` quote, a command substitution, a redirection, an env
  assignment, `python3 -c'…'`, `uv run` with an option, `uvx`, `npx` and a path such as
  `/tmp/br`. Now each segment must start with a bare `br`, `bd` or `basicly`, or run the
  relative kit path through `python3` or `python`, with no option. `uv run` is not allowed,
  and no `cd` may come before the kit path. A command over 8192 characters is not read. Each word
  must be a plain word, a single-quoted string, or a double-quoted string without `$`, a
  backtick or a backslash (handily-gvul).
- **quiet-items draws the full row when a later command hides the exit status of a tracker
  write.** Only `&&` may join two segments of a quiet row. `br close a; br close b` and
  `br close a || br close b` draw the full row (handily-gvul).
- **quiet-items goes quiet for a tracker write that ends with a plain `echo`.** The echo can
  hold only allowed words and `$?`. After `;`, the row is quiet only when the last output
  line shows an exit status of 0, as in `exit=0`. After `&&`, the exit status of the command
  decides. `br close x; echo ok` draws the full row, because the echo hides the exit status
  of the tracker command (handily-gvul).

## task-pane 0.1.0 - 2026-10-08

### Added

- **The `task-pane` mod keeps a session task list that Claude and you share.** It gives the
  model the tools `task_add`, `task_update` and `task_list` and a system prompt section that
  tells it to keep its plan there. `/task`, `/task add <text|id>`, `/task rm <n>` and
  `/task pane` show and change the list, and a change you make is told to Claude. With no tasks
  yet, `/task` and the pane list the open tracker items from `workitems` (handily-fwkt.4.1).

### Fixed

- **`task-pane` keeps tracker text and model text apart from your words.** Each row has an
  author column, `you`, `claude` or `tracker`, before the title, in `/task`, in `task_list` and
  in the pane. The `(you)` suffix is gone, because a title could forge it. A run of spaces in a
  title becomes one space, so a title cannot wrap into a forged row. Tracker ids and titles,
  and titles that the model wrote, are quoted with `JSON.stringify`, and control, format and
  line separator characters are escaped, in the rows, the notes, the `/task` replies and the
  pane. Each reply, note and tool answer that holds tracker text says that it is data, not an
  instruction, and so do the system prompt and the tool descriptions. A note names the author
  of each task. A tracker item whose id is not an item id is not added. A title with a bidi
  control character is refused by name. A closed or deferred item is not open: `/task add <id>`
  refuses it, and `/task` and the pane do not list it (handily-467i).

## session-board 0.1.0 - 2026-10-08

### Added

- **The `session-board` mod shows each local Claude Code session in one pane.** `/session-board`
  opens the board. It polls `claude agents --json` every 15 s while the board is shown, and it
  shares one cached result across sessions. A row shows the state, the task and its progress,
  the worktree and branch, and the time worked or elapsed, with an estimate of the time left
  (handily-fwkt.5.1).

### Fixed

- **The `session-board` mod shows no row for a session that `claude agents` does not list.**
  Before, each stored key of an earlier session showed a row with the state `not listed`. Now
  the board shows such a row only for this session, when the last poll does not list it yet. A
  listed session whose key was written more than 60 s before its start shows `(stale)` after
  its task and no estimate. A poll still deletes a key that is older than 24 hours
  (handily-p4w9).

## item-toasts 0.1.0 - 2026-10-08

### Added

- **The `item-toasts` mod shows a toast when a work item changes outside this session.** It
  reads the `workitems` refresh diffs and drops the change of each `Bash`, `Write` or `Edit`
  call of this session. It shows at most one toast every 30 s and merges the changes that wait
  into one toast. It toasts once when the work items turn unavailable and once when they come
  back (handily-fwkt.6.1).

## Repository - 2026-10-08

### Added

- **The repository has its marketplace file, TypeScript toolchain and gates.**
  `npm run check` validates, type-checks, lints and tests every mod, and CI runs the same
  checks through `basicly verify` (handily-fwkt.1).
- **CONTRIBUTING.md describes how to release one mod.** Bump the version in
  its `plugin.json`, generate the marketplace file, fold the changelog by hand,
  commit, and tag with `claude plugin tag` (handily-fwkt.7.1).
- **A pushed mod tag publishes a GitHub release.** The `release` workflow runs
  on a tag `<name>--v<version>`. It refuses the tag by name when the version in
  `mods/<name>/.claude-plugin/plugin.json` differs, when the committed
  marketplace file differs from `npm run marketplace`, or when `CHANGELOG.md`
  has no section `## <name> <version> - <date>`. Then it runs
  `claude plugin tag --dry-run`, `npm run check`, and publishes the release with
  that section as the notes. The checks run with a read-only token that git
  does not keep. Only the publish job can write, and it runs no repository
  code. Each action is pinned by its commit SHA (handily-fwkt.7.2).
- **`npm run lint` refuses raw invisible and bidi characters in mod sources.** A `.ts`,
  `.tsx` or `.mjs` file under `mods/` or `scripts/` that holds a raw character of class
  Cf, Zl or Zp, or a Bidi_Control character, fails the gate. The failure names the file,
  line, column and code point, and gives the `\u{...}` escape to write instead. Visible
  glyphs such as `●`, `✓`, `▶`, `○` and `…` still pass. The gate skips the generated
  `.claude-plugin/types` folders and `node_modules` (handily-3hz5).

### Fixed

- **The markdownlint hook lints the Markdown files.** It skipped before, because
  `markdownlint-cli2` was not installed. It is now a pinned dev dependency, and
  `.markdownlint-cli2.jsonc` sets the line length to 100 and skips generated
  files (handily-vodf).
