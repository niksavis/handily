# handily-reply-view

`reply-view` makes long replies of Claude short and structured on the screen. A reply longer than
30 lines folds to its first lines. A markdown table draws with dim rules between its columns and
under its header, and without a box around it. Each table and each fenced code block gets a
`copy` button. A mermaid flowchart or sequence diagram draws as a diagram, with a `copy` button
for its source and a `copy drawing` button for the drawing. Each prompt that you type opens under
a coloured rule labelled `you`, so you find it when you scroll. `/replies` switches the view off
and on for the session. The model still reads the full reply and the prompt as you typed it. Only
the screen changes.

The approved mock is in `docs/mocks.md`, section 7.2, with the decisions in section 7.3.

[docs/install.md](../../docs/install.md) gives the install, update and uninstall steps.

## A long reply

A reply longer than 30 lines draws its first 30 lines, a dim count of the hidden lines, and two
buttons at the right edge:

```text
● The release is done. task-pane 0.3.0 and agent-board 0.2.0 are published, and every gate passed.

  - Step 1 of the release ran without a warning.
  …
  - Step 27 of the release ran without a warning.
  … 15 more lines                                       [ more ] [ copy reply ]
```

- `more` shows the whole reply between two dim divider lines, with `less` and `copy reply` under
  the lower line. The lines show where the opened reply starts and ends, which is the text that
  `copy reply` takes. `less` folds it again and removes both lines:

```text
● ──────────────────────────────────────────────────────────────────────────────
  The release is done. task-pane 0.3.0 and agent-board 0.2.0 are published, and every gate passed.
  …
  - Step 42 of the release ran without a warning.
  ──────────────────────────────────────────────────────────────────────────────
                                                        [ less ] [ copy reply ]
```

- `copy reply` copies the whole reply as markdown, as Claude wrote it. Its label differs from the
  `copy` button of a code block, so a reply that ends with a code block shows which button takes
  the block and which takes the reply.
- A toast names what a copy button copied on its first line and the line count on the next
  line, such as `✓ Copied the sh block` and `2 lines`. It stays 6 seconds.
- A copy that fails draws `■ Not copied`, then the reason, such as
  `no screen is attached to this session`. It stays 10 seconds. When the copy throws, the reason
  is `the transcript shows why`, and the transcript holds the error.
- On a narrow screen the count of hidden lines is cut at its end, so the buttons stay on its line.
- When the reply is narrower than the two buttons and the gap of 2 columns before them, the count
  stands on its own line and the buttons stand under it. When the two buttons do not fit on one
  line, each button stands on its own line. A label wider than the reply is cut with `…`, and
  the button still works:

```text
● Line 1
  …
  Line 30
  … 24 more lines
            [ more ]
      [ copy reply ]
```

- A line counts as the rows that it takes on the screen. A long paragraph counts as several
  rows. When the 30 rows end inside a line, that line is cut at a word and ends with `…`.
- A reply of 30 lines or fewer draws as Claude Code draws it, unless it holds a table or a
  fenced block.
- While a reply streams, Claude Code draws it itself, and the view draws the reply only when it
  is complete, so the look of the reply changes once at the end.

## A table

A table loses its box. The columns stay aligned, the header is bold, and a column that the table
aligns to the right stays right-aligned. A dim `│` stands between the columns on every line, and a
dim `─` line with a `┼` at each column stands under the header. The rules span the width of the
table, not the width of the screen. Each rule character takes one column, so the rules do not
change the widths of the columns. The `copy` and `copy as text` buttons stand on the header line
when they fit after the headings:

```text
  Mod         │ State    │ Next  [ copy ] [ copy as text ]
  ────────────┼──────────┼─────────────────
  task-pane   │ released │ follows the work
  simple-view │ released │ click to expand
```

When the table does not fit the width of the screen, a long cell wraps at the spaces inside its
column, and the rows stay aligned. A column whose widest cell is 12 cells or less is short and
keeps its width. Every other column is long. The long columns share the rest of the width by the
width of their widest cell, and each long column gets at least 12 cells when the screen has room
for that. When a cell wraps, a dim dotted `┄` line separates the rows, so you can see where each
row ends. A table where no cell wraps has no row rules.

At 120 columns, a column of short phrases such as `Buttons on the header row` is long, so it
wraps and gives its width to the other long columns:

```text
  Change        │ Why                                                    │ Effect              [ copy ] [ copy as text ]
  ──────────────┼────────────────────────────────────────────────────────┼──────────────────────────────────────────────
  Buttons on    │ The buttons took a line of their own under every       │ A table that fits draws its buttons after the
  the header    │ table, so a short table took one line more than it     │ headings, and the reply is one line shorter
  row           │ needed                                                 │
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Wrapped cells │ A wide table drew one block for each row, so the       │ Long cells wrap inside their columns and the
                │ reader lost the columns                                │ rows stay aligned on a normal screen
```

The view puts the buttons in the first of these places where they fit:

1. The header line, after the headings.
2. The last line of the last row, after its text.
3. A line of their own, under the table.

A heading or a cell never moves and is never cut to make room for the buttons. The buttons end at
the right edge of the table. The `│` rules on the last line count as its text, so the buttons fit
on the last row only when that line ends early. At 80 columns, this table has no room on its
header line or its last row, so the buttons go under it:

```text
  Mod        │ Change                          │ Risk                    │ Owner
  ───────────┼─────────────────────────────────┼─────────────────────────┼──────
  reply-view │ Tables wrap their long cells    │ A wide table can still  │ Ana
             │ inside their columns and keep   │ take many lines on a    │
             │ the rows aligned                │ narrow screen           │
  ┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄
  task-pane  │ Each task tool call draws as    │ Low                     │ Bo
             │ one row                         │                         │
                                                     [ copy ] [ copy as text ]
```

A screen narrower than 40 columns draws each row as a block. The view also draws blocks when a
column of the table would get fewer than 6 cells. The first cell is the bold title of the block,
and each other cell is a `label: value` line. The buttons stand on the title of the first block
when they fit there, and otherwise on a line of their own under the last block:

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

When the title line and its `copy` button do not fit the reply, the button stands under the
title line, as the buttons of a diagram do:

```text
● Here is the plan:

  ── plan ──────────
            [ copy ]
  1. Write the mocks
  2. Ask the person
```

## A diagram

A fenced block with the tag `mermaid` that holds a flowchart or a sequence diagram draws as a
diagram. The diagram has a dim title line and two buttons at the right edge. The drawing replaces
the source:

```text
● The view decides per block:

  ── mermaid · flowchart ────────────────────────────  [ copy ] [ copy drawing ]
  ╭────────╮   ┌───────┐   ┌──────────┐ yes  ┌─────────┐
  │ Prompt │──▶│ Reply │──▶│ ◇ Table? │──┬──▶│ Columns │
  ╰────────╯   └───────┘   └──────────┘  │   └─────────┘
                                         │no ┌────────┐
                                         └──▶│ Engine │
                                             └────────┘
```

- `copy` copies the mermaid source, without the fences. The toast names it, such as
  `✓ Copied the flowchart source`.
- `copy drawing` copies the drawn lines. The toast names it, such as
  `✓ Copied the flowchart drawing`.
- The view draws `flowchart` and `graph` with the directions `TD`, `TB` and `LR`. A flowchart `LR`
  that is too wide for the screen draws top down.
- When the title line and the buttons do not fit on one line, the buttons stand on a line of
  their own under the title line.
  When the two buttons do not fit on one line, each button stands on its own line.
- On the desktop app, the drawing draws in a code block, so its lines keep their columns.
- A diagram draws whole or as its source. It never draws in part.
- When a long reply folds inside a diagram, the folded reply shows only the title line of the
  diagram and its buttons. `more` shows the drawing.
- The view keeps the last 32 drawings for this session, one for each source, width and surface.
  So a reply that draws again at the same width does not lay out its diagram again.

A block that does not draw keeps the look of a fenced block. One dim note above it names the
reason:

```text
● Here is the flow:

  diagram not drawn: line 3 does not parse.
  ── mermaid ─────────────────────────────────────────────────────────  [ copy ]
  flowchart TD
    A[Start] --> B[Parse]
    B => C[Draw]
```

Other reasons that the note names:

- `classDiagram does not draw yet.`, and the same for each other kind of diagram.
- `subgraph does not draw yet.`, and the same for `direction`.
- `box does not draw yet.`, and the same for `create` and `destroy` in a sequence diagram.
- `it takes 59 columns, the screen has 38.`
- `52 boxes, at most 40 draw.` The limits of one diagram are 80 source lines, 8000 source
  characters, 40 boxes, 60 edges, 12 participants, 60 messages and notes, and 120 drawn rows.
- `the block is empty.`

A mermaid block with no closing fence draws as a fenced block, with no note. So a block
that Claude has not finished never draws in part.

The `diagrams` setting `off` draws every mermaid block as a fenced block, with no note.

## Diagram hints

The `diagramHints` setting is `off` by default. When it is `on`, each prompt that you type
carries one hint for Claude. The hint asks for a mermaid diagram when a flow or an exchange reads
better as a diagram. You do not see the hint. Claude reads it after your prompt. `/replies hints`
turns the hints on or off for this session, and keeps the choice in the `hints` key of
`$.state`.

The hint costs about 140 tokens for each prompt that you type. This count was measured on
2026-10-29 with Claude Code 2.1.312 and the model `claude-opus-5-5`. Two `claude -p` runs of the
same prompt differ only in a mod that adds the hint as the context of the prompt. The run with the
hint used 22027 input tokens and the run without it used 21887, three times each. The hint text
has 350 characters, and a test fails when it grows past 400. When the hint text changes, measure
again and record the new count and its date here.

The hint text:

```text
The terminal draws a mermaid block in a reply as a diagram. When a flow or an exchange reads better as a diagram, add one fenced mermaid block: flowchart TD or LR, or sequenceDiagram. Keep each label short. Use at most 40 boxes and 12 participants. Do not use subgraph, direction, box, create or destroy. The reply must read well without the diagram.
```

A prompt that a plugin, another session, a channel or the Remote Control bridge sends carries
no hint.

## A sequence diagram

A `sequenceDiagram` draws under the title line `── mermaid · sequence ──`:

```text
● The reply takes three steps:

  ── mermaid · sequence ─────────────────────────────  [ copy ] [ copy drawing ]
  ┌─────┐        ┌────────┐        ┌────────────┐
  │ You │        │ Claude │        │ reply-view │
  └──┬──┘        └────┬───┘        └──────┬─────┘
     │    prompt      │                   │
     │───────────────▶│                   │
     │                │    reply text     │
     │                │──────────────────▶│
     │  drawn reply   │                   │
     │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌│
     │                │                   │──┐ cache by width
     │                │                   │◀─┘
     │                │       ┌───────────┴───────────┐
     │                │       │ layout once per width │
     │                │       └───────────┬───────────┘
```

- Each participant and actor gets a box and a lifeline `│`, in the order of its first mention.
  The boxes keep at least 8 columns between them. The columns between two lifelines hold the
  widest label between them plus 4.
- A message takes one row for its label and one row for its arrow. The label stands between the
  two lifelines at the left end of the arrow. `->>` draws a solid arrow `─▶`, and `-->>` draws a
  dashed arrow `╌▶`. `-x` ends in `×`, `-)` ends in `▷`, and `->` has no head. An arrow that
  passes a lifeline draws the lifeline through, as `╌│╌`.
- A message from a participant to itself draws as a loop of 2 rows, with its label to the right.
  A label of 3 lines makes the loop 3 rows high.
- A note is a box: `left of` and `right of` a lifeline, or `over` one or two lifelines. A lifeline
  that passes under a note joins it with `┴` and `┬`.
- `autonumber` puts `1.`, `2.` and so on before each message.
- `loop`, `alt`, `else`, `opt`, `par`, `and`, `critical`, `break` and `rect` draw as a dotted row
  across the lifelines, such as `┄┄ alt: hit ┄┄`, and `end` draws as `┄┄ end ┄┄`. A block inside
  a block draws its rows 2 columns in from each side. A block label too wide for the screen is
  cut with `…`.
- When the drawing is too wide, the labels of the messages and the notes wrap, each in at most 3
  lines. The name of a participant does not wrap.

## A prompt that you type

A prompt that you type keeps the row that Claude Code draws, with its grey background band. The
mod adds a blank line and a rule above it. The rule spans the width of the transcript, names
`you` and the time when the prompt entered the session, and has the `suggestion` colour of your
theme:

```text
● ok

── you · 22:47 ──────────────────────────────────────────────────────────────────
❯ make the human prompts in the terminal distinguishable from your answers, and
  reply with the single word ok

● ok
```

- A mod cannot set the grey band itself, because no theme key names it. So the mod keeps the
  row of Claude Code and frames it.
- The time comes from the moment the session kept the prompt. A prompt that you type while
  Claude works waits in the queue, and its time is the moment the session takes it from the
  queue. The mod keeps the time for this session only. After a resume, a prompt from before the
  resume shows `you` without a time, because the mod knows no time for it. The mod never guesses
  a time.
- While a prompt waits in the queue, its rule shows `you` without a time.
- The prompt text, its wrap and its band are those of Claude Code. The mod never changes them.
- The next row of the transcript draws the blank line under the prompt. A row that draws no
  blank line above itself, such as a tool row, stands directly under the prompt.
- These rows draw as Claude Code draws them: a task notification, a message from another agent,
  teammate, session or channel, a prompt that a plugin sent, a slash command that you type and
  its output.
- The ctrl+o view and `--verbose` draw each prompt in full as Claude Code draws it, without the
  rule, so a copy of that text holds no rule characters.
- The desktop app draws each prompt as it draws it.

## Settings and the command

| Setting        | Default | Use                                                                                           |
| -------------- | ------- | --------------------------------------------------------------------------------------------- |
| `mode`         | `on`    | The mode when a session starts: `on` or `off`                                                 |
| `diagrams`     | `on`    | `on` draws a mermaid flowchart or sequence diagram as a diagram. `off` draws it as its source |
| `diagramHints` | `off`   | `on` adds one hint about mermaid diagrams, about 140 tokens, to each prompt that you type     |

| Command                 | Effect                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `/replies`              | Turns the reply view off or on for this session, and replies with the new mode     |
| `/replies hints`        | Turns the diagram hints off or on for this session, and replies with the new state |
| `/replies copy diagram` | Copies the source of the last diagram of the last reply                            |
| `/replies copy table`   | Copies the last table of the last reply as markdown                                |
| `/replies copy code`    | Copies the content of the last code block of the last reply                        |
| `/replies copy reply`   | Copies the whole last reply as markdown                                            |

While the view is off, Claude Code draws every reply and every prompt unchanged.

The mod keeps the mode in the `mode` key of its `$.state`, so a change does not reach other
sessions. When the session starts and the key is unset, the mod writes the `mode` setting to it.
So a session starts with the mode of the setting, and `/replies` toggles from there. `/handily`
shows the setting beside the mode when the two differ.

## Copy from the keyboard

A button in the transcript takes a click only. `/replies copy` gives a path from the keyboard. It
reads the last reply of the main session. It copies the same text as the `copy` button of the
block, and its toast names it as that button does, such as `✓ Copied the sequence source`. The
command lays the reply out at the width of the terminal where it runs, as the reply draws there.

- A mermaid block counts as a diagram and not as a code block.
- A diagram that does not draw copies as its button does: `✓ Copied the mermaid block`.
- With the `diagrams` setting `off`, a mermaid block draws as a code block, so
  `/replies copy code` copies it and `/replies copy diagram` does not.

When the last reply has no block of that kind, the command says so and names the command that
copies the whole reply:

```text
The last reply has no diagram. /replies copy reply copies the whole reply.
```

The mod keeps the last reply in memory for this session only. After a `/clear` or a resume,
`/replies copy` has no reply until Claude answers again. The answer of a subagent does not
count.

## When the reply stays as Claude Code draws it

- The mode is off. `/replies` turned it off for this session, or the `mode` setting is `off`.
- The reply is 30 lines or fewer and holds no table and no fenced block.
- The block is a summary of the text that Claude wrote between two tool calls.
- The reply is longer than 60000 characters.
- Drawing the reply failed. The mod writes the reason to the transcript.

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
- Each prompt that you type keeps its time in `$.state` for this session.
- A `subgraph`, a sequence diagram with `box`, `create` or `destroy`, and every other kind of
  diagram draw as their source.
- A sequence diagram draws no participant boxes under its last row, and an actor draws as a box.
