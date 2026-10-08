# workitems

`workitems` is a provider mod. It reads the work items of the tracker at the session root and
gives other mods one typed list. It draws nothing of its own.

## What it reads

| Tracker               | Detected by                                        | Read path                                             |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| basicly               | `.basicly/ledger/template.json`                    | `basicly tracker list --status <s>`, after approval   |
| beads (`bd`, `br`)    | `.beads/issues.jsonl`                              | Built-in JSON Lines reader                            |
| beans                 | `.beans.yml` or `.beans/`                          | Built-in front matter reader                          |
| Any other (`files`)   | `globs` in `.handily.json`                         | Generic JSON, JSON Lines or front matter reader       |
| Any other (`adapter`) | an entry in your `~/.config/handily/adapters.json` | `<command> describe --json`, `<command> items --json` |

- The mod looks only at the session root (`$.session.root()`). It never reads a parent folder.
- It detects the tracker again when the working directory changes.
- It reads one source per repo: the first one in the table that it finds, or the one that
  `.handily.json` names. The snapshot lists each other source that it finds under `ignored`.
- A tracker file over 4 MiB, or a malformed line, makes the read fail. The reason names the file.
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

- The mod runs `basicly tracker list --status <s>` from `PATH` at the repo root, once for each
  of `open`, `in_progress` and `blocked`. This command loads the repo's kit code, so it runs only
  after you approve it (see [Approval](#approval)).
- It maps `record` to `id`, and reads `fields.title`, `status`, `fields.priority`,
  `fields.issue_type`, `fields.assignee` and `dates.updated`. It skips a tombstoned record.
- When `basicly` is not on `PATH`, the read fails with "basicly is not on PATH. Install it to
  read this tracker." The mod never runs the repo's own `.basicly/core/kit/tracker/cli.py`.
- The poll reads again when a file in `.basicly/ledger` or any file under the kit folder changes.
- `basicly` runs with `PYTHONDONTWRITEBYTECODE=1` and `PYTHONPYCACHEPREFIX` set to a new folder.
  The new folder does not exist, so Python never runs a cached `.pyc` file from the repo.
- The mod runs the program path that the approval recorded, and checks the approval again
  before each of the three list runs.
- The mod reads only the open statuses. So when a record leaves them, for example when it is
  closed or deferred, `refresh()` reports it under `closed`, with the status `closed` and the
  last raw status that the mod read.

### beads

- The beads reader skips a line whose `_type` is not `issue`, and a `tombstone` line.
- When `.beads/metadata.json` names the `dolt` backend, the data comes from `bd`. Then each
  item carries the label `possibly stale`, because `bd` keeps its data in Dolt.

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

`basicly tracker list` loads the repo's kit code, so it runs only after you approve it. The CLI
adapter needs no approval, because you typed its command yourself.

- In an interactive session the mod asks once, in the engine's question dialog, with the
  options `Allow for this repo` and `Not now`.
- `Allow for this repo` is kept in `$.store` under a key of the repo root, the command, the
  real path of `basicly`, and the sha256 of every file under `.basicly/core/kit/tracker/`, in
  every subfolder and with every suffix. A link in that folder makes the read fail, because the
  key cannot cover what it leads to.
- The mod cannot hash a file over 4 MiB, so such a kit file makes the read fail, and the
  reason names it. A kit file whose name holds a control character or is over 256 characters
  also makes the read fail, and the reason does not repeat the name.
- When one of these changes, the old approval does not match, and the mod asks again.
- The question shows each argument in double quotes, with the real path of the program, and
  names the kit folder.
- The mod refuses a `basicly` whose real path is inside the repo root, or whose real path the
  engine does not give. Program lookup skips a relative or empty `PATH` entry, such as `.`.
- On Windows the mod compares a path with a drive-letter repo root (such as `C:\repo`)
  without regard to case. A UNC root (such as `\\server\share`) is still compared with case.
- After `Not now`, or when you close the dialog, the state is `approval-needed`. The mod asks
  again at the next session start.
- The mod never asks in a session that is not interactive, such as `claude -p`. The state is
  then `approval-needed`.
- A session that draws only on the desktop app cannot run a command. A CLI source then has the
  state `terminal-only`.

## The contract

The contract is `types/index.d.ts`. A dependent mod lists `workitems` under `dependencies` in
its `plugin.json`, and the engine lays the contract into that mod's types folder.

| Part                                                    | Use                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `$.state.get({ plugin: 'workitems', key: 'snapshot' })` | The last snapshot. A render that reads it draws again on a change            |
| `$.workitems.refresh({ since })`                        | Reads again. Returns the created, updated and closed items and the `version` |
| `$.workitems.lines({ snapshot, now })`                  | The state lines of `docs/mocks.md` section 0, with their tone                |
| `$.workitems.writeVerbs()`                              | The write verbs of each tracker CLI that the mod knows                       |

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
