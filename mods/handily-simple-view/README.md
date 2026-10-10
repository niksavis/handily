# simple-view

`simple-view` draws one short row for each `Bash`, `Edit`, `Write`, `Read`, `Grep` and `Glob`
call in the transcript.
A `Bash` row with output has a `more` button that opens the output under the row, and a `copy`
button that copies it. `/simple` switches the view off and on for the session. `/simple show N`
prints one call in full. The model still reads the full tool result. Only the screen changes.

```text
● List the mods  ls  exit 0  7 lines  1.1s                                  [ more ] [ copy ]
● List a folder that does not exist  ls  exit 2  ls: cannot access '/n…  [ more ] [ copy ]
● Append a probe line  printf  exit 0  0 lines  2.8s
  Updated README.md (+1 -0)
● Edit  src/app.ts  +2 -1
● Read  mods/handily/.claude-plugin/plugin.json  18 lines
● Read  docs/design.md  lines 160-239 of 674
```

The approved mocks are in `docs/mocks.md`, sections 6 and 7.2. The design is in
`docs/design.md`, section 4.8.

## Install

`handily-simple-view` depends on `handily-quiet-items`, and `handily-quiet-items` depends on
`handily-workitems`. Claude Code installs both with it:

```text
/plugin install handily-simple-view --marketplace niksavis/handily
```

## Rows

| Call                                           | Row                                                                        | Result block under it               |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| `Bash`, `Read`, `Grep`, `Glob`, before the run | description or tool, the parts of the input it can read, dim `…`           | as the engine draws it              |
| `Bash`, running                                | description, program, dim `running`, time since the call started           | as the engine draws it              |
| `Bash`, no error                               | description, program, `exit 0`, stdout line count, time                    | one `Updated` line per changed file |
| `Bash`, `Exit code N`                          | description, program, `exit N`, the first non-empty error line, time       | empty                               |
| `Edit`, `Write`                                | tool, file path, added and removed line totals                             | empty                               |
| `Read`                                         | tool, file path, line count, or the range of lines that the call read      | empty                               |
| `Grep`                                         | tool, pattern in quotes, `in` and the folder, the count of the output mode | empty                               |
| `Glob`                                         | tool, pattern, `in` and the folder, the count of matched files             | empty                               |
| `Read`, `Grep`, `Glob`, running                | tool, the path or the pattern from the input, dim `…`                      | as the engine draws it              |

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
- After `exit N`, the engine sends no diff, but the command can still have changed a file.
  `/simple show N` then prints `File diff: not reported by the engine.`
- `/simple show N` prints `File diff: none.` for a `Bash` call only when the engine tracked the
  call and listed no changed file.
- The `bashEditDiffEnabled` setting turns Bash edit tracking on or off. The
  `CLAUDE_CODE_BASH_EDIT_DIFF` environment variable wins over the setting. Without either, the
  engine decides, and the mod cannot read that decision.
- When an error line or a stderr line follows the description, the description keeps up to 40
  cells. The terminal cuts the error line or the stderr line first.
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

`more` opens the output under the row, at most 20 lines. Then `all 140 lines` opens every line,
and `less` on the row folds the output again:

```text
● Run the unit tests  npm  exit 0  140 lines  3.0s                          [ less ] [ copy ]
  line 1
  …
  line 20
  …
  [ all 140 lines ]
```

- `copy` copies the full output of the call: stdout, then stderr, exactly as the engine gave
  them. Trailing spaces and blank lines stay. After `exit N` it copies the error output under the
  `Error: Exit code N` line. A toast says how many lines it copied, or why the copy failed.
- When the engine saved a large output to a file, the row shows only the preview that the engine
  kept. `copy` reads the saved file and copies all of it.
- The opened lines are dim and never wrap: a long line is cut at the row end. `copy` keeps the
  whole line. Colour codes are dropped, a line that a carriage return overwrote shows its last
  part, a tab becomes spaces up to the next 8-cell stop, and other hidden characters show as
  escapes such as `\u200b`. A wide character or an emoji takes 2 cells, and a combining mark
  takes none.
- `all N lines` draws at most 60000 characters. Then a dim line says how many lines it did not
  draw, and `copy` still takes all of them.
- A running call has `more` only. It opens the full command under the row, one dim line for
  each command line. When the call ends, an opened row shows the output in place of the command.
- Each row opens and folds alone. A call with no output and an `Edit` or `Write` row have no
  buttons. An output of only spaces, tabs and blank lines counts as no output, so its row shows
  `0 lines` and has no buttons.

## When the engine row stays

simple-view draws the engine row unchanged in each of these cases:

- `/simple` turned the view off for this session.
- `quiet-items` stored a row for the call, and the `quiet-items` mode is on. The tracker row
  of `quiet-items` wins. While `/quiet-items` has turned its mode off, simple-view draws its own
  row for the call.
- The call was interrupted, refused or ran in the background.
- The call errored without the `Error: Exit code N` text, for example a timeout or a refusal at
  the permission question.
- The output or the input is not a shape that the mod reads, or a staged `Edit` or `Write` that
  did not change the file. A `Read` of an image, a PDF, a notebook or an unchanged file is not a
  shape that the mod reads.
- A `Read`, `Grep` or `Glob` call that errored.
- An input field of the wrong type, also while the input streams, such as a `command` that is
  not text.
- Drawing the row failed. The mod writes the reason to the debug log.
- Any tool other than `Bash`, `Edit`, `Write`, `Read`, `Grep` and `Glob`.

In the normal view the engine folds runs of read-only calls into one group line, such as
`Read 2 files, listed 1 directory, ran 1 shell command`. While its mode is on, simple-view
unfolds a group when each call of the group draws as one row: a `Bash` call in the foreground,
a `Read`, a `Grep` or a `Glob`. The calls of the group then draw as their rows in its place:

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
The running call draws as one row instead, and its `more` button opens the command. When no call
of the group runs, the group folds again to the line of the engine, unless a call of the group
failed.

## Commands

| Command          | Effect                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `/simple`        | Turns the view off or on for this session, and replies with the new mode. It starts on   |
| `/simple show N` | Prints the input, the output and the file diff of the N-th last tool call. 1 is the last |

- `/simple show N` refuses a number outside the kept calls, and gives the valid range.
- ctrl+o cannot expand a single row. The engine reuses the drawn row and does not call the mod
  again. Use `more` on the row, or `/simple show N`.

## Memory limit

`/simple show` keeps the last 50 tool calls of the main session in `$.state`. It cuts each part
of a call (the input, the output and the file diff) at 8000 characters, and says how many
characters it cut. Calls of subagents are not kept.

When a session ends for any reason (`/exit`, `/clear`, a resume or a finished run), the mod
resets the count of kept calls. The calls and the times of the ended session are no longer
reachable: `/simple show` refuses them, and an old row draws without its time. `$.state` has
no delete, so the mod writes each new call over a slot of the ended session. The 50 slots stay
the upper limit. One small time record (three numbers) stays for each `Bash` call of the
process.

A press on `more`, `all N lines` or `less` keeps one small value for that call in `$.state`, so
the row stays open or folded when it draws again.

## Known limits

- `/simple` does not change the mode of `quiet-items`. Claude Code refuses a write to the state
  of another plugin: `handily-quiet-items owns that value and only its owner writes it`. Use
  `/quiet-items` to switch the tracker rows.
- The running time is updated once per second while the call runs.
