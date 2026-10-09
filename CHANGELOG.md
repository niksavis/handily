# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each mod has its own version in
its `plugin.json` and follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## handily-task-pane 0.6.0 - 2026-10-09

### Changed

- **handily-task-pane 0.6.0, handily-agent-board 0.4.0 and handily-session-board 0.4.0 draw
  each state with the same mark and theme colour.** Doing is `▶` in `claude`, Done is `✓` in
  `success`, To do is `○` in `subtle`, Blocked is `■` in `error`, and Waits for you is `◆` in
  `warning`. Each of the three mods keeps the table in `hooks/signals.ts`, and
  `scripts/signals.test.mjs` fails when two tables differ or when a mark is not one column wide.
  A finished session now shows `✓`, not `○`. A failed agent or session shows `■`. A running or
  waiting subagent shows `▶`. session-board writes `interactive` and `background`, shows the
  task count as `2 of 4` with no bar, and draws no task line for a session with no task data.
  task-pane shows the author only for `you` and `tracker`, in the theme colour `suggestion`, so
  a title cannot imitate it. It shows the `rm` button only on the task in progress and on a
  task that you opened. It counts an emoji such as `⚡` as two columns when it cuts a title
  (handily-fwkt.8.14).

## handily-agent-board 0.4.0 - 2026-10-09

### Changed

- **handily-task-pane 0.6.0, handily-agent-board 0.4.0 and handily-session-board 0.4.0 draw
  each state with the same mark and theme colour.** Doing is `▶` in `claude`, Done is `✓` in
  `success`, To do is `○` in `subtle`, Blocked is `■` in `error`, and Waits for you is `◆` in
  `warning`. Each of the three mods keeps the table in `hooks/signals.ts`, and
  `scripts/signals.test.mjs` fails when two tables differ or when a mark is not one column wide.
  A finished session now shows `✓`, not `○`. A failed agent or session shows `■`. A running or
  waiting subagent shows `▶`. session-board writes `interactive` and `background`, shows the
  task count as `2 of 4` with no bar, and draws no task line for a session with no task data.
  task-pane shows the author only for `you` and `tracker`, in the theme colour `suggestion`, so
  a title cannot imitate it. It shows the `rm` button only on the task in progress and on a
  task that you opened. It counts an emoji such as `⚡` as two columns when it cuts a title
  (handily-fwkt.8.14).

## handily-session-board 0.4.0 - 2026-10-09

### Changed

- **handily-task-pane 0.6.0, handily-agent-board 0.4.0 and handily-session-board 0.4.0 draw
  each state with the same mark and theme colour.** Doing is `▶` in `claude`, Done is `✓` in
  `success`, To do is `○` in `subtle`, Blocked is `■` in `error`, and Waits for you is `◆` in
  `warning`. Each of the three mods keeps the table in `hooks/signals.ts`, and
  `scripts/signals.test.mjs` fails when two tables differ or when a mark is not one column wide.
  A finished session now shows `✓`, not `○`. A failed agent or session shows `■`. A running or
  waiting subagent shows `▶`. session-board writes `interactive` and `background`, shows the
  task count as `2 of 4` with no bar, and draws no task line for a session with no task data.
  task-pane shows the author only for `you` and `tracker`, in the theme colour `suggestion`, so
  a title cannot imitate it. It shows the `rm` button only on the task in progress and on a
  task that you opened. It counts an emoji such as `⚡` as two columns when it cuts a title
  (handily-fwkt.8.14).

## handily-reply-view 0.3.0 - 2026-10-09

### Changed

- **handily-reply-view 0.3.0 draws a wide table in wrapped columns, and a reply folds only after
  30 lines.** A table that does not fit the screen wraps its long cells inside their columns, and
  the rows stay aligned. Only a screen narrower than 40 columns draws one block for each row. The
  `copy` and `copy as text` buttons stand on the header line when they fit after the headings,
  else at the end of the last row, and only else on a line of their own under the table. A
  heading or a cell never moves and is never cut for the buttons.
  `copy as text` drops markdown marks, backslash escapes and entities, and keeps the address of a
  link. A reply folds only when it is longer than 30 lines, not 12. While a reply streams, Claude
  Code still draws it itself, so the look of the reply changes once when it is complete
  (handily-cvqn7).

## handily-simple-view 0.4.0 - 2026-10-09

### Changed

- **handily-simple-view 0.4.0 draws one row for each `Read`, `Grep` and `Glob` call, and
  unfolds a group of calls that each draw as one row.** A `Read` row shows the path relative to
  the session root and the line count, or the range of a partial read, such as
  `Read  docs/design.md  lines 160-239 of 674`. A `Grep` or `Glob` row shows the pattern, the
  folder and the count. Claude Code 2.1.295 offered no `Grep` or `Glob` tool in a live check, so
  only tests cover those two rows. While the mode is on, a group of foreground `Bash`, `Read`,
  `Grep` and `Glob` calls draws as rows in place of the line of the engine, such as
  `Read 2 files, listed 1 directory, ran 1 shell command`. A `Bash` row no longer shows a time
  under 1 second. When an error line follows the description, the description keeps up to 40
  cells and the terminal cuts the error line first (handily-vxxvq).

## handily 0.4.0 - 2026-10-09

### Changed

- **Every mod has a new plugin name that starts with `handily-`, and an update does not move
  you to it.** Claude Code keeps each old plugin installed and does not install the new one. When
  both are installed, the two copies collide: Claude Code refuses the commands of one copy, and
  `handily-workitems` does not load beside `workitems` (measured on Claude Code 2.1.295). The
  bundle keeps the name `handily`. The slash commands keep their short names, and each command
  description now starts with `handily ·`. The new versions are handily 0.4.0,
  handily-workitems 0.5.0, handily-quiet-items 0.4.0, handily-task-pane 0.5.0,
  handily-session-board 0.3.0, handily-item-toasts 0.4.0, handily-agent-board 0.3.0,
  handily-simple-view 0.3.0 and handily-reply-view 0.2.0. New release tags are
  `handily-<mod>--v<version>`. The old tags stay (handily-wltuw).

  | Old plugin id | New plugin id |
  | --- | --- |
  | `workitems@handily` | `handily-workitems@handily` |
  | `quiet-items@handily` | `handily-quiet-items@handily` |
  | `task-pane@handily` | `handily-task-pane@handily` |
  | `session-board@handily` | `handily-session-board@handily` |
  | `item-toasts@handily` | `handily-item-toasts@handily` |
  | `agent-board@handily` | `handily-agent-board@handily` |
  | `simple-view@handily` | `handily-simple-view@handily` |
  | `reply-view@handily` | `handily-reply-view@handily` |

  To move, run these lines in a shell. The first line updates the marketplace and the bundle.
  The second line installs each new id. The third line uninstalls each old id, each mod before
  the mod that it depends on. A command for a plugin that you did not install fails for that
  plugin only. Then restart Claude Code.

  ```sh
  claude plugin marketplace update handily; claude plugin update handily@handily
  for p in workitems quiet-items task-pane session-board item-toasts agent-board simple-view reply-view; do claude plugin install "handily-$p@handily"; done
  for p in reply-view simple-view agent-board item-toasts session-board task-pane quiet-items workitems; do claude plugin uninstall "$p@handily"; done
  ```

  To move one mod only, install its new id and uninstall its old id, for example
  `claude plugin install handily-task-pane@handily` and
  `claude plugin uninstall task-pane@handily`. `claude plugin uninstall` works on the user scope
  when you give no `--scope`. For an old id in the project or local settings, type `/handily`
  after the restart. It names each old id that is still installed, with its scope, and prints the
  exact command, such as `claude plugin uninstall workitems@handily --scope project`.

  The new ids start with their own settings and store. Set the `mode` and `titleLength` of
  handily-quiet-items and the `mode` of handily-task-pane again in `/config` if you changed them.
  Expect handily-workitems to ask once again before it runs `basicly` or `br`. A permission rule
  for the task-pane tools names `mcp__handily-task-pane__<name>` now.

  In a clone of this repository, a `git pull` leaves the old `mods/<name>` folders with
  generated type files, and `npm run check` refuses them as mods without a `plugin.json`. Move
  them out of `mods/` (handily-wltuw).

## handily-workitems 0.5.0 - 2026-10-09

### Changed

- **`workitems@handily` is now `handily-workitems@handily`.** Install the new id and
  uninstall the old one.
  The steps and the reasons are in the handily 0.4.0 section (handily-wltuw).

## handily-quiet-items 0.4.0 - 2026-10-09

### Changed

- **`quiet-items@handily` is now `handily-quiet-items@handily`.** Install the new id and
  uninstall the old one.
  The steps and the reasons are in the handily 0.4.0 section (handily-wltuw).

## handily-task-pane 0.5.0 - 2026-10-09

### Changed

- **`task-pane@handily` is now `handily-task-pane@handily`.** Install the new id and
  uninstall the old one.
  The steps and the reasons are in the handily 0.4.0 section (handily-wltuw).
- **task-pane draws each task tool call as one row in the transcript.** A `task_add`,
  `task_update`, `task_move` or `task_list` call took about 6 lines: the call, the result line
  and the whole task list. Now it is one row that names the action, the task number and the
  title, such as `● Task 2 ▶ in progress  Draw the mocks`, and the result block is empty. The
  model still receives the whole answer with the list. A long title is cut with `…` to the
  terminal width. A refused or failed call, and a row that the mod cannot read, draw as Claude
  Code draws them (handily-trnjp).

## handily-session-board 0.3.0 - 2026-10-09

### Changed

- **`session-board@handily` is now `handily-session-board@handily`.** Install the new id and
  uninstall the old one.
  The steps and the reasons are in the handily 0.4.0 section (handily-wltuw).

## handily-item-toasts 0.4.0 - 2026-10-09

### Changed

- **`item-toasts@handily` is now `handily-item-toasts@handily`.** Install the new id and
  uninstall the old one.
  The steps and the reasons are in the handily 0.4.0 section (handily-wltuw).

## handily-agent-board 0.3.0 - 2026-10-09

### Changed

- **`agent-board@handily` is now `handily-agent-board@handily`.** Install the new id and
  uninstall the old one.
  The steps and the reasons are in the handily 0.4.0 section (handily-wltuw).

## handily-simple-view 0.3.0 - 2026-10-09

### Changed

- **`simple-view@handily` is now `handily-simple-view@handily`.** Install the new id and
  uninstall the old one.
  The steps and the reasons are in the handily 0.4.0 section (handily-wltuw).

## handily-reply-view 0.2.0 - 2026-10-09

### Changed

- **`reply-view@handily` is now `handily-reply-view@handily`.** Install the new id and
  uninstall the old one.
  The steps and the reasons are in the handily 0.4.0 section (handily-wltuw).

## workitems 0.4.1 - 2026-10-09

### Fixed

- **workitems reads a beads tracker file over 4 MiB.** The engine reads no file over 4 MiB, so
  a long-lived beads project showed "Work items unavailable". When `.beads/issues.jsonl` is over
  4 MiB, workitems now lists the open items through `br list --json --limit 0`, after you approve
  the run once for the repo. A missing `br`, a cut output, a non-zero exit, output that is not
  JSON or a list that says it is incomplete fails with the cause and the fix, and shows no item.
  A file of 4 MiB or less is read directly as before. A `bd` tracker on Dolt over 4 MiB fails by
  name (handily-vli6x).
- **A poll failure that repeats shows once.** workitems wrote one transcript line on every failed
  poll, every 2 seconds. Now a failure shows once, and again only after a refresh succeeds or the
  failure text changes (handily-8mjdz).
- **A basicly tracker no longer starts up to six basicly processes on each read.** workitems
  ran `basicly tracker list` once for each open status, and checked the approval before each
  run. Each check could run `basicly --version`. On Windows one read then took longer than the
  hook limit of 10 seconds. workitems now runs one `basicly tracker items --json` call for every
  open status, checks the approval once per read, and keeps the verdict of `basicly --version`
  in memory. A change of a kit file, of the program path or a reinstall of basicly runs the
  version check again. A basicly below 0.21.1 has no `tracker items` command, so it fails the read
  by name and runs no kit code. The approved
  command changed, so workitems asks you once again to allow basicly. A basicly without
  `tracker items` fails the read by name (handily-8mjdz).

## task-pane 0.4.2 - 2026-10-09

### Changed

- **task-pane shows what a call does, not its raw command.** The tool line of
  the task in progress shows the description that Claude gave a call, such
  as `Bash Run the tests`. A call without a description still shows the first line of its
  command. task-pane is now version 0.4.2 (handily-urqjc).

## agent-board 0.2.1 - 2026-10-09

### Changed

- **agent-board shows what a call does, not its raw command.** The tool line of
  each subagent shows the description that Claude gave a call, such
  as `Bash Run the tests`. A call without a description still shows the first line of its
  command. agent-board is now version 0.2.1 (handily-urqjc).

## simple-view 0.2.0 - 2026-10-09

### Added

- **simple-view opens and copies the output of a Bash call by a click.** A finished `Bash` row
  with output ends with `more` and `copy`. `more` opens at most 20 lines of the output under the
  row, then `all N lines` opens every line, and `less` folds it again. `copy` copies the output
  exactly as the engine gave it, also an output that the engine saved to a file, and a toast says
  how many lines it copied. A running call draws one row with a dim `running` state and its time,
  and `more` opens its full command. While the live group of the engine holds a running `Bash`
  call, simple-view unfolds the group, so the engine no longer draws the full command over many
  lines. A tab moves to the next stop by the width of the text on the screen, so wide characters
  and emoji keep the columns in place (handily-t899o).

## reply-view 0.1.0 - 2026-10-09

### Added

- **reply-view folds long replies and structures tables and code blocks.** A reply longer than
  12 lines draws its first 12 lines, a count of the hidden lines, `more` and `copy`. `copy`
  copies the whole reply as markdown. A table draws without box lines, with aligned columns and
  a bold header, and as one block per row when the columns do not fit the width. `copy` copies
  the table as markdown, and `copy as text` copies `label: value` lines. Text between backticks
  keeps its marks, and an emoji counts as two columns. A fenced block gets a title line from its
  tag and a `copy` button that copies its content only, without the indent of a list item.
  `/replies` turns the view off and on for the session. The model still reads the full reply
  (handily-t899o).

## handily 0.3.0 - 2026-10-09

### Added

- **The handily bundle installs reply-view.** The bundle now installs 8 mods, and `/handily`
  lists reply-view with the others (handily-t899o).

## task-pane 0.4.1 - 2026-10-09

### Fixed

- **An opened task no longer repeats its title.** A click on a task whose title fits the row
  shows only its start time and tool count. A cut title still shows in full (handily-huxqo).
- **The release carries task-pane 0.4.0.** The 0.4.0 tag has no release page, because the release
  check failed on an older Claude Code. The mods now require the latest Claude Code.

## task-pane 0.4.0 - 2026-10-09

### Added

- **task-pane shows the work in progress, not only the list.** The task in progress comes
  first, in bold, with its time. The line under it shows the last tool and target of the main
  loop and the count of tool calls since the task started. Open tasks follow in list order, and
  done tasks fold into a `+N done` button. A press on a task title shows its full title, its
  start time and its tool count. With no task list, a `Now` line shows the last tool, the count
  per tool and the time since the first call. An `Agents` section lists each running subagent
  with its plan count and its last tool. After 20 tool calls of the main loop with no task list,
  or with no change of the list by Claude, the pane shows a warning and an
  `Ask Claude for a plan` button, which puts a request into the prompt box without sending it.
  At the next prompt that the person types, the mod adds one note for Claude, at most once per
  20 tool calls. task-pane is now version 0.4.0 (handily-eq6pk).

### Fixed

- **The empty task pane reaches every open tracker item.** The pane listed at most 10 open
  items, and a tracker with more had no way to show the rest. The pane now shows the first 10
  and an `all N open` button that shows every open item. `first 10` folds the list again, and
  `Add N as tasks` adds the items that the pane shows (handily-yxie3).

## agent-board 0.2.0 - 2026-10-09

### Added

- **agent-board draws the task list of each subagent on its card.** When a subagent keeps a
  list in `task-pane`, its card shows `plan N/M done` and one line per task in list order,
  with `✓` for done, `▶` for in progress and `○` for open. A list of more than 5 tasks folds to
  the task in progress, the 2 tasks before it and the 2 tasks after it. On a folded list,
  `plan N/M done` is a button: a click on it unfolds the whole list, and a second click folds
  it. The pane does not take the keyboard focus. Titles show hidden characters as escapes.
  The board reads the `task-pane` state with no plugin dependency, so a card without a list,
  or a session without `task-pane`, draws as before. agent-board is now version 0.2.0
  (handily-fwkt.8.3).

### Fixed

- **agent-board shows the last real tool on a done row.** A subagent ends with a
  `SubagentHandback` call, and the done row read `last SubagentHandback`, an internal tool name.
  The row now keeps the tool and target of the last other call, and the count still includes
  the hand-back. A subagent whose one call was the hand-back still shows it (handily-yxfev).

## task-pane 0.3.0 - 2026-10-09

### Added

- **Each subagent keeps a task list of its own.** The task tools of a subagent act only on the
  list of that subagent, and `task_list` returns the list of the agent that calls it. The main
  loop keeps its list at `{ plugin: 'task-pane', key: 'list' }`, so `/task`, the pane and
  `session-board` work as before. Another mod reads the agent ids at `agentIds` and each list
  at `agentList` by its agent id. The session keeps the lists of at most 100 agents, and
  `/clear` resets all of them (handily-fwkt.8.2).
- **The `task_move` tool puts a task before another.** It takes `id` and `before`, and the task
  ids do not change. A move that names an unknown id, or the same id twice, is refused with the
  ids that exist and the correct form. Each tool answer lists the tasks in the order of the
  work (handily-fwkt.8.12).

## workitems 0.4.0 - 2026-10-08

### Changed

- **workitems asks once for a basicly repo and keeps the answer.** basicly 0.21.1 and later
  run only the installed package for `tracker list`, not the repo code in
  `.basicly/core/kit/tracker`. So after you answer `Allow for this repo`, the approved program
  reports its version, and on 0.21.1 or later a change of the kit files or a basicly upgrade no
  longer asks again. An older basicly, or a version that does not parse, still asks again when
  a kit file changes. A changed basicly program path always asks again. No basicly command, not
  even `--version`, runs before you approve the repo. An approval from an earlier version stays
  valid. The question names both cases (handily-szdh).

## simple-view 0.1.2 - 2026-10-08

### Fixed

- **`/simple show N` says `File diff: none.` only when Claude Code tracked the Bash call and
  listed no changed file.** Claude Code sends the file diff of a Bash call only while Bash edit
  tracking is on, so a missing diff does not prove that nothing changed. When the diff is
  missing, malformed, or the call failed, `/simple show N` now prints
  `File diff: not reported by the engine.` When Claude Code reports that it could not track the
  call, it prints `File diff: not tracked by the engine.`, which matches the row. The row itself
  stays silent when no diff came. The README names the `bashEditDiffEnabled` setting and the
  `CLAUDE_CODE_BASH_EDIT_DIFF` variable that turn tracking on (handily-s43cv).

## quiet-items 0.3.1 - 2026-10-08

### Fixed

- **quiet-items reads the simple-view mode through a shared type.** quiet-items compares the
  simple-view mode against a constant of the new `QuietItemsSimpleViewMode` type, and a
  simple-view test pins the values that `/simple` writes. A rename of a mode value now fails a
  test or the type check, so `/simple` off cannot stop turning the quiet rows off without
  notice. The behaviour does not change (handily-e19gp).

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
