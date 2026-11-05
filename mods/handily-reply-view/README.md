# handily-reply-view

`reply-view` makes long replies of Claude short and structured on the screen. On the terminal it
draws every reply, with its own look for headings, lists, task lists, quotes and alerts. A reply
longer than 30 lines folds to its first lines. A markdown table draws in a full box, with a
double rule under its header and a rule between its rows. The `tableStyle` setting `rules` draws
rules between its columns only. Numbers, durations, versions and paths in the prose and the cells
of a reply draw in their own colours, and inline code draws in the code colour of Claude Code.
The `highlight` setting `off` draws the numbers, durations, versions and paths as plain text. Each
table and each fenced code block gets a `copy` button. A mermaid flowchart or sequence diagram
draws as a diagram, with a `copy` button for its source and a `copy drawing` button for the
drawing. Each prompt that you type opens under a coloured rule labelled `you`, so you find it when
you scroll. `/replies` switches the view off and on for the session. The model still reads the
full reply and the prompt as you typed it. Only the screen changes.

The approved mock is in `docs/mocks.md`, section 7.2, with the decisions in section 7.3. Box
tables by default, highlighting and the palette follow sections 14.3 to 14.5.

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
- On the terminal, a reply of 30 lines or fewer draws whole, with no fold row. On the desktop
  app, such a reply draws as Claude Code draws it, unless it holds a table or a fenced block.
- While a reply streams, Claude Code draws it itself, and the view draws the reply only when it
  is complete, so the look of the reply changes once at the end.

## A table

By default a table on a screen of 40 columns or more draws in a full box. A double rule stands
under the header, and a rule stands between each two rows. The `copy` and `copy as text` buttons
stand under the box and end at its right edge. At 80 columns the box looks like this:

```text
  ┌───────────────┬───────┬──────┬────────────────────┐
  │ Mod           │ Tests │ Gate │ Next               │
  ╞═══════════════╪═══════╪══════╪════════════════════╡
  │ handily-board │   212 │ pass │ frames, see design │
  ├───────────────┼───────┼──────┼────────────────────┤
  │ reply-view    │    98 │ fail │ npm test exits 1   │
  └───────────────┴───────┴──────┴────────────────────┘
                              [ copy ] [ copy as text ]
```

- A table with no data rows draws its header in the box, with no double rule.
- The box takes 4 columns more than the `rules` style, so a wide table draws one block for each
  row sooner.
- Under 40 columns no box draws. A table that fits draws in the `rules` style, and a table that
  does not fit draws one block for each row.
- On the desktop app a table draws in the `rules` style, whatever the setting. The box waits for
  a check of how the desktop app draws it.
- A stored `tableStyle` value other than `rules` or `box` draws the box, and the debug log names
  the value: `handily-reply-view: userConfig tableStyle is "grid"; set it to rules or box in
/config. Drawing box.`

The `tableStyle` setting `rules` draws a table without a box. The columns stay aligned, the
header is bold, and a column that the table aligns to the right stays right-aligned. A `│` stands
between the columns on every line, and a double `═` line with a `╪` at each column stands under
the header. The rules span the width of the table, not the width of the screen. Each rule
character takes one column, so the rules do not change the widths of the columns. The `copy` and
`copy as text` buttons stand on the header line when they fit after the headings:

```text
  Mod         │ State    │ Next  [ copy ] [ copy as text ]
  ════════════╪══════════╪═════════════════
  task-pane   │ released │ follows the work
  simple-view │ released │ click to expand
```

The table has these colours, by the theme keys of Claude Code:

- The header cells are bold, in `claude`.
- The rules and the box are in `subtle`.
- Numbers, durations, versions and paths in a cell draw by the rules of
  [Highlighting](#highlighting), such as `212`, `1,024`, `v0.13.0` and `3m 12s`.
- Inline code is in `permission`, as Claude Code draws inline code. Bold text is bold. A link
  shows its text, underlined, in `suggestion`.

When the table does not fit the width of the screen, a long cell wraps at the spaces inside its
column, and the rows stay aligned. A column whose widest cell is 12 cells or less is short and
keeps its width. Every other column is long. The long columns share the rest of the width by the
width of their widest cell, and each long column gets at least 12 cells when the screen has room
for that. In the `rules` style, when a cell wraps, a dotted `┄` line separates the rows, so you
can see where each row ends. A `rules` table where no cell wraps has no row rules.

At 120 columns, a column of short phrases such as `Buttons on the header row` is long, so it
wraps and gives its width to the other long columns:

```text
  Change        │ Why                                                    │ Effect              [ copy ] [ copy as text ]
  ══════════════╪════════════════════════════════════════════════════════╪══════════════════════════════════════════════
  Buttons on    │ The buttons took a line of their own under every       │ A table that fits draws its buttons after the
  the header    │ table, so a short table took one line more than it     │ headings, and the reply is one line shorter
  row           │ needed                                                 │
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Wrapped cells │ A wide table drew one block for each row, so the       │ Long cells wrap inside their columns and the
                │ reader lost the columns                                │ rows stay aligned on a normal screen
```

In the `rules` style, the view puts the buttons in the first of these places where they fit:

1. The header line, after the headings.
2. The last line of the last row, after its text.
3. A line of their own, under the table.

A heading or a cell never moves and is never cut to make room for the buttons. The buttons end at
the right edge of the table. The `│` rules on the last line count as its text, so the buttons fit
on the last row only when that line ends early. At 80 columns, this table has no room on its
header line or its last row, so the buttons go under it:

```text
  Mod        │ Change                          │ Risk                    │ Owner
  ═══════════╪═════════════════════════════════╪═════════════════════════╪══════
  reply-view │ Tables wrap their long cells    │ A wide table can still  │ Ana
             │ inside their columns and keep   │ take many lines on a    │
             │ the rows aligned                │ narrow screen           │
  ┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┄
  task-pane  │ Each task tool call draws as    │ Low                     │ Bo
             │ one row                         │                         │
                                                     [ copy ] [ copy as text ]
```

On a screen narrower than 40 columns, a table that does not fit draws each row as a block. The
view also draws blocks when a column of the table would get fewer than 6 cells. The first cell is
the bold title of the block, and each other cell is a `label: value` line. One blank line stands
between two blocks. The buttons stand on the title of the first block when they fit there, and
otherwise on a line of their own under the last block:

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
- A cell shows inline code, bold, italic and struck text and links in their looks, without the
  markdown marks: no `**`, no `_`, no `~~`, no backticks, no backslash escapes, a link as its
  text. The text between two
  backticks keeps its marks, such as `**/*.ts`. The width of a column counts only the text that
  the cell shows.
- A table without data rows that does not fit the width shows its headings, one on each line.
- An empty cell draws no line in a block, and `copy as text` leaves it out.
- In a block, a label wider than half the reply is cut with `…`, so the value keeps room.

## Highlighting

With the `highlight` setting `on`, the default, the view draws the numbers, durations, versions,
paths and inline code of a reply in three colours. The rules apply where the view draws the text:
paragraphs, list items and table cells. At 80 columns a reply looks like this:

```text
● The gate ran npm run check over 9 mods in 3m 12s. handily-board 0.19.0
  passed 1,204 tests; docs/mocks.md gained section 14 at 14:05. p95 fell from
  46 ms to 2 s, and the x86_64 build kept utf8 and sha256 in ./scripts/mods.mjs.
```

| What                         | Colour       | Examples                                     |
| ---------------------------- | ------------ | -------------------------------------------- |
| Numbers, durations, versions | `planMode`   | `9`, `1,204`, `3m`, `12s`, `14:05`, `0.19.0` |
| Paths                        | `merged`     | `docs/mocks.md`, `./scripts/mods.mjs`        |
| Inline code                  | `permission` | `npm run check`                              |

- A token starts at the start of the text, after a space, or after `(`, `[`, `"` or `'`. It ends
  before a space, the end of the text, or the closing marks `, ; : . ) ] " ' ! ?` before a space
  or the end. So the full stop at the end of a sentence is not part of a token.
- A number has digits, optional thousands commas and one decimal part. A sign at the start and a
  `%` or `x` at the end belong to it. A digit after a letter, `_`, `-`, `#` or `.`, or before a
  letter or `_`, is no number: `p95`, `x86_64`, `utf8`, `sha256`, `opus-5-5`, `695ce64` and
  `#123` stay plain.
- A duration is a number with `ms`, `s`, `m`, `h`, `d` or `min` attached, such as `46ms` or
  `1h30m`, or a clock time such as `14:05`. In `46 ms` only the number is coloured.
- A version is `v` and digits with one or more dot parts, such as `v2.1`, or digits with two or
  more dots, such as `0.14.0`. A part such as `-rc.1` belongs to it.
- Digits joined by `-` or `–`, such as `1-5` or `2026-10-29`, are one token.
- A path has a `/`, a letter, no `://`, and a leading `/`, `./`, `../` or `~/`, a trailing `/` or
  an extension of 1 to 6 letters or digits. `and/or`, `I/O`, `TCP/IP`, `24/7`, `1/2`, `src/gen`,
  a bare `README.md` and `https://x.y/z` stay plain.
- An IPv4 address, such as `192.168.1.1`, stays plain. So does a slash and one word, such as
  `/config` or `/tmp`, because it reads as a slash command. `/usr/bin`, `/tmp/` and `/a.md` are
  paths.
- Inline code draws in `permission`, with no other colour inside it.
- A token never starts inside a word: the `3` in `f(3)` stays plain.

The `highlight` setting `off` leaves out only the colours of numbers, durations, versions and
paths. Inline code keeps `permission`, as Claude Code draws it, and the view still draws every
reply. The highlight changes no width and no copied text.

On the terminal the view draws paragraphs, headings, lists, task lists, quotes and alerts itself.
[Headings, lists, quotes and alerts](#headings-lists-quotes-and-alerts) shows how. The token
colours apply in paragraphs, list items and table cells, and not in headings, quotes or alerts.
These keep the Markdown element of Claude Code, with no highlight:

- HTML, indented code, a rule such as `---`, and a heading underlined with `===` or `---`;
- a line that holds a bracket that is not a simple link, an image, an HTML tag or an entity such
  as `&copy;`;
- a line with a `*`, `_`, `~` or a backtick that the view cannot prove simple, such as `**/*.md`,
  `** foo**`, `_snake_case_`, emphasis or a code span across two lines, or a backslash at the end
  of a line;
- a list with a paragraph or indented code after a blank line inside an item, a heading or a
  quote inside an item, a nested numbered list that does not start at 1, or a numbered task;
- a quote with a line that has no `>`, with a list, a heading or code inside it, or with a
  shallower line right after a deeper one;
- a block that follows one of these with no blank line between them.

When a reply holds a link reference definition, such as `[docs]: https://example.com`, all of
its prose keeps the Markdown element, so each reference finds its address. The view draws a line
itself only when its text is the same as CommonMark gives: `**bold**`, `*italic*`, `~~struck~~`
and `_italic_` between spaces or punctuation, `snake_case` words, a `*` between spaces, escapes,
code spans on one line and simple links.

On the desktop app the prose of a reply draws in the Markdown element of Claude Code, so only the
cells of a table highlight there.

## Headings, lists, quotes and alerts

On the terminal a heading draws without its `#` marks, and a blank line follows it. The
`headingStyle` setting picks the look. With `banner`, the default, a box hugs H1 and a `━` rule
stands under H2. At 80 columns a reply looks like this:

```text
● ╭──────────────────────────────╮
  │ Ingest timeouts after v2.3.1 │
  ╰──────────────────────────────╯

  Impact
  ━━━━━━

  p95 rose to 2 s.

  Why 4 is too few
```

- H1 and H2 are bold in `claude`, H3 is bold in `merged`, and H4 to H6 are bold.
- `bold` draws no box and no rule. `underline` also underlines H1 and H2. `uppercase` draws H1 in
  capitals.
- Under 40 columns the box gives way, and H1 draws as H2. A long heading wraps inside its box.
- A stored `headingStyle` value outside the options draws `banner`, and the debug log names the
  value.

A list draws the bullets `•`, `◦` and `▪` by its level, and a numbered list keeps its numbers.
Each level indents to the text of its parent, 2 columns for a bullet. Level 4 and deeper keep
the indent of level 4. The bullets and numbers are in `inactive`. An empty item keeps its bullet.

```text
● • Level 1
    ◦ Level 2
      ▪ Level 3
        ▪ Level 4 and deeper keep ▪ and stop indenting here
        ▪ Level 5
```

A task draws `[✓]` in `success` when it is done, with its text dim and struck through, and
`[ ]` in `inactive` when it is open. The `✓` is the Done glyph of the `glyphs` setting, so the
nerd set draws nf-cod-check. Under a task list of 3 or more tasks, nested ones counted, a
dim line counts the done tasks. A change of the bullet character, such as `-` to `+`, starts a
new list with its own count:

```text
● [✓] Restore pool_size to 32
  [✓] Confirm p95 returns to 45 ms
  [ ] Check that tanks-db can take 32 connections
      [ ] Ask the DB owner for max_connections
  [ ] Add an alert on acquire timeouts
  2 of 5 done
```

Each level of a quote draws its own `▌` in `inactive`, and the quote text is italic. A long line
wraps with a bar on each row.

```text
● ▌ Rolling ingest back to v2.3.0: v2.3.1 cut the DB pool from 32 to 4, and
  ▌ writes time out (pool 4/4 busy, up to 87 waiting).
  ▌
  ▌ ▌ A nested quote keeps its own bar.
  ▌ ▌ ▌ And a third level.
```

A quote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` is
an alert. It draws as a box across the reply, with the kind as a word on its top edge. The edge
and the word are in `suggestion`, `success`, `merged`, `warning` or `error`, and the body is
plain. Under 40 columns the alert draws as a bar with the word on its first line. An alert of
another kind, such as `[!TODO]`, keeps the Markdown element.

```text
● ╭─ Warning ──────────────────────────╮
  │ Do not raise pool_size above       │
  │ max_connections on tanks-db.       │
  ╰────────────────────────────────────╯
```

A link draws its text in `suggestion`, underlined, as a link that you can open. When the text
differs from the address, the host follows in dim, such as `the deploy run (ci.example.com)`. The
host leaves out a user name and a password. Only `https:`, `http:` and `mailto:` addresses become
a link. Any other address, such as `javascript:` or `data:`, draws as text, then the address in
dim.

## The palette

The `palette` setting of the `handily` bundle picks the colours. With `catppuccin-mocha` and a
dark theme, or the theme `auto`, the view draws fixed hex colours on the terminal. A light theme,
an ANSI theme and the desktop app keep the theme keys. `/handily palette` shows both.

| Part                        | Theme key                          | catppuccin-mocha                                                 |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| Table header                | `claude`                           | `#f9e2af`                                                        |
| Rules and box               | `subtle`                           | `#585b70`                                                        |
| Numbers                     | `planMode`                         | `#a6e3a1`                                                        |
| Inline code                 | `permission`                       | `#89dceb`                                                        |
| Paths                       | `merged`                           | `#cba6f7`                                                        |
| Links                       | `suggestion`                       | `#89b4fa`                                                        |
| Diagram lines and labels    | `inactive`                         | `#9399b2`                                                        |
| Diagram heads               | `claude`                           | `#cba6f7`                                                        |
| Diagram boxes, in turn      | `suggestion`, `planMode`, `merged` | `#89b4fa`, `#a6e3a1`, `#f5c2e7`, `#fab387`, `#94e2d5`, `#f9e2af` |
| H1 and H2                   | `claude`                           | `#f9e2af`                                                        |
| H3                          | `merged`                           | `#cba6f7`                                                        |
| Bullets, numbers, quote bar | `inactive`                         | `#cba6f7`                                                        |
| Open task `[ ]`             | `inactive`                         | `#9399b2`                                                        |
| Quote text                  | no colour                          | `#a6adc8`                                                        |

The mod reads the `handily` row and the `theme` row of `/config` when the session starts and when
either changes, and draws its replies again. A mod installed without the `handily` bundle draws
the theme keys.

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
  ╭────────╮   ╭───────╮   ┌──────────┐ yes  ╭─────────╮
  │ Prompt │──▶│ Reply │──▶│ ◇ Table? │──┬──▶│ Columns │
  ╰────────╯   ╰───────╯   └──────────┘  │   ╰─────────╯
                                         │no ╭────────╮
                                         └──▶│ Engine │
                                             ╰────────╯
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
- Every box has rounded corners `╭╮╰╯`. A decision `{…}` keeps square corners and the mark `◇`,
  and a note of a sequence diagram keeps square corners. So the shapes differ also with no colour.
- On the terminal, the boxes take the colours `suggestion`, `planMode` and `merged` in turn, in
  the order of their first mention in the source. A box keeps its colour when the flowchart turns
  top down. The arrow heads of a flowchart are in `claude`. The line and the head of a message in
  a sequence diagram take the colour of the participant that sends it. The other lines, the
  lifelines, the edge labels and the `alt` rows are in `inactive`. The text of a message and of a
  note is plain.
- A label that holds `**bold**`, `_italic_` or `<u>underline</u>` draws in that style, without the
  marks. The width of the label counts without the marks. A `_` inside a word, as in
  `snake_case_name`, stays as written.
- `copy drawing` copies the plain lines, with no colour codes and no marks. `copy` copies the
  source with its marks.
- On the desktop app, the drawing draws in a code block with no colour, so its lines keep their
  columns.
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
- `it takes 59 columns, the screen has 38. Widen the window or shorten the labels.`
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

No hint goes out in these cases:

- A plugin, another session, a channel or the Remote Control bridge sends the prompt.
- You type a slash command.
- `/replies` turned the reply view off for this session, or the `mode` setting is `off`.
- The `diagrams` setting is `off`, so a mermaid block draws as its source.

## A sequence diagram

A `sequenceDiagram` draws under the title line `── mermaid · sequence ──`:

```text
● The reply takes three steps:

  ── mermaid · sequence ─────────────────────────────  [ copy ] [ copy drawing ]
  ╭─────╮        ╭────────╮        ╭────────────╮
  │ You │        │ Claude │        │ reply-view │
  ╰──┬──╯        ╰────┬───╯        ╰──────┬─────╯
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
  ╭──┴──╮        ╭────┴───╮        ╭──────┴─────╮
  │ You │        │ Claude │        │ reply-view │
  ╰─────╯        ╰────────╯        ╰────────────╯
```

- Each participant and actor gets a box and a lifeline `│`, in the order of its first mention.
  When the lifelines are longer than 10 rows, the boxes draw again under the last row, in the same
  colours. These 3 rows count in the limit of 120 drawn rows. The boxes keep at least 8 columns
  between them. The columns between two lifelines hold the
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

## A git graph

A `gitGraph` draws under the title line `── mermaid · gitgraph ──`. The commits run down the
screen, so the newest commit is at the bottom, as in the source:

```text
● The feature lands in two branches:

  ── mermaid · gitgraph ─────────────────────────────  [ copy ] [ copy drawing ]
  ╷ main
  ● 1
  ● 2
  ├─╮ nice_feature
  │ ● 3
  ● │ 4
  │ ├─╮ very_nice_feature
  │ │ ● 5
  ● │ │ 6
  │ ● │ 7
  ⊗─╯ │ customID merge nice_feature (tag: customTag)
  │   ● 8
  ● 9
```

At 40 columns, a label that does not fit wraps under its lanes:

```text
● The feature lands in two branches:

  ── mermaid · gitgraph ────────────────
               [ copy ] [ copy drawing ]
  ╷ main
  ● 1
  ● 2
  ├─╮ nice_feature
  │ ● 3
  ● │ 4
  │ ├─╮ very_nice_feature
  │ │ ● 5
  ● │ │ 6
  │ ● │ 7
  ⊗─╯ │ customID merge nice_feature
  │   │ (tag: customTag)
  │   ● 8
  ● 9
```

- `gitGraph`, `gitGraph:`, `gitGraph LR:` and `gitGraph TB:` draw top down. `gitGraph BT:` draws
  as its source.
- Each branch is a lane `│`, 2 columns from the next lane. The `main` lane is at the left. The
  branches with no `order:` come next, in the order of the source, and then the branches with
  `order:`, by their number.
- A branch starts on a row with its name, such as `├─╮ develop`, from the head of the branch that
  was checked out. A branch with no commit to start from starts with `╷`.
- A commit draws `●`. `type: REVERSE` draws `⊗`, `type: HIGHLIGHT` draws `▮`, and a merge draws
  `◉`. The id and the message of a commit stand after the lanes, and its tags follow in bold, such
  as `(tag: v1.0.0)`. A commit with no id shows no id. The view does not make up the random id
  that Mermaid shows.
- A merge draws a join from the head of the merged branch, such as `◉─╯`, and the words
  `merge develop` in italic. A join that passes a lane draws the lane through, as `├─│─╮`.
- `cherry-pick id: "A"` draws a commit with the words `cherry-pick of A` in italic. As in Mermaid,
  no line joins it to commit `A`.
- On the terminal, each lane and its commits take the colours `suggestion`, `planMode` and
  `merged` in turn, in the order of the lanes. A branch name is bold in the colour of its lane.
  The join of a new branch takes the colour of the new branch. The join of a merge takes the
  colour of the merged branch. Ids, messages and tags are plain.
- `title` draws its text in bold above the lanes. `accTitle` and `accDescr` draw nothing, as in
  Mermaid.
- On the desktop app, the drawing draws in a code block with no colour, as the other diagrams do.
- A label that does not fit wraps under its lanes. When the lanes and 10 columns of a label do not
  fit, the graph draws as its source with the note `it takes 36 columns, the screen has 28.`
  The note ends with the remedy.
- A git graph that Mermaid refuses draws as its source. The note names the line and the reason,
  such as `line 3: the branch dev does not exist.`, `line 4: the branch dev exists already.`,
  `line 3: a branch cannot merge itself.`, `line 5: both branches have the same head.`,
  `line 5: the branch main has no commits.`, `line 3: no commit has the id x.`,
  `line 3: the commit a is on this branch.` or
  `line 9: the merge commit m needs the id of a parent.`

The syntax follows the [gitGraph page](https://mermaid.js.org/syntax/gitgraph.html) of Mermaid
12.3.0.

## A mind map

A `mindmap` draws as a tree from its root, under the title line `── mermaid · mindmap ──`:

```text
● The topics of the talk:

  ── mermaid · mindmap ──────────────────────────────  [ copy ] [ copy drawing ]
   ╭───────╮
  ( mindmap )
   ╰┬──────╯
    ├─ Origins
    │  ├─ Long history
    │  └─ Popularisation
    │     └─ British popular psychology author Tony Buzan
    ├─ Research
    │  ├─ On effectiveness
    │  │  and features
    │  └─ On Automatic creation
    │     └─ Uses
    │        ├─ Creative techniques
    │        ├─ Strategic planning
    │        └─ Argument mapping
    └─ Tools
       ├─ Pen and paper
       └─ Mermaid
```

At 40 columns, a long node wraps under its own text:

```text
● The topics of the talk:

  ── mermaid · mindmap ─────────────────
               [ copy ] [ copy drawing ]
   ╭───────╮
  ( mindmap )
   ╰┬──────╯
    ├─ Origins
    │  ├─ Long history
    │  └─ Popularisation
    │     └─ British popular psychology
    │        author Tony Buzan
    ├─ Research
    │  ├─ On effectiveness
    │  │  and features
    │  └─ On Automatic creation
    │     └─ Uses
    │        ├─ Creative techniques
    │        ├─ Strategic planning
    │        └─ Argument mapping
    └─ Tools
       ├─ Pen and paper
       └─ Mermaid
```

- The indentation of a line sets its level. A node takes the nearest line above it with less
  indentation as its parent, as in Mermaid.
- The root draws in a frame of its shape. `[…]` and `{{…}}` draw square corners. `((…))` draws
  as a circle `( … )`. `(…)`, `)…(`, `))…((` and a root with no shape draw rounded corners.
- Every other node draws its text after `├─` or `└─`, with no shape. Each level stands 3 columns
  to the right of its parent.
- On the terminal, the root is in `claude`. Each node of the first level is bold, in the colours
  `suggestion`, `planMode` and `merged` in turn. Each node under it takes its colour. The lines
  of the tree are in `inactive`.
- `<br>` in a node breaks the line. A node too wide for the screen wraps. When a level and 10
  columns of its text do not fit, the mind map draws as its source with the width note.
- A class line `:::urgent` draws nothing.
- On the desktop app, the drawing draws in a code block with no colour, as the other diagrams do.
- These draw as the source, with a note: `::icon(…)` (`icons does not draw yet.`), a markdown
  string (`markdown strings does not draw yet.`), a second root
  (`line 3 starts a second root.`) and a mind map with no node (`the mindmap has no nodes.`).

The syntax follows the [mindmap page](https://mermaid.js.org/syntax/mindmap.html) of Mermaid
12.3.0.

## A timeline

A `timeline` draws its periods down an axis, under the title line `── mermaid · timeline ──`:

```text
● Five industrial ages:

  ── mermaid · timeline ─────────────────────────────  [ copy ] [ copy drawing ]
  Timeline of Industrial Revolution
  ┄┄ 17th-20th century ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ● Industry 1.0  • Machinery, Water power, Steam
  │                 power
  ● Industry 2.0  • Electricity, Internal combustion engine, Mass production
  ● Industry 3.0  • Electronics, Computers, Automation
  ┄┄ 21st century ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ● Industry 4.0  • Internet, Robotics, Internet of Things
  ● Industry 5.0  • Artificial intelligence, Big data, 3D printing
```

At 40 columns, the events wrap in their column:

```text
● Five industrial ages:

  ── mermaid · timeline ────────────────
               [ copy ] [ copy drawing ]
  Timeline of Industrial Revolution
  ┄┄ 17th-20th century ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ● Industry 1.0  • Machinery, Water
  │                 power, Steam
  │                 power
  ● Industry 2.0  • Electricity,
  │                 Internal combustion
  │                 engine, Mass
  │                 production
  ● Industry 3.0  • Electronics,
                    Computers,
                    Automation
  ┄┄ 21st century ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ● Industry 4.0  • Internet, Robotics,
  │                 Internet of Things
  ● Industry 5.0  • Artificial
                    intelligence, Big
                    data, 3D printing
```

- `timeline`, `timeline LR` and `timeline TD` draw top down.
- `title` draws its text in bold on the first line. A `section` draws as a dotted row with its
  name, such as `┄┄ 21st century ┄┄`. A section name too wide for the screen is cut with `…`.
- A period draws `●` and its name in bold. Its events follow, each after `•`. The axis `│` joins a
  period to the next period of its section.
- When the widest period takes more than a third of the screen, or leaves fewer than 20 columns
  for the events, each period stands on its own row and its events stand under it.
- On the terminal, with sections, each section and its periods take the colours `suggestion`,
  `planMode` and `merged` in turn. With no section, each period takes the next colour. The events
  are plain. `•`, `│` and the dotted rows are in `inactive`.
- `<br>` breaks a line. A `#` after a period starts a comment, as in Mermaid. A colon and a space
  start each event. So `C#` and `a:b` in an event draw as written. `accTitle` and `accDescr` draw
  nothing.
- On the desktop app, the drawing draws in a code block with no colour, as the other diagrams do.
- These draw as the source, with a note: an event before any period or a colon with no space after
  it (`line 2 does not parse.`), a timeline with no period
  (`the timeline has no time periods.`) and a timeline of more than 120 rows
  (`135 rows, at most 120 draw.`).

The syntax follows the [timeline page](https://mermaid.js.org/syntax/timeline.html) of Mermaid
12.3.0.

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

## The prompts tab

`/replies prompts` opens a `prompts` tab that lists each prompt that you typed in this session.
You move through a long transcript by your own prompts. The tab opens with the keyboard on
`[ next ]`. `/replies prompts` again, or `/replies prompts close`, closes it.

```text
Prompts  12 · at 9 · since 10:02
[ prev ] [ next ] [ last ]
─────────────────────────────────────────
  1 10:02 Read the design and t…  4 tools
  …
  5 10:30 Run the checks          3 tools
── compacted at 10:40 ──
  6 10:41 Commit it               2 tools
  …
▸ 9 10:51 Draw the mocks for th… 12 tools
    Draw the mocks for the first batch
    and check every width with a script.
    ran 6m · Read 5 · Edit 4 · Bash 3
    [ copy prompt ]
 10 10:58 Run the checks          3 tools
```

- Each row shows the number, the time, the first line of the prompt and the count of tool calls
  that ran. A call that you or a hook refused does not count. At a narrow width the row shows the
  count without the word `tools`.
- When the first prompt is from another day, the header names the day, such as
  `since Mon 09:14`.
- `at` is the prompt of the last jump. Before a jump it is the newest prompt. The row of `at` has
  `▸` and bold text. Under it, the tab shows the whole prompt in up to 3 lines, how long its turn
  ran and the tools by name. The prompt that runs now shows `▶` and `runs`.
- A press on a row, or Enter on it, moves the transcript to that prompt. A row from a drawing
  before a `/clear` names the prompt as gone and does not move the transcript. `prev` (hotkey `p`),
  `next` (`n`) and `last` (`l`) move to the previous, the next or the newest prompt. `copy prompt`
  (`y`) copies the whole prompt.
- A compaction draws a dim rule at its time. A task notification, a message from another agent
  and a turn that continues with no text are not prompts.
- The tab draws the last 100 prompts. A button above them counts the earlier ones, such as
  `[ 40 earlier prompts · at 31 is here ]`, and a press draws them all.
- Above the prompt (not docked), the tab draws at most 8 rows around `at`, with the buttons on the
  header line.

`/replies next`, `/replies prev` and `/replies prompt 9` move the transcript from the keyboard
and reply with the prompt. When the tab is not shown, a toast also shows the prompt. With no
prompt yet, each of these commands replies:

```text
No prompt yet in this session. The prompts tab opens after your first prompt.
```

A number outside the list gets the range, such as `No prompt 99. This session has prompts 1-12.`

A jump works in fullscreen only, because outside fullscreen the scrollback belongs to the
terminal. When Claude Code does not move the transcript, the tab shows
`■ could not jump to prompt 3` and the reason in words, and a command replies with the reason. A
prompt from before a compaction can have no drawn row to jump to. The debug log keeps the answer
of Claude Code.

The mod keeps the list in memory for this session only. After a `/clear` the open tab empties at
once. After a resume, the list starts again with the next prompt that you type, and the tab and
`/replies prompts` say that the prompts from before the resume are not listed. The tab draws
again only when its list changes, and no other row of the transcript draws again for it.

## The line at the end of a turn

When a turn ends, Claude Code draws a dim line with a word, the duration and the end time. On
the terminal the mod draws this line again. It keeps the word of Claude Code. The duration and
the end time draw in the number colour of the palette, `planMode`, or `#a6e3a1` with the
`catppuccin-mocha` palette. With `LANG=en_US.UTF-8` the lines read:

```text
✻ Baked for 6m 20s · done 2:32 PM
✻ Cogitated for 1h 4m 12s · done 2:32 PM
✻ Baked for 3s
```

- The line of the mod does not show two parts that Claude Code can add, because a mod cannot read
  them: the token budget, and `N messages hidden (/focus to show)`. `/replies` turns the view off
  and gives the line back to Claude Code.
- The duration has the format of Claude Code: `3s`, `1m 4s`, `1h 4m 12s`.
- The end time has the format of Claude Code. The `Time format` setting of `/config` and the
  `timeZone` setting apply, and `auto` takes the locale from `LC_ALL`, `LC_TIME` or `LANG`, such
  as `2:32 PM` for `en_US` and `14:32` for `de_DE`. A line from an earlier day names the day, such
  as `Tuesday 2:32 PM`. When `Time format` is a pattern with `%`, Claude Code draws the line.
- The end time is the moment the session kept the line. The mod keeps it in `$.state` for this
  session only. A line from before a resume, or a line whose time the mod did not see, shows no
  end time, as in the third line above. The mod never guesses a time.
- When the line is wider than the screen, `done` drops first, as in `✻ Baked for 6m 20s · 2:32 PM`.
  When the line is still too wide, the end time drops. The duration always stays.
- Claude Code draws the line itself in the ctrl+o view and with `--verbose`, when the
  `Show turn duration` setting of `/config` is off, and when the mode is off. The desktop app draws
  its own line.
- The mod does not see a background shell, a monitor or a workflow. While one of them still runs,
  Claude Code says that it still runs, and the line of the mod can say `done`. The only list of
  these tasks reaches the classic `Stop` hooks, and a security plugin of an organization can skip
  the classic hooks of a mod.
- While an agent or a teammate of the session still runs, Claude Code draws every turn line,
  because its line then waits for the agents or says that they still run. An agent counts while
  `$.agent.list()` shows it as `pending`, `running` or `waiting`. The mod checks the agents again
  when an agent ends a turn and when a task notification arrives, and then draws its own line.

## Settings and the command

| Setting        | Default  | Use                                                                                                 |
| -------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `mode`         | `on`     | The mode when a session starts: `on` or `off`                                                       |
| `diagrams`     | `on`     | `on` draws a mermaid flowchart or sequence diagram as a diagram. `off` draws it as its source       |
| `diagramHints` | `off`    | `on` adds one hint about mermaid diagrams, about 140 tokens, to each prompt that you type           |
| `tableStyle`   | `box`    | `box` draws a full box at 40 columns or more. `rules` draws rules between the columns               |
| `highlight`    | `on`     | `on` draws numbers, durations, versions and paths in their own colours. `off` draws them plain      |
| `headingStyle` | `banner` | `banner` draws a box around H1 and a rule under H2. `bold`, `underline` and `uppercase` draw no box |

| Command                  | Effect                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `/replies`               | Turns the reply view off or on for this session, and replies with the new mode     |
| `/replies hints`         | Turns the diagram hints off or on for this session, and replies with the new state |
| `/replies copy diagram`  | Copies the source of the last diagram of the last reply                            |
| `/replies copy table`    | Copies the last table of the last reply as markdown                                |
| `/replies copy code`     | Copies the content of the last code block of the last reply                        |
| `/replies copy reply`    | Copies the whole last reply as markdown                                            |
| `/replies prompts`       | Opens or closes the prompts tab                                                    |
| `/replies prompts close` | Closes the prompts tab                                                             |
| `/replies next`          | Moves the transcript to the next prompt                                            |
| `/replies prev`          | Moves the transcript to the previous prompt                                        |
| `/replies prompt 9`      | Moves the transcript to prompt 9                                                   |

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
- On the desktop app, the reply is 30 lines or fewer and holds no table and no fenced block.
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
- An actor of a sequence diagram draws as a box.
