- **board: the band above the prompt shows an agent strip, exceptions first.** While the
  `this session` tab is not shown, the band shows up to 3 agent rows under its head line: needs
  you first, then failed, then done, then running. Each row has its state word, what it waits
  for, why it failed, its answer or its plan step and tool, and an `open` button. A fold button
  names the rest. With no open task, the head line reads `Agents  N · no open task`. Under a band
  body of 100 columns the `ctx` column drops, and every row fits at 80 and 40 columns. A change
  of state draws at once, and a new tool or a time changes on the 10 second tick. A stalled task
  time now reads `stalled 16m`. (handily-crupjy.2)
