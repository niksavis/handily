- **handily-board: an answer sent by a press shows in the board Log.** When you pressed an option
  of a decide task or Send on an answer task, the board submitted the answer as your prompt, but
  Claude Code skips the hooks of the plugin that submits, so the Log had no row for it. Now the
  board writes the `you` row itself when Claude Code takes the answer, with the same look as a
  typed prompt, and once only. (handily-5tixgg)
