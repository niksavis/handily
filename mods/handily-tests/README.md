# handily-tests

`tests` reads the output of each Bash call that runs your tests. It lists each failed test by
name in a pane tab named `tests`, with its file, its line and its assertion diff. A status line
shows the count of the last run. [docs/mocks.md](../../docs/mocks.md), section 13, gives the
approved design.

Release 1 reads vitest, jest, node --test (the spec and the TAP reporter) and pytest, also
`pytest -q`. The mod finds the runner from the format of
the output, not from the command, so `npm test` that runs vitest counts as vitest. Output in any
other format changes nothing: not the tab, not the status line and not the toasts. A runner with
a custom reporter is not read. Cargo and go come in a later release.

`tests` needs no other mod. Load it with `claude --plugin-dir mods`.
[docs/install.md](../../docs/install.md) gives the install, update and uninstall steps.

## Commands

| Command        | Effect                                                            |
| -------------- | ----------------------------------------------------------------- |
| `/tests`       | Opens the `tests` tab. On a shown `tests` tab, it closes the tab  |
| `/tests close` | Closes the `tests` tab                                            |
| `/tests list`  | Prints the last run as text: the count and each failure with diff |
| `/tests clear` | Empties the list of runs of this session                          |

Replies, from the tests:

```text
/tests         Tests tab opened.
/tests         Tests tab closed.
/tests close   The tests tab is not open. Run /tests to open it.
/tests clear   Cleared 1 test run.
/tests clear   No test run to clear.
/tests list    No test run yet. A Bash call that runs vitest, jest, node --test or pytest fills the tests tab.
```

While the tab holds the keyboard, `y` copies the opened failure: its name, its file and line,
its message and its diff.

## The tests tab

The tab opens with the first failure open. A press on a failure opens it, and a second press
closes it. The test fixture, docked at body 41, after `npm test` ran vitest with 1 failure:

```text
Tests  ■ 1 failed · 3 of 4 passed
vitest · npm test · 0s ago · 1.4s
─────────────────────────────────────────
■ adds two numbers        math.test.ts:12
    expected 5 to be 4
    - Expected
    + Received
    - 4
    + 5
    [ copy ]
+3 passed
```

- The tab lists at most 5 failures. `[ +2 more failed ]` shows the rest. A run keeps at most
  50 failures, and a dim line such as `+10 more failures in the transcript` names the rest.
- With 2 runs or more, a `Runs` list follows with the last 5 runs, newest first. A run of a
  subagent shows its name under the row. `[ +2 older runs ]` shows every kept run.
- The session keeps the last 20 runs. A new session starts empty.
- Under the message, the tab shows the lines that the runner printed, and makes up none. A line
  that starts with `-` draws in `error`, and a line that starts with `+` in `success`. A failure
  keeps at most 12 lines, and a dim line such as `+8 more lines in the transcript` names the rest.
- A test file or suite that fails to load counts as a failed test under its file name. It never
  counts as a pass.
- The mark and the word `failed` draw in `error`. A pass draws `✓` and `passed` in `success`.
- On the desktop app the marks are plain, whatever the Glyphs setting of `handily` is.

A run that the mod cannot read whole never shows a pass. The words say what happened:

| The Bash call                        | The tab says                                          |
| ------------------------------------ | ----------------------------------------------------- |
| The output was cut                   | `■ 2 failed · output cut` and `counts may be short`   |
| The output was cut with no failure   | `○ output cut`                                        |
| It went to the background            | `▶ npm test runs in the background`                   |
| It was interrupted                   | `■ npm test was interrupted` and `no result`          |
| The runner failed before a test      | `■ vitest could not run the tests` and the error line |
| The runner found no tests            | `■ vitest found no tests` and the line of the runner  |
| The output matched, but was not read | `■ the run could not be read`; the debug log has why  |

A Bash call in the background or an interrupted call counts as a test run only when its output
has a known format, or when its command runs vitest, jest, pytest, `node --test` or the `test`
script of npm, pnpm, yarn or bun.

Test output can hold secrets. The mod shows it only in this session and sends it nowhere.

## Status line

| Setting `statusLine` | The line                                                                      |
| -------------------- | ----------------------------------------------------------------------------- |
| `failures` (default) | `■ tests: 1 failed · 3 of 4 passed` while the last run failed, else none      |
| `always`             | As `failures`, and also `✓ tests: 4 of 4 passed` and `▶ tests: npm test runs` |
| `off`                | The mod sets no status line                                                   |

From one minute after the last run, the line shows the age of the run. The age comes after a
count, such as `2 failed`. A run with no count, such as an interrupted run, shows the age first.

Each Edit, Write and NotebookEdit call of the main loop or of an agent counts as an edit when it
ends after the start of the last result. A refused call and a call that failed do not count. A
result is a run with a count, a run that could not run the tests or a run that found no tests.
A new result sets the count to the edits since its start. A run that was interrupted, that went
to the background or that could not be read keeps the count.

The test fixture, 2 days after a run with 2 failures and with 2 edits after the run:

```text
■ tests: 2 failed · 2d ago · 3 of 5 passed · 2 edits since
```

- The age has the form of the runs list: `1m ago` to `59m ago`, then `1h ago` to `23h ago`, then
  whole days, such as `2d ago`.
- The mod sets the line again only when its age text changes: once a minute in the first hour,
  then once an hour, then once a day. It uses one `$.clock.after` timer and no repeating timer.
- An old line stays. Only a new run or the `failures` rule hides it.
- The mod does not know the width of the terminal, so it sets the whole line and does not cut
  it. The count and the age are in the first 39 columns for every outcome. So a cut at the right
  end at 40 columns keeps them. The tests cut the line with `…`, for example
  `■ tests: 2 failed · 2d ago · 3 of 5 pas…` and `■ tests: 2d ago · npm run test:integrat…`.

## Toasts

With the setting `toasts` on, and only while the `tests` tab is not shown:

```text
■ 1 test failed                    (a run turns from pass to fail)
"adds two numbers"
/tests shows the diff

✓ Tests pass again                 (the first pass after a failure)
vitest · 4 of 4 passed
```

The copy button shows `✓ Copied the failure`, or `■ Copy failed` when the clipboard refused.

## Credits

The idea of a tests pane comes from redgreen (MIT). `handily-tests` copies no code from it and
adds no test runner as a dependency.
