# simple-view

`simple-view` draws one short row for each `Bash`, `Edit` and `Write` call in the transcript.
`/simple` switches it off and on for the session. `/simple show N` prints one call in full. The
model still reads the full tool result. Only the screen changes.

```text
● List the mods  ls  exit 0  7 lines  1.1s
● List a missing folder  ls  exit 2  ls: cannot access '/nonexistent-folder': No such file or directory  0.4s
● Append a probe line  printf  exit 0  0 lines  2.8s
  Updated README.md (+1 -0)
● Edit  src/app.ts  +2 -1
```

The approved mocks are in `docs/mocks.md`, section 6. The design is in `docs/design.md`,
section 4.8.

## Install

`simple-view` depends on `quiet-items`, and `quiet-items` depends on `workitems`. Install all
three:

```text
/plugin install workitems --marketplace niksavis/handily
/plugin install quiet-items --marketplace niksavis/handily
/plugin install simple-view --marketplace niksavis/handily
```

## Rows

| Call                  | Row                                                                  | Result block under it               |
| --------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| `Bash`, running       | description, program, `running`, time since the call started         | as the engine draws it              |
| `Bash`, no error      | description, program, `exit 0`, stdout line count, time              | one `Updated` line per changed file |
| `Bash`, `Exit code N` | description, program, `exit N`, the first non-empty error line, time | empty                               |
| `Edit`, `Write`       | tool, file path, added and removed line totals                       | empty                               |

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
  block says `File changes were not tracked for this call`.
- A missing `Updated` line proves that the call changed no file only when Bash edit tracking
  was on for that call. With tracking off, the engine sends no diff, also for a call that wrote
  a file. The block is then empty, and `/simple show N` prints
  `File diff: not reported by the engine.`
- The `bashEditDiffEnabled` setting turns Bash edit tracking on or off. The
  `CLAUDE_CODE_BASH_EDIT_DIFF` environment variable wins over the setting. Without either, the
  engine decides, and the mod cannot read that decision.
- A path inside the session root shows relative to the root. Another path shows in full.
- The time is measured by the mod clock around the call. It includes the time that a
  permission question waited for an answer.
- `Write` of a new file counts the lines of its content, blank lines at the end included, as
  its diff does. When the engine gives no diff for an
  update (for example, the old content was too large to diff), the row shows the path only,
  with no totals.

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
  did not change the file.
- Drawing the row failed. The mod writes the reason to the debug log.
- Any tool other than `Bash`, `Edit` and `Write`.

In the normal view the engine folds runs of read-only calls into one group line, such as
`Listed 2 directories, ran 2 shell commands`. simple-view leaves that line as the engine draws
it. The ctrl+o transcript unfolds the group, and each call there shows its simple-view row.

When a folded group holds a call that failed, simple-view unfolds the group while its mode is
on. Each call of the group then draws as its own row, so the failure is visible. A call that
still runs does not unfold the group. When `quiet-items` also unfolds the group, the result is
the same.

## Commands

| Command          | Effect                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `/simple`        | Turns the view off or on for this session, and replies with the new mode. It starts on   |
| `/simple show N` | Prints the input, the output and the file diff of the N-th last tool call. 1 is the last |

- `/simple show N` refuses a number outside the kept calls, and gives the valid range.
- ctrl+o cannot expand a single row. The engine reuses the drawn row and does not call the mod
  again. Use `/simple show N`.

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

## Known limits

- `/simple` does not change the mode of `quiet-items`. Claude Code refuses a write to the state
  of another plugin: `quiet-items owns that value and only its owner writes it`. Use
  `/quiet-items` to switch the tracker rows.
- The running time is updated once per second while the call runs.
