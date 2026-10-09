- **A basicly tracker no longer starts up to six basicly processes on each read.** workitems
  ran `basicly tracker list` once for each open status, and checked the approval before each
  run. Each check could run `basicly --version`. On Windows one read then took longer than the
  hook limit of 10 seconds. workitems now runs one `basicly tracker items --json` call for every
  open status, checks the approval once per read, and keeps the verdict of `basicly --version`
  in memory. A change of a kit file, of the program path or a reinstall of basicly runs the
  version check again, so a basicly below 0.21.1 still asks for approval again. The approved
  command changed, so workitems asks you once again to allow basicly. A basicly without
  `tracker items` fails the read by name (handily-8mjdz).
