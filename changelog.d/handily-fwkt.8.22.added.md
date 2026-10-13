- **handily-board 0.3.0 opens a running agent from its row.** Each running agent row on the
  this session tab gets an `open` button. A press runs `/tasks`, which opens Claude Code's view
  of the background agents: with one running agent its detail view, with more the list. Claude
  Code picks the agent, not the board. An agent that is on hold, pending, idle, failed or ended
  has no button. A refused run is logged and named in a toast (handily-fwkt.8.22).
