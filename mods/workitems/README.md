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
| `$.workitems.refresh()`                                 | Reads again and returns the created, updated and closed items     |
| `$.workitems.lines({ snapshot, now })`                  | The state lines of `docs/mocks.md` section 0, with their tone     |
| `$.workitems.writeVerbs()`                              | The write verbs of each tracker CLI                               |

The snapshot `state` is one of `ok`, `failed`, `approval-needed`, `stale`, `no-tracker` and
`terminal-only`. This version produces `ok`, `failed` and `no-tracker`.

## Refresh

- A refresh is single-flight. A second call while one runs gets the same result.
- The mod polls the tracker file with `$.clock.every` every 2 s. It reads the file again only
  when the file's modification time or size changed.

## Develop

```sh
claude --plugin-dir mods
claude plugin test mods/workitems
```

A dependent mod loads only together with `workitems`, so load the `mods` folder.
