- **reply-view: a prompt that you type can draw with a bar or in a bubble, and its label carries
  its number.** The new `promptStyle` setting is `rule` (the default, as before), `bar` or
  `bubble`. A bar draws at the left of the prompt with the label under it. A bubble draws the
  prompt in a frame at the right edge, at most 3/4 of the width of the terminal, and under 40
  columns it draws as a bar. A bar or a bubble shows at most 6 lines: a longer prompt shows 5
  lines and `… N more lines (ctrl+o shows all)`, or `… N more lines` where the words do not fit.
  In each style the label names `you`, the number of the prompt in the prompts tab and the time,
  such as `you · 9 · 10:51`. (handily-36bsx.5)
