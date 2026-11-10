# Proposed mocks, waiting for approval

Record: handily-crupjy.1 (epic handily-crupjy). The rules come from handily-crupjy.2 and
handily-crupjy.3, which the owner approved on 2026-11-04, and from handily-y8t3v. The owner has not
approved these mocks.

## Conventions used

These follow docs/mocks.md: 8.0 for the signals, the 9-column name cut and the time form, and 8.13
for the plain band lines with the engine's `[-]`.

- Marks: `▶` doing (`claude`), `✓` done (`success`), `■` failed (`error`), `◆` needs you
  (`warning`). A state word takes the colour of its mark. `slow 45s`, `quiet 3m` and `stalled 16m`
  are in `warning`.
- `ctx`, times, `▸` tool lines and counts are dim. Names are bold. These are plain blocks, so the
  looks are listed under each block and not drawn inline. That keeps every line within its width.
- Width: the band body is `bodyColumns`, which is the terminal width less 5. The head line is the
  body plus a space and `[-]` (engine),
  so it is 4 columns longer than the body, as in 8.13a. Agent rows end at
  the last body column. So the body is 115 at 120 columns, 75 at 80 columns and 35 at 40 columns.
- `open` is the borderless agent button of 8.0. `[ board ]` and the fold button are bracket buttons,
  as in 8.13. In the focus mock, `▌` marks the inverted button, as in 8.13h.
- A script measured every line. Each line is at most 119 columns at 120, 79 at 80 and 39 at 40. 66
  lines in all, none over.

### 1. Waits: an agent needs you

**1a. 120 columns (body 115): `◆ needs you` comes first, with what it waits for, its ctx and
`open`.**

```text
▶ 2 Write the tab mocks                                                                       4m ▰▰▱▱ 1/4 [ board ] [-]
◆ scout     needs you waits for: permission · Bash npm test --workspace mods/handily-board         ctx 31k open  2m
▶ Explore   running   2/7 Draw the plan · ▸ Grep hooks/band.ts                                     ctx 48k open  1m
```

**1b. 80 columns (body 75): the ctx column is left out, because the body is under 100.**

```text
▶ 2 Write the tab mocks                               4m ▰▰▱▱ 1/4 [ board ] [-]
◆ scout     needs you waits for: permission · Bash npm test        open  2m
▶ Explore   running   2/7 Draw the plan                            open  1m
```

**1c. 40 columns (body 35): the time is left out, and the detail keeps only the tool.**

```text
▶ 2 Write the tab… 4m 1/4 [ board ] [-]
◆ scout     needs you Bash np… open
▶ Explore   running 2/7 Draw…  open
```

Looks: `◆` and `needs you` in `warning`. `running` and `▶` in `claude`.

### 2. Failures

**2a. 120 columns: a failed row stays until the person opens the board or runs `/board`.**

```text
▶ 2 Write the tab mocks                                                                       4m ▰▰▱▱ 1/4 [ board ] [-]
■ lane-b    failed    after Bash npm test --workspace mods/handily-board                           ctx 62k open  4m
▶ Explore   running   2/7 Draw the plan · ▸ Grep hooks/band.ts                                     ctx 48k open  1m
```

**2b. 80 columns: the same rows with no ctx.**

```text
▶ 2 Write the tab mocks                               4m ▰▰▱▱ 1/4 [ board ] [-]
■ lane-b    failed    after Bash npm test                          open  4m
▶ Explore   running   2/7 Draw the plan                            open  1m
```

**2c. 40 columns: the state word is not padded, so the detail gets the space.**

```text
▶ 2 Write the tab… 4m 1/4 [ board ] [-]
■ lane-b    failed after Bash… open
▶ Explore   running 2/7 Draw…  open
```

Looks: `■` and `failed` in `error`. The time is the age of the agent when it ended.

### 3. Done answers

**3a. 120 columns: a done agent keeps its masked first answer line until the next prompt.**

```text
▶ 2 Write the tab mocks                                                                       4m ▰▰▱▱ 1/4 [ board ] [-]
✓ Plan      done      Found 3 callers of drawBand; .npmrc holds token=*** and the CI file reads it ctx 22k open 30s
▶ Explore   running   2/7 Draw the plan · ▸ Grep hooks/band.ts                                     ctx 48k open  1m
```

**3b. 80 columns: the answer line is cut at the end.**

```text
▶ 2 Write the tab mocks                               4m ▰▰▱▱ 1/4 [ board ] [-]
✓ Plan      done      Found 3 callers of drawBand; .npmrc holds t… open 30s
▶ Explore   running   2/7 Draw the plan                            open  1m
```

**3c. 40 columns: 13 columns of the answer remain. The board shows all of it.**

```text
▶ 2 Write the tab… 4m 1/4 [ board ] [-]
✓ Plan      done Found 3 call… open
▶ Explore   running 2/7 Draw…  open
```

Looks: `✓` and `done` in `success`. The answer is plain text. `***` is the mask of
`maskedCredentials`.

### 4. Running agents, with a stalled task (handily-y8t3v)

**4a. 120 columns: the stall is named by the words `stalled`, `slow` and `quiet`, not by colour
alone.**

```text
▶ 2 Write the tab mocks                                                              stalled 16m ▰▰▱▱ 1/4 [ board ] [-]
▶ Explore   slow 45s  ▸ Bash npm run check · step 3/5 Run the gates                                ctx 48k open  3m
▶ tester    quiet 3m  ▸ Read src/app.ts                                                            ctx 12k open  5m
▶ impl…nter running   0/3 Edit the band · ▸ Edit hooks/band.ts                                     ctx —   open  9s
```

**4b. 80 columns: a row shows the plan step, or the tool when the agent has no plan.**

```text
▶ 2 Write the tab mocks                      stalled 16m ▰▰▱▱ 1/4 [ board ] [-]
▶ Explore   slow 45s  ▸ Bash npm run check                         open  3m
▶ tester    quiet 3m  ▸ Read src/app.ts                            open  5m
▶ impl…nter running   0/3 Edit the band                            open  9s
```

**4c. 40 columns: the task title is cut first, so `stalled 16m` stays.**

```text
▶ 2 Writ… stalled 16m 1/4 [ board ] [-]
▶ Explore   slow 45s ▸ Bash n… open
▶ tester    quiet 3m ▸ Read s… open
▶ impl…nter running 0/3 Edit…  open
```

Looks: `stalled 16m`, `slow 45s` and `quiet 3m` are in `warning`, with the word and the time
together. `ctx —` means no step has been measured yet.

### 5. Overflow: more agents than rows

**5a. 120 columns: 7 agents. Rows go to needs you, then failed. The fold button names the rest.**

```text
▶ 2 Write the tab mocks                                                                       4m ▰▰▱▱ 1/4 [ board ] [-]
◆ scout     needs you waits for: permission · Bash npm test --workspace mods/handily-board         ctx 31k open  2m
◆ gene…pose needs you waits for: permission · Edit hooks/band.ts                                   ctx 40k open  1m
■ lane-b    failed    after Bash npm test --workspace mods/handily-board                           ctx 62k open  4m
[ +4 more agents · 1 done · 3 running ]
```

**5b. 80 columns.**

```text
▶ 2 Write the tab mocks                               4m ▰▰▱▱ 1/4 [ board ] [-]
◆ scout     needs you waits for: permission · Bash npm test        open  2m
◆ gene…pose needs you waits for: permission · Edit hooks/band.ts   open  1m
■ lane-b    failed    after Bash npm test                          open  4m
[ +4 more agents · 1 done · 3 running ]
```

**5c. 40 columns: the fold drops the word `agents`.**

```text
▶ 2 Write the tab… 4m 1/4 [ board ] [-]
◆ scout     needs you Bash np… open
◆ gene…pose needs you Edit ho… open
■ lane-b    failed after Bash… open
[ +4 more · 1 done · 3 running ]
```

### 6. No open task

**6a. 120 columns: the head line says why no task line shows, and keeps `[ board ]`.**

```text
Agents  2 · no open task                                                                                  [ board ] [-]
✓ Plan      done      Found 3 callers of drawBand; .npmrc holds token=*** and the CI file reads it ctx 22k open 30s
▶ Explore   running   2/7 Draw the plan · ▸ Grep hooks/band.ts                                     ctx 48k open  1m
```

**6b. 80 columns.**

```text
Agents  2 · no open task                                          [ board ] [-]
✓ Plan      done      Found 3 callers of drawBand; .npmrc holds t… open 30s
▶ Explore   running   2/7 Draw the plan                            open  1m
```

**6c. 40 columns: one space after `Agents`.**

```text
Agents 2 · no open task   [ board ] [-]
✓ Plan      done Found 3 call… open
▶ Explore   running 2/7 Draw…  open
```

Looks: `Agents` in bold. `2 · no open task` is dim.

### When the band draws nothing

This replaces 8.13k.

| Case | What shows |
| --- | --- |
| No open task, and no agent row to show | nothing |
| Only done agents, after the next prompt | nothing (the done rows end at the prompt) |
| The this session tab is shown, docked or inline | nothing (`next(e)`); the pane holds the agents |
| A survey holds the band, a plugin beneath draws, `[-]` collapsed, setting `band` off | as 8.13k |
| An approved plan waits | the 8.13f plan line is the head line, with agent rows under it |

## Row grammar

- **Head line.**
  - With an open task, it is the task line of 8.13, unchanged except that a stalled time reads
    `stalled 16m`.
  - With no open task, it reads `Agents  N · no open task` and `[ board ]`.
  - A tasks-for-you count (`◆ 3 for you`) and the plan offer stay as in 8.13e and 8.13f.
- **Agent rows.**
  - At most 3. The order is needs you, then failed, then done, then running. Inside a group, the
    order is by spawn time.
- **Body 115 (120 columns), from body 100:**
  - mark and a space: 2
  - name: 9, then a space
  - state: 9, then a space
  - detail: 76
  - a space and `ctx`: 7
  - a space and `open`: 5
  - a space and the time: 3, right-aligned
  - Total: 115.
- **Body 75 (80 columns):** the same without `ctx`. The detail is 44.
- **Body 35 (40 columns):**
  - mark: 2
  - name: 9, then a space
  - the state word at its own width, then a space
  - detail: 17 less the width of the state word, so 8 to 13
  - a space and `open`: 5
  - No time. The time drops under body 50, as the bar of the band does.
- **Detail by state:**
  - needs you: `waits for: permission · <tool target>`. At body 35, only the tool and target.
  - failed: `after <tool target>`, or `before its first tool call`.
  - done: the masked first answer line, at most 200 characters before the cut.
  - running: the current plan step `n/m <title>`, or `▸ <tool target>` when there is no plan. From
    body 100, the step and then the tool.
- **What is cut first:**
  1. the detail
  2. the time (under body 50)
  3. the padding of the state word (under body 50)
  - The mark, the name, the state word and `open` are never cut.
- **Fold row:**
  - It shows when there are more than 3 agent rows: `[ +N more agents · counts ]`.
  - The counts come in rank order: needs you, failed, done, running. A count of 0 is left out.
  - Under body 50 it reads `more` without `agents`. Counts are cut from the right, but a hidden
    `needs you` count is never cut. Example: `[ +2 more · 1 needs you ]`.
- **Redraw.** A change of state draws at once. A tool detail or a time changes on the 10 s tick. The
  tick runs while any agent runs or a task is in progress.

## Keyboard access

**Focus on an `open` button (80 columns): `▌` marks the inverted button.**

```text
▶ 2 Write the tab mocks                               4m ▰▰▱▱ 1/4 [ board ] [-]
◆ scout     needs you waits for: permission · Bash npm test       ▌open  2m
▶ Explore   running   2/7 Draw the plan                            open  1m
```

| Action | Key or command | Without a pointer |
| --- | --- | --- |
| Put the keyboard on the band | ctrl+x tab | the focus lands on `[ board ]` |
| Walk the controls | Tab, Shift+Tab | `[ board ]`, then each row's `open` from top to bottom, then the fold button |
| Open the board | `[ board ]`; `/board` | Enter on `[ board ]` |
| Open one agent | `open` on its row | Tab to it, then Enter |
| See the rest | the fold button; `/board` | Tab to it, then Enter: it opens the board with the Agents section |
| Give the keyboard back | Esc | the focus returns to the prompt |
| Hide the band | `[-]`, ctrl+x ctrl+a; `userConfig` `band` set to `off` | ctrl+x ctrl+a |

- No hotkeys, as in 8.7 and 8.13l. A digit typed into an empty prompt would press a band button.
- After a press, the band redraws, and the engine keeps the focus ring at the same index.
- `/board list` and `/board stats` print the same agents as text.

## What changes against today's band

- **Size.** Today the band is one line. It becomes a head line, up to 3 agent rows and a fold row:
  up to 5 lines. The prompt sits up to 4 lines lower than today.
- **No open task.** Today the band shows nothing when no task is open. Now it shows while any agent
  row is left, with the head `Agents  N · no open task`.
- **Head line.** The task line and `[ board ]` keep their place, so a person who knows the old band
  finds the button in the same place. The only change on the line is the word `stalled` before a
  stalled time.
- **Agent rows in the band.** Until now, agents showed only in the pane (8.10) and the status line
  (8.10p). Unlike the pane, the band shows:
  - an `open` button on failed and done rows too;
  - the plan step as text, where the pane state shows `plan 2/7`. The state word is now always
    `running`, `slow` or `quiet`.
- **Persistence.** A done row stays until the next prompt. A failed row stays until the board opens.

## Open questions for the owner

1. **What does `open` do on a failed or done row?** The pane has no button there, and the engine's
   `/tasks` view may not list an ended agent. Recommended: it opens the board with that agent row
   pressed open, showing the answer and the last calls. This also clears the failed row, so one
   press means "I saw it". On needs-you and running rows it runs `/tasks`, as 8.0 says.
2. **The 40-column row.** Recommended: keep the 9-column name and leave the state word unpadded, as
   drawn. It keeps the name rule of 8.0 everywhere. The other choice is a 6-column name with aligned
   states and a fixed 10-column detail. It aligns better, but it adds a third name-cut rule.
3. **The stalled word.** Recommended: `stalled 16m`, word first and both in `warning`, as drawn. A
   mark such as `16m!` reads as noise under a screen reader. Should the same word go on the pane
   task row (8.2d3) in handily-y8t3v? Recommended: yes, so the rule lives in one place.
4. **A short terminal.** When `maxRows` is less than the lines the band needs, recommended: drop
   running rows first and let the fold count them. Never let the engine scroll a needs-you row out
   of view.
5. **Killed, on hold, pending, idle and not listed agents.** Recommended:
   - killed sorts with done and keeps the word `killed`;
   - on hold, pending, idle and asked sort with running and keep their words;
   - a not-listed agent with a call in flight sorts with running;
   - an ended not-listed agent shows no row.
6. **A done agent with an empty answer.** Recommended: the dim detail `no answer`. It matches the
   pane's `answer: none`.
7. **The no-task head line.** Recommended: keep it, as drawn. It gives `[ board ]` one fixed place
   and says why no task shows. The other choice is no head line, with `[ board ]` on the fold row.
   That saves a line, but the button then moves between states.
8. **Row order towards the prompt.** Recommended: the head on top, then the rows in rank order, then
   the fold next to the prompt. The live order in tmux is part of the criterion. Does the engine
   draw `[-]` on the first line only? It needs a tmux probe.

## Failure modes

- **At 40 columns,** the detail shows only 8 to 13 characters (`Bash np…`). The person learns the
  kind of state, and opens the row or the board for the fact.
- **The ambiguous-width glyphs** (`▶ ◆ ■ · … —`) count as 1 column here and in `displayWidth`. A
  terminal in a CJK locale may draw them 2 wide, and then the rows wrap.
- **The mask** of an answer line is by pattern. A secret in an unknown shape reaches the screen and
  stays until the next prompt. The board already shows the same line on its answer field.
- **Control or bidi characters** in an answer or a target go through `escaped`, as in the pane. A
  test must cover the band path too.
- **Colour blindness and `NO_COLOR`.** Every state has a mark and a word: `needs you`, `failed`,
  `done`, `running`, `slow`, `quiet`, `stalled`. No meaning relies on colour.
- **A screen reader** hears `open` three times. Reading order puts each row's text before its
  button, which gives the context. A labelled button would be clearer, but the engine Button has
  only a visible `label`.
- **Failed rows pile up** if the person never opens the board. 3 failed rows hide every running
  agent, and only the fold counts them.
- **Height.** A 5-line band in a short terminal pushes the prompt down. The engine caps the slot at
  half the rows, and a taller tree scrolls (open question 4).
- **Two band mods** still yield to each other by the 8.13k rule. If both yield, no strip shows.
- **The 10 s tick:** a tool and a time can lag by up to 10 s. A change of state does not lag.
- **No band in two cases:** the mobile app and `-p`. There, `/board list` is the only path.
