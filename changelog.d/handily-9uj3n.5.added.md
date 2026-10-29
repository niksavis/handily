- **board lets Claude add several tasks in one call at a chosen place.** `task_add` takes
  `titles`, a list of tasks in the order of the work, and `before`, the id of the task that the
  new tasks go before. The answer names the new ids. A batch that would pass the limit of 100
  tasks, or that holds one bad title, is refused whole and adds nothing (handily-9uj3n.5).
