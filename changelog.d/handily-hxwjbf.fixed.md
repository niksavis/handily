- **handily-board: a worker session gets the plan note on a message from another session.** An
  orchestrated worker session gets its later prompts as messages from another Claude session,
  not from the person. Before, the plan note went only with a prompt of the person, so it never
  reached such a session. Now a prompt with the origin kind `peer` or `coordinator` also
  carries the note. Its text says that the note is for the session itself and not for the
  sender, and that the session must not reply about it. The note of the person, the notes about
  changes of the person, the answers and the resume note did not change. The limit of one note
  per 20 tool calls covers both kinds of prompt. (handily-hxwjbf)
