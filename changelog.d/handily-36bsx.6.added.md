- **Bar, line and pie charts draw in the terminal.** reply-view draws a mermaid `xychart-beta`
  or `xychart` bar chart upright, with each value above its bar, when it has at most 12 bars that
  fit, and across with each value at the right edge when it does not. A line chart draws as steps
  with `●` at each value, and on a screen of 40 columns or less as bars across with a note. A
  second series draws `▒` for bars or `◇` for a line, and a legend names both series by their
  shape. A `pie` draws one bar per slice, largest first, with its share and its value. A chart with
  no values, a value that is not a number, a pie slice below 0 or more than 40 bars shows its
  source under a note that names the reason. `/replies copy chart` copies the source of the last
  chart. The desktop app shows each chart in a plain code block (handily-36bsx.6).
