# quiet-items

`quiet-items` draws one short row in place of each tracker write in the transcript. The model
still reads the full tool result. Only the screen changes.

```text
● work item created    handily-ab12  Draw text mocks for the mods                                  open         P2
● !raw tracker edit!   .beads/issues.jsonl  ~Edit, not through the tracker CLI~
```

The approved mocks are in `docs/mocks.md`, section 1.

## What it matches

| Tool            | Match                                                                                                                                                                  | Row                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `Bash`          | A tracker CLI write: `br`, `bd`, `basicly tracker`, `.basicly/core/kit/tracker/cli.py`                                                                                 | One row per item of the refresh diff |
| `Write`, `Edit` | A tracker file at the `workitems` root: `.beads/issues.jsonl`, `.basicly/ledger/` (`pending-*.jsonl`, `events-*.jsonl`, `snapshot.jsonl`), `.beans/**/<id>--<slug>.md` | One `raw tracker edit` row           |

- The write verbs come from `$.workitems.writeVerbs()`. `bd` uses the verbs of `br`.
- `basicly tracker write -- <verb>` uses the verbs of `.basicly/core/kit/tracker/cli.py`.
- The parser splits a command on `&&`, `;`, a newline, `|` and `||`. It strips the wrapper
  `uv run` and the flags of `python3`. It skips the global options of the tracker CLI.
- A command with `--help`, `-h` or `--dry-run` is not a write.
- The shell reads everything after a `#` at the start of a word as a comment, and so does the
  parser.

## Which commands go quiet

The mod goes quiet only when it can see every effect of the command and its exit status. In
every other case the engine draws its full row.

| Command                                                | Row                                              | Why                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `br close a`                                           | Quiet                                            | One tracker write                                                                                                                                                               |
| `cd x && br close a && br update b --status open`      | Quiet                                            | `&&` stops at the first failure, so the exit status shows it                                                                                                                    |
| `br close a && echo ok`                                | Quiet                                            | The same as above                                                                                                                                                               |
| `br close a; echo "exit=$?"`                           | Quiet only when the last output line is `exit=0` | The echo prints the exit status of the tracker command                                                                                                                          |
| `br close a; echo ok`                                  | Engine                                           | The echo hides the exit status of the tracker command                                                                                                                           |
| `br close a; br close b`, `br close a \|\| br close b` | Engine                                           | The second write hides the exit status of the first                                                                                                                             |
| `br close a; git log`, `br close a \| tail -1`         | Engine                                           | A segment that is not a tracker write can hide a failure                                                                                                                        |
| `br update a --title "$(id)"`, a backtick, `<(…)`      | Engine                                           | The shell runs other code. Inside single quotes the shell does not expand it, so the write stays quiet                                                                          |
| `br close a > out.txt`, `2>&1`, `< in.txt`             | Engine                                           | A redirection, also to `/dev/null`, changes where the input or the output goes                                                                                                  |
| `FOO=1 br close a`, `uv run --env-file f br close a`   | Engine                                           | An env assignment, such as `PATH`, can change the program that runs                                                                                                             |
| `uvx br close a`, `npx br close a`                     | Engine                                           | The wrapper fetches a package from a registry                                                                                                                                   |
| `uv run --with x br close a`                           | Engine                                           | The flag chooses where the code comes from. The same applies to `--from`, `-w`, `--with-editable`, `--with-requirements`, `--package`, `--index`, `--directory` and `--project` |
| A loop or a heredoc                                    | Engine                                           | The parser cannot see each write                                                                                                                                                |

A trailing echo goes quiet only when it comes after `;`, a newline or `&&`, and it holds only
literal words and `$?`. Another `$`, a glob character or a leading `-` keeps the engine row.

## How it finds the items

1. Before the call runs, the mod calls `$.workitems.refresh()` and keeps the `version` it
   reached. A change from before the call is then inside that version.
2. After the call succeeds, it calls `$.workitems.refresh({ since: version })`.
3. It keeps the rows of the diff in `$.state`, under the `tool_use_id` of the call.
4. The `ToolUse` row draws the rows. The `ToolResult` block under it draws empty.
5. When the engine folds the call into a `ToolGroup` line (`Ran 1 shell command`), the mod
   unfolds that group, so the row shows.

The verb of a row is `created`, `updated`, `closed` or `commented`. `commented` replaces
`updated` when every matched write is a comment verb.

## When it draws the engine row

The engine draws its own row (`next(e)`) in each of these cases:

- The call is still running, errored or was interrupted, or the command wrote to stderr.
- The command draws the engine row in the table of the section above, or no write matched.
- The last output line of a status echo does not show the exit status 0.
- The `workitems` state is not `ok`.
- The refresh diff is empty, or a refresh rejected.
- The mode is `off`.

## Settings and the command

| Setting       | Default | Use                                                 |
| ------------- | ------- | --------------------------------------------------- |
| `mode`        | `on`    | The mode when a session starts: `on` or `off`       |
| `titleLength` | `60`    | The number of title characters before the cut (`…`) |

`/quiet-items` toggles the mode for this session only. It keeps the mode in `$.state`, so a
change does not reach other sessions. It takes no argument.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/quiet-items
```

`quiet-items` depends on `workitems`, so load the `mods` folder. The tests load a fake
`workitems` provider, because `claude plugin test` loads only the mod under test.
