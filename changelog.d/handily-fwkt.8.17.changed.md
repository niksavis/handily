- **handily-board draws the this session tab with the same work for 1 agent and for 30
  agents.** Before, each draw read the task list of every subagent, one state read for each
  agent. Now the board keeps a copy of the subagent lists in one state value, so the number
  of state reads in a draw does not grow with the agents. A new test pins 5 reads for 1 and
  for 30 agents of 20 tasks. The board draws the same rows as before. A session that reloads
  into this version from an older one reads the list of each agent once, draws it, and keeps
  it, so no plan goes missing after the update. Measured live on Claude
  Code 2.1.300 with 30 agents of 20 tasks, the draw hook of the tab took a median of 10.05 ms
  before the change and 3.98 ms after it (handily-fwkt.8.17).
