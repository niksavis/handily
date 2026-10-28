- **filetree marks the files that a Bash call changed.** At the start of a `Bash` or
  `PowerShell` call the mod takes a fresh git status, and after the call it compares. Each file
  whose git state or time stamp changed while the call ran gets `✎` with the agent that ran it.
  Outside a git repo, the mod lists the open folders at the start and the end of the call, with
  no process. The mod reads no command text and runs no `find`. It never guesses one agent: a
  change that came before the call or after its end gets no mark. When calls of two or more
  agents ran at the same time, the row shows `2 agents`, and the open row says
  `changed while Bash of main and scout ran` (handily-02b2v.6).
