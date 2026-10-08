- **The `workitems` mod reads basicly and any tracker CLI that serves adapter contract 1.** It
  runs `basicly tracker list` for the open, in-progress and blocked records, and skips a
  tombstoned record. When a record leaves these statuses, `refresh()` reports it as closed. A
  `command` in `.handily.json` names a tracker CLI that prints `describe --json` and
  `items --json`. The mod refuses a contract other than the number 1, and names the contract
  that it got. The adapter write verbs are in the snapshot as `adapterWrites`. Each command that
  runs repo code needs the approval of the person in an interactive session. This covers
  `basicly` from `PATH`, the repo's own basicly kit and an adapter. The approval is asked again
  when the command, the program path or a covered repo file changes. For basicly, the covered
  files are every file under the kit folder. For an adapter, they are the files in the folder of each
  repo file that the command names. Output that was cut off, or a non-zero exit, makes the read
  fail with the command name. A session on the desktop app shows the state `terminal-only` for
  a CLI source. Each reader now refuses an item whose id, title or status holds a control
  character or is too long, and every read of a tracker file stays inside the repo root
  (handily-fwkt.2.3).
