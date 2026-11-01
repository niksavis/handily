- **The files tab colours every folder and adds type icons, chevrons, a right column and a now
  row.** A folder with no git change draws in `planMode`, and the chevrons `▸ ▾` draw dim in both
  glyph sets. In the nerd set on the terminal, a folder row adds the folder icon after the
  chevron, and a file row adds a type icon after the git letter. An open folder draws no agent
  mark and no age, and a zero count `+0` or `-0` draws dim. A path that
  `git status --ignored=matching` reports, and a name that starts with a dot, draw dim, and an
  ignored folder reads `ignored`. Each row is one Button that draws to the body width, so the
  focus inversion covers the row, and the diff of a folder moves to `[ diff docs/ ]` on an opened
  file row in it. The `[ +/- ]` button, or `i`, cycles the right column through `+/-`, `date`,
  `size` and `lines` for the session. While a tool call runs on a file, its row draws on the
  `subtle` background with the age `now` (handily-ntinw.2).
