- **board names a waiting agent and a high context on the status line.** While the this
  session tab is not shown, the status line reads, for example,
  `◆ scout waits for permission: Bash npm test · ctx 91% high`, `◆ 2 agents wait for permission`
  or `ctx 91% high · /compact frees it`. A wait is an ask of a subagent that is not settled after
  3 seconds, the same wait that the agent rows show as `needs you`. The board clears the line
  when nothing waits and the context is under 80 percent, and while the this session tab is
  shown. The new setting `statusLine` takes `attention`, the default, or `off`, which never sets
  a status line (handily-xsjad.9).
