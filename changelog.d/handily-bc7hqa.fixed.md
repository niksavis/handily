- **An approved call no longer shows needs you while it runs.** handily-board cleared a
  permission ask only when the whole call ended. So a call that you or the auto mode classifier
  approved in under 3 seconds, and that then ran longer, showed `needs you` on its agent row,
  counted as a wait on the Session line and in the status line, and sent a notice. The board now
  forgets the ask when Claude Code records the decision for the call, the telemetry record
  `tool_decision`. A refusal clears the ask in the same way. An ask with no decision after
  3 seconds still shows `needs you` and sends the notice. The board passes every telemetry
  record on unchanged (handily-bc7hqa).
