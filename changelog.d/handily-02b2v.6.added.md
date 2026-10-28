- **filetree marks the files that a Bash call changed.** After a `Bash` or `PowerShell` call
  ends, each file whose git state or time stamp changed while it ran gets `✎` with the agent that
  ran the call. Outside a git repo, the mod lists the open folders again and marks the new and
  changed files. The mod reads no command text and runs no `find` and no extra process. When
  calls of two or more agents ran at the same time, the row shows `2 agents`, and the open row
  says `changed while Bash of main and scout ran` (handily-02b2v.6).
