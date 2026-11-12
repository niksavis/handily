- **reply-view puts tables and diagrams that fit side by side.** A table or a drawn diagram that
  follows another with only blank lines between them shares a row with it when both fit, with
  their button rows and 3 columns between them. The tops align, and a block that does not fit
  starts a new row. A code block, a diagram that does not draw and a chart stay stacked. The new
  `sideBySide` setting is `on` by default. A person who uses a terminal screen reader sets it to
  `off`, because a screen reader reads a shared row across both blocks. The desktop app always
  stacks the blocks. A mouse selection across a shared row takes both blocks, while each `copy`
  button, `copy reply` and `/replies copy` give each block alone as its markdown.
  (handily-36bsx.9.1)
