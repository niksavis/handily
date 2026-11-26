- **The board no longer keeps a store copy of the task list and the trend.** handily-board 0.34.2
  wrote a copy to restore them after a return from the background session list. A live check on
  Claude Code 2.1.332 showed that the return starts a new session with a new id and transcript,
  and nothing links it to the old one, so the copy never restored. The copy and its debug line
  are removed. (handily-2zz7g)
