- **task-pane shows the work in progress, not only the list.** The task in progress comes
  first, in bold, with its time. The line under it shows the last tool and target of the main
  loop and the count of tool calls since the task started. Open tasks follow in list order, and
  done tasks fold into a `+N done` button. A press on a task title shows its full title, its
  start time and its tool count. With no task list, a `Now` line shows the last tool, the count
  per tool and the time since the first call. An `Agents` section lists each running subagent
  with its plan count and its last tool. After 20 tool calls of the main loop with no task list,
  or with no change of the list by Claude, the pane shows a warning and an
  `Ask Claude for a plan` button, which puts a request into the prompt box without sending it.
  At the next prompt that the person types, the mod adds one note for Claude, at most once per
  20 tool calls. task-pane is now version 0.4.0 (handily-eq6pk).
