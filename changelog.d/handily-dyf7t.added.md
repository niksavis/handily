- **The board lists the findings that Claude records, and you file, fix or dismiss each one.**
  A fifth model tool, `finding_add`, records a finding outside the task: one line of at most 200
  characters. The `this session` tab shows it under `Findings`, after `For you`, with three
  buttons. `[ file ]` creates a tracker record with the finding text as its title, through the
  new `$.workitems.create` of `workitems`, which runs
  `basicly tracker write -- create <text> --type task --json` in a basicly repo after an
  approved read. It runs the tracker CLI only on this press, and the toast names the new id or
  the reason why nothing was filed. `[ fix ]` puts `Fix this finding: <text>` in the prompt box
  and sends nothing. `[ dismiss ]` removes the row. No button calls a model. (handily-dyf7t)
