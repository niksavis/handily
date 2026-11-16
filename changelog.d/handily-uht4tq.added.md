- **The board marks a session that waits on background work.** When a turn ends while a
  background shell, a monitor, a background subagent or a scheduled wakeup still runs, the board
  shows `◷ waiting 3m` with the oldest item, such as `shell Watch the CI run`, on the band, on
  the status line, in the Session head and on the this machine card. The next turn start clears
  it, and a turn you interrupt with Esc keeps it. A Stop with both lists empty and a new session
  show `○ idle`; after `/clear`, a resume or a Stop without the lists, the board shows
  `○ no turn` until the next Stop, never idle. After 30 minutes with no turn the age reads
  `40m?` with `not seen since 40m`. The glyph sets of every mod gain the role `waiting`: `◷` plain
  and nf-cod-watch in the nerd set, and `/handily glyphs` lists it. (handily-uht4tq)
