- **handily-board: a failed agent row leaves the band with no refused write.** When the this
  session tab drew a failed agent row, the board marked the row as seen from a timer that Claude
  Code 2.1.327 and later can refuse while the draw runs, so the failed row could stay in the band.
  Now the draw writes no state, the band hides the row at once, and the next command, prompt or
  pane close keeps the mark. A failure after the draw stays in the band. (handily-m4zwe0)
