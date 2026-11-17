- **simple-view puts the reason of a failed call on its own line under the row.** The first
  error line after `exit N`, the hook message after `refused` and the text after `error` draw in
  the error colour under the row, so the state word and the time stay on the row. Below 60
  columns the time and the buttons move under the reason. `exit N` names 126, 127, 130 and 143
  dim beside the code: `not executable`, `command not found`, `interrupted` and `stopped`.
  (handily-d75xdi)
- **reply-view opens every table, code block, diagram and chart with a head.** A dim rule holds
  the kind word bold in the colour of its kind (table `claude`, code `merged`, diagram
  `suggestion`, chart `planMode`) and the buttons at the right edge, the fold button of a long
  code block first. A diagram that does not draw says `not drawn` on its head, with the reason
  under it. (handily-d75xdi)
- **reply-view shows the outcome of a copy on its button.** A pressed copy button reads
  `✓ copied` in the success colour, or `■ not copied` in the error colour, until another block is
  copied, also by `/replies copy`. No other button on the line moves. (handily-d75xdi)
- **The fold row of a long reply names the blocks that it hides.** After the count, such as
  `▸ 15 more lines · 1 table · 1 sh block · 1 flowchart`, each kind in the colour of its head.
  Under 60 columns the kinds take their own line. (handily-d75xdi)
