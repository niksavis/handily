# reply-view

`reply-view` makes long replies of Claude short and structured on the screen. A reply longer than
30 lines folds to its first lines. A markdown table draws without box lines. Each table and each
fenced code block gets a `copy` button. `/replies` switches the view off and on for the session.
The model still reads the full reply. Only the screen changes.

The approved mock is in `docs/mocks.md`, section 7.2, with the decisions in section 7.3.

## Install

```text
/plugin install handily-reply-view --marketplace niksavis/handily
```

## A long reply

A reply longer than 30 lines draws its first 30 lines, a dim count of the hidden lines, and two
buttons at the right edge:

```text
● The release is done. task-pane 0.3.0 and agent-board 0.2.0 are published, and every gate passed.

  - Step 1 of the release ran without a warning.
  …
  - Step 27 of the release ran without a warning.
  … 15 more lines                                             [ more ] [ copy ]
```

- `more` shows the whole reply, with `less` and `copy` under its last line. `less` folds it again.
- `copy` copies the whole reply as markdown, as Claude wrote it. A toast says what it copied, or
  why the copy failed.
- A line counts as the rows that it takes on the screen. A long paragraph counts as several
  rows. When the 30 rows end inside a line, that line is cut at a word and ends with `…`.
- A reply of 30 lines or fewer draws as Claude Code draws it, unless it holds a table or a
  fenced block.
- While a reply streams, Claude Code draws it itself, and the view draws the reply only when it
  is complete, so the look of the reply changes once at the end.

## A table

A table loses its box lines. The columns stay aligned, the header is bold, and a column that the
table aligns to the right stays right-aligned. The `copy` and `copy as text` buttons stand on the
first header line, so they take no line of their own:

```text
  Mod           State      Next  [ copy ] [ copy as text ]
  task-pane     released   follows the work
  simple-view   released   click to expand
```

When the table does not fit the width of the screen, a long cell wraps at the spaces inside its
column, and the rows stay aligned. A short column keeps its width. The long columns share the
rest of the width by the width of their widest cell, and each long column gets at least 12
cells when the screen has room for that:

```text
  Mod          Change                            Risk  [ copy ] [ copy as text ]
                                                                           Owner
  reply-view   Tables wrap their long cells      A wide table can still    Ana
               inside their columns and keep     take many lines on a
               the rows aligned                  narrow screen
```

- The buttons end at the right edge of the table. When the table is too narrow for its headings
  and the buttons, the buttons start two cells after the last heading.
- A heading that reaches into the room of the buttons moves down to the second header line, in
  its own column. The view never cuts a heading or a cell to make room for the buttons. The table
  above shows this with `Owner`.

A screen narrower than 40 columns draws each row as a block. The view also draws blocks when a
column of the table would get fewer than 6 cells. The first cell is the bold title of the block,
and each other cell is a `label: value` line. The buttons stand on the title of the first block,
or above it when the title and the buttons do not fit on one line:

```text
  task-pane  [ copy ] [ copy as text ]
    State: released
    Next:  follows the work
```

- `copy` copies the table as markdown, as Claude wrote it.
- `copy as text` copies one block of `label: value` lines for each row, with an empty line
  between the blocks. The text has no markdown marks, no table pipes and no backslash escapes, so
  it pastes into an email or a chat as it is. A link copies as its text and its address in
  parentheses. An entity such as `&amp;` copies as its character.
- `copy as text` does not copy an aligned table. Spaces line up only in a font where each
  character has the same width, and most emails and chats use another font.
- A table with no data rows has no `copy as text` button.
- A cell shows its text without markdown marks: no `**`, no `_`, no backticks, no backslash
  escapes, a link as its text. The text between two backticks keeps its marks, such as `**/*.ts`.
- A table without data rows that does not fit the width shows its headings, one on each line.
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
- The reply is 30 lines or fewer and holds no table and no fenced block.
- The block is a summary of the text that Claude wrote between two tool calls.
- The reply is longer than 60000 characters.
- Drawing the reply failed. The mod writes the reason to the debug log.

## Known limits

- The count of lines is an estimate from the width of the screen. The renderer of Claude Code
  wraps the text, so the real count can differ by a few lines.
- A hidden character in a reply, such as a zero-width space, shows as an escape such as
  `\u200b`. The joiners inside an emoji, such as the family emoji, stay hidden. `copy` and
  `copy as text` keep the characters as Claude wrote them.
- An emoji counts as two columns. A terminal that draws an emoji in another width moves the
  columns of a table after it.
- The widest cell of each column sets the layout of the table: aligned, wrapped or in blocks.
- A press on `more` or `less` keeps one small value for that reply in `$.state`, so the reply
  stays open or folded when it draws again.
