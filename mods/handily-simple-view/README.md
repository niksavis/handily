# handily-simple-view

`simple-view` draws one short row for each tool call in the transcript: a built-in tool, an MCP
tool or a tool that a plugin adds. `Bash`, `Edit`, `Write`, `Read`, `Grep` and `Glob` have rich
rows. Every other tool has the generic row: the tool name, a short summary of the input, the
state, and the size of the result and the time. A call that asks you or shows you a plan keeps
the row of Claude Code.
A `Bash` row with output has a `more` button that shows the output in the `call` tab, and a
`copy` button that copies it. A press never changes the height of the row. A call that failed,
also inside a REPL script, draws one row and one reason line under it.
`/simple off` and `/simple on` switch the view for the session. `/simple show N` prints one
call in full, and `/simple open N` shows it in the `call` tab. The model still reads the full
tool result. Only the screen changes.

```text
● List the mods  ls  exit 0  7 lines  1.1s                                  [ more ] [ copy ]
● List a folder that does not exist  ls  exit 2  0.4s                   [ more ] [ copy ]
  ls: cannot access '/nonexistent-folder': No such file or directory
● Run the build  tsc  exit 127  command not found  0.1s                 [ more ] [ copy ]
  sh: 1: tsc: not found
● Print x after a pipe  true  refused                                   [ more ] [ copy ]
  pipe-status-guard: refusing a status read after `tail`: the pipeline…
● Append a probe line  printf  exit 0  0 lines  2.8s
  Updated README.md (+1 -0)
● Edit  src/app.ts  +2 -1
● Edit  note.txt  refused
  probe-guard: file tools are refused in this folder
● Edit  hooks/transcript.ts  error
  File has not been read yet. Read it first before writing to it.
● Edit  src/app.ts  denied  auto mode: Self-Modification
● Bash  touch other.txt  denied  by a rule
● Read  mods/handily/.claude-plugin/plugin.json  18 lines
● Read  docs/design.md  lines 160-239 of 674
● WebSearch  handily claude code mods  done  16 lines  5.3s
● claude-in-chrome · list_connected_browsers  done  1 line
```

The approved mocks are in `docs/mocks.md`, sections 6, 21, 22 and 23. Section 7.2 is superseded by
section 21. The design is in `docs/design.md`, section 4.8.

[docs/install.md](../../docs/install.md) gives the install, update and uninstall steps.

## Rows

| Call                                                           | Row                                                                                                     | Result block under it               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `Bash`, `Read`, `Grep`, `Glob`, before the run                 | description or tool, the parts of the input it can read, dim `…`                                        | as the engine draws it              |
| `Bash`, running                                                | description, program, dim `running`, time since the call started                                        | as the engine draws it              |
| `Bash`, no error                                               | description, program, `exit 0`, stdout line count, time                                                 | one `Updated` line per changed file |
| `Bash`, `Exit code N`                                          | description, program, `exit N`, the name of the code, time; the first non-empty error line under it     | empty                               |
| `Bash`, refused by a hook                                      | description, program, `refused`, time; the first line of the hook message under it                      | empty                               |
| `Bash`, another `Error:` text                                  | description, program, `error`, time; the first non-empty line of the text under it                      | empty                               |
| `Bash`, denied by the auto mode classifier                     | description, program, `denied`, `auto mode` and the reason                                              | empty                               |
| `Bash`, denied by a permission rule                            | `Bash`, the command, `denied`, `by a rule`                                                              | empty                               |
| `Edit`, `Write`                                                | tool, file path, added and removed line totals                                                          | empty                               |
| `Read`                                                         | tool, file path, line count, or the range of lines that the call read                                   | empty                               |
| `Grep`                                                         | tool, pattern in quotes, `in` and the folder, the count of the output mode                              | empty                               |
| `Glob`                                                         | tool, pattern, `in` and the folder, the count of matched files                                          | empty                               |
| `Read`, `Grep`, `Glob`, running                                | tool, the path or the pattern from the input, dim `…`                                                   | as the engine draws it              |
| `Edit`, `Write`, `Read`, `Grep`, `Glob`, refused by a hook     | tool, the path or the pattern from the input, `refused`; the first line of the hook message under it    | empty                               |
| `Edit`, `Write`, `Read`, `Grep`, `Glob`, denied                | tool, the path or the pattern from the input, `denied`, then `auto mode` and the reason, or `by a rule` | empty                               |
| `Bash`, `Edit`, `Write`, `Read`, `Grep`, `Glob`, denied by you | the row of the call stays as it was drawn before the run                                                | one line: `denied`, `by you`        |
| Any other tool, before the run                                 | tool name, input summary, dim `…`                                                                       | as the engine draws it              |
| Any other tool, running                                        | tool name, input summary, dim `running`, time since the call started                                    | as the engine draws it              |
| Any other tool, no error                                       | tool name, input summary, `done`, line count of the result, time                                        | empty                               |
| Any other tool, error                                          | tool name, input summary, `error`; the first non-empty line of the error text under it                  | empty                               |
| Any other tool, refused by a hook                              | tool name, input summary, `error`; the first line of the hook message under it                          | empty                               |
| `Edit`, `Write`, `Read`, `Grep` or `Glob`, another error       | tool, path or pattern, `error`; the first non-empty line of the error text under it                     | empty                               |

- The description is the `description` that the model gave. Without one, the row shows the
  first command segment. An ellipsis (`…`) marks a cut or a segment that follows.
- The program is the first word of the first segment that is not `cd`, `pushd` or `popd`. A
  `VAR=value` word before it is skipped.
- When the engine gives a meaning for a non-zero exit that is not an error, such as
  `No matches found` for `grep`, the row shows that meaning in place of `exit 0`.
- When a call without an error wrote to stderr, the row adds the stderr line count and the
  first non-empty stderr line, dim and cut at the row end. The result block does not change.
- When the engine saved a large output to a file, stdout holds only a preview. The row then
  shows `output saved to a file` in place of the line count, and `/simple show N` prints the
  path of that file.
- The result block names each changed file as `Updated`, `Created` or `Deleted`, with
  `(+added -removed)`. Files that the engine counts but does not list show as
  `and N more changed files`. When the engine reports that it could not track the changes, the
  block says `File changes were not tracked for this call`, and `/simple show N` prints
  `File diff: not tracked by the engine.`
- A missing `Updated` line proves that the call changed no file only for a call without an
  error, and only when Bash edit tracking was on for that call. With tracking off, the engine
  sends no diff, also for a call that wrote a file. The block is then empty, and
  `/simple show N` prints `File diff: not reported by the engine.`
- A hook that refuses a call before it runs sends `Error: PreToolUse:Bash hook error:`, the
  hook command in brackets and its message. The row leaves out all of that text up to the
  message, and shows the first line of the message on its own line under the row.
- A hook refusal of `Edit`, `Write` or `Read` has the same shape, with the tool name in place of
  `Bash`, as captured on Claude Code 2.1.312. The row shows the tool, the path and `refused`,
  and the first line of the message goes under the row. Another error of these tools, such as
  `File has not been read yet`, shows the tool, the path and `error`, and the first non-empty
  line of the error text goes under the row.
- A call inside a REPL script that fails reaches the row with no output: Claude Code 2.1.328
  draws it with `output` undefined. The mod keeps the error text of each failed call from its
  `tool.call`, keyed by the tool use id, for the last 50 failed calls of the session. The row
  takes its reason from that text. A failed call that the mod did not keep, such as a call of a
  subagent or of an ended session, keeps the row of the engine.
- The reason line leaves out `Error:` and the `<tool_use_error>` tags. A call that ended with an
  exit code and printed nothing shows a dim `no output` line. Another failed call with no error
  text shows a dim `no error text` line.
- A row with no description shows the command, so it leaves out the program when the program is
  the first word of the command. A call that runs `exit 3` reads `exit 3` once.
- Any other errored `Bash` text that starts with `Error:`, is not an exit code and is not a
  denial shows `error`, and the first non-empty line after `Error:` goes under the row.
- The reason of a failed call, the line under the row, draws in the error colour, indented under
  the row and cut at the row end. Below 60 columns the reason wraps to at most two lines. A
  longer reason is cut at a word with `…`, and the row then gets `more`. Below 60 columns the
  row keeps only `more`: the time and `copy` are in the `call` tab.
- A failed row with more text than the row shows, such as a second error line, gets `more` and
  `copy`.
- A row that does not fit with its `more` and `copy` buttons, such as a successful row at 40
  columns, puts the time and the buttons on a line of their own under the row. The state word
  and the line count stay whole.
- `exit N` names four codes dim beside the code: 126 `not executable`, 127
  `command not found`, 130 `interrupted` and 143 `stopped`. Other codes have no name.
  [Denied calls](#denied-calls) gives the rows of a denial.
- After `exit N`, the engine sends no diff, but the command can still have changed a file.
  `/simple show N` then prints `File diff: not reported by the engine.`
- `/simple show N` prints `File diff: none.` for a `Bash` call only when the engine tracked the
  call and listed no changed file.
- The `bashEditDiffEnabled` setting turns Bash edit tracking on or off. The
  `CLAUDE_CODE_BASH_EDIT_DIFF` environment variable wins over the setting. Without either, the
  engine decides, and the mod cannot read that decision.
- When a stderr line follows the description, the description keeps up to 40 cells. The
  terminal cuts the stderr line first. In a refused `Edit`, `Write`, `Read`, `Grep` or `Glob`
  row, the path, or the pattern and the folder together, keep up to 40 cells.
- A path inside the session root shows relative to the root, and the root itself shows as `.`.
  Another path shows in full.
- The row shows the time only from 1 second. The engine gives no run time for a `Bash` call, so
  the mod clock measures the time around the call. It includes the time that a permission
  question waited for an answer.
- A `Read` of a whole file shows its line count, such as `18 lines`. A `Read` of a part shows
  the range, such as `lines 160-239 of 674`.
- A `Grep` row counts what its output mode returned: `12 lines` for `content`, `3 files` for
  `files_with_matches` and `7 matches` for `count`. When the engine cut the output at
  `head_limit`, the row shows both counts, such as `10 of 12 lines`.
- A `Glob` row shows the total of matched files. When the engine knows the total only as a
  lower bound, the row adds a `+`, such as `100+ files`.
- Claude Code 2.1.295 offered no `Grep` or `Glob` tool in a live check, also not to an `Explore`
  agent. The mod reads their outputs in the shape of the 2.1.295 output schema. The
  transcripts of 2.1.294 show the same shape.
- `Write` of a new file counts the lines of its content, blank lines at the end included, as
  its diff does. When the engine gives no diff for an
  update (for example, the old content was too large to diff), the row shows the path only,
  with no totals.

## Denied calls

The auto mode classifier or a permission rule can deny a call before it runs. A `Bash`, `Edit`,
`Write`, `Read`, `Grep` or `Glob` call that one of them denied draws as one short row:

```text
● Edit  src/app.ts  denied  auto mode: Self-Modification
● Remove the notes  rm  denied  auto mode
● Bash  touch other.txt  denied  by a rule
```

| Denied by                | The text that the mod reads                                                                             | The words after `denied`    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| The auto mode classifier | `Permission for this action was denied by the Claude Code auto mode classifier. Reason:` and the reason | `auto mode:` and the reason |
| A permission rule        | `Permission to use Bash with command touch other.txt has been denied.`                                  | `by a rule`                 |

- The reason of the classifier is the text in brackets. The server-side sentence of the
  classifier gives no explanation, so the row shows `auto mode` alone.
- A `Bash` row that the classifier denied keeps the description and the program. A `Bash` row
  that a rule denied shows `Bash` and the command.
- The permission rule text was captured on Claude Code 2.1.322. A text of the same shape with
  another tool name draws the same row. A deny rule on `Write` removes the `Write` tool, so no
  `Write` call can be denied by a rule.
- `denied` and the words after it are red, and so is the marker. The row has no buttons, and the
  result block is empty.
- In a narrow terminal, the path, the pattern, the description or the command is cut first,
  then the reason of the classifier. `denied`, `auto mode` and `by a rule` are never cut.
- A text in another shape draws the `error` row with the text under it, and never `denied`. A
  tool with the generic row keeps that row with `error`.

### Denied by you

When you answer No to the permission prompt of a `Bash`, `Edit`, `Write`, `Read`, `Grep` or
`Glob` call, the row of the call stays and one short line shows under it:

```text
● Write(other.txt)
  denied  by you
```

- The mod reads the result text `User rejected tool use`, captured on Claude Code 2.1.323. Any
  other text draws no such line. When that text is not the error text that the call answered,
  the engine draws its own result line, so a rejection in a new wording stays in view.
- `denied` and `by you` are red and never cut. The line has no buttons.
- `Edit` and `Write` keep the row of the engine. `Bash`, `Read`, `Grep` and `Glob` keep the row
  that simple-view drew before the run, with the dim `…`.

## The generic row

Every tool that is not `Bash`, `Edit`, `Write`, `Read`, `Grep` or `Glob` and not on the list
below draws the generic row. The mod keeps no list of supported tools, so a tool that a new
Claude Code release adds, and any MCP tool, gets the generic row.

```text
● WebSearch  ink flexbox text truncate end  running  3.0s
● WebSearch  ink flexbox text truncate end  done  14 lines  5.3s
● WebFetch  https://example.com  done  1 line  1.6s
● claude-in-chrome · list_connected_browsers  done  1 line
● Skill  no-comments  error
  ⎿  Initializing…
  ⎿  Error: Unknown skill: no-comments
```

- The tool name of an MCP tool, `mcp__server__tool`, shows as `server · tool`. A name with no
  tool part shows in full.
- The input summary is the first text that is not empty in these fields, in this order:
  `title`, `subject`, `description`, `summary`, `url`, `query`, `pattern`, `skill`, `command`,
  `file_path`, `filePath`, `notebook_path`, `path`, `uri`, `prompt`, `message`, `name`. Without
  one, it is the first text value of the input that is not empty. An input with no text value
  shows no summary.
- In the summary, each run of spaces and line breaks becomes one space. Colour codes are
  dropped, and other hidden characters show as escapes such as `​`. The terminal cuts the
  summary at the row end first. The tool name and the state stay.
- The marker is green after `done`, red after `error` and dim before the run and while the call
  runs. `done` is green and `error` is red.
- The line count is the count of lines in the result as the model read it. The time shows from
  1 second. The mod clock measures it around the call, as for `Bash`.
- After `error`, the first non-empty line of the error text goes under the row, and the result
  block is empty. When a hook refused the call, the line is the first line of the hook message.
  `/simple show N` prints the call in full.
- A call has no line count and no time when a subagent made it, when it is from an ended
  session, or when a plugin above simple-view answered it.

In Code Mode, Claude Code runs tool calls inside `REPL` scripts. Two rows show more than `done`:

```text
● REPL  Read the last commit  dispatched #12
● Poll  #12 done · 1 running
● Poll  #3 error
● Poll  no new events
```

- A `REPL` script that Claude Code started without waiting for it shows `dispatched` and its
  number in place of `done`. A script that ran to its end keeps `done` and its line count.
- A `Poll` row names each event that arrived: the script number and `done` or `error`, and the
  count of scripts that still run. A row with an `error` is red. A `Poll` that found nothing
  shows `no new events`.
- Only an event with a nonce from the first line of the result counts. An event that a script
  output quotes does not count. A result with no nonce line keeps `done` and its line count.
- The calls inside a script draw their own rows, as outside Code Mode.

These tools keep the row of Claude Code, because you must read or answer what the row shows:

| Tool                                                         | Why the engine row stays                              |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `AskUserQuestion`                                            | It asks you questions, and the row shows your answers |
| `EnterPlanMode`, `ExitPlanMode`                              | It asks you to approve plan mode or the plan          |
| `ProposeGoal`                                                | It asks you to approve a goal                         |
| `TodoWrite`                                                  | The row shows the plan as a list                      |
| `SendUserMessage`, `SendUserFile`, `PushNotification`        | It sends a message or a file to you                   |
| `ReportFindings`                                             | It reports review findings to you                     |
| `propose_skills`, `PublishPlugin`                            | It asks you to save a skill or to publish a plugin    |
| `SuggestPluginInstall`, `SuggestSkills`, `SuggestConnectors` | It offers you a choice                                |
| `OfferChromeSetup`, `ShowOnboardingRolePicker`               | It asks you to set up a browser or to pick a role     |
| `request_computer`                                           | Its schema has no description, so the mod stays safe  |

`ToolSearch` also keeps the row of Claude Code. Claude Code 2.1.300 draws no row for it, and
simple-view does not add one.

## Rows of other mods

simple-view asks the plugins beneath it and the engine first. It draws its row only when the
answer is the engine row. When a plugin beneath it draws its own row, that row stays. A plugin
above it draws before simple-view is asked. So the rows of `handily-board` for its task tools
and the tracker rows of `quiet-items` stay, in either order of the plugins.

- When such a plugin passes a call on to the engine, simple-view draws its row for the call.
  `handily-board` passes a running or failed task call on, so that call draws the generic row.
- In a live check with Claude Code 2.1.300, the engine answered `ref` 1 for a row that no plugin
  had changed. So simple-view cannot see a plugin beneath it that only changes the props of the
  engine row, and it draws its own row in that case.

## While the input streams

Claude Code sends the tool name of a call first, and its input when the model has written it.
Before the call runs, a `Bash`, `Read`, `Grep` or `Glob` row shows what is readable, and a dim `…`
in place of the result:

```text
● Bash  …
● Count to five slowly  sleep  …
● Read  …
```

- A `Bash` row shows the tool name until the description or the command arrives. Then it shows
  the same label and program as the finished row.
- A `Read` row shows the path, and a `Grep` or `Glob` row shows the pattern and the folder, as
  soon as they arrive. A running `Read`, `Grep` or `Glob` call shows the same row.
- A call is before its run while it does not run, has no output, and has no error and no abort.
  In that state a missing field has not arrived yet, so the row leaves it out. A field of the
  wrong type is not an input that streams, so the engine draws the row. This rule holds for a
  complete input too.
- In a live check with Claude Code 2.1.296, the input of a call stayed `{}` until the model had
  written all of it. The row showed `● Bash  …` first, then the description and the program with
  `…` until the call started.

## Open and copy the output

A finished `Bash` row with output ends with two buttons. They stand at the right edge of the row,
dim until the pointer is on them.

```text
● Run the unit tests  npm  exit 0  140 lines  3.0s                          [ more ] [ copy ]
```

A press on `more` never changes the height of the row, so the text that you looked at stays
where it was. What the press does depends on the room:

- In fullscreen from 110 columns, or while the `call` tab is open, the output opens in the
  `call` tab, and `more` reads `shown`. The tab docks beside the transcript. It opens once and
  stays open: Esc gives the keys back and keeps the tab. A second press on another row shows that
  call in the same tab.
- A press on `shown` while the `call` tab is the tab on show clears the call from the tab. The
  tab stays open and empty, and the row reads `more` again. `/simple close` closes the tab.
  When another tab hides the `call` tab, the press shows the `call` tab again. When the tab showed
  the call while it ran, the first press after the call ended shows the ended call.
- Below 110 columns, or on the main screen, no pane opens, because an inline pane pushes the
  transcript up. The row adds one dim line that names the command, such as
  `/simple open 3 shows this call in the call tab.`. The number follows new calls. A second
  press removes the line.

```text
● Run the unit tests  npm  exit 0  140 lines  3.0s                         [ shown ] [ copy ]
```

The `call` tab, docked, body 60 columns:

```text
Bash · exit 0 · 3.0s
Run the unit tests
$ npm test
────────────────────────────────────────────────────────────
line 1
…
line 140
────────────────────────────────────────────────────────────
140 lines
[ copy ] [ < error ] [ error > ]
```

`< error` and `error >` draw only when the session keeps another call that failed.

- `copy` copies the full output of the call: stdout, then stderr, exactly as the engine gave
  them. Trailing spaces and blank lines stay. After `exit N` it copies the error output under the
  `Error: Exit code N` line. After `refused` it copies the message of the hook, and after
  `error` the text after `Error:`. The `call` tab shows the same text.
- In the `call` tab, `copy` (key `c`) copies the call. `< error` (key `p`) and `error >`
  (key `n`) show the previous or the next kept call that failed.
- A toast says `✓ Copied the output`, then the line count on the next line, such as
  `140 lines`. It stays 6 seconds.
- A copy that fails draws `■ Not copied`, then the reason, such as
  `the clipboard took nothing`. It stays 10 seconds. When the copy throws, the reason is
  `the transcript shows why`, and the transcript holds the error.
- When the engine saved a large output to a file, the press reads the saved file, and the
  `call` tab shows all of it. `copy` reads the saved file and copies all of it. When the file
  cannot be read, the tab says `The saved output could not be read.` and names the path.
- In the `call` tab, colour codes are dropped, a line that a carriage return overwrote shows its
  last part, a tab becomes spaces up to the next 8-cell stop, and other hidden characters show as
  escapes such as `\u200b`. A wide character or an emoji takes 2 cells, and a combining mark
  takes none. The tab draws at most 60000 characters and at most about 12000 elements, because
  the engine refuses a tree of more than 20000 nodes. Then a dim line says how many lines it did
  not draw, and `copy` still takes all of them.
- A line wider than the tab goes on in the next row after a dim `↳`. A row breaks after the last
  space that fits. Only a word longer than the row is cut inside the word.
- A running call has `more` only. The `call` tab shows the full command.
- A call with no output and an `Edit` or `Write` row have no buttons. An output of only spaces,
  tabs and blank lines counts as no output, so its row shows `0 lines` and has no buttons.
- The press handler is `pressMore(port, site, call, seat)` in `hooks/viewer.ts`. It answers
  `viewer`, `cleared`, `hint` or `unhint`.

### Output kinds in the call tab

The `call` tab draws the output of a `Bash` call in the format of its kind. The mod finds the
kind from the command and the text, and never guesses. Any other output is plain text. The top
rule names the kind, such as `── grep ───`. The head keeps the command, the exit code and the
time.

| Kind     | When                                                                                                                                       | Drawn as                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| grep     | a part of the command runs `grep`, `egrep`, `fgrep`, `rg` or `git grep`, and every line is `path:N:text`, `N:text`, a context line or `--` | the path dim above its lines, the line number in `planMode`, a literal pattern bold in `warning`                                          |
| git log  | a part runs `git log`, and every line is a one-line entry, or the first line is `commit` and a full hash                                   | the hash in `warning`, the refs in `success`, the subject bold, the other head lines dim                                                  |
| diff     | the first line starts with `diff`, `---` or `commit` and a full hash, and a hunk head `@@` follows                                         | terminal: file lines bold, hunk heads in `suggestion`, `+` in `success`, `-` in `error`; desktop: the path and one engine `Code` per file |
| JSON     | the whole text is one JSON object or array                                                                                                 | pretty, keys in `planMode`, strings in `success`, other values in `warning`; 5 levels deep or more as a dim `{…} 2 keys`                  |
| markdown | every part runs `cat`, `head` or `tail`, `cat` has no option, and one part reads a `.md` or `.markdown` file                               | the engine `Markdown` element                                                                                                             |

- A JSON number keeps the text that the command printed, such as `1.0` or a 20-digit integer.
- A diff file whose last hunk was cut draws the terminal tokens on the desktop too, because a cut
  hunk does not parse.
- `/simple open N` shows the kept record. Its head names the end of the call as the row does,
  such as `Bash · exit 0 · 0.7s · call 5 of 5` or `Bash · No matches found · 0.2s · call 2 of 5`.
  When the engine saved the output to a file, the tab reads the file. The line that says the
  record was cut draws dim. A JSON text that the record cut is plain.
- `rg` into a pipe prints no line numbers unless the command has `-n`. Such an output is plain.
- The mocks are in `docs/mocks.md`, section 23.

## When the engine row stays

simple-view draws the engine row unchanged in each of these cases:

- The mode is off. `/simple` turned it off for this session, or the `mode` setting is `off`.
- `quiet-items` stored a row for the call, and the `quiet-items` mode is on. The tracker row
  of `quiet-items` wins. While `/quiet-items` has turned its mode off, simple-view draws its own
  row for the call.
- Another mod drew its own row for the call. [Rows of other mods](#rows-of-other-mods) says
  how.
- The call was interrupted or ran in the background.
- A `Bash` call errored with a text that does not start with `Error:`.
- A failed call whose error text the mod did not keep and whose output is no error text, or an
  error text that starts with `Interrupted by user` or `[Request interrupted by user`.
- A failed call whose output is not the error text that its `tool.call` answered. The person
  rejection of Claude Code 2.1.323 has such an output, and so can an interruption or a denial in
  a wording that the mod does not know.
- The output or the input is not a shape that the mod reads, or a staged `Edit` or `Write` that
  did not change the file. A `Read` of an image, a PDF, a notebook or an unchanged file is not a
  shape that the mod reads.
- An input field of the wrong type, also while the input streams, such as a `command` that is
  not text.
- Drawing the row failed. The mod writes the reason to the transcript.
- A tool that keeps the row of Claude Code. [The generic row](#the-generic-row) lists them.

In the normal view the engine folds runs of read-only calls into one group line, such as
`Read 2 files, listed 1 directory, ran 1 shell command` or `Called claude-in-chrome`. While its
mode is on, simple-view unfolds a group when each call of the group draws as one row: a `Bash`
call in the foreground, a `Read`, a `Grep`, a `Glob` or a call with the generic row. A
`ToolSearch` call, which the engine does not draw, does not keep a group folded. The calls of
the group then draw as their rows in its place:

```text
● Read  README.md  123 lines
● Read  package.json  30 lines
● List the mods  ls  exit 0  9 lines                                        [ more ] [ copy ]
```

The group also unfolds while the input of its calls streams, as soon as the tool names are known.
So the engine line `Running 1 shell command…` does not show first.

A group that holds another tool keeps the line of the engine, except in the two cases below.
The ctrl+o transcript unfolds every group, and each call there shows its simple-view row.

When a folded group holds a call that failed, simple-view unfolds the group while its mode is
on. Each call of the group then draws as its own row, so the failure is visible. When
`quiet-items` also unfolds the group, the result is the same.

While the live group holds a `Bash` call that runs in the foreground, simple-view also unfolds
that group. The engine would draw the full command of the running call there, over many lines.
The running call draws as one row instead, and its `more` button shows the command in the
`call` tab. When no call of the group runs, the group folds again to the line of the engine,
unless a call of the group failed.

## Settings and the commands

| Setting | Default | Use                                           |
| ------- | ------- | --------------------------------------------- |
| `mode`  | `on`    | The mode when a session starts: `on` or `off` |

| Command              | Effect                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `/simple on`         | Turns the view on for this session, and replies with the new mode                        |
| `/simple off`        | Turns the view off for this session, and replies with the new mode                       |
| `/simple`            | Turns the view off or on for this session, and replies with the new mode                 |
| `/simple show N`     | Prints the input, the output and the file diff of the N-th last tool call. 1 is the last |
| `/simple open N`     | Shows the N-th last tool call in the `call` tab and gives it the keys. 1 is the last     |
| `/simple open`       | Shows the last tool call in the `call` tab                                               |
| `/simple open error` | Shows the last kept call that failed in the `call` tab                                   |
| `/simple close`      | Closes the `call` tab. Every row whose call the tab showed reads `more` again            |

- The mod keeps the mode in the `mode` key of its `$.state`, so a change does not reach other
  sessions. When the session starts and the key is unset, the mod writes the `mode` setting to
  it. So a session starts with the mode of the setting, and `/simple` toggles from there.
  `/handily` shows the setting beside the mode when the two differ.
- `/simple show N` and `/simple open N` refuse a number outside the kept calls, and give the
  valid range. `/simple open` shows the kept record of the call, which is cut at 8000
  characters, as `/simple show N` prints it. An output that the engine saved to a file is read
  from the file.
- Any other argument changes nothing, and the reply names the valid forms.
- ctrl+o cannot expand a single row. The engine reuses the drawn row and does not call the mod
  again. Use `more` on the row, `/simple open N` or `/simple show N`.

## Memory limit

`/simple show` keeps the last 50 tool calls of the main session in `$.state`. It cuts each part
of a call (the input, the output and the file diff) at 8000 characters, and says how many
characters it cut. Calls of subagents are not kept.

When a session ends for any reason (`/exit`, `/clear`, a resume or a finished run), the mod
resets the count of kept calls. The calls and the times of the ended session are no longer
reachable: `/simple show` refuses them, and an old row draws without its time. `$.state` has
no delete, so the mod writes each new call over a slot of the ended session. The 50 slots stay
the upper limit. One small time record (three numbers) stays for each `Bash` call and each call
with the generic row of the process. A call with the generic row also keeps one line count.

A press on `more` below 110 columns keeps one small value for that call in `$.state`, so the
line that names `/simple open` stays when the row draws again. The `call` tab keeps the id of
the call that it shows in `$.state`, and the text of that call in memory. The error texts of the
last 50 failed calls stay in memory, and a session end clears them.

## Known limits

- The mod cannot tell whether the transcript is scrolled up. `onScreen` gives only which rows of
  the row itself are visible, and a press carries no scroll position. So below 110 columns every
  press adds the `/simple open` line, at the bottom and scrolled up. At the bottom the row then
  grows by one line.
- With another pane already docked, such as the board, the transcript is narrower, for example 83
  columns at 150. The mod keeps in memory the widest transcript columns that its own renders saw
  in fullscreen, and the rows that came with them. A press counts as docked when the transcript
  has 110 columns or more, or when the widest seen has 110 or more, the transcript is now
  narrower, and the rows are the same. A dock narrows the transcript and keeps the rows. A resize
  of the terminal usually changes the rows, and the next render then starts the widest again.
  So the `call` tab joins the dock as a tab, and after a resize the press takes the `/simple open` line.
  It fails in one case: a terminal made narrower from the side only, with the rows unchanged,
  counts as docked, so the press opens one inline pane above the prompt once. From then on the
  tab is open, and the next press uses it.
- The shape of the error text that `tool.call` answers for a failed call inside a REPL script is
  not measured. The mod reads it with or without `Error:` and with or without the
  `<tool_use_error>` tags.

- `/simple` does not change the mode of `quiet-items`. Claude Code refuses a write to the state
  of another plugin: `handily-quiet-items owns that value and only its owner writes it`. Use
  `/quiet-items` to switch the tracker rows.
- The running time is updated once per second while the call runs.
- `/simple show N` does not keep a call that a plugin above simple-view answers itself, such as
  a `handily-board` task tool. In a live check with Claude Code 2.1.300, `handily-board` stood
  above simple-view, so its task calls were not kept.
- `/simple show N` prints `File diff: not reported by the engine.` for a call of a tool other
  than `Bash`, `Edit`, `Write`, `Read`, `Grep` and `Glob`. The mod reads a file diff only from
  those 6 tools, and another tool can still change a file.
