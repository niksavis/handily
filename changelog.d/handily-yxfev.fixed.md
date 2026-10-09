- **agent-board shows the last real tool on a done row.** A subagent ends with a
  `SubagentHandback` call, and the done row read `last SubagentHandback`, an internal tool name.
  The row now keeps the tool and target of the last other call, and the count still includes
  the hand-back. A subagent whose one call was the hand-back still shows it (handily-yxfev).
