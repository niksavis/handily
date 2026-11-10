- **tests shows the age of the last run and the edits since on the status line.** From one
  minute after the run, the line reads, for example,
  `■ tests: 2 failed · 2d ago · 3 of 5 passed · 2 edits since`. The age comes after the count, in
  the form of the runs list. A run with no count, such as an interrupted run, shows the age
  first. Each Edit, Write and NotebookEdit call of the main loop or of an agent that ends after
  the start of the last result counts as an edit. An interrupted run, a run in the background
  and a run that could not be read keep the count. An old line stays until a new run or the
  `failures` rule hides it. The count and the age are in the first 39 columns, so a cut of the
  line at 40 columns keeps them. (handily-crupjy.4)
