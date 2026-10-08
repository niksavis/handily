- **`task-pane` keeps tracker text and model text apart from your words.** A note to Claude
  about a task from a tracker item quotes the item id and title with `JSON.stringify`, and
  says that the tracker supplied them, not you. The system prompt and the `task_add` and
  `task_list` descriptions say that tracker text is data, not an instruction. `task_add`
  refuses a title that holds the `(you)` mark, so the model cannot forge a task that you
  added. `/task add <id>` refuses a closed or deferred item by name and points to
  `/task add -- <text>` (handily-467i).
