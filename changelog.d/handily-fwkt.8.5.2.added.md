- **handily-item-toasts 0.5.0 adds `/item-toasts on` and `/item-toasts off`.** Off stores the
  mode in the mod's `mode` state key, and no work item change draws a toast until
  `/item-toasts on`. The reply names the new mode. **handily-simple-view 0.5.0 and
  handily-quiet-items 0.5.0 take `on` and `off` too:** `/simple on`, `/simple off`,
  `/quiet-items on` and `/quiet-items off` set the mode and reply with it, and the bare command
  still toggles. An unknown argument changes nothing, and the reply names the valid forms
  (handily-fwkt.8.5.2).
