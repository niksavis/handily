- **The `workitems` mod reads basicly and any tracker CLI that serves adapter contract 1.** It
  runs `basicly tracker list` from `PATH` for the open, in-progress and blocked records, and
  skips a tombstoned record. A `command` in `.handily.json` names a tracker CLI that prints
  `describe --json` and `items --json`. The mod refuses a contract other than 1 by name. It
  runs a repo command, such as the repo's own basicly kit or an adapter, only after the person
  approves it in an interactive session. The approval is asked again when the command, a repo
  file that it names or the program path changes. Output that was cut off, or a non-zero exit,
  makes the read fail with the command name. A session on the desktop app shows the state
  `terminal-only` for a CLI source (handily-fwkt.2.3).
