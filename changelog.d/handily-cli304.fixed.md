- **handily-board: the band follows a closed board or a tab switch at once, with no refused
  write.** When a board pane drew after a close or a tab switch, the board wrote state from that
  draw. Claude Code 2.1.327 refuses a state write while a draw runs, so the debug log read
  `the band may show a closed board late: ... state.set: denied` and the band could show the
  closed board late. Now the draw only asks for a redraw and writes no state. (handily-cli304)
