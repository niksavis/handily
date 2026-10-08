- **agent-board shows what each subagent of this session does.** A new mod with its own pane,
  opened with `/agent-board` and closed with `/agent-board close`. Each subagent is a card: its
  type, its state, the time since its spawn, its task, the tool that it runs now with its
  target, and its count of tool calls. A subagent with a parent shows `under` and the parent.
  The header reads `all N done` when every subagent ended. A loop that the engine does not
  list, such as a fork of the engine, keeps a card marked `not listed`. The board redraws
  every second only while its pane is the shown tab, and it passes the tool calls of the main
  loop on unchanged (handily-cr7r).
