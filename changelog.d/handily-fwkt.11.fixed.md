- **handily-item-toasts 0.4.1 shows no error after `/reload-plugins`.** A reload
  restarts the version of `handily-workitems` at 0. Before this fix, item-toasts
  then asked for changes since a newer version and logged
  `HooksError: workitems refresh: since 64 is newer than the current version 1`
  once. Now item-toasts takes the restarted snapshot as its new baseline, with no
  error and no toast, and toasts the next change against it (handily-fwkt.11).
