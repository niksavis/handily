- **handily-board, handily-filetree and handily-tests draw no button in the widget placement.**
  Claude Code 2.1.323 adds the `widget` placement, the small form of a minimized pane on the
  desktop app, and its types say that a click may not reach it. The three mods drew the docked
  form with its buttons there. Now a widget draws the head line alone: `Tasks` for the
  `this session` tab, the `Inbox` and `Sessions` heads for the `this machine` tab, the `Files`
  head line, and the `Tests` head line of the docked form. (handily-5ahlbn)
