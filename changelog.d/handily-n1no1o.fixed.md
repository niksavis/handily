- **handily-board: the plan reminder counts Code Mode work as steps, and stays quiet where the
  board is not used.** In Code Mode every call inside a REPL script counted as a tool call, so one
  script could bring the "your task list did not change in N tool calls" note. Now a REPL call
  counts once and the calls inside it count not at all. The note goes out only in a session that
  called a board tool. After a resume, the next prompt tells Claude once that the task list is
  empty and the old task ids are gone. (handily-n1no1o)
