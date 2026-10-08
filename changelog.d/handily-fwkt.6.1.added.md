- **The `item-toasts` mod shows a toast when a work item changes outside this session.** It
  reads the `workitems` refresh diffs and drops the change of each `Bash`, `Write` or `Edit`
  call of this session. It shows at most one toast every 30 s and merges the changes that wait
  into one toast. It toasts once when the work items turn unavailable and once when they come
  back (handily-fwkt.6.1).
