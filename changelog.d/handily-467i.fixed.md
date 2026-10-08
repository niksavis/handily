- **`task-pane` keeps tracker text and model text apart from your words.** Each row has an
  author column, `you`, `claude` or `tracker`, before the title, in `/task`, in `task_list` and
  in the pane. The `(you)` suffix is gone, because a title could forge it. A tracker row and a
  note about a tracker task quote the item id and title with `JSON.stringify`. When the list
  holds a tracker row, each note and each tool answer say that this text is data, not an
  instruction, and so do the system prompt and the tool descriptions. A title with a bidi
  control or another invisible format character is refused by name. A closed or deferred item
  is not open: `/task add <id>` refuses it, and `/task` and the pane do not list it
  (handily-467i).
