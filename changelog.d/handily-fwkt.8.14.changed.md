- **handily-task-pane 0.6.0, handily-agent-board 0.4.0 and handily-session-board 0.4.0 draw
  each state with the same mark and theme colour.** Doing is `▶` in `claude`, Done is `✓` in
  `success`, To do is `○` in `subtle`, Blocked is `■` in `error`, and Waits for you is `◆` in
  `warning`. Each of the three mods keeps the table in `hooks/signals.ts`, and
  `scripts/signals.test.mjs` fails when two tables differ or when a mark is not one column wide.
  A finished session now shows `✓`, not `○`. A failed agent or session shows `■`. A running or
  waiting subagent shows `▶`. session-board writes `interactive` and `background`, shows the
  task count as `2 of 4` with no bar, and draws no task line for a session with no task data.
  task-pane shows the author only for `you` and `tracker`, in the theme colour `suggestion`, so
  a title cannot imitate it. It shows the `rm` button only on the task in progress and on a
  task that you opened. It counts an emoji such as `⚡` as two columns when it cuts a title
  (handily-fwkt.8.14).
