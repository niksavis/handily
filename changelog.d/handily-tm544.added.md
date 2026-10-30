- **The new mod `handily-tests` lists each failed test by name.** It reads the output of a Bash
  call that runs vitest, jest, node --test or pytest. The runner comes from the output format,
  so `npm test` that runs vitest counts as vitest. The `tests` tab shows each failure with its
  file, its line and its assertion diff, and a list of the last runs. `/tests` opens the tab,
  `/tests close` closes it, `/tests list` prints the last run as text and `/tests clear` empties
  it. The status line shows `tests: 1 failed · 3 of 4 passed`, and the setting `statusLine` can
  turn it off. A cut, background or interrupted run says so in words and never shows a pass.
  Output in another format changes nothing. The bundle `handily` installs the mod, and
  `/handily` lists it (handily-tm544).
