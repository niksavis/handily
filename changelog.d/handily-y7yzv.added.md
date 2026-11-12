- **The board marks a subagent that fails the same command again and again.** When a subagent
  fails the same Bash command 3 times, with an Edit or a Write between the failures, its row in the
  band and in the this session tab shows `retry 3`, and the Agents head counts `1 retry`. A retry
  row comes first among the running agents in the band. A call that a check or the person refuses
  does not count. The mark clears when the command passes or the agent ends. The row shows the
  command through the credential mask, and the board keeps only a hash of the command.
  (handily-y7yzv)
