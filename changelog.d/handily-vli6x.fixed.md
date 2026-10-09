- **workitems reads a beads tracker file over 4 MiB.** The engine reads no file over 4 MiB, so
  a long-lived beads project showed "Work items unavailable". When `.beads/issues.jsonl` is over
  4 MiB, workitems now lists the open items through `br list --json --limit 0`, after you approve
  the run once for the repo. A missing `br`, a cut output, a non-zero exit, output that is not
  JSON or a list that says it is incomplete fails with the cause and the fix, and shows no item.
  A file of 4 MiB or less is read directly as before. A `bd` tracker on Dolt over 4 MiB fails by
  name (handily-vli6x).
