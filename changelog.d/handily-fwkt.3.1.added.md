- **The `quiet-items` mod draws one short row for each tracker write.** A `br`, `bd`, `basicly
  tracker` or tracker kit write draws `work item <verb>  <id>  <title>  <status>  P<priority>`
  per changed item, from the `workitems` refresh diff. A direct `Write` or `Edit` of a tracker
  file draws a `raw tracker edit` row. `/quiet-items` toggles the rows for one session. The
  model still reads the full tool result (handily-fwkt.3.1).
