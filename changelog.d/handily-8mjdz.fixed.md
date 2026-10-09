- **A basicly tracker no longer starts up to six basicly processes on each read.** workitems
  checked the approval before each of the three list runs, and each check could run
  `basicly --version`. On Windows one read then took longer than the hook limit of 10 seconds.
  workitems now checks the approval once per read and keeps the verdict of `basicly --version`
  in memory. A change of a kit file, of the program path or a reinstall of basicly runs the
  version check again, so a basicly below 0.21.1 still asks for approval again. Each open
  status is still read in its own call (handily-8mjdz).
