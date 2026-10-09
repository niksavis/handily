- **task-pane draws each task tool call as one row in the transcript.** A `task_add`,
  `task_update`, `task_move` or `task_list` call took about 6 lines: the call, the result line
  and the whole task list. Now it is one row that names the action, the task number and the
  title, such as `● Task 2 ▶ in progress  Draw the mocks`, and the result block is empty. The
  model still receives the whole answer with the list. A long title is cut with `…` to the
  terminal width. A refused or failed call, and a row that the mod cannot read, draw as Claude
  Code draws them (handily-trnjp).
