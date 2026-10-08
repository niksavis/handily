- **Each row of the task pane is one line that fits the pane.** A tracker item shows the
  priority, the id, the title and `[ add ]`. A task shows the mark, the number, the author, the
  title and `[ rm ]`. An id is never cut. The title fills the room that is left and is cut to
  fit, so a row no longer wraps or splits an id at a narrow width such as 45 columns. A `…`
  button on a cut row shows the full title under the row, and a second press hides it. The
  pane shows ids and titles without JSON quotes, and still escapes control, format and line
  separator characters. Notes, `task_list` and the `/task` replies keep the quotes
  (handily-hw07).
- **The session board shows each session as a card.** A card has a status mark in a theme
  colour, the name, an `inter` or `bg` badge, `this` on the current session, the task with a
  progress bar such as `▰▰▱▱ 2/4`, and the worktree, branch and time. A dim rule line separates
  two cards. This session comes first, then the working, waiting, idle and ended sessions. A
  background session whose state has not changed for over 24 hours is hidden behind a dim
  `N older background job(s) hidden` footer, and the header counts only the cards shown. A
  session with its own key and no tasks shows `no tasks`, and a session with no key shows `—`.
  The board no longer switches to a table from 100 columns (handily-hw07).
