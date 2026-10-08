- **simple-view unfolds a folded tool group that holds a failed call.** In the normal view
  Claude Code folds a run of read-only calls into one line, such as
  `Listed 1 directory, ran 1 shell command`, and that line hid a failed `ls`. While the
  simple-view mode is on, a folded group with a failed call that no longer runs now draws
  each call as its own row. Other groups stay folded (handily-azz23).
