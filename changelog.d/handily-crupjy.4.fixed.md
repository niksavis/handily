- **tests keeps the count and the age on the status line of a 40 column terminal.** Claude Code
  draws its own prefix before the status text of a mod and cuts the row with `…`. A live check on
  Claude Code 2.1.322 measured the prefix at 20 columns: an indent of 2 columns, the mark `⚠`, the
  name `handily-tests:` and 2 spaces. At 40 columns the row of handily-tests 0.2.0 ended with
  `tests: 1 failed …`, and the age was lost. Now the text has no mark and no `tests:`, because the
  prefix names the mod, and the count and the age are in its first 19 columns for every outcome:
  `1 failed · 59m ago`, `999 failed · 23h`, `4 passed · 2h ago` or
  `23h ago · npm test was interrupted`. A pass shows `4 passed` in place of `4 of 4 passed`. The
  runs list and the toasts do not change. (handily-crupjy.4)
