- **handily-board 0.2.0 shows the agents of other sessions on the this machine tab.** Each
  session that runs the board now shares the name, the current task and the done and total
  counts of its active subagents in its store key, at most 4096 bytes. A card of another session
  shows at most 4 agent rows, an agent with no task list as `no tasks`, then a
  `+N more agents` button. Inline, the agents fold into one `N agents` button under the row.
  This session's card keeps its counts only (handily-fwkt.8.11).
