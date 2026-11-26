- **The board keeps the agent plans it finds while it draws.** In handily-board, a plan of an
  agent that the board found during a draw was written from a timer, and Claude Code refused that
  write because drawing is pure. So the plan was lost and read again on each draw. Now the board
  keeps it in memory and writes it at the next command, prompt, main turn end or pane close.
  (handily-gjucwo)
