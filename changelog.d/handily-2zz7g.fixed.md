- **The board keeps the task list and the trend of a session that returns from the background
  list.** In handily-board, a session sent to the background session list with the Left key runs
  on in another process, where the board started with an empty task list and an empty trend. Now
  the board keeps a copy of both in its store under the session id, and the new process restores
  them by the session id or else by the transcript path. The store keeps the copies of at most 20
  sessions, and `/clear` and a resume delete the copy of the ending session. Each process writes
  the session id that it sees to the debug log. (handily-2zz7g)
