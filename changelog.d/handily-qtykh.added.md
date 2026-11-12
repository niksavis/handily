- **simple-view draws a call that the auto mode classifier denied as one short row.** An `Edit`,
  `Write`, `Read` or `Bash` call that the classifier denied showed the long engine error block.
  Now the row shows the tool, the path or the description, the word `denied` and `auto mode`
  with the reason, such as `auto mode: Self-Modification`, in the error colour. When the
  classifier gave no explanation, the row shows `auto mode` with no reason. In a narrow terminal
  the path is cut first and then the reason. A hook refusal keeps the word `refused`. An error
  text of another shape keeps the row of before. (handily-qtykh)
