- **The this machine tab shows each session's item, step and last result.** Each session card
  adds its record id in the code colour and its last result, `✓` for a pass or `■` for a
  failure, with its age, read from the `item` and `last` fields that `orch state set` writes.
  Without an `item` the card takes the first record id in the session's now text. Sessions dead
  for 2 hours or more fold into one line at the end, so the live ones stay on top.
  (handily-1smtn2)
