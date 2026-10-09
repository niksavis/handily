- **simple-view opens and copies the output of a Bash call by a click.** A finished `Bash` row
  with output ends with `more` and `copy`. `more` opens at most 20 lines of the output under the
  row, then `all N lines` opens every line, and `less` folds it again. `copy` copies the full
  output of the call, also an output that the engine saved to a file, and a toast says how many
  lines it copied. A running call draws one row with a dim `running` state and its time, and
  `more` opens its full command. While the live group of the engine holds a running `Bash` call,
  simple-view unfolds the group, so the engine no longer draws the full command over many
  lines. simple-view is now version 0.2.0 (handily-t899o).
- **reply-view folds long replies and structures tables and code blocks.** A reply longer than
  12 lines draws its first 12 lines, a count of the hidden lines, `more` and `copy`. `copy`
  copies the whole reply as markdown. A table draws without box lines, with aligned columns and
  a bold header, and as one block per row when the columns do not fit the width. `copy` copies
  the table as markdown, and `copy as text` copies `label: value` lines. A fenced block gets a
  title line from its tag and a `copy` button that copies its content only. `/replies` turns the
  view off and on for the session. The model still reads the full reply. reply-view starts at
  version 0.1.0, and the `handily` bundle 0.3.0 installs it (handily-t899o).
