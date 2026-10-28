- **board sends a desktop notice when a session needs you.** When a permission ask of this
  session, of the main loop or of a subagent, is still not settled after 3 seconds and the this
  session tab is not shown, the board sends one notice through `$.ui.notify`, for example
  `app needs you: scout waits for permission: Bash npm test`. Each wait sends at most one notice,
  and an ask that the auto mode classifier settles before 3 seconds sends none. When Claude Code
  reports that it sent nothing, as on the desktop app, the board shows the same text as a toast
  (handily-8jno3).
