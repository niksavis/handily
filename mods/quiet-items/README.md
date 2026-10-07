# quiet-items

`quiet-items` draws one short row in place of each tracker write in the transcript. The model
still reads the full tool result. Only the screen changes.

```text
● work item created    handily-ab12  Draw text mocks for the mods                                  open         P2
● !raw tracker edit!   .beads/issues.jsonl  ~Edit, not through the tracker CLI~
```

The approved mocks are in `docs/mocks.md`, section 1.

## What it matches

| Tool            | Match                                                                                  | Row                                  |
| --------------- | -------------------------------------------------------------------------------------- | ------------------------------------ |
| `Bash`          | A tracker CLI write: `br`, `bd`, `basicly tracker`, `.basicly/core/kit/tracker/cli.py` | One row per item of the refresh diff |
| `Write`, `Edit` | A file under `.beads/` (`.jsonl`), `.basicly/ledger/` (`.jsonl`) or `.beans/` (`.md`)  | One `raw tracker edit` row           |

- The write verbs come from `$.workitems.writeVerbs()`. `bd` uses the verbs of `br`.
- `basicly tracker write -- <verb>` uses the verbs of `.basicly/core/kit/tracker/cli.py`.
- The parser splits a command on `&&`, `;`, `|` and `||`. It strips environment assignments,
  the wrappers `uv run`, `uvx` and `npx`, and the flags of `python3`. It skips the global
  options of the tracker CLI.
- A command with `--help`, `-h` or `--dry-run` is not a write.

## How it finds the items

1. Before the call runs, the mod reads `version` from the `workitems` snapshot.
2. After the call succeeds, it calls `$.workitems.refresh({ since: version })`.
3. It keeps the rows of the diff in `$.state`, under the `tool_use_id` of the call.
4. The `ToolUse` row draws the rows. The `ToolResult` block under it draws empty.

The verb of a row is `created`, `updated`, `closed` or `commented`. `commented` replaces
`updated` when every matched write is a comment verb.

## When it draws the engine row

The engine draws its own row (`next(e)`) in each of these cases:

- The call is still running, errored or was interrupted.
- The command is a loop or a heredoc, or no write matched.
- The `workitems` state is not `ok`.
- The refresh diff is empty, or the refresh rejected.
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
