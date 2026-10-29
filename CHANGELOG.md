# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each mod has its own version in
its `plugin.json` and follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## handily-board 0.13.0 - 2026-10-29

### Added

- **board gives a task a new title with `/board edit`.** `/board edit <n> <title>` changes the
  title of task `n` in place, and Claude reads the change in the note at your next prompt. An
  empty title, a title of more than 200 characters and a title with a control character are
  refused by name, and the old title stays (handily-9uj3n.4).
- **board lets Claude add several tasks in one call at a chosen place.** `task_add` takes
  `titles`, a list of tasks in the order of the work, and `before`, the id of the task that the
  new tasks go before. The answer names the new ids. A batch that would pass the limit of 100
  tasks, or that holds one bad title, is refused whole and adds nothing (handily-9uj3n.5).
- **board shows progress, a stalled task and a finished plan in the task header.** The header
  draws a bar split into done, in progress and pending tasks, with their counts, for example
  `Tasks  ▰▰▱▱ 1/4 · ▶1 ○2 · 14m`. The time of a task in progress turns to the warning colour
  when its current run passes 15 minutes. When every task is done, the header shows
  `✓ all 4 done` and the time until the last task was done (handily-9uj3n.6).

## handily-simple-view 0.9.0 - 2026-10-29

### Added

- **simple-view draws an Edit, Write or Read call that a hook refused as one row.** The row
  shows the tool, the path, `refused` and the first line of the hook message, and the error
  block of Claude Code is gone. A refused `Grep` or `Glob` call shows its pattern in the same
  way. Another error of these tools keeps the row of Claude Code (handily-fwkt.8.27).

## handily-board 0.12.0 - 2026-10-29

### Changed

- **The board shows its toasts in the shared toast layout and drops the toasts that the pane
  already shows.** An add, a remove or a move from the pane that Claude is told about shows no
  toast. A refusal starts with `■` and names its reason on its own line, such as
  `■ Not added`, then `app-gh78 is closed in beads`, and stays 10 s. A status change from the
  pane reads `✓ Task 3 is now done`, then the quoted title. The board that waits for a wider
  terminal reads `◆ Board waits for a wider terminal`, then `run /board to open it here`. No
  board toast holds a line break or the tracker notice. The replies of `/board` do not change
  (handily-ftx0x.4).

### Fixed

- **board README says how the keyboard reaches the task rows.** `/board` already gives the keyboard
  to the tab it brings forward, so Tab reaches the task rows at once. ctrl+x tab moves the keyboard
  on to the next tab, and from the last tab back to the prompt. Pressed on the this session tab,
  it gave the keyboard to the this machine tab, and Tab seemed to skip the task rows
  (handily-9uj3n.10).

## handily-reply-view 0.11.0 - 2026-10-29

### Fixed

- **reply-view keeps the copy buttons of a table or a diagram inside a narrow reply.** When a
  reply is narrower than the line `[ copy ] [ copy as text ]` or `[ copy ] [ copy drawing ]`,
  each button stands on its own line. When one button is wider than the reply, its label is cut
  with an ellipsis, as in `[ copy dr… ]`, and the button still copies the whole text
  (handily-5zzxk.10).

## handily-reply-view 0.10.0 - 2026-10-28

### Added

- **reply-view draws a mermaid sequence diagram in a reply as a diagram.** A complete reply with
  a `mermaid` block that holds a `sequenceDiagram` shows the drawing in place of the source, under
  the title line `── mermaid · sequence ──`, with the `[ copy ]` and `[ copy drawing ]` buttons.
  Each participant gets a box and a lifeline. A message draws its label above a solid or dashed
  arrow. A message to the same participant draws as a loop. Notes, `autonumber` and the blocks
  `loop`, `alt`, `opt`, `par`, `critical`, `break` and `rect` draw too. A label wraps to fit the
  screen in at most 3 lines. A diagram that is still too wide draws as its source under the note
  `diagram not drawn: it takes 50 columns, the screen has 38.` The note
  `sequenceDiagram does not draw yet` is gone (handily-5zzxk.7).

## handily-board 0.11.0 - 2026-10-28

### Added

- **board marks a slow or a quiet subagent on its row.** A running agent whose tool call has run
  for more than 30 seconds reads `slow 45s`, with the time of that call. A running agent with no
  event for 2 minutes reads `quiet 3m`, with the time since its last event. The word takes the
  warning colour and the mark stays `▶`. The board starts no timer for these states: a shown tab
  reads them when it draws again every 10 seconds (handily-xsjad.6).
- **board prints the session figures and the agents as text with `/board stats`.** The reply
  has the Session line with its waits, context and cost, the details with the context of the
  window, the compactions, the last turn and the limits with their resets, the checks, each
  waiting agent, and each agent with its state and context. The board does not need to be open.
  When the host gives no usage, the reply says `no context or cost on this host` and shows no
  context, cost or limit. `/board frob` now lists `/board stats` (handily-xsjad.10).

## handily-board 0.10.1 - 2026-10-28

### Changed

- **board sets the status line only for a wait, and never for the context.** The Claude Code
  status line already shows the context, so the board line `ctx 91% high · /compact frees it` is
  gone, and a wait no longer ends with `· ctx 91% high`. A subagent that waits for permission
  still shows `◆ scout waits for permission: Bash npm test`, and the Session line of the board
  still says `high` from 80 percent (handily-xsjad.14).

## handily-board 0.10.0 - 2026-10-28

### Added

- **board opens the Session details under the Session line: the context, the compactions, the
  last turn and the rate limits.** Press the Session line. The details show
  `context 124k of 200k · 1 compaction`, the duration and the cost of the last main turn with its
  edits, errors and spawned agents, and `limits 5h 31% · 7d 13%` with the time until each limit
  resets. A plan that reports no rate limits shows `limits: none reported`. From 80 percent, the
  details add that `/compact` or `/clear` frees the context. The permission checks follow
  (handily-xsjad.4).
- **board shows the context and the output tokens of a subagent on its opened row.** The line of
  the tool calls reads `7 tool calls · ctx 48k · out 6.1k`, from the usage of the latest model
  request of the agent that the engine event `turn.step` reports. A request that stopped at its
  output limit shows `stopped at max_tokens · ctx 198k`. The board passes the response of a main
  loop request on as it arrives and reads none of it (handily-xsjad.7).

## handily-filetree 0.6.0 - 2026-10-28

### Added

- **filetree marks the files that a Bash call changed.** At the start of a `Bash` or
  `PowerShell` call the mod takes a fresh git status, and after the call it compares. Each file
  whose git state or time stamp changed while the call ran gets `✎` with the agent that ran it.
  Outside a git repo, the mod lists the open folders at the start and the end of the call, with
  no process. The mod reads no command text and runs no `find`. It never guesses one agent: a
  change that came before the call or after its end gets no mark. When calls of two or more
  agents ran at the same time, the row shows `2 agents`, and the open row says
  `changed while Bash of main and scout ran` (handily-02b2v.6).

## handily-reply-view 0.9.0 - 2026-10-28

### Added

- **reply-view draws a mermaid flowchart in a reply as a diagram.** A complete reply with a
  `mermaid` block that holds a `flowchart` or `graph` shows the drawing in place of the source,
  under the title line `── mermaid · flowchart ──`. `[ copy ]` copies the source and
  `[ copy drawing ]` copies the drawn lines, and each toast names what it copied. A block that
  does not draw keeps the look of a fenced block, under one dim note with the reason, such as
  `diagram not drawn: it takes 59 columns, the screen has 38.` A diagram draws whole or as its
  source. A sequence diagram draws as its source for now, with the note
  `diagram not drawn: sequenceDiagram does not draw yet.` A later version draws it. When a long
  reply folds inside a diagram, only the title line of the diagram shows. The new setting
  `diagrams` is `on` by default, and `off` draws every mermaid block as before (handily-5zzxk.6).

## handily-board 0.9.0 - 2026-10-28

### Added

- **board sends a desktop notice when a session needs you.** When a permission ask of this
  session, of the main loop or of a subagent, is still not settled after 3 seconds and the this
  session tab is not shown, the board sends one notice through `$.ui.notify`, for example
  `app needs you: scout waits for permission: Bash npm test`. Each wait sends at most one notice,
  and an ask that the auto mode classifier settles before 3 seconds sends none. When Claude Code
  reports that it sent nothing, as on the desktop app, the board shows the same text as a toast
  (handily-8jno3).
- **board names a waiting agent and a high context on the status line.** While the this
  session tab is not shown, the status line reads, for example,
  `◆ scout waits for permission: Bash npm test · ctx 91% high`, `◆ 2 agents wait for permission`
  or `ctx 91% high · /compact frees it`. A wait is an ask of a subagent that is not settled after
  3 seconds, the same wait that the agent rows show as `needs you`. The board clears the line
  when nothing waits and the context is under 80 percent, and while the this session tab is
  shown. The new setting `statusLine` takes `attention`, the default, or `off`, which never sets
  a status line (handily-xsjad.9).

## handily-filetree 0.5.0 - 2026-10-28

### Added

- **filetree shows the preview and the diff of a file.** A press on a file row opens it with
  `[ preview ]`, `[ diff ]`, `[ copy path ]` and `[ @ to prompt ]`. The preview shows at most
  2,000 lines in the Code element, or a Markdown file in the Markdown element. A binary file, a
  file over 4 MiB and a file that the mod cannot read each show a one-line note. The diff runs one
  `git diff HEAD` and is cut only at the end of a hunk. An untracked file, or a repo with no
  commit, shows as one added hunk with no process. A press on the counts of a folder shows the
  diff of at most 50 changed files under it (handily-02b2v.7).

## handily-board 0.8.0 - 2026-10-28

### Added

- **board shows a subagent that waits for your permission answer as needs you, and the last 5
  permission checks.** When the verdict of the engine event `tool.check` for a subagent call is
  `ask`, the agent row says `asked`. When the call is still not settled 3 seconds later, the row
  says `needs you` with a `waits for: permission · Bash npm test` line, the Agents header counts
  it, and the Session line starts with `◆ 1 waits`. The mark clears when the call runs, when the
  answer refuses it, and when the turn of the agent ends. An ask that the auto mode classifier
  settles before 3 seconds draws no mark. Claude Code gives no event when the dialog opens or
  closes, so the mark stays while an allowed call runs. After the first check, a press on the
  Session line shows the counts of the checks, and `last 5 checks` shows the newest 5 with the
  verdict word, the tool and the target. The board masks the credentials in each target
  (handily-xsjad.5).

### Security

- **board masks a credential in a call target on every row.** Before, the `▶ Now` row and the
  agent rows drew the target of a call as it came, so a command such as
  `GITHUB_TOKEN=ghp_… gh pr list` showed its token. Every row now masks it by the same rule as
  the checks list: `GITHUB_TOKEN=*** gh pr list` (handily-ygiyf).

## handily-filetree 0.4.0 - 2026-10-28

### Added

- **filetree marks which agent read or edited each file.** A row shows `◦` for a read and `✎`
  for an edit, then the agent label of the board and the age. A folder shows the latest mark
  under it. A `Now` block lists the latest file of each agent. A denied or failed call removes
  its mark. A `Grep` marks its first 12 files, and the `Now` line counts the rest. The agent
  filter `{agent: all}` picks one agent, and it follows the transcript that you open
  (handily-02b2v.5).

## handily-board 0.7.0 - 2026-10-28

### Added

- **board stores the label it draws for each agent.** Each agent in the `agents` state of the
  board now carries `label`, cut and numbered by the rule of the agent rows, such as
  `gene…se 2`. Another mod can name an agent the same way the board does (handily-02b2v.4).

## handily-filetree 0.3.0 - 2026-10-28

### Changed

- **filetree draws the git letter before the file name, and colours the name.** A changed file
  reads `M design.md`. The letter takes the column where a folder draws its arrow, so no name
  moves. The letter and the name draw in the colour of the state: modified and renamed in the
  warning colour, new and untracked in the success colour, deleted and conflicts in the error
  colour. Each folder count draws in the colour of its letter. The inline list above the prompt
  now shows the letters and the folder counts too (handily-02b2v.10).

## handily 0.8.0 - 2026-10-28

### Fixed

- **The `handily` bundle installs `handily-filetree`, and `/handily` lists it.** The bundle
  `plugin.json` names `handily-filetree` in its dependencies, so one install of `handily` gets
  every mod. `handily-filetree` writes the ready value that `/handily` reads, and the summary
  counts 7 mods. The README credits claude-code-filetree by Kurt Buhler as a reference
  (handily-02b2v.9).

## handily-filetree 0.2.1 - 2026-10-28

### Fixed

- **`handily-filetree` writes the ready value that `/handily` reads.** Before, `/handily` could
  not see that the mod had loaded (handily-02b2v.9).

## handily-board 0.6.0 - 2026-10-28

### Added

- **board shows a Session line first on the this session tab: the context percent and the
  cost.** The line reads `Session  ctx 62% · $4.18`, with the figures of the engine event
  `session.measure`. The percent is the one that the Claude Code status line shows. While a main
  turn runs, `turn +$0.31` is the cost that the turn added. After it, `last +$0.62` is the cost of
  the last turn. From 80 percent, the percent shows the word `high` in the warning colour. Before
  the first reply, and after `/clear`, the line reads `ctx — until the first reply`. A host that
  gives no usage shows `no context or cost on this host` and no number. A narrow tab cuts the
  turn cost first, then the cost (handily-xsjad.3).

## handily-filetree 0.2.0 - 2026-10-28

### Added

- **filetree shows the git state of each file and a count on each folder.** A file shows `M`,
  `A`, `?`, `D`, `R` or `U` in its colour, a folder shows counts such as `M2 ?1`, and the header
  shows the branch, the commits ahead and behind and the count of changed entries. A deleted file
  shows in its folder, and a renamed file names the file it came from. The mod reads the branch
  from `HEAD` and polls the stamps of the git `index` and `HEAD` every 2 s while the tab is shown.
  It runs one `git status --porcelain=v2` for each change, after a Bash, PowerShell, Edit or Write
  call, on a prompt and on focus, one at a time and at least 2 s apart. No process runs while
  nothing changes, and none outside a git repo. A failed, slow or missing git shows a line, and
  the tree stays (handily-02b2v.3).

## handily-reply-view 0.8.0 - 2026-10-27

### Changed

- **reply-view and simple-view show copy toasts in the shared toast layout.** A copy toast
  reads `✓ Copied the plan block` or `✓ Copied the output`, then the line count, such as
  `2 lines`, on its own line, and stays 6 s. A failed copy reads `■ Not copied`, then the
  reason, and stays 10 s. When the copy throws, the reason is `the transcript shows why`, and
  the transcript holds the error. Both mods use the same reason texts (handily-ftx0x.3).

## handily-simple-view 0.8.0 - 2026-10-27

### Changed

- **reply-view and simple-view show copy toasts in the shared toast layout.** A copy toast
  reads `✓ Copied the plan block` or `✓ Copied the output`, then the line count, such as
  `2 lines`, on its own line, and stays 6 s. A failed copy reads `■ Not copied`, then the
  reason, and stays 10 s. When the copy throws, the reason is `the transcript shows why`, and
  the transcript holds the error. Both mods use the same reason texts (handily-ftx0x.3).

## handily-filetree 0.1.0 - 2026-10-27

### Added

- **filetree is a new mod: `/tree` opens a `files` tab that lists the working folder.** Folders
  come first, and the mod lists a folder only when you open it. `.git`, `node_modules`, `target`,
  `.venv`, `__pycache__`, `dist` and `.next` show `not listed`. A file whose name starts with a
  dot is dim. A folder draws 200 entries and a more button for the rest. Inline above the prompt,
  the tab draws a flat list of at most 8 rows. A scroll or another redraw lists no folder again.
  `[ refresh ]` and opening a folder list again. `/tree` on a shown tab and `/tree close` close it.
  This release shows no git state and no agent marks. The mod depends on `handily-board`
  (handily-02b2v.2).

## handily-item-toasts 0.7.0 - 2026-10-27

### Changed

- **item-toasts shows each part of a toast on its own line and keeps it long enough to read.**
  Line 1 is the signal mark, the id and the change, such as `✓ handily-ab12 closed` or
  `▶ handily-cd34 open → in_progress`. Line 2 is the tracker title in double quotes, cut with
  `…` to fit the 40-column box. A merged toast reads `3 items changed`, then the counts with
  their marks, then the ids. A failure toast puts its hint on line 3. A toast stays 2000 ms plus
  80 ms for each visible cell, at least 6 s and at most 15 s, and at least 10 s for `■`. A new
  gate, `scripts/toast.test.mjs`, keeps every toast of a mod in its `hooks/toast.ts`
  (handily-ftx0x.2).

## handily-reply-view 0.7.0 - 2026-10-27

### Changed

- **handily-reply-view keeps each word of a table cell whole when the room allows.** When a
  table is wider than the screen, each long column now gets at least the width of its longest
  word, if the longest words of all long columns fit together and each long column keeps at
  least 6 cells. So a name such as `handily-simple-view` no longer splits inside the word.
  Otherwise, a long word splits at the column width as before. Below 40 columns, or when a long
  column gets fewer than 6 cells, the table still draws one block for each row
  (handily-5zzxk.3).

## handily-board 0.5.0 - 2026-10-27

### Added

- **board lets you mark a task done, started or open.** `/board done <n>`, `/board start <n>`
  and `/board open <n>` set the status of task `n`, and an opened task row has the same
  buttons. A number that does not exist is refused with the numbers that exist. Each change of
  yours, a status, an add, a removal or a move, now waits for your next prompt. That prompt
  carries one note for Claude with every change since the last prompt, so three changes in one
  turn reach Claude as one note. The replies say `Claude is told at your next prompt.`
  (handily-9uj3n.1).
- **board clears the done tasks in one action.** `/board clear` removes every done task and
  names how many it removed, and `[ clear done ]` under the unfolded done tasks does the same.
  With no done task, it says that there is nothing to clear. When the list is full at 100 tasks
  and some are done, the refusal of a new task counts the done tasks and names `/board clear`.
  The refusal to Claude names `task_update` with the status `removed` instead. An add never
  removes a task (handily-9uj3n.2).
- **board removes a task in one press and moves a task to any place.** Every task row now ends
  with `[ rm ]`, also a pending or a done task, so one press removes it. `/board mv <n> before
  <m>`, `/board mv <n> top` and `/board mv <n> bottom` place a task anywhere in the list. After
  `up` or `down` on the board, the mod asks Claude Code to keep the keyboard focus on the moved
  task. Only the request is tested. No live check has confirmed the focus (handily-9uj3n.3).

### Fixed

- **handily-board measures an emoji sequence as 2 columns.** Before, the board counted each code
  point of a sequence. The technologist emoji took 4 columns, a family of three 6, a family of
  four 8, a flag 4 and a thumbs up with a skin tone 4. The warning sign with VS16 and the keycap
  one took 1. So a task title with such an emoji was cut at the wrong column. The board now
  measures one grapheme at a time, the same way as handily-reply-view and handily-simple-view.
  An emoji sequence, a flag, a keycap and an emoji with VS16 take 2 columns. A pictograph with
  no emoji presentation, such as the thermometer without VS16, took 2 columns and now takes 1.
  Every character that Unicode 16 East Asian Width marks wide or fullwidth now takes 2 columns,
  such as Tangut, the Kana supplements, the small form variants and the Yijing hexagrams. The
  circled numbers on a black square, U+3248 to U+324F, are ambiguous width and now take 1
  column. A long agent name that ends in an emoji sequence is now cut between graphemes, so the
  cut never leaves half of a keycap. `scripts/width.test.mjs` runs one table of cases against
  the width file of each mod (handily-5zzxk.1).

## handily-reply-view 0.6.1 - 2026-10-27

### Fixed

- **handily-reply-view measures the keycap one emoji as 2 columns.** Before, it took 1 column,
  so the border of a table after it was one column off. The reply view also counted every
  character from U+8C48 to U+FAFF as 2 columns, because its wide range started at the wrong
  ideograph. So a Latin Extended-D letter, a Vai letter or a private use character, such as a
  Nerd Font icon, took 2 columns, and now takes 1. A pictograph with no emoji presentation, such
  as the thermometer without VS16, took 2 columns and now takes 1. Every character that Unicode
  16 East Asian Width marks wide or fullwidth now takes 2 columns, such as Tangut, the Kana
  supplements and the Yijing hexagrams. The circled numbers on a black square, U+3248 to U+324F,
  are ambiguous width and now take 1 column. The reply view now measures a grapheme the same way
  as handily-board and handily-simple-view. `scripts/width.test.mjs` runs one table of cases
  against the width file of each mod (handily-5zzxk.1).

## handily-simple-view 0.7.2 - 2026-10-27

### Fixed

- **handily-simple-view measures every wide character as 2 columns.** Before, some characters
  that Unicode 16 East Asian Width marks wide took 1 column, such as the trigrams, the Yijing
  hexagrams, the Tai Xuan Jing symbols, the counting rod numerals, Kana Extended-B and the
  Tangut supplement. They now take 2. The circled numbers on a black square, U+3248 to U+324F,
  are ambiguous width, so they now take 1 column, not 2. The simple view measures a grapheme the
  same way as handily-board and handily-reply-view. `scripts/width.test.mjs` runs one table of
  cases against the width file of each mod (handily-5zzxk.1).

## handily-simple-view 0.7.1 - 2026-10-27

### Fixed

- **simple-view draws a tool call that a hook refused as one short row.** Before, a `Bash`
  call that a `PreToolUse` hook refused drew the full multi-line error block of Claude Code. The
  row now shows the description, the program, `refused` in the error colour and the first line
  of the hook message. `more` opens the whole message under the row, and `copy` copies it. Any
  other errored `Bash` text that starts with `Error:`, such as a permission denial, shows
  `error` and its first line in the same way. A generic row of a call that a hook refused shows
  `error`, and the error block of Claude Code under it is gone (handily-fwkt.8.26).

## handily-simple-view 0.7.0 - 2026-10-14

### Added

- **simple-view draws one short row for every tool call, not only for a fixed list of tools.**
  `Bash`, `Edit`, `Write`, `Read`, `Grep` and `Glob` keep their rich rows. Every other tool,
  built-in or MCP, draws one row with the tool name (`server · tool` for an MCP tool), a short
  summary of the input, the state (`running`, `done` or `error`), and the line count of the
  result and the time. A tool that a new Claude Code release adds gets the row with no change to
  the mod. A tool that asks you or shows you a plan keeps the row of Claude Code, such as
  `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode`. The mod README lists each such tool and
  the reason. simple-view now draws a row only where the plugins beneath it give the engine row,
  so the row of another mod stays, such as a `handily-board` task row. A folded group of MCP
  calls, such as `Called claude-in-chrome`, now unfolds into its rows. `/simple show N` prints
  `File diff: not reported by the engine.` for a call of another tool. A live check on Claude
  Code 2.1.300 drew the rows for `WebSearch`, `WebFetch`, `Skill`, an MCP tool and a failed
  `handily-board` task call, and kept the rows of the board (handily-fwkt.8.23).

## handily-board 0.4.0 - 2026-10-14

### Added

- **handily-board documents and tests keyboard use of the board.** Tab and Shift+Tab reach
  every button of the `this session` and `this machine` tabs in reading order, Enter presses the
  button, and Esc gives the keyboard back to the prompt. The keyboard alone unfolds and folds
  the plan of an agent. The mod code did not change. New tests hold this on the terminal and
  desktop surfaces, and a live check on Claude Code 2.1.300 confirmed it in a terminal. The
  README names one limit: after `up`, `down` or a fold of more rows, the focus stays at the
  same place in the order of the buttons, not on the same button (handily-fwkt.8.15).

### Changed

- **handily-board draws the this session tab with the same work for 1 agent and for 30
  agents.** Before, each draw read the task list of every subagent, one state read for each
  agent. Now the board keeps a copy of the subagent lists in one state value, so the number
  of state reads in a draw does not grow with the agents. A new test pins 5 reads for 1 and
  for 30 agents of 20 tasks. The board draws the same rows as before. A session that reloads
  into this version from an older one reads the list of each agent once, draws it, and keeps
  it, so no plan goes missing after the update. Measured live on Claude
  Code 2.1.300 with 30 agents of 20 tasks, the draw hook of the tab took a median of 10.05 ms
  before the change and 3.98 ms after it (handily-fwkt.8.17).

## handily 0.7.0 - 2026-10-14

### Added

- **`/handily` shows the `mode` setting of a mod beside its session mode when the two differ**,
  such as `off (default on)`. It reads the setting from the rows of the `/config` menu
  (handily-fwkt.8.13).

## handily-item-toasts 0.6.0 - 2026-10-14

### Added

- **A `mode` setting sets the mode of the toasts when a session starts.** The new `userConfig`
  field `mode` takes `on`, the default, or `off`. Each session starts from it, and `/item-toasts`
  toggles from there. The reply to an unknown argument now names the setting (handily-fwkt.8.13).

## handily-reply-view 0.6.0 - 2026-10-14

### Added

- **A `mode` setting sets the mode of the reply view when a session starts.** The new
  `userConfig` field `mode` takes `on`, the default, or `off`. Each session starts from it, and
  `/replies` toggles from there. The reply to an argument now names the setting
  (handily-fwkt.8.13).

## handily-simple-view 0.6.0 - 2026-10-14

### Added

- **A `mode` setting sets the mode of the one-row view when a session starts.** The new
  `userConfig` field `mode` takes `on`, the default, or `off`. Each session starts from it, and
  `/simple` toggles from there. The reply to an unknown argument now names the setting
  (handily-fwkt.8.13).

## handily-workitems 0.8.0 - 2026-10-14

### Changed

- **handily-workitems no longer publishes the whole snapshot at a poll that finds no change.**
  It publishes only the new small `checked` state value, with the snapshot `version` and the
  time of the check. `snapshot.checkedAt` is now the time of the check that made the snapshot,
  and `$.workitems.lines` takes the header age from the newer of the two. A poll also sends its
  checks at once. Measured in a live session on a 26 MB beads file with 5902 open items, an
  unchanged poll fell from 48-69 ms to 2-6 ms (handily-fwkt.2.5).

## handily-workitems 0.7.0 - 2026-10-13

### Added

handily-workitems reads a `.beads/issues.jsonl` over 4 MiB by streaming it through `/bin/cat`,
or `cmd.exe type` on Windows, with no approval and no `br` run. It keeps only the open items and
reads the file again only when its size or modification time changes.

## handily 0.6.0 - 2026-10-13

### Added

- **handily 0.6.0 `/handily` shows the version, the state, the mode and the purpose of each
  mod.** Each mod gets one line that fits in 80 columns: its name, its version, `loaded` or why it
  did not load, its mode (`on`, `off`, `polling`, `paused`, `-` for none, or `?` when the read
  fails), and the first sentence of its description. A mod that did not load gets a second line
  with the command that fixes it. The last line counts the loaded mods and the mods that are off
  or paused. handily-item-toasts 0.5.1, handily-simple-view 0.5.1 and handily-reply-view 0.5.4
  now store their `on` mode when a session starts, so `/handily` can show it (handily-fwkt.22).

### Changed

- **Breaking change: the marketplace is now named `niksavis`, so the install id is
  `handily@niksavis`.** `/plugin marketplace add niksavis/handily` still works and now adds the
  marketplace `niksavis`. To move from the old marketplace `handily`, run
  `claude plugin marketplace remove handily`, which also uninstalls each plugin you installed
  from it, then `claude plugin marketplace add niksavis/handily` and
  `claude plugin install handily@niksavis`, and type `/reload-plugins`. handily 0.6.0 `/handily`
  names each plugin still installed from the marketplace `handily` as an old id, with the line
  that uninstalls it and the line that removes the marketplace (handily-fwkt.21).

## handily-item-toasts 0.5.1 - 2026-10-13

### Changed

- **handily 0.6.0 `/handily` shows the version, the state, the mode and the purpose of each
  mod.** Each mod gets one line that fits in 80 columns: its name, its version, `loaded` or why it
  did not load, its mode (`on`, `off`, `polling`, `paused`, `-` for none, or `?` when the read
  fails), and the first sentence of its description. A mod that did not load gets a second line
  with the command that fixes it. The last line counts the loaded mods and the mods that are off
  or paused. handily-item-toasts 0.5.1, handily-simple-view 0.5.1 and handily-reply-view 0.5.4
  now store their `on` mode when a session starts, so `/handily` can show it (handily-fwkt.22).

## handily-simple-view 0.5.1 - 2026-10-13

### Changed

- **handily 0.6.0 `/handily` shows the version, the state, the mode and the purpose of each
  mod.** Each mod gets one line that fits in 80 columns: its name, its version, `loaded` or why it
  did not load, its mode (`on`, `off`, `polling`, `paused`, `-` for none, or `?` when the read
  fails), and the first sentence of its description. A mod that did not load gets a second line
  with the command that fixes it. The last line counts the loaded mods and the mods that are off
  or paused. handily-item-toasts 0.5.1, handily-simple-view 0.5.1 and handily-reply-view 0.5.4
  now store their `on` mode when a session starts, so `/handily` can show it (handily-fwkt.22).

## handily-reply-view 0.5.4 - 2026-10-13

### Changed

- **handily 0.6.0 `/handily` shows the version, the state, the mode and the purpose of each
  mod.** Each mod gets one line that fits in 80 columns: its name, its version, `loaded` or why it
  did not load, its mode (`on`, `off`, `polling`, `paused`, `-` for none, or `?` when the read
  fails), and the first sentence of its description. A mod that did not load gets a second line
  with the command that fixes it. The last line counts the loaded mods and the mods that are off
  or paused. handily-item-toasts 0.5.1, handily-simple-view 0.5.1 and handily-reply-view 0.5.4
  now store their `on` mode when a session starts, so `/handily` can show it (handily-fwkt.22).

## handily-board 0.3.2 - 2026-10-13

### Fixed

- **handily-board: an agent name on a "this machine" card stays readable.** The name keeps up to
  12 characters, so `general-purpose` shows as `gene…purpose` and no longer as `gene…pose`. The
  task text is cut first (handily-fwkt.8.21).

## handily-workitems 0.6.0 - 2026-10-13

### Added

- **handily-workitems 0.6.0 pauses and resumes every tracker read with `/workitems pause` and
  `/workitems resume`.** A pause stops the poll and every tracker read, and the snapshot state
  becomes `paused`. A refresh that another mod asks for then reads nothing and answers with the
  state `paused`. A resume polls again and reads the tracker once. A bare `/workitems` says if
  the reads run or are paused, and an unknown argument gets a reply that names the valid forms.
  quiet-items draws tracker commands in full, item-toasts shows no toast, and handily-board
  0.3.1 shows a dim paused line in place of the items. None of them shows an error for the
  pause (handily-fwkt.8.5.3).

## handily-item-toasts 0.5.0 - 2026-10-13

### Added

- **handily-item-toasts 0.5.0 adds `/item-toasts on` and `/item-toasts off`.** Off stores the
  mode in the mod's `mode` state key, and no work item change draws a toast until
  `/item-toasts on`. The reply names the new mode. **handily-simple-view 0.5.0 and
  handily-quiet-items 0.5.0 take `on` and `off` too:** `/simple on`, `/simple off`,
  `/quiet-items on` and `/quiet-items off` set the mode and reply with it, and the bare command
  still toggles. An unknown argument changes nothing, and the reply names the valid forms
  (handily-fwkt.8.5.2).

### Changed

- **A bare `/item-toasts` now toggles the mode between on and off**, as `/quiet-items` and
  `/simple` do. It stores the new mode and replies as `/item-toasts on` and `/item-toasts off`
  do. An unknown argument still changes nothing, and its reply now names the bare form too
  (handily-fwkt.8.5.4).

## handily-simple-view 0.5.0 - 2026-10-13

### Added

- **handily-item-toasts 0.5.0 adds `/item-toasts on` and `/item-toasts off`.** Off stores the
  mode in the mod's `mode` state key, and no work item change draws a toast until
  `/item-toasts on`. The reply names the new mode. **handily-simple-view 0.5.0 and
  handily-quiet-items 0.5.0 take `on` and `off` too:** `/simple on`, `/simple off`,
  `/quiet-items on` and `/quiet-items off` set the mode and reply with it, and the bare command
  still toggles. An unknown argument changes nothing, and the reply names the valid forms
  (handily-fwkt.8.5.2).

## handily-quiet-items 0.5.0 - 2026-10-13

### Added

- **handily-item-toasts 0.5.0 adds `/item-toasts on` and `/item-toasts off`.** Off stores the
  mode in the mod's `mode` state key, and no work item change draws a toast until
  `/item-toasts on`. The reply names the new mode. **handily-simple-view 0.5.0 and
  handily-quiet-items 0.5.0 take `on` and `off` too:** `/simple on`, `/simple off`,
  `/quiet-items on` and `/quiet-items off` set the mode and reply with it, and the bare command
  still toggles. An unknown argument changes nothing, and the reply names the valid forms
  (handily-fwkt.8.5.2).

## handily-board 0.3.1 - 2026-10-13

### Added

- **handily-workitems 0.6.0 pauses and resumes every tracker read with `/workitems pause` and
  `/workitems resume`.** A pause stops the poll and every tracker read, and the snapshot state
  becomes `paused`. A refresh that another mod asks for then reads nothing and answers with the
  state `paused`. A resume polls again and reads the tracker once. A bare `/workitems` says if
  the reads run or are paused, and an unknown argument gets a reply that names the valid forms.
  quiet-items draws tracker commands in full, item-toasts shows no toast, and handily-board
  0.3.1 shows a dim paused line in place of the items. None of them shows an error for the
  pause (handily-fwkt.8.5.3).

## handily-board 0.3.0 - 2026-10-13

### Added

- **handily-board 0.3.0 opens a running agent from its row.** Each running agent row on the
  this session tab gets an `open` button. A press runs `/tasks`, which opens Claude Code's view
  of the background agents: with one running agent its detail view, with more the list. Claude
  Code picks the agent, not the board. An agent that is on hold, pending, idle, failed or ended
  has no button. A refused run is logged and named in a toast (handily-fwkt.8.22).

## handily 0.5.1 - 2026-10-13

### Changed

- **handily 0.5.0 lists `handily-board` in place of `handily-task-pane`,
  `handily-session-board` and `handily-agent-board`.** `/handily` now reports 6 mods, such as
  `handily: 6 of 6 mods loaded`. It names `handily-task-pane@handily`,
  `handily-session-board@handily` and `handily-agent-board@handily` as old ids of
  `handily-board`, in the same way as the ids from before handily 0.4.0, and prints
  `claude plugin uninstall <old id> --scope <scope>` for each (handily-fwkt.8.19.4).

### Removed

- **Breaking change: `handily-task-pane`, `handily-agent-board` and `handily-session-board`
  are removed, with no alias and no deprecation version.** `/task`, `/agent-board` and
  `/session-board` are gone. `/board` replaces them, and `/board machine` shows the board of
  every local session. An update does not remove an old plugin. With an old plugin and
  `handily-board` both installed, Claude gets two sets of task tools. To move, run this line
  in a shell, then type `/reload-plugins` in each open session. The line updates the
  marketplace, installs `handily-board`, uninstalls the three old plugins and updates the
  bundle. A command for a plugin that you did not install fails for that plugin only
  (handily-fwkt.8.19.4).

  ```sh
  claude plugin marketplace update handily; claude plugin install handily-board@handily; for p in handily-task-pane handily-agent-board handily-session-board; do claude plugin uninstall "$p@handily"; done; claude plugin update handily@handily
  ```

### Fixed

- **After the move from an old plugin name, type `/reload-plugins` in each open session. A
  restart is not needed.** `/reload-plugins` unloads an uninstalled plugin from an open session.
  The README move sections and the removal note said that a restart was needed. When `/handily`
  names an old plugin id, its summary line now ends with
  `Run each uninstall command above, then type /reload-plugins` (handily-fwkt.12).

## handily-board 0.2.0 - 2026-10-13

### Added

- **handily-board 0.1.0 is a board with two tabs that replaces handily-task-pane,
  handily-session-board and handily-agent-board.** `/board` opens it. The `this session` tab
  shows the task list that Claude and you share, and the subagents of this session: a failed
  agent with a second line, an agent on hold, and at most 6 rows before a fold. The
  `this machine` tab shows every local Claude Code session, the ones that wait for you first,
  with a `waits for:` line. The tab polls `claude agents --json` only while it is shown.
  `/board add`, `/board rm`, `/board list` and `/board close` replace the `/task` forms. The
  model tools are `mcp__handily-board__task_add`, `task_update`, `task_move` and `task_list`
  (handily-fwkt.8.19).

- **handily-board 0.2.0 shows the agents of other sessions on the this machine tab.** Each
  session that runs the board now shares the name, the current task and the done and total
  counts of its active subagents in its store key, at most 4096 bytes. A card of another session
  shows at most 4 agent rows, an agent with no task list as `no tasks`, then a
  `+N more agents` button. Inline, the agents fold into one `N agents` button under the row.
  This session's card keeps its counts only (handily-fwkt.8.11).

### Fixed

- **handily-board 0.1.1 polls the sessions at once when the this machine tab becomes
  shown.** The 15 second poll skips its turn while the tab is hidden. Before this fix,
  a switch back to the tab showed old data, such as `Sessions 4 · 38s ago`, until the
  next turn. Now the tab polls `claude agents --json` at once when its data is 15
  seconds old or older, and polls nothing extra when the data is newer
  (handily-fwkt.8.20).

## handily-reply-view 0.5.3 - 2026-10-13

### Changed

- **handily-reply-view 0.5.3 and handily-simple-view 0.4.2 draw divider lines around the text
  that `more` opens.** A dim line now stands above and below an opened long reply and above and
  below the opened output of a tool call row, so the person sees where the opened text starts
  and ends and what copy takes. `less` removes both lines (handily-fwkt.16).

### Fixed

- **handily-reply-view 0.5.2 names the reply on its copy button.** The button that copies a
  whole long reply now reads `copy reply`, so under a reply that ends with a code block it no
  longer looks like the `copy` button of that block. Each copy toast names the copied part and
  its line count, such as `Copied the sh block (2 lines).` or
  `Copied the reply as markdown (61 lines).`. On a narrow screen the count of hidden lines is
  cut at its end, so the buttons stay on its line (handily-fwkt.15).

## handily-simple-view 0.4.2 - 2026-10-13

### Changed

- **handily-reply-view 0.5.3 and handily-simple-view 0.4.2 draw divider lines around the text
  that `more` opens.** A dim line now stands above and below an opened long reply and above and
  below the opened output of a tool call row, so the person sees where the opened text starts
  and ends and what copy takes. `less` removes both lines (handily-fwkt.16).

## handily-item-toasts 0.4.1 - 2026-10-13

### Fixed

- **handily-item-toasts 0.4.1 shows no error after `/reload-plugins`.** A reload
  restarts the version of `handily-workitems` at 0. Before this fix, item-toasts
  then asked for changes since a newer version and logged
  `HooksError: workitems refresh: since 64 is newer than the current version 1`
  once. Now item-toasts takes the restarted snapshot as its new baseline, with no
  error and no toast, and toasts the next change against it (handily-fwkt.11).

## handily-reply-view 0.5.1 - 2026-10-09

### Fixed

- **handily-reply-view 0.5.1 keeps the prompt row of Claude Code, with its grey background
  band, and frames it with a coloured rule.** In 0.5.0 the mod drew its own prompt row without
  the band, so a prompt was hard to find when you scrolled. Now a prompt that you type draws a
  blank line, a rule labelled `you` and the time in the `suggestion` colour of your theme, and
  then the prompt row as Claude Code draws it. The rule spans the width of the transcript. A
  prompt that you type while Claude works now shows its time too: 0.5.0 kept the time only for
  a prompt typed while the session was idle. A prompt longer than 60000 characters now also
  gets the rule (handily-bm2jt).

## handily-reply-view 0.5.0 - 2026-10-09

### Added

- **handily-reply-view 0.5.0 opens each prompt that you type with a dim rule labelled `you`, so
  you find your own prompts when you scroll the terminal.** The rule spans the width of the
  transcript and shows the time when the prompt entered the session, such as
  `── you · 21:37 ───`. A prompt from before a resume shows `you` without a time, because the
  mod knows no time for it. The prompt text under the rule is bold, keeps the `❯` marker and
  wraps as before. A task notification, a message from another agent, teammate, session or
  channel, a prompt that a plugin sent, a slash command and its output draw as Claude Code draws
  them. The ctrl+o view and the desktop app draw the prompt as Claude Code draws it, without the
  rule. `/replies` turns the rule off and on together with the reply view (handily-u76rw).

## handily-simple-view 0.4.1 - 2026-10-09

### Fixed

- **handily-simple-view 0.4.1 draws its own row while the input of a call streams, so the raw
  engine row no longer shows first.** Before a `Bash`, `Read`, `Grep` or `Glob` call runs, its
  row shows the bullet, the tool name or the description when it arrives, the parts of the input
  that are readable, and a dim `…`. The full row follows as soon as the call ends. A running
  `Read`, `Grep` or `Glob` call also shows this row. A tool group that holds only calls of these
  tools unfolds as soon as the tool names are known, so the `Running 1 shell command…` line no
  longer shows. Another tool, an errored call, an interrupted call and an input field of the
  wrong type still draw as the engine draws them (handily-vt4ku).

## handily-reply-view 0.4.0 - 2026-10-09

### Changed

- **handily-reply-view 0.4.0 draws dim rules between the columns of a table and under its
  header.** A dim `│` stands between the columns on every line, and a dim `─` line with `┼`
  crossings stands under the header. The header text is bold and no longer underlined. When a
  cell of a table wraps, a dim dotted `┄` line separates the rows in place of the blank line. A
  table that fits draws no row rules. The rules span the width of the table, not the screen,
  and the widths of the columns do not change. `copy` and `copy as text` hold no rule
  characters. A table now takes one line more, for the rule under its header. A table drawn as
  blocks below 40 columns keeps its look (handily-ucz8v).

## handily-reply-view 0.3.1 - 2026-10-09

### Changed

- **handily-reply-view 0.3.1 separates the rows of a wrapped table, underlines the headings and
  gives the width of a wrapped table to its long columns.** When a cell of a table wraps, one
  blank line separates the rows, so you can see where each row ends. A table where no cell wraps
  has no blank lines. Each heading stays bold and is now underlined. The underline covers the
  text of the heading, not the space between the columns, and it adds no line. In a table that
  does not fit, only a column whose widest cell is 12 cells or less keeps its width. Every wider
  column wraps and shares the rest of the width by the width of its widest cell, so a column of
  short phrases such as `Buttons on the header row` takes 13 cells at 120 columns, not 25. A
  blank line counts as a line when a long reply folds (handily-1zos4).

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
