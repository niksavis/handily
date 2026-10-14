- **handily-workitems no longer publishes the whole snapshot at a poll that finds no change.**
  It publishes only the new small `checked` state value, with the snapshot `version` and the
  time of the check. `snapshot.checkedAt` is now the time of the check that made the snapshot,
  and `$.workitems.lines` takes the header age from the newer of the two. A poll also sends its
  checks at once. Measured in a live session on a 26 MB beads file with 5902 open items, an
  unchanged poll fell from 48-69 ms to 2-4 ms (handily-fwkt.2.5).
