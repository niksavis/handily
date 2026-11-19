- **handily-board: Claude can close a task that it assigned to you, and the board shows who
  closed it.** The new tool `task_close` closes a `do`, `answer` or `decide` task with
  `claude_did` (only for `do`), `person_did` with your own words in `said`, or `not_needed`.
  The board checks `said` literally against your last prompts, kept in memory only.
  `task_update` no longer withdraws a task for you; it names `task_close` with `not_needed`.
  Each closed row starts with who closed it, such as `Claude: you answered` or
  `you: done · to send`, and wraps its whole text with no `…`. `[ reopen ]` and
  `/board reopen <n>` open a task that Claude closed and tell Claude at your next prompt. The
  fold reads `[ +N closed ]`. A prompt that you type names at most 5 open tasks for you to
  Claude. The transcript draws one row for each `task_assign` and `task_close` call. From a
  body of 50 columns, the band names the oldest open task for you. (handily-fybumg)
