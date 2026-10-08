- **The `workitems` mod reads basicly and any tracker CLI that serves adapter contract 1.** It
  runs `basicly tracker list` from `PATH` for the open, in-progress and blocked records, and
  skips a tombstoned record. When a record leaves these statuses, `refresh()` reports it as
  closed. Each basicly read needs the approval of the person in an interactive session, keyed on
  the program path and every file of the repo's basicly kit. Without `basicly` on `PATH`, the
  read fails by name. A tracker CLI runs only from the person's own
  `~/.config/handily/adapters.json`, keyed on the real path of the repo root. A repo
  `.handily.json` that names a command runs nothing and shows the line to copy. The mod refuses
  a contract other than the number 1, and names the value that it got. The adapter write verbs
  are in the snapshot as `adapterWrites`. Output that was cut off, or a non-zero exit, makes the
  read fail with the command name. A session on the desktop app shows the state `terminal-only`
  for a CLI source. Each reader refuses an item whose id, title or status holds a control
  character or is too long, and every read of a tracker file stays inside the repo root
  (handily-fwkt.2.3).
