- **Gantt diagrams draw in the terminal.** reply-view draws a mermaid `gantt` as one row per task,
  with a bar across one date axis that all the tasks share, and each `section` as a bold heading.
  The fill tells the kind of a task: `█` a task, `▓` an active task, `░` a done task and `◇` a
  milestone. A crit task draws in the heading colour with a bold label, and a last line names the
  kinds. The view reads the `dateFormat`, the `axisFormat`, `tickInterval`, durations, `after` and
  `until`, and fits the drawing to the screen at 80, 40 and 30 columns. `excludes`, a `vert`
  marker, an unknown task id and a date that does not match the `dateFormat` show the source under
  a note that names the reason. The desktop app shows the drawing in a plain code block
  (handily-2dpxv0.4).
