- **The board writes the usage snapshot and shows the plan on the pace line.** Each new reading
  of the 5 hour and the weekly limit goes into `handily-board.json` in the usage snapshot folder,
  in the format `basicly.usage-snapshot` version 1. The board merges the reading into its own
  file and writes the file in place. The folder is `BASICLY_USAGE_SNAPSHOT_DIR`, else
  `XDG_STATE_HOME/basicly/usage-snapshots`, else `~/.local/state/basicly/usage-snapshots`, and
  `LOCALAPPDATA/basicly/usage-snapshots` on Windows. The `pace` line of the Session details
  adds the projected percent of each limit at its reset and `plan start`, `plan hold` or
  `plan close idle`. The board needs no basicly. (handily-l97t2x)
