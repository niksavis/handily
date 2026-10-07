- **The `task-pane` mod keeps a session task list that Claude and you share.** It gives the
  model the tools `task_add`, `task_update` and `task_list` and a system prompt section that
  tells it to keep its plan there. `/task`, `/task add <text|id>`, `/task rm <n>` and
  `/task pane` show and change the list, and a change you make is told to Claude. With no tasks
  yet, `/task` and the pane list the open tracker items from `workitems` (handily-fwkt.4.1).
