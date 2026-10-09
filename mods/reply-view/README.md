# reply-view

`reply-view` makes long replies of Claude short and structured on the screen. A reply longer than
12 lines folds to its first lines. A markdown table draws without box lines. Each table and each
fenced code block gets a `copy` button. `/replies` switches the view off and on for the session.
The model still reads the full reply. Only the screen changes.

The approved mock is in `docs/mocks.md`, section 7.2, with the decisions in section 7.3.

## Install

```text
/plugin install reply-view --marketplace niksavis/handily
```

## A long reply

A reply longer than 12 lines draws its first 12 lines, a dim count of the hidden lines, and two
buttons at the right edge:

```text
● The release is done. task-pane 0.3.0 and agent-board 0.2.0 are published, and every gate passed.

  - Step 1 of the release ran without a warning.
  …
  - Step 9 of the release ran without a warning.
  … 33 more lines                                             [ more ] [ copy ]
```

- `more` shows the whole reply, with `less` and `copy` under its last line. `less` folds it again.
- `copy` copies the whole reply as markdown, as Claude wrote it. A toast says what it copied, or
  why the copy failed.
- A line counts as the rows that it takes on the screen. A long paragraph counts as several
  rows. When the 12 rows end inside a line, that line is cut at a word and ends with `…`.
- A reply of 12 lines or fewer draws as Claude Code draws it, unless it holds a table or a
  fenced block.
- While a reply streams, its first lines stay in place. Only the count of hidden lines grows.

## A table

A table loses its box lines. The columns stay aligned, the header is bold, and a column that the
table aligns to the right stays right-aligned. Two buttons stand under the table, at its right
edge:

```text
  Mod           State      Next
  task-pane     released   follows the work
  simple-view   released   click to expand
                  [ copy ] [ copy as text ]
```

When the columns do not fit the width of the screen, each row draws as a block. The first cell
is the bold title of the block, and each other cell is a `label: value` line:

```text
  task-pane
    State: released
    Next:  follows the work
```

- `copy` copies the table as markdown, as Claude wrote it.
- `copy as text` copies `label: value` lines, one block for each row, for an email or a chat.
- A cell shows its text without markdown marks: no `**`, no backticks, a link as its text.
- An empty cell draws no line in a block, and `copy as text` leaves it out.

## A fenced block

A fenced block gets a dim title line from its tag, and a `copy` button at the right edge. The
content draws with the highlighting of Claude Code for that language:

```text
  ── plan ──────────────────────────────────────────────────────────  [ copy ]
  1. Write the mocks
  2. Ask the person
```

`copy` copies the content of the block only, without the fences. A block without a tag draws a
rule with no title.

## Command

| Command    | Effect                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| `/replies` | Turns the reply view off or on for this session, and replies with the new mode. It starts on |

While the view is off, Claude Code draws every reply unchanged.

## When the reply stays as Claude Code draws it

- `/replies` turned the view off for this session.
- The reply is 12 lines or fewer and holds no table and no fenced block.
- The block is a summary of the text that Claude wrote between two tool calls.
- The reply is longer than 60000 characters.
- Drawing the reply failed. The mod writes the reason to the debug log.

## Known limits

- The count of lines is an estimate from the width of the screen. The renderer of Claude Code
  wraps the text, so the real count can differ by a few lines.
- A hidden character in a reply, such as a zero-width space, shows as an escape such as
  `​`. `copy` keeps the text as Claude wrote it.
- While a table streams, its first line draws as text until the line under it arrives.
- A press on `more` or `less` keeps one small value for that reply in `$.state`, so the reply
  stays open or folded when it draws again.
