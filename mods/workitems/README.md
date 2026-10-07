# workitems

`workitems` is a provider mod. It reads the work items of the tracker at the session root and
gives other mods one typed list. It draws nothing of its own.

## What it reads

| Tracker            | Detected by           | Read path                  |
| ------------------ | --------------------- | -------------------------- |
| beads (`bd`, `br`) | `.beads/issues.jsonl` | Built-in JSON Lines reader |

- The mod looks only at the session root (`$.session.root()`). It never reads a parent folder.
- It detects the tracker again when the working directory changes.
- The beads reader skips a line whose `_type` is not `issue`, and a `tombstone` line.
- When `.beads/metadata.json` names the `dolt` backend, the data comes from `bd`. Then each
  item carries the label `possibly stale`, because `bd` keeps its data in Dolt.
- A tracker file over 4 MiB, or a malformed line, makes the read fail. The reason names the file.

## The contract

The contract is `types/index.d.ts`. A dependent mod lists `workitems` under `dependencies` in
its `plugin.json`, and the engine lays the contract into that mod's types folder.

| Part                                                    | Use                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `$.state.get({ plugin: 'workitems', key: 'snapshot' })` | The last snapshot. A render that reads it draws again on a change |
| `$.workitems.refresh({ since })`                        | Reads again and returns the created, updated and closed items     |
| `$.workitems.lines({ snapshot, now })`                  | The state lines of `docs/mocks.md` section 0, with their tone     |
| `$.workitems.writeVerbs()`                              | The write verbs of each tracker CLI                               |

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
- To see what one tool call changed, read `version` before the call. Then call
  `refresh({ since: version })` after it. A poll that reads the change first does not hide it.
- The mod keeps the diffs of the last 50 versions. A `since` older than these, or newer than
  the current version, makes `refresh` reject with a reason.
- When the same item changes in more than one version, `created` wins over `closed`, and
  `closed` wins over `updated`. The item is the latest one.
- One read runs at a time. A call that arrives while a read runs waits for one more read after
  it. All the calls that arrive during the same read share that next read.
- The mod polls the tracker file with `$.clock.every` every 2 s. It reads the file again only
  when the file's modification time or size changed.
- The poll starts before the first refresh at session start, so a failed first refresh does
  not stop it.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/workitems
```

A dependent mod loads only together with `workitems`, so load the `mods` folder.
