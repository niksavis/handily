- **handily-board draws one row for a `task_add` call with several titles.** The call showed
  the generic Claude Code row. Now the row shows the word `Tasks`, the ids, the word `added` and
  the titles joined with a middle dot, such as
  `Tasks 3, 4 added  Write the mocks · Ask the person`. Three or more consecutive ids read as a
  range, such as `Tasks 3-7 added`. A call that names a task to add before shows it, such as
  `Tasks 6, 7 added before 2`. In a narrow terminal the head is never cut. The titles are cut at
  the end, and `+N` counts the titles that are not shown. A refused call keeps the generic error
  row. (handily-lqssg)
