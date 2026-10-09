- **handily-simple-view 0.4.1 draws its own row while the input of a call streams, so the raw
  engine row no longer shows first.** Before a `Bash`, `Read`, `Grep` or `Glob` call runs, its
  row shows the bullet, the tool name or the description when it arrives, the parts of the input
  that are readable, and a dim `…`. The full row follows as soon as the call ends. A running
  `Read`, `Grep` or `Glob` call also shows this row. A tool group that holds only calls of these
  tools unfolds as soon as the tool names are known, so the `Running 1 shell command…` line no
  longer shows. Another tool, an errored call, an interrupted call and an input field of the
  wrong type still draw as the engine draws them (handily-vt4ku).
