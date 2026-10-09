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

- `$.workitems.classify(command)` reads a `Bash` command, and `$.workitems.trackerFile` names a
  tracker file. The rules are in the `workitems` mod, so `item-toasts` uses the same rules.
- The write verbs are those of `$.workitems.writeVerbs()`. `bd` uses the verbs of `br`.
- `basicly tracker write -- <verb>` uses the verbs of `.basicly/core/kit/tracker/cli.py`.
- A command with `--help`, `-h` or `--dry-run` is not a write.

## Which commands go quiet

The parser uses an allowlist. The mod goes quiet only when the command has one of the
allowed shapes. Every other command draws the engine row.

A command goes quiet only when all of these hold:

- Each segment starts with one of these programs:
  - `br`, `bd` or `basicly`;
  - `python3` or `python`, directly followed by `.basicly/core/kit/tracker/cli.py`;
  - `.basicly/core/kit/tracker/cli.py` alone.
- Each segment is a tracker write or `cd` with one word.
- No `cd` comes before a segment that runs the kit path. A `cd` before `br`, `bd` or
  `basicly` is allowed.
- Only `&&` joins two segments. A trailing status echo is the one exception (see below).
- The command has at most 8192 characters.
- Every word is one of these:
  - a bare word of the characters `A-Z a-z 0-9 . _ / : = @ , + % -`;
  - a single-quoted string;
  - a double-quoted string without `$`, a backtick or a backslash.

| Command                                                    | Row                                              | Why                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `br close a`, `br update a --title "Fix the parser"`       | Quiet                                            | An allowed shape                                                                   |
| `br update a --title '$(id)'`                              | Quiet                                            | The shell does not expand text in single quotes                                    |
| `cd x && br close a && br update b --status open`          | Quiet                                            | `&&` stops at the first failure, so the exit status shows it                       |
| `br close a && echo ok`                                    | Quiet                                            | The same as above                                                                  |
| `br close a; echo "exit=$?"`                               | Quiet only when the last output line is `exit=0` | The echo prints the exit status of the tracker command                             |
| `br close a; echo ok`                                      | Engine                                           | The echo hides the exit status of the tracker command                              |
| `br close a; br close b`, `br close a \|\| br close b`     | Engine                                           | The second write hides the exit status of the first                                |
| `br close a; git log`, `br close a \| tail -1`             | Engine                                           | A segment that is not a tracker write can hide a failure                           |
| `br update a --title "$(id)"`, `$'…'`, a backtick, `\`     | Engine                                           | The shell expands or runs it                                                       |
| `br close x-*`, `br close {a,b}`, `~/notes`, `$HOME`       | Engine                                           | The shell expands it                                                               |
| `br close a > out.txt`, `2>&1`, `< in.txt`, `<(…)`         | Engine                                           | A redirection, also to `/dev/null`, changes where the input or output goes         |
| `br close a & id`, `(br close a)`, `br close a # note`     | Engine                                           | The parser does not read a background job, a subshell or a comment                 |
| `FOO=1 br close a`, `env …`, `sudo …`                      | Engine                                           | Only a bare tracker program may start a segment                                    |
| `uvx br close a`, `npx br close a`                         | Engine                                           | The wrapper fetches a package from a registry                                      |
| `uv run python3 .basicly/core/kit/tracker/cli.py close a`  | Engine                                           | `uv run` syncs the project first, and a build backend in the tree can run any code |
| `python3 -I …`, `python3 -c…`                              | Engine                                           | No option of `python` may appear                                                   |
| `/tmp/br close a`, `./br close a`, an absolute kit path    | Engine                                           | Only a bare tracker name or the exact relative kit path is allowed                 |
| `cd x && python3 .basicly/core/kit/tracker/cli.py close a` | Engine                                           | After `cd`, the relative kit path names a script in another directory              |
| A command longer than 8192 characters                      | Engine                                           | The parser does not read it. It gives `opaque` when a tracker name appears         |

A trailing `echo` goes quiet only when it comes after `;`, a newline or `&&`. Its words must
pass the word rule, and `$?` is the one `$` that it may hold. A word that starts with `-`
keeps the engine row.

The parser gives one of three results:

- `write` or `echoed`: the command has an allowed shape.
- `opaque`: the command names `br`, `bd`, `basicly` or the kit path, but it is not an
  allowed shape. When the parser cannot read the command, any mention of these names counts.
- `none`: the command names no tracker program and no kit path, for example `npm test`.

The parser cannot see inside a script. `bash close.sh` gives `none`, even when the script
runs a tracker write.

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
- The command does not have an allowed shape (see the section above), or no write matched.
- The last output line of a status echo does not show the exit status 0.
- The `workitems` state is not `ok`.
- The refresh diff is empty, or a refresh rejected.
- The mode is `off`.
- The `simple-view` mode is `off`.

## Settings and the command

| Setting       | Default | Use                                                 |
| ------------- | ------- | --------------------------------------------------- |
| `mode`        | `on`    | The mode when a session starts: `on` or `off`       |
| `titleLength` | `60`    | The number of title characters before the cut (`…`) |

`/quiet-items` toggles the mode for this session only. It keeps the mode in `$.state`, so a
change does not reach other sessions. It takes no argument.

When the session starts and the `mode` key in `$.state` is unset, the mod writes the `mode`
setting to it. A mod that reads the key, such as `simple-view`, then sees the active mode. The
mod does not overwrite a mode that `/quiet-items` set before a reload of the plugin.

## Follow simple-view

`/simple` is one switch for the concise view. While the `simple-view` mode is `off`, this mod
draws every row as the engine draws it: the `ToolUse` row, the `ToolResult` block and a
folded `ToolGroup` line. While `simple-view` is not installed or its mode is not `off`, this
mod follows its own mode.

- The mod reads the `mode` key of `handily-simple-view` from `$.state`. It cannot set that key,
  because only its owner writes it.
- `handily-simple-view` lists `handily-quiet-items` under `dependencies`. This mod does not list
  `simple-view`, because the two lists would make a cycle. The mod types the key as `unknown`
  and checks the value when it reads it. Only the value `off` turns the rows off.
- `/quiet-items` still toggles its own mode. While `/simple` is off, `/quiet-items` on draws no
  quiet row until `/simple` is on again. Its reply says so:
  `quiet-items on for this session, but /simple is off, so tracker writes draw in full.`

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/handily-quiet-items
```

`quiet-items` depends on `workitems`, so load the `mods` folder. The tests load a fake
`workitems` provider, because `claude plugin test` loads only the mod under test.
