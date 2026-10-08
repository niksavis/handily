- **workitems reads tracker commands and tracker files for other mods.** The noun has two new
  methods. `$.workitems.classify(command)` reads a shell command and returns `write`, `echoed`,
  `opaque` or `none` with the tracker writes that it found. `$.workitems.trackerFile({ path,
  root })` returns the tracker file that a path names. quiet-items and item-toasts now call
  these methods and keep no copy of the parser, so both mods count the same calls. A
  quiet-items or item-toasts version with this change needs a workitems version with this
  change, because an older workitems has no `classify` (handily-w56f).
