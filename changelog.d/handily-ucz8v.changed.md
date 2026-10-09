- **handily-reply-view 0.4.0 draws dim rules between the columns of a table and under its
  header.** A dim `│` stands between the columns on every line, and a dim `─` line with `┼`
  crossings stands under the header. The header text is bold and no longer underlined. When a
  cell of a table wraps, a dim dotted `┄` line separates the rows in place of the blank line. A
  table that fits draws no row rules. The rules span the width of the table, not the screen,
  and the widths of the columns do not change. `copy` and `copy as text` hold no rule
  characters. A table now takes one line more, for the rule under its header. A table drawn as
  blocks below 40 columns keeps its look (handily-ucz8v).
