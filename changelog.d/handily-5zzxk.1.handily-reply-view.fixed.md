- **handily-reply-view measures the keycap one emoji as 2 columns.** Before, it took 1 column,
  so the border of a table after it was one column off. The reply view also counted every
  character from U+8C48 to U+FAFF as 2 columns, because its wide range started at the wrong
  ideograph. So a Latin Extended-D letter, a Vai letter or a private use character, such as a
  Nerd Font icon, took 2 columns, and now takes 1. A pictograph with no emoji presentation, such
  as the thermometer without VS16, took 2 columns and now takes 1. The reply view now measures
  a grapheme the same way as handily-board and handily-simple-view. `scripts/width.test.mjs`
  runs one table of cases against the width file of each mod (handily-5zzxk.1).
