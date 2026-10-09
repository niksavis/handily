- **agent-board draws the task list of each subagent on its card.** When a subagent keeps a
  list in `task-pane`, its card shows `plan N/M done` and one line per task in list order,
  with `✓` for done, `▶` for in progress and `○` for open. A list of more than 5 tasks folds to
  the task in progress, the 2 tasks before it and the 2 tasks after it. On a folded list,
  `plan N/M done` is a button: Enter on it unfolds the whole list, and Enter again folds it.
  The board reads the `task-pane` state with no plugin dependency, so a card without a list,
  or a session without `task-pane`, draws as before. agent-board is now version 0.2.0
  (handily-fwkt.8.3).
