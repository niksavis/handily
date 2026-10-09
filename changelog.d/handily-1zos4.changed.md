- **handily-reply-view 0.3.1 separates the rows of a wrapped table, underlines the headings and
  gives the width of a wrapped table to its long columns.** When a cell of a table wraps, one
  blank line separates the rows, so you can see where each row ends. A table where no cell wraps
  has no blank lines. Each heading stays bold and is now underlined. The underline covers the
  text of the heading, not the space between the columns, and it adds no line. In a table that
  does not fit, only a column whose widest cell is 12 cells or less keeps its width. Every wider
  column wraps and shares the rest of the width by the width of its widest cell, so a column of
  short phrases such as `Buttons on the header row` takes 13 cells at 120 columns, not 25. A
  blank line counts as a line when a long reply folds (handily-1zos4).
