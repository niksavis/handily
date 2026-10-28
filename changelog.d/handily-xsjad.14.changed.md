- **board sets the status line only for a wait, and never for the context.** The Claude Code
  status line already shows the context, so the board line `ctx 91% high · /compact frees it` is
  gone, and a wait no longer ends with `· ctx 91% high`. A subagent that waits for permission
  still shows `◆ scout waits for permission: Bash npm test`, and the Session line of the board
  still says `high` from 80 percent (handily-xsjad.14).
