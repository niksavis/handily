- **The board, the toasts and quiet-items list the work items of a basicly vault again.** Since
  basicly moved a ledger to a vault, `.basicly/ledger` is a file and not a folder, so handily
  found no tracker and showed `No tracker found at the repo root`. handily-workitems now reads
  such a repository through `basicly tracker items`, as before, and reads it again once in each 30
  seconds, because a vault change touches no file in the repository. (handily-ib002t)
