# workitems

`workitems` is a provider mod. It reads the work items of the tracker at the session root and
gives other mods one typed list. It draws nothing of its own.

## What it reads

| Tracker               | Detected by                                        | Read path                                             |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| basicly               | `.basicly/ledger/template.json`                    | `basicly tracker items --json`, after approval        |
| beads (`bd`, `br`)    | `.beads/issues.jsonl`                              | Built-in JSON Lines reader, or `br list` over 4 MiB   |
| beans                 | `.beans.yml` or `.beans/`                          | Built-in front matter reader                          |
| Any other (`files`)   | `globs` in `.handily.json`                         | Generic JSON, JSON Lines or front matter reader       |
| Any other (`adapter`) | an entry in your `~/.config/handily/adapters.json` | `<command> describe --json`, `<command> items --json` |

- The mod looks only at the session root (`$.session.root()`). It never reads a parent folder.
- It detects the tracker again when the working directory changes.
- It reads one source per repo: the first one in the table that it finds, or the one that
  `.handily.json` names. The snapshot lists each other source that it finds under `ignored`.
- A tracker file over 4 MiB, or a malformed line, makes the read fail. The reason names the file.
  `.beads/issues.jsonl` is the one exception to the size rule (see [beads](#beads)).
- Each read of a tracker file stays inside the repo root. A file that resolves outside the root,
  for example through a link, makes the read fail. The reason names the file.
- Each reader checks the `id`, the `title` and the raw status of each item. A control character,
  a line break or a text direction control in one of them, or a text that is too long, makes
  the item unreadable. The limits are 200 characters for the `id`, 500 for the `title` and 100
  for the status. The reason names the file and the field.
- A front matter file holds one item. When the mod cannot read one such file, it skips only
  that item. The snapshot `caveat` then counts the skipped files and names the first, for
  example `1 item file skipped: .beans/app-a1--x.md line 4 is malformed.`
- The front matter reader reads plain, quoted and block (`|`, `>`) scalars, lists in the
  `[a, b]` form, and lists of `- item` lines at any indent. It ignores a trailing `# comment`.
  A field in another form, such as a nested map, is unreadable. The mod skips the item only
  when the reader needs that field.

### basicly

- The mod runs this command from `PATH` at the repo root:
  `basicly tracker items --json --status open --status in_progress --status blocked`. One call
  reads every open status. It runs only after you approve it (see [Approval](#approval)).
- A basicly without `tracker items` exits with an error, and the read fails with the command
  and the exit code. basicly 0.21.5 has the command.
- basicly 0.21.1 or later runs only the installed package for this command. An older basicly
  also runs the repo code in `.basicly/core/kit/tracker`.
- It reads `id`, `title`, `rawStatus`, `priority`, `type`, `assignee` and `updatedAt` of each
  item. basicly leaves out a tombstoned record. A repeated id makes the read fail by name.
- When `basicly` is not on `PATH`, the read fails with "basicly is not on PATH. Install it to
  read this tracker." The mod never runs the repo's own `.basicly/core/kit/tracker/cli.py`.
- The poll reads again when a file in `.basicly/ledger` or any file under the kit folder changes.
- `basicly` and `basicly --version` run with `PYTHONDONTWRITEBYTECODE=1` and
  `PYTHONPYCACHEPREFIX` set to a new folder. The new folder does not exist, so Python never runs
  a cached `.pyc` file from the repo.
- The mod runs the program path that the approval recorded. It checks the approval once for
  each read, before the call.
- The mod reads only the open statuses. So when a record leaves them, for example when it is
  closed or deferred, `refresh()` reports it under `closed`, with the status `closed` and the
  last raw status that the mod read.

### beads

- The beads reader skips a line whose `_type` is not `issue`, and a `tombstone` line.
- When `.beads/metadata.json` names the `dolt` backend, the data comes from `bd`. Then each
  item carries the label `possibly stale`, because `bd` keeps its data in Dolt.

#### A tracker file over 4 MiB

The engine reads no file over 4 MiB. So the size of `.beads/issues.jsonl` chooses the read path:

| Size of `.beads/issues.jsonl` | Read path                                                                |
| ----------------------------- | ------------------------------------------------------------------------ |
| 4 MiB or less                 | The mod reads the file itself, as above                                  |
| Over 4 MiB                    | The mod runs `br list --json --limit 0`, after you approve it            |
| Over 4 MiB, on Dolt (`bd`)    | The read fails by name. The mod runs nothing, because `br` reads no Dolt |

- The mod runs `br` from `PATH` at the repo root. It runs nothing before you approve it (see
  [Approval](#approval)). The snapshot `sourceLabel` is `beads (br)`.
- `br list` with no status lists every item that is not closed and not a tombstone. In br 0.3.2
  that includes `deferred`, `draft`, `pinned` and a custom status. `--limit 0` asks for every
  such item.
- The mod reads only these open items. So when an item leaves the list, `refresh()` reports it
  under `closed`, with the status `closed` and the last raw status that the mod read.
- The mod reads `id`, `title`, `status`, `priority`, `issue_type`, `assignee`, `updated_at` and
  `labels`, with the same checks as a line of the file. `br list` gives no dependencies, so an
  item from it has no `parent`.
- The mod shows no item when the list can be incomplete. Each failure names the cause and the
  fix:

  | Cause                                                            | Reason                                                                  |
  | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | `br` is not on `PATH`                                            | `br is not on PATH. Install br to list the open items of ...`           |
  | The output was cut at 4 MiB                                      | `br list output was cut off. Close some open items, ...`                |
  | A non-zero exit                                                  | `br list exited N. Run it in a shell to see why.`                       |
  | `br list` did not start or did not end in time                   | `br list did not start or did not end in time ...`                      |
  | The output is not JSON, or has no `issues` list                  | `br list printed no valid JSON ...` or `... printed no issues list ...` |
  | `has_more` is not `false`, or `total` is not a number            | `br list did not say that it printed every item ...`                    |
  | `total` differs from the number of items                         | `br list printed N of M items ...`                                      |
  | An item is not an object, has an invalid field or an unsafe text | `br list item N ...`                                                    |

  A reason in the last five rows ends with the fix
  `Run "br list --json --limit 0" at the repo root to see why the list could not be read.`

- Until you approve the run, the state is `approval-needed`. On a surface that cannot run a
  command, the state is `terminal-only`.
- The poll reads again when the size or the modification time of the file changes, when the
  real path of `br` on `PATH` changes, for example when you install or move `br`, and after you
  approve `br list`.
- When the read changes between the file and `br`, `refresh()` compares the items without
  `parent`. So a child item that did not change is not reported as updated.
- When the file shrinks to 4 MiB or less, the mod reads the file itself again. A closed item
  that the `br` list did not hold is then not reported as created.

### beans

- Each `.md` file under the beans folder is one item. The id is the part of the file name
  before `--`, for example `app-ab12` in `app-ab12--add-the-export-button.md`. A name
  without `--` is the whole id, for example `app-ab12` in `app-ab12.md`.
- The beans folder is `.beans/`. The `path` key under `beans:` in `.beans.yml` moves it. The
  path `.` is the repo root. The reader skips a folder whose name starts with a dot, as beans
  does.
- A file under the `archive/` folder is closed, whatever its `status` says.
- beans has no assignee. The `tags` become the labels.

| beans `status`          | Item `status` |
| ----------------------- | ------------- |
| `todo`                  | `open`        |
| `in-progress`           | `in_progress` |
| `draft`                 | `other`       |
| `completed`, `scrapped` | `closed`      |

| beans `priority` | Item `priority` |
| ---------------- | --------------- |
| `critical`       | 0               |
| `high`           | 1               |
| `normal`         | 2               |
| `low`            | 3               |
| `deferred`       | 4               |

A priority word that is not in this table makes the read fail. The reason names the file and
the line.

## .handily.json

`.handily.json` at the repo root chooses the source, or describes the files of another tracker.

```json
{
  "source": "files",
  "globs": ["work/*.jsonl"],
  "format": "jsonl",
  "fields": { "id": "key", "title": "summary", "status": "state", "priority": "rank" }
}
```

| Key      | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| `source` | Optional. `basicly`, `beads`, `beans`, `files` or `adapter`. The mod reads this source      |
| `globs`  | The item files, relative to the repo root. `*` and `?` match in one folder, `**` in any     |
| `format` | `json` (one item or a list of items per file), `jsonl` (one item per line) or `frontmatter` |
| `fields` | The file field of each item field. `id`, `title` and `status` are required                  |

- The item fields are `id`, `title`, `status`, `priority`, `type`, `assignee`, `updatedAt`,
  `labels`, `parent` and `url`.
- A `status` value of `open`, `in_progress`, `blocked`, `deferred` or `closed` keeps its
  meaning. Any other value becomes `other`.
- The `priority` must be a whole number of 0 or more, as a number or as a string of digits.
  An empty string is no priority.
- The mod reads only the fields of the item itself, never a name that every object inherits,
  such as `constructor`.
- A wildcard does not match a name that starts with a dot, unless the glob part starts with a
  dot too.
- The mod resolves the real path of each folder that it lists and of each linked file. When
  one leads outside the repo root, the read fails, and the reason names the path and the glob.
- For a linked file, the poll checks the size and the modification time of the file that the
  link leads to.
- An unknown key, an unknown source, or a missing field makes the read fail. The reason names
  the fault.
- `.handily.json` holds data only. A `command` in it runs nothing. The read fails, and the reason
  names your file `~/.config/handily/adapters.json` and the repo root. It never repeats the
  repo's command (see [CLI adapter contract 1](#cli-adapter-contract-1)).
- A failure reason never shows a name or a value from the repo that holds a control character
  or is very long. Such a reason becomes a fixed text that names the source.

## CLI adapter contract 1

A tracker CLI that the mod does not know can serve its items through two commands. A repo never
names the command. You name it, once per repo, in your own file `~/.config/handily/adapters.json`.
Typing the line is your consent, so the mod runs the adapter with no approval question.

**What your entry allows.** Read this before you add a line:

- The entry approves the command, not one version of the code. A `git pull` that changes the
  script runs the new code at the next read, with no new question.
- The key is a path. A different clone that you later place at the same path inherits the entry.
- The check that the program is outside the repo covers only `argv[0]`. With the working folder
  at the repo root, `npx`, `python -m`, `uv run` and the `require` of `node` load code from the
  repo itself. So `["node", "tools/tracker.mjs"]` runs whatever that repo file holds.
- Add an entry only for a repo whose code you already trust to run on your machine.

Setup:

1. The repo can ship an adapter script and document the command for it. Read the script first.
2. Find the real path of the repo root, for example with `pwd -P` in the repo.
3. Add one entry to `~/.config/handily/adapters.json`. The key is that exact real path, and the
   value is the program and its arguments. This example runs a repo script, with the limits
   above:

   ```json
   { "/home/you/src/app": ["node", "tools/tracker.mjs"] }
   ```

- The mod finds your home folder through `HOME`, or `USERPROFILE` when `HOME` is not set.
- The key is the exact real path, with no patterns. A clone at another path does not match. A
  root that you open through a link resolves to the same key.
- The mod refuses a program whose real path is inside the repo root, for example
  `["tools/run"]`. Run a repo script through a program outside the repo, such as `node`.
- The mod refuses an argument with a control character or over 256 characters.
- The mod refuses an adapters file that is not a regular file.
- When no entry matches the repo, the no-tracker line names `~/.config/handily/adapters.json`
  as a place that the mod looked.
- When `.handily.json` names `"source": "adapter"` and your file has no entry for the repo, the
  read fails, and the reason names your file and the repo root.

- `<command> describe --json` prints one JSON object:

  ```json
  {
    "name": "tickets",
    "version": "1.4.0",
    "contract": 1,
    "watch": ["tickets/*.json"],
    "writes": [["close"], ["comments", "add"]],
    "statusMap": { "todo": "open", "doing": "in_progress", "done": "closed" }
  }
  ```

- `<command> items --json` prints a JSON array of items. Each item has `id`, `title` and
  `status`, and can have `priority`, `type`, `assignee`, `updatedAt`, `labels`, `parent` and
  `url`.
- The mod refuses a `contract` other than the number 1, and the reason names the value it got.
- `statusMap` maps the status of the tracker to `open`, `in_progress`, `blocked`, `deferred`,
  `closed` or `other`. A status that is not in the map keeps the rule of `.handily.json`.
- The item keys are `<name>:<id>`. The snapshot `sourceLabel` is the `name`.
- Each `writes` entry is the arguments after the command of one write. The mod adds them to
  the snapshot as `adapterWrites: { command, verbs }`, for example the command
  `node tools/tracker.mjs`.
- The poll reads again when a file under `watch` or your adapters file changes.
- The mod refuses a `name`, a `writes` entry, a `watch` glob or a `statusMap` key with a control
  character or over 256 characters, and more than 100 entries in one list. The reason does not
  repeat the value.
- A non-zero exit, output over 4 MiB or output that is not valid JSON makes the read fail. The
  reason names the command in double quotes.

## Approval

`basicly tracker items` and `br list` run only after you approve them. The mod runs no basicly
command before you approve the repo, not even `basicly --version`. The CLI adapter needs no
approval, because you typed its command yourself.

- In an interactive session the mod asks once, in the engine's question dialog, with the
  options `Not now` and `Allow for this repo`. `Not now` is the first option, so Enter
  answers `Not now`.
- `Allow for this repo` is kept in `$.store` under a key of the repo root, the command, the
  real path of `basicly`, and the sha256 of every file under `.basicly/core/kit/tracker/`, in
  every subfolder and with every suffix. A link in that folder makes the read fail, because the
  key cannot cover what it leads to.
- The mod cannot hash a file over 4 MiB, so such a kit file makes the read fail, and the
  reason names it. A kit file whose name holds a control character or is over 256 characters
  also makes the read fail, and the reason does not repeat the name.
- The mod also keeps the answer under a second key of the repo root, the command and the real
  path of `basicly`, with no kit files.
- When the kit files differ from the files that you approved, the mod runs `basicly --version`
  with the approved program path. The version decides if the approval covers the kit files:

  | `basicly --version` prints         | A kit change       |
  | ---------------------------------- | ------------------ |
  | `basicly X.Y.Z`, 0.21.1 or later   | does not ask again |
  | `basicly X.Y.Z`, below 0.21.1      | asks again         |
  | any other text, or a non-zero exit | asks again         |
  | nothing, because it did not start  | the read fails     |

  basicly 0.21.1 or later runs only the installed package, so the kit files do not change what
  it runs. An older basicly also runs the repo code in `.basicly/core/kit/tracker`.

- The mod keeps the last verdict of `basicly --version` in memory while Claude Code runs, never
  in `$.store` or `$.state`. The verdict is keyed on the repo root, the command, the real path
  of `basicly`, the size and modification time of the file at that path, and the sha256 of
  every kit file. A later read with the same key runs no `basicly --version`. A kit change, a
  different program path or a reinstall of `basicly` at the same path changes the key, so the
  mod runs `basicly --version` again, and a downgrade below 0.21.1 asks again. When the engine
  cannot give the size and the time of the program file, the mod keeps no verdict.

- When the command or the real path of `basicly` changes, the old approval does not match, and
  the mod asks again.
- An approval of `basicly tracker list` from an older workitems does not cover
  `basicly tracker items`. The approved command changed, so the mod asks you once again.
- The question shows each argument in double quotes, with the real path of the program. It says
  that basicly 0.21.1 or later runs only the installed package, and that an older basicly also
  runs the repo code in the kit folder.
- The mod refuses a `basicly` whose real path is inside the repo root, or whose real path the
  engine does not give. Program lookup skips a relative or empty `PATH` entry, such as `.`.
- On Windows the check that a program is outside the repo root ignores case, for a
  drive-letter root (such as `C:\repo`) and a UNC root (such as `\\server\share`). The check
  that a tracker file is inside the root compares with case, apart from the drive letter. A
  long-path prefix (`\\?\` or `\\?\UNC\`) names the same root as the path without it.
- Only the answer `Allow for this repo` stores an approval. After `Not now`, Enter, text typed
  under `Other`, or when you close the dialog, the mod stores nothing and the state is
  `approval-needed`. The mod asks again at the next session start.
- The mod never asks in a session that is not interactive, such as `claude -p`. The state is
  then `approval-needed`.
- A session that draws only on the desktop app cannot run a command. A CLI source then has the
  state `terminal-only`.

`br list --json --limit 0` follows the same rules as basicly above, with one difference in what
the approval covers:

- The key holds the repo root, the command and the real path of `br`. It holds no repo file
  and no hash of the `br` program.
- A new `br` at a new real path asks again. A new `br` at the same real path does not ask
  again, because the key holds the path, not the content of the program.
- These facts about `br list --json --limit 0` were checked on br 0.3.2 on 2026-10-09. The
  question names them in short:

  | Checked                         | Result                                                                                                                                                             |
  | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Files that it writes            | The git-ignored cache `.beads/beads.db` and `.beads/beads.base.jsonl`. It imports an edited `issues.jsonl` into the cache. It does not rewrite `issues.jsonl`      |
  | Programs that it starts by name | None of `git`, `sh`, `bash`, `python3`, `node`, `env`, `editor` and `vi`, each placed first on `PATH` as a spy. A control call proved that the spies record a call |
  | Programs that it starts by path | Not ruled out. No system call tracer was available                                                                                                                 |
  | `.beads/config.yaml`            | Holds the prefix, defaults and sync settings. `br config list` shows no key that names a command                                                                   |

- The key holds no repo file, so the mod never runs a version check of `br`.
- The mod refuses a `br` whose real path is inside the repo root.

## The contract

The contract is `types/index.d.ts`. A dependent mod lists `workitems` under `dependencies` in
its `plugin.json`, and the engine lays the contract into that mod's types folder.

| Part                                                    | Use                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `$.state.get({ plugin: 'workitems', key: 'snapshot' })` | The last snapshot. A render that reads it draws again on a change                              |
| `$.workitems.refresh({ since })`                        | Reads again. Returns the created, updated and closed items and the `version`                   |
| `$.workitems.lines({ snapshot, now })`                  | The state lines of `docs/mocks.md` section 0, with their tone                                  |
| `$.workitems.writeVerbs()`                              | The write verbs of each tracker CLI that the mod knows                                         |
| `$.workitems.classify(command)`                         | Reads a shell command: `write`, `echoed`, `opaque` or `none`, with the tracker writes it found |
| `$.workitems.trackerFile({ path, root })`               | The tracker file that `path` names, relative to `root`, or `null`                              |

The snapshot `state` is one of `ok`, `failed`, `approval-needed`, `stale`, `no-tracker` and
`terminal-only`. This version produces each of them except `stale`.

Each snapshot also carries these fields:

| Field       | Meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `version`   | A number that rises by 1 each time the data changes                    |
| `at`        | The time of the read that gave this data                               |
| `checkedAt` | The time of the last check of the tracker file. The header age uses it |

## Refresh

- `refresh({ since })` returns the changes since the snapshot `version` that you give. Without
  `since`, it returns the changes since the version at the time of the call.
- The result also holds `version`, the snapshot version that the refresh reached. The changes
  are those from `since` to this `version`.
- To see what one tool call changed, run `const { version } = await $.workitems.refresh()`
  before the call. Then call `refresh({ since: version })` after it. A poll that reads the
  change first does not hide it.
- The mod keeps the diffs of the last 50 versions. A `since` older than these, or newer than
  the current version, makes `refresh` reject with a reason.
- When the same item changes in more than one version, `created` wins over `closed`, and
  `closed` wins over `updated`. The item is the latest one.
- One read runs at a time. A call that arrives while a read runs waits for one more read after
  it. All the calls that arrive during the same read share that next read.
- The mod polls the tracker files with `$.clock.every` every 2 s. It reads them again only
  when the modification time or the size of a tracker file changed, or when the list of
  ignored sources changed. For beans and `files`, it lists the item files at each poll to see
  this. It reads `.handily.json` once per poll.
- The poll starts before the first refresh at session start, so a failed first refresh does
  not stop it.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/workitems
```

A dependent mod loads only together with `workitems`, so load the `mods` folder.
