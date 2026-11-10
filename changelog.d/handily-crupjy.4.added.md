- **tests shows the age of the last run and the edits since on the status line.** From one
  minute after the run, the line reads, for example,
  `■ tests: 2 failed · 2d ago · 3 of 5 passed · 2 edits since`. The age comes after the count, in
  the form of the runs list. Each Edit, Write and NotebookEdit call of the main loop or of an
  agent after the run counts as an edit, and a new run sets the count to 0. An old line stays
  until a new run or the `failures` rule hides it. The count and the age come first, so a
  cut of the line at 40 columns keeps them. (handily-crupjy.4)
