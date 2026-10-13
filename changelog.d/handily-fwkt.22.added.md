- **handily 0.6.0 `/handily` shows the version, the state, the mode and the purpose of each
  mod.** Each mod gets one line that fits in 80 columns: its name, its version, `loaded` or why it
  did not load, its mode (`on`, `off`, `polling`, `paused`, `-` for none, or `?` when the read
  fails), and the first sentence of its description. A mod that did not load gets a second line
  with the command that fixes it. The last line counts the loaded mods and the mods that are off
  or paused. handily-item-toasts 0.5.1, handily-simple-view 0.5.1 and handily-reply-view 0.5.4
  now store their `on` mode when a session starts, so `/handily` can show it (handily-fwkt.22).
