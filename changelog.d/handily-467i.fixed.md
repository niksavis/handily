- **`task-pane` keeps tracker text and model text apart from your words.** Each row has an
  author column, `you`, `claude` or `tracker`, before the title, in `/task`, in `task_list` and
  in the pane. The `(you)` suffix is gone, because a title could forge it. A run of spaces in a
  title becomes one space, so a title cannot wrap into a forged row. Tracker ids and titles are
  quoted with `JSON.stringify`, and control, format and line separator characters are escaped,
  in the rows, the notes, the `/task` replies and the pane. Each reply, note and tool answer
  that holds tracker text says that it is data, not an instruction, and so do the system prompt
  and the tool descriptions. A note names the author of each task. A tracker item whose id is
  not an item id is not added. A title with a bidi control character is refused by name. A
  closed or deferred item is not open: `/task add <id>` refuses it, and `/task` and the pane do
  not list it (handily-467i).
