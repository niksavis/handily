- **simple-view draws one short row for every tool call, not only for a fixed list of tools.**
  `Bash`, `Edit`, `Write`, `Read`, `Grep` and `Glob` keep their rich rows. Every other tool,
  built-in or MCP, draws one row with the tool name (`server · tool` for an MCP tool), a short
  summary of the input, the state (`running`, `done` or `error`), and the line count of the
  result and the time. A tool that a new Claude Code release adds gets the row with no change to
  the mod. A tool that asks you or shows you a plan keeps the row of Claude Code, such as
  `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode`. The mod README lists each such tool and
  the reason. simple-view now draws a row only where the plugins beneath it give the engine row,
  so the row of another mod stays, such as a `handily-board` task row. A folded group of MCP
  calls, such as `Called claude-in-chrome`, now unfolds into its rows. `/simple show N` prints
  `File diff: not reported by the engine.` for a call of another tool. A live check on Claude
  Code 2.1.300 drew the rows for `WebSearch`, `WebFetch`, `Skill`, an MCP tool and a failed
  `handily-board` task call, and kept the rows of the board (handily-fwkt.8.23).
