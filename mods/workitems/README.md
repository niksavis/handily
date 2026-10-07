# workitems

`workitems` is a provider mod. It reads the work items of the tracker at the session root and
gives other mods one typed list. It draws nothing of its own.

## What it reads

| Tracker             | Detected by                | Read path                                       |
| ------------------- | -------------------------- | ----------------------------------------------- |
| beads (`bd`, `br`)  | `.beads/issues.jsonl`      | Built-in JSON Lines reader                      |
| beans               | `.beans.yml` or `.beans/`  | Built-in front matter reader                    |
| Any other (`files`) | `globs` in `.handily.json` | Generic JSON, JSON Lines or front matter reader |

- The mod looks only at the session root (`$.session.root()`). It never reads a parent folder.
- It detects the tracker again when the working directory changes.
- It reads one source per repo: the first one in the table that it finds, or the one that
  `.handily.json` names. The snapshot lists each other source that it finds under `ignored`.
- A tracker file over 4 MiB, or a malformed line, makes the read fail. The reason names the file.
- A front matter file holds one item. When the mod cannot read one such file, it skips only
  that item. The snapshot `caveat` then counts the skipped files and names the first, for
  example `1 item file skipped: .beans/app-a1--x.md line 4 is malformed.`
- The front matter reader reads plain, quoted and block (`|`, `>`) scalars, lists in the
  `[a, b]` form, and lists of `- item` lines at any indent. It ignores a trailing `# comment`.
  A field in another form, such as a nested map, is unreadable. The mod skips the item only
  when the reader needs that field.

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
| `source` | Optional. `beads`, `beans` or `files`. The mod reads this source and ignores the others     |
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

## The contract

The contract is `types/index.d.ts`. A dependent mod lists `workitems` under `dependencies` in
its `plugin.json`, and the engine lays the contract into that mod's types folder.

| Part                                                    | Use                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `$.state.get({ plugin: 'workitems', key: 'snapshot' })` | The last snapshot. A render that reads it draws again on a change            |
| `$.workitems.refresh({ since })`                        | Reads again. Returns the created, updated and closed items and the `version` |
| `$.workitems.lines({ snapshot, now })`                  | The state lines of `docs/mocks.md` section 0, with their tone                |
| `$.workitems.writeVerbs()`                              | The write verbs of each tracker CLI                                          |

The snapshot `state` is one of `ok`, `failed`, `approval-needed`, `stale`, `no-tracker` and
`terminal-only`. This version produces `ok`, `failed` and `no-tracker`.

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
