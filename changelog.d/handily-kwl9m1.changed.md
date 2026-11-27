- **`task_update` gives a plan task a new title, and each task tool names its fields.**
  `task_update` takes `id`, and `status`, `title` or both. The task keeps its id, its status and
  its place. Before, a call with a title was refused by Claude Code, because the tool did not
  declare `title`. A new title for a task for the person is refused by name, and the refusal
  names `task_close` with `not_needed` and a new `task_assign`. `task_add` and `task_move` refuse
  a task for the person as `before`. Each task tool description now ends with the fields that the
  tool takes, such as `It takes: id (required), status, title.` (handily-kwl9m1)
