# handily-reply-view

`reply-view` makes long replies of Claude short and structured on the screen. On the terminal it
draws every reply, with its own look for headings, lists, task lists, quotes and alerts. A reply
longer than 30 lines folds to its first lines. A markdown table draws in a full box, with a
double rule under its header and a rule between its rows. The `tableStyle` setting `rules` draws
rules between its columns only. Numbers, durations, versions and paths in the prose and the cells
of a reply draw in their own colours, and inline code draws in the code colour of Claude Code.
The `highlight` setting `off` draws the numbers, durations, versions and paths as plain text. Each
table and each fenced code block gets a `copy` button. A mermaid flowchart, sequence diagram,
state diagram, class diagram, ER diagram, git graph, mind map or timeline draws as a diagram, with
a `copy` button for its source and a `copy drawing` button for the drawing. Each prompt that you
type opens under a coloured rule labelled `you`, so you find it when you scroll. `/replies`
switches the view off and on for the session. The model still reads the full reply and the prompt
as you typed it. Only the screen changes.

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
- The fold never shows the title line of a diagram alone.
  [A folded diagram](#a-folded-diagram) gives the rule.
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

A fenced block with the tag `mermaid` that holds a flowchart, a sequence diagram, a state
diagram, a class diagram, an ER diagram, a gantt diagram, a git graph, a mind map, a timeline, a
requirement diagram, a C4 diagram or an architecture diagram draws as a diagram. The diagram has a
dim title line and two buttons at the right edge. The drawing replaces the source:

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
- When the labels of the boxes must fit, they wrap at spaces at 16 columns, then at 12 columns. A
  longer word stays whole, and its box widens. Only when the drawing still does not fit, a long
  word breaks inside, at the room that its level leaves for each box. A box alone in its level
  keeps the word whole. A label never loses a character, and text with no spaces, such as Chinese,
  breaks between characters.
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
- A diagram draws whole or as its source. Only the preview of a folded reply shows a part of a
  tall diagram.
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

- `journey does not draw yet.`, and the same for each other kind of diagram that this part does
  not name.
- `direction does not draw yet.`, for a `direction` line outside a `subgraph`.
- The reasons of a `subgraph` that does not draw, in the part on groups in a flowchart.
- `box does not draw yet.`, and the same for `create` and `destroy` in a sequence diagram.
- `it takes 59 columns, the screen has 38. Widen the window or shorten the labels.`
- `52 boxes, at most 40 draw.` The limits of one diagram are 80 source lines, 8000 source
  characters, 40 boxes, 60 edges, 12 participants, 60 messages and notes, and 120 drawn rows.
- `the block is empty.`
- `%%{init}%% does not draw yet.` A directive can change the settings of any kind of diagram, such
  as the name of the main branch. So a block with a directive draws as its source.

A mermaid block with no closing fence draws as a fenced block, with no note. So a block
that Claude has not finished never draws in part.

The `diagrams` setting `off` draws every mermaid block as a fenced block, with no note.

### A folded diagram

When the first 30 rows of a long reply end inside a drawn diagram, the fold follows these rules
in order:

1. When the preview with the whole diagram takes 60 rows or fewer, the preview shows the whole
   diagram and ends after it. When nothing follows the diagram, the reply draws whole, with no
   fold row.
2. When at least 5 rows of the drawing fit above row 30, the preview shows the title line and the
   first rows of the drawing. The fold row names the kind of diagram and its hidden rows. When
   more of the reply follows the diagram, the fold row also counts those lines.
3. Else the preview ends before the title line of the diagram.

A sequence diagram of 30 messages takes 66 rows. Under one line of prose it folds like this at 80
columns:

```text
● Here are the pings:

  ── mermaid · sequence ─────────────────────────────  [ copy ] [ copy drawing ]
  ╭───╮        ╭───╮
  │ A │        │ B │
  ╰─┬─╯        ╰─┬─╯
    │  ping 0    │
    │───────────▶│
    │  pong 1    │
    │◀───────────│
    │  ping 2    │
    │───────────▶│
    │  pong 3    │
    │◀───────────│
    │  ping 4    │
    │───────────▶│
    │  pong 5    │
    │◀───────────│
    │  ping 6    │
    │───────────▶│
    │  pong 7    │
    │◀───────────│
    │  ping 8    │
    │───────────▶│
    │  pong 9    │
    │◀───────────│
    │  ping 10   │
    │───────────▶│
    │  pong 11   │
    │◀───────────│
  … sequence diagram, 39 more rows                     [ more ] [ copy reply ]
```

`copy drawing` copies the whole drawing, also when the preview shows a part of it. The fold of
prose, tables and fenced blocks does not change.

## Groups in a flowchart

A `subgraph` in a flowchart draws as a frame around its boxes. The frame has a dotted border
`┄ ┆` and square corners, so it does not look like a box. The title of the subgraph stands on the
top edge of the frame. An edge between two groups runs from a box in one frame to a box in the
other frame, through the borders. This source is a component diagram:

```text
flowchart LR
  subgraph Engine
    H[Hooks]
    T[Telemetry]
  end
  subgraph Mods
    W[workitems] --> BD[board]
    W --> Q[quiet-items]
    R[reply-view]
    F[filetree]
  end
  H --> BD
  H --> R
  H --> F
  T --> BD
```

It draws at 80 columns and more, under the title line and its buttons:

```text
  ┌┄ Engine ┄┄┄┄┄┄┐
  ┆ ╭───────╮     ┆
  ┆ │ Hooks │────────────┐
  ┆ ╰───────╯     ┆      │
  ┆ ╭───────────╮ ┆      │
  ┆ │ Telemetry │────┐   │
  ┆ ╰───────────╯ ┆  │   │
  └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘  │   │
  ┌┄ Mods ┄┄┄┄┄┄┄┄┄┄┄│┄┄┄│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐
  ┆ ╭───────────╮    │   │   ╭────────────╮  ┆
  ┆ │ workitems │────│─┐ ├──▶│ reply-view │  ┆
  ┆ ╰───────────╯    │ │ │   ╰────────────╯  ┆
  ┆                  │ │ │   ╭──────────╮    ┆
  ┆                  │ │ ├──▶│ filetree │    ┆
  ┆                  │ │ │   ╰──────────╯    ┆
  ┆                  │ │ │   ╭───────╮       ┆
  ┆                  │ │ │   │ board │       ┆
  ┆                  │ │ └──▶│       │       ┆
  ┆                  └─│────▶│       │       ┆
  ┆                    ├────▶│       │       ┆
  ┆                    │     ╰───────╯       ┆
  ┆                    │     ╭─────────────╮ ┆
  ┆                    └────▶│ quiet-items │ ┆
  ┆                          ╰─────────────╯ ┆
  └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

- `subgraph id [Title]`, `subgraph "Title"`, `subgraph Title words` and `subgraph id` give the
  title. A `subgraph` with no title draws a frame with no title.
- A box belongs to the first subgraph that names it, as in Mermaid. A line outside every
  subgraph can name the box before the subgraph does.
- Two subgraphs with the same id draw as one frame, with the title of the first.
- A `direction` line inside a subgraph draws in the direction of the flowchart. Mermaid does the
  same when an edge links the subgraph to a box outside it. A subgraph with no such edge must
  name the direction of the flowchart.
- A frame keeps one column of space beside its boxes, and it is only as wide as its boxes and
  its title need. A box outside the frame stays out of it. When a line crosses the border, the
  line draws through it.
- The title moves to the right of a line that enters the frame through the top edge. A frame
  grows to hold its whole title. When the labels must fit, the frame does not grow for its
  title. The title then takes the room on the top edge of its own frame, and only the part past
  that room is cut with `…`.
- On the terminal, the border is in `inactive` and the title is bold. The boxes keep their
  colours.
- When the frames are too wide for the screen, a flowchart `LR` draws top down. When it is still
  too wide, the diagram draws as its source under the width note. The component diagram above
  takes 44 columns, so at 40 columns it draws as its source.

These reasons are in the note of a `subgraph` that does not draw:

- `a subgraph inside a subgraph does not draw yet.`
- `an edge to the subgraph Mods does not draw yet.` An edge must name a box in the subgraph.
- `an empty subgraph does not draw yet.`
- `line 2 opens a subgraph with no end.`
- `direction LR inside a subgraph does not draw yet.`
- `its loops and its subgraphs cannot keep one order.` A box at the end of a loop must be the
  last box of its level, and the frames keep one order in every level. When two loops need two
  frames in opposite orders, the diagram draws as its source.

## Diagram hints

The `diagramHints` setting is `off` by default. When it is `on`, each prompt that you type
carries one hint for Claude. The hint asks for a mermaid diagram when a flow, an exchange or a
structure reads better as a diagram. You do not see the hint. Claude reads it after your prompt.
`/replies hints` turns the hints on or off for this session, and keeps the choice in the `hints`
key of `$.state`.

The hint names each kind of diagram that the view draws, by the keyword that starts its block.
The names come from the list `DRAWN_DIAGRAM_KINDS` in `hooks/mermaid.ts`. A test fails when the
hint names a kind that does not draw, or leaves out a kind that draws.

The hint costs about 230 tokens for each prompt that you type. This count was measured on
2026-11-05 with Claude Code 2.1.318 and the model `claude-opus-5-5`. Two `claude -p` runs of the
same prompt differ only in a mod that adds the hint as the context of the prompt. The run with the
hint used 22674 input tokens and the run without it used 22445, three times each, so the hint
costs 229 tokens. Input tokens are the sum of `input_tokens`, `cache_creation_input_tokens` and
`cache_read_input_tokens` in the `usage` of `--output-format json`. The same method measured the
hint of 350 characters that named only two kinds at 154 tokens. The count of 229 tokens is for
the hint text of 516 characters. The hint text now has 537 characters and names more kinds, and
it is not measured yet. A test fails when the hint text grows past 540 characters, which keeps it
under 250 tokens. When the hint text changes, measure again and record the new count and its date
here.

The hint text:

```text
The terminal draws a fenced mermaid block as a diagram. Add one when a diagram reads better than text. These kinds draw: flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, pie, xychart, gantt, gitGraph, mindmap, timeline, requirementDiagram, C4Context and the other C4 kinds, architecture-beta. A flowchart is TD or LR and may use a subgraph that does not nest. Keep each label short. Use at most 40 boxes and 12 participants. Do not use direction, box, create or destroy. The reply must read well without the diagram.
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

## A state diagram

A `stateDiagram` or `stateDiagram-v2` draws with the layout of a flowchart, under the title line
`── mermaid · state ──`. A state is a rounded box. `[*]` draws as `●` where a transition leaves it
and as `◉` where a transition ends at it. Each state that ends at `[*]` gets its own `◉`:

```text
● The car moves through three states:

  ── mermaid · state ────────────────────────────────  [ copy ] [ copy drawing ]
      ●
      ▼
  ╭───────╮
  │ Still │◀─────────┐
  ╰───┬───╯          │
  ┌───┴───┐          │
  ▼       ▼          │
  ◉  ╭────────╮      │
     │ Moving │──────┘
     ╰────┬───╯
          ▼
      ╭───────╮
      │ Crash │
      ╰───┬───╯
          ▼
          ◉
```

- `direction LR` draws the states across, as a flowchart `LR` does. A diagram too wide for the
  screen draws top down. When it is also too wide top down, it draws as its source under the note
  `it takes 52 columns, the screen has 38. Widen the window or shorten the labels.`
- A transition draws its label as a flowchart edge does, such as `Queued --> Running : claimed`.
- A state shows the text after its colon, such as `Done : All checks passed`, or the text of
  `state "Waits for you" as Waiting`. Without a text it shows its id.
- The states take the colours of the boxes in turn, in the order of their first mention. `●`, `◉`
  and the arrow heads are in `claude`. The lines and the labels are in `inactive`.
- `classDef`, `class`, `style`, `:::name`, `accTitle`, `accDescr` and a `%%` comment at the end of
  a line draw nothing.
- These draw as the source under a note that names the reason: a state with nested states, such
  as `state First {`, a `<<fork>>`, a `<<join>>`, a `<<choice>>`, a note, the `--` of concurrent
  regions, `direction RL` and `direction BT`, and a transition from a state to itself.

## A class diagram

A `classDiagram` draws under the title line `── mermaid · class ──`. Each class is a rounded box
with its name, a rule and its members. The classes stand one under the next, as the entities of an
ER diagram do, and each relation has its own route, so no two relations share a line:

```text
● Reply-view parses a reply into blocks:

  ── mermaid · class ────────────────────────────────  [ copy ] [ copy drawing ]
  ╭─────────────────────╮
  │ Reply               │
  ├─────────────────────┤
  │ + text: string      │
  │ + blocks(): Block[] │
  ╰─────────────────────╯
             ◆ 1
             │ holds
             │ 0..n
  ╭──────────┴──────────╮
  │ Block               │◁─┐
  ├─────────────────────┤  │
  │ + rows(): number    │  │
  ╰─────────────────────╯  │
             △             │
             │             │
  ╭──────────┴──────────╮  │
  │ Table               │  │
  ├─────────────────────┤  │
  │ + header: string[]  │  │
  ╰─────────────────────╯  │
                           │
  ╭─────────────────────╮  │
  │ Fence               ├──┘
  ├─────────────────────┤
  │ + tag: string       │
  ╰─────────────────────╯
```

- A parent or an owner stands above its children and parts. Each child follows its parent when it
  can, so the relation runs down the middle. Any other relation runs on its own line at the right
  of the stack. Where two lines cross, the vertical line stays whole.
- The mark of a relation stands next to the box of its parent or owner: in the row under the box
  for a relation down the middle, and in the column right of the box for a relation on the right.
  An arrow head stands next to the box that the arrow points at.

| Source             | Down the middle                  | On the right                     |
| ------------------ | -------------------------------- | -------------------------------- |
| `A <\|-- B`        | `△` under the parent `A`         | `◁` beside the parent `A`        |
| `A ..\|> B`        | `△` under `B`, a dashed line     | `◁` beside `B`, a dashed line    |
| `A *-- B`          | `◆` under the owner `A`          | `◆` beside the owner `A`         |
| `A o-- B`          | `◇` under the owner `A`          | `◇` beside the owner `A`         |
| `A --> B`          | `▼` above `B`                    | `◀` beside `B`                   |
| `A ..> B`          | `▼` above `B`, a dashed line     | `◀` beside `B`, a dashed line    |
| `A -- B`, `A .. B` | a solid or a dashed line, no end | a solid or a dashed line, no end |

- A cardinality draws as a word beside the end of its own class, such as `◆ 1` under `Reply` and
  `0..n` over `Block`. The label stands between them on a line down the middle, and next to the
  first class of the source line on a line at the right, such as `1 shows`.
- A class shows its members as you wrote them, with `+ - # ~`, `$` and `*`. When the stack is too
  wide, a long name or member wraps, and a member that wraps continues 2 columns in. A class with
  more than 10 members draws as the source under the note
  `class Reply has 14 members, at most 10 draw.`
- An annotation such as `<<interface>>` draws as `«interface»` above the name. A class label such
  as `class Animal["Animal with a label"]` replaces the name, and a name in backticks draws without
  them.
- The classes take the colours of the boxes in turn. The members are plain. The marks and the
  arrow heads are in `claude`. The lines and the words are in `inactive`.
- `direction`, `classDef`, `cssClass`, `style`, `:::name`, `click`, `link` and `callback` draw
  nothing.
- These draw as the source under a note that names the reason: a `namespace`, a `note`, a
  lollipop interface such as `A ()-- B`, and a two-way relation such as `A <|--|> B`.

## An ER diagram

An `erDiagram` draws its entities top to bottom, one under the next, in the order of their first
mention. All the entities have the width of the widest one. The title line is
`── mermaid · er ──`:

```text
● The session log keeps three tables:

  ── mermaid · er ───────────────────────────────────  [ copy ] [ copy drawing ]
  ╭────────────────────╮
  │ SESSION            │
  ├────────────────────┤
  │ PK id       string │
  │    started  date   │
  ╰──────────┬─────────╯
             │ 1
             │ has
             │ 0..n
  ╭──────────┴─────────╮
  │ PROMPT             │
  ├────────────────────┤
  │ PK id       string │
  │ FK session  string │
  │    text     string │
  ╰──────────┬─────────╯
             │ 1
             │ runs
             │ 1..n
  ╭──────────┴─────────╮
  │ TOOL_CALL          │
  ├────────────────────┤
  │ PK id       string │
  │ FK prompt   string │
  │    name     string │
  ╰────────────────────╯
```

A cardinality draws as a word, not as a crow's foot:

| Source                                                      | Word   |
| ----------------------------------------------------------- | ------ |
| `\|\|`, `1`, `only one`                                     | `1`    |
| `\|o`, `o\|`, `zero or one`, `one or zero`                  | `0..1` |
| `}o`, `o{`, `zero or more`, `zero or many`, `many(0)`, `0+` | `0..n` |
| `}\|`, `\|{`, `one or more`, `one or many`, `many(1)`, `1+` | `1..n` |

- A relationship from an entity to the entity under it draws down the middle. The cardinality of
  the upper entity, the label and the cardinality of the lower entity follow, one on each line.
- Any other relationship draws beside the stack, on the right. Each cardinality stands next to its
  entity, and the label stands next to the first entity of the source line:

```text
  ╭──────────────────╮
  │ CUSTOMER         ├╌ 1..n uses ╌╌╌╌╌╌┐
  ╰─────────┬────────╯                  ╎
            │ 1                         ╎
            │ places                    ╎
            │ 0..n                      ╎
  ╭─────────┴────────╮                  ╎
  │ ORDER            │                  ╎
  ╰─────────┬────────╯                  ╎
            │ 1                         ╎
            │ contains                  ╎
            │ 1..n                      ╎
  ╭─────────┴────────╮                  ╎
  │ LINE-ITEM        ├─ 0..n ─────────┐ ╎
  ╰──────────────────╯                │ ╎
                                      │ ╎
  ╭──────────────────╮                │ ╎
  │ DELIVERY-ADDRESS ├╌ 1..n ╌╌╌╌╌╌╌╌╌│╌┘
  ╰──────────────────╯                │
                                      │
  ╭──────────────────╮                │
  │ PRODUCT          ├─ 1 appears in ─┘
  ╰──────────────────╯
```

- `--` and `to` draw a solid line. `..` and `optionally to` draw a dashed line.
- An attribute shows its keys, its name, its type and its comment, in columns. An alias such as
  `p[Person]` replaces the name. An entity with more than 12 attributes draws as the source under
  the note `entity A has 13 attributes, at most 12 draw.`
- The entities take the colours of the boxes in turn. The keys `PK`, `FK` and `UK` are bold. The
  types, the comments, the lines and the words are in `inactive`.
- `direction`, `classDef`, `class`, `style` and `:::name` draw nothing.
- These draw as the source under a note that names the reason: a `subgraph`, a relationship from
  an entity to itself, and a cardinality that does not parse, such as
  `line 3: the cardinality }|..|x does not parse.`

## A chart

A fenced `mermaid` block that holds an `xychart-beta` or `xychart` bar chart or line chart, or a
`pie`, draws as a chart. The title line names the kind, such as `── mermaid · bar chart ──`. The
syntax is the one of the Mermaid pages
[XY Chart](https://mermaid.js.org/syntax/xyChart.html) and
[Pie chart](https://mermaid.js.org/syntax/pie.html), Mermaid 12.3.0.

A bar chart with at most 12 bars draws upright when each label is 8 columns or less and the chart
fits the screen. Each value stands above its bar:

```text
● p95 jumped at 14:00 and stayed high:

  ── mermaid · bar chart ────────────────────────────  [ copy ] [ copy drawing ]
  Ingest p95 by hour (ms)

  2500 ┤                      2029   2032
       │                      ▁▁▁▁▁  ▁▁▁▁▁  2007
  2000 ┤                      █████  █████  █████
       │                      █████  █████  █████
  1500 ┤                      █████  █████  █████
       │                      █████  █████  █████
  1000 ┤                      █████  █████  █████
       │                      █████  █████  █████
   500 ┤  45     47     46    █████  █████  █████
       │ ▁▁▁▁▁  ▂▂▂▂▂  ▁▁▁▁▁  █████  █████  █████
     0 └─────────────────────────────────────────
         11:00  12:00  13:00  14:00  15:00  16:00
```

Any other bar chart draws across, with each value at the right edge. This is the same chart at 40
columns:

```text
  Ingest p95 by hour (ms)
  11:00 ▌                             45
  12:00 ▌                             47
  13:00 ▌                             46
  14:00 █████████████████████▉      2029
  15:00 ██████████████████████      2032
  16:00 █████████████████████▋      2007
        0                      2500
```

- The top of a bar uses the eighth blocks `▁` to `█`, and the end of a bar across uses `▏` to
  `█`. So 2029 and 2032 differ.
- The scale starts at 0 and ends at a round number above the largest value. A y-axis range such
  as `y-axis "Latency" 0 --> 3000` sets the scale when it holds every value.
- A bar chart with a value below 0 draws across, around a line `┃` at 0. Each value shows its sign,
  such as `+120` and `-84`.
- A line chart draws steps: `─` along, `╯` or `╮` at a change, `│` up or down, and `●` at each
  value. A row under the labels prints each value. On a screen of 40 columns or less, and when the
  steps do not fit, a line chart draws as bars across with a note under it, such as
  `line chart drawn as bars: the screen has 38 columns.`
- A chart with two series draws the second series as `▒` for bars or `◇` for a line. A legend at
  the right of the title names both series by their shape, such as `█ p95   ▒ p99`. A series with
  no name shows as `series 1` or `series 2`.
- A pie draws one bar per slice, largest first, with its share and its value, such as
  `53% · 212`. On a narrow screen the value goes first. Then the labels cut with `…`.
- On the terminal, the bars take `suggestion` and then `planMode`. The tallest bar of a chart with
  one series is in `claude`. The values and the scale numbers are in `planMode`, and the axis is in
  `inactive`. The title is bold. The slices of a pie take the colours of the boxes in turn, in size
  order.
- The titles of the x-axis and the y-axis follow the chart in one dim line.
- `copy` copies the mermaid source and `copy drawing` copies the drawn lines.
  `/replies copy chart` copies the source of the last chart of the last reply.
- On the desktop app, the chart draws in a code block with no colour, as a diagram does.
- The `diagrams` setting `off` draws a chart as its source, as it draws a diagram.

These draw as the source under a note that starts with `chart not drawn:` and names the reason:

- a chart with no values, such as `bar []`
- a value that is not a number, such as `line 4: "n/a" is not a number.`
- a pie slice below 0, or slices that add up to 0
- more than 40 bars, points or slices, such as `41 bars, at most 40 draw.`
- more than 2 series, or bar and line series in one chart
- an x-axis with a number range, such as `x-axis 1 --> 10`, and a point label, such as
  `line [540 "PaLM"]`
- an x-axis with more or fewer labels than the series has values

## A gantt diagram

A `gantt` block draws each task as one row, with a bar across one date axis that all the tasks
share. The title line is `── mermaid · gantt ──`. The syntax is the one of the Mermaid page
[Gantt diagrams](https://mermaid.js.org/syntax/gantt.html), Mermaid 12.3.0. This is the example of
that page at 80 columns:

```text
● The plan of the gantt work:

  ── mermaid · gantt ────────────────────────────────  [ copy ] [ copy drawing ]
  Adding GANTT diagram functionality to mermaid
  A section
    Completed task                ░░░░░         ┊                ┊
    Active task                          ▓▓▓▓▓▓▓▓                ┊
    Future task                                 █████████████    ┊
    Future task2                                ┊           █████████████
  Critical tasks
    Completed task in the critic… ░░░           ┊                ┊
    Implement parser and jison        ░░░░░░    ┊                ┊
    Create tests for parser                ▓▓▓▓▓▓▓▓              ┊
    Future task in critical line                ┊ ██████████████ ┊
    Create tests for renderer                   ┊              █████
    Add to mermaid                              ┊                ┊ █████████████
    Functionality added                         ┊                ┊             ◇
  Documentation
    Describe gantt syntax             ▓▓▓▓▓▓▓▓▓ ┊                ┊
    Add gantt diagram to demo pa…             ███                ┊
    Add another diagram to demo…              █████              ┊
  Last section
    Describe gantt syntax                       ┊ █████████      ┊
    Add gantt diagram to demo pa…               ┊         ███    ┊
    Add another diagram to demo…                ┊           ██████
                                  ──────────────┴────────────────┴──────────────
                                                01-12            01-19
  █ task   ▓ active   ░ done   ◇ milestone   █ crit
```

- Each `section` is a bold heading in its cycle colour. Its tasks indent by 2 and their bars take
  the same colour.
- The fill tells the kind of a task, also with no colour: `█` a task, `▓` an `active` task, `░` a
  `done` task in `inactive`, and `◇` a `milestone` in the middle of its time. A `crit` task draws
  in `claude` with a bold label. The last line names the kinds that the diagram holds.
- `┊` marks each date of the axis in the rows of the tasks. The view picks the smallest step of
  the axis that keeps its dates apart, or the step of `tickInterval` when its dates fit. `weekday`
  sets the first day of a week step.
- A task starts at a date in the `dateFormat`, after the tasks of `after a1 b2` (the latest end),
  or at the end of the task before it. It ends at a date, after a duration such as `3d`, `20h` or
  `1M`, or at `until a1` (the earliest start). `inclusiveEndDates` adds a day to an end date.
- A part of a duration counts as Mermaid 12.3.0 counts it. A duration in days or weeks rounds to
  whole days, so `0.5d` is 1 day and `0.5w` is 4 days. A duration in months or years drops the
  part, so `1.5M` is 1 month and `0.5y` adds no time. A part of a millisecond drops.
- `dateFormat` reads `YYYY`, `M`, `MM`, `MMM`, `MMMM`, `D`, `DD`, `H`, `HH`, `h`, `hh`, `a`, `A`,
  `m`, `mm`, `s`, `ss`, `S`, `SS`, `SSS`, `X` and `x`. The default is `YYYY-MM-DD`. A format with
  no date, such as `HH:mm`, reads its times on one day.
- `axisFormat` reads the `%` codes of the Mermaid page, except `%U`, `%W` and `%Z`. With no
  `axisFormat`, the axis shows `%m-%d` in one year and `%Y-%m-%d` across years, and the time for
  steps shorter than a day. Mermaid shows `%Y-%m-%d`. The shorter dates fit more steps on a narrow
  screen.
- The view reads every date and time in UTC.
- `click`, `todayMarker`, `topAxis`, `weekend`, `includes`, `accTitle`, `accDescr` and a `%%`
  comment draw nothing.
- `copy` copies the mermaid source and `copy drawing` copies the drawn lines. On the desktop app,
  the diagram draws in a code block with no colour.

These draw as the source under a note that names the reason:

- `excludes` and a `vert` marker
- an id that no task has, such as `line 3: no task has the id zz.`, and `after` or `until`
  references that loop
- a date that does not match the `dateFormat`, an end that is not a date or a duration, a first
  task with no start, and a task that ends before it starts
- a `dateFormat` token such as `YY`, `Q` or `Do`, and an `axisFormat` code such as `%U`
- no task, or more than 60 tasks
- a screen too narrow for a label of 4 columns and 10 columns of bars, such as
  `it takes 15 columns, the screen has 14. Widen the window or shorten the labels.`

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
  │ ├─╮ very_nice_feature
  ● │ │ 4
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
  │ ├─╮ very_nice_feature
  ● │ │ 4
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
- Each branch is a lane `│`, 2 columns from the next lane. The lanes take the order of Mermaid.
  `main` counts as 0, a branch with `order:` counts as its number, and the branch at place n of
  the source with no `order:` counts as the number `0.n`. Branches with the same number keep the
  order of the source. So `order: 0` comes right after `main`.
- A branch starts on a row with its name, such as `├─╮ develop`, right under the commit that it
  starts from. A branch with no commit to start from starts with `╷`.
- A commit draws `●`. `type: REVERSE` draws `⊗`, `type: HIGHLIGHT` draws `▮`, and a merge draws
  `◉`. The id and the message of a commit stand after the lanes, and its tags follow in bold, such
  as `(tag: v1.0.0)`. A commit with no id shows no id. The view does not make up the random id
  that Mermaid shows.
- A merge draws a join from the lane of the merged branch, such as `◉─╯`, and the words
  `merge develop` in italic. A merged branch with no commits of its own has a lane from the
  commit that it starts from, so the join never reads as a merge of a newer commit. A join
  that passes a lane draws the lane through, as `├─│─╮`.
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
  `line 3: the commit a is on this branch.`, `line 9: the branch dev cannot merge into itself.`,
  `line 6: the commit a has no parent x.` or
  `line 9: the merge commit m needs the id of a parent.`
- A commit id that is used twice draws as its source, with the note
  `line 4: the commit id a exists already.` Mermaid keeps only the last commit with that id and
  draws the graph without the first one, so the view does not draw it.

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

## A requirement diagram

A `requirementDiagram` draws its requirements and elements one under the next, as a class diagram
does. The title line is `── mermaid · requirement ──`:

```text
● The checkout has two requirements:

  ── mermaid · requirement ──────────────────────────  [ copy ] [ copy drawing ]
  ╭─────────────────────────────────────╮
  │ «Element»                           │
  │ gateway                             │
  ├─────────────────────────────────────┤
  │ Type: payment service               │
  ╰──────────────────┬──────────────────╯
                     ╎
                     ╎ «satisfies»
                     ▼
  ╭─────────────────────────────────────╮
  │ «Requirement»                       │
  │ checkout                            │
  ├─────────────────────────────────────┤
  │ ID: 1                               │
  │ Text: Orders are payable online.    │
  │ Risk: High                          │
  │ Verification: Test                  │
  ╰─────────────────────────────────────╯
                     ⊕
                     │ «contains»
                     │
  ╭──────────────────┴──────────────────╮
  │ «Functional Requirement»            │
  │ card                                │
  ├─────────────────────────────────────┤
  │ ID: 1.1                             │
  │ Text: Card payments are authorised. │
  │ Risk: Medium                        │
  │ Verification: Inspection            │
  ╰─────────────────────────────────────╯
```

- A box shows its type in `«»`, its name in bold, a rule and its fields, as Mermaid shows them. A
  requirement shows `ID`, `Text`, `Risk` and `Verification`. An element shows `Type` and
  `Doc Ref`. A field that the source does not set does not show.
- A relation draws its type in `«»`, such as `«satisfies»`. `contains` draws a solid line with `⊕`
  next to the box that contains. Each other type draws a dashed line with an arrow head next to
  its target, as in Mermaid. `a <- copies - b` reads from `b` to `a`.
- A box stands above the boxes that its relations point at. A relation to the next box runs down
  the middle. Any other relation runs on its own line at the right of the stack.
- When the stack is too wide, the field values wrap in their column. When less than 10 columns are
  left for a value, the value stands under its field name.
- On the terminal, the boxes take the colours `suggestion`, `planMode` and `merged` in turn. The
  field names, the lines and the relation types are in `inactive`. `⊕` and the arrow heads are in
  `claude`. The values are plain.
- The keywords read in any case, as in Mermaid. A value in quotes keeps its text. A value with no
  quotes cannot hold `:`, `,`, `-`, `<`, `>`, `=` or `{`, and cannot start with a keyword such as
  `test`. Mermaid refuses these, so they draw as the source with a note. When a box sets a field
  twice, or a name has two definitions, the first wins, as in Mermaid.
- `direction`, `style`, `classDef`, `class`, `:::name`, `accTitle`, `accDescr` and a comment draw
  nothing. The boxes always stand top down.
- These draw as the source under a note that names the reason: a relation to a name that the
  diagram does not define (`line 4: no requirement or element has the name ghost.`), a relation
  from a box to itself, one name for a requirement and an element, a box with no closing brace and
  a `title` line, which Mermaid also refuses.
- A relation on the right needs room for its type beside the stack. At 30 columns such a diagram
  draws as the source under the width note.

The syntax follows the
[requirement diagram page](https://mermaid.js.org/syntax/requirementDiagram.html) of Mermaid
12.3.0.

## A C4 diagram

A `C4Context`, `C4Container`, `C4Component`, `C4Dynamic` or `C4Deployment` block draws with the
layout of a flowchart, top down. Each boundary draws as a dotted frame. The title line is
`── mermaid · c4 ──`. This source:

```text
  C4Container
    title Checkout
    Person(shopper, "Shopper", "Buys online")
    Container_Boundary(shop, "Shop") {
      Container(web, "Web App", "TypeScript", "Takes the orders")
      ContainerDb(orders, "Orders", "Postgres")
    }
    System_Ext(cards, "Card Provider")
    Rel(shopper, web, "Orders", "HTTPS")
    Rel(web, orders, "Stores")
    BiRel(web, cards, "Pays")
```

draws as:

```text
● The checkout talks to the card provider:

  ── mermaid · c4 ───────────────────────────────────  [ copy ] [ copy drawing ]
  Checkout
                               ╭─────────────╮
                               │ Shopper     │
                               │ [Person]    │
                               │ Buys online │
                               ╰──────┬──────╯
                        ┌─────────────┘
                        │ Orders
                        │ [HTTPS]
  ┌┄ Shop [CONTAINER] ┄┄│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐
  ┆                     ▼              ┆
  ┆        ╭─────────────────────────╮ ┆
  ┆        │ Web App                 │ ┆
  ┆        │ [Container: TypeScript] │ ┆
  ┆        │ Takes the orders        │ ┆
  ┆        ╰────────────┬────────────╯ ┆
  ┆                  ┌──┴───────────────────────────────┐
  ┆                  │ Stores          ┆                │ ⇄ Pays
  ┆                  ▼                 ┆                │
  ┆ ╭────────────────────────────────╮ ┆ ╭──────────────┴─────────────╮
  ┆ │ Orders                         │ ┆ │ Card Provider              │
  ┆ │ [Database Container: Postgres] │ ┆ │ [External Software System] │
  ┆ ╰────────────────────────────────╯ ┆ ╰────────────────────────────╯
  └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

- `title` draws its text in bold on the first line.
- An element draws as a rounded box with its name in bold, its kind in brackets and its
  description. The kind is `Person`, `Software System`, `Container` or `Component`, with the
  technology after a colon, such as `[Container: TypeScript]`. Mermaid draws a database as a
  cylinder, a queue as a pipe and an external element in grey. The terminal says it in words:
  `[Database Container: Postgres]`, `[Queue Component]` and `[External Software System]`.
- A description wraps at spaces at 32 columns, and a longer word stays whole. The layout of a
  flowchart can wrap the names, the kinds and the descriptions further on a narrow screen, by the
  rules of a flowchart label, so no character is lost.
- A boundary draws as a frame with its name and its type, such as `Shop [CONTAINER]`. `Boundary`
  has the type `system` and `Deployment_Node` the type `node`, unless the source names another
  type, as in Mermaid. The frames do not nest. A boundary inside a boundary draws as its own frame,
  named from the inside out, such as `App Server [node] in Data Centre`. A boundary that holds only
  other boundaries has no frame of its own. The description of a boundary does not show.
- A relation draws as an arrow with its label and its technology in brackets, such as `[HTTPS]`.
  `Rel_U`, `Rel_D`, `Rel_L`, `Rel_R` and the long forms draw as `Rel`, because the layout places
  the boxes itself. `Rel_Back` points at its first element. `BiRel` draws a line with no arrow head
  and `⇄` before its label. In a `C4Dynamic`, each label starts with its number in the order of
  the source, such as `1: Opens`. `RelIndex` ignores its index, as Mermaid does.
- A second relation between the same two elements replaces the first, and a second element with
  the same alias changes the first, as in Mermaid. The description of a relation does not show.
  Mermaid does not draw it either.
- A value in quotes keeps its text. A value with no quotes ends at the next comma, so the last
  value of a call needs quotes, as in Mermaid. `$descr="…"` and `$techn="…"` set a value by its
  name.
- On the terminal, the elements take the colours `suggestion`, `planMode` and `merged` in turn.
  The arrow heads are in `claude`. The lines, the frame borders and the relation words are in
  `inactive`. The frame titles are bold.
- `UpdateElementStyle`, `UpdateRelStyle`, `UpdateLayoutConfig`, `$sprite`, `$tags`, `$link`,
  `accTitle`, `accDescr` and `accDescription` draw nothing.
- When the elements of one level stand side by side and do not fit the screen, they move onto
  more rows. The view tries 2 rows for the widest level, then 3, and so on, until the drawing
  fits. The elements of one boundary stay together. An element with no relation moves to the level
  of its boundary, and a boundary with no relation stands under the rest. The levels of the
  relations keep their order. When that is still too wide, the label of a relation wraps at 8
  columns instead of being cut. Every layout that keeps the words whole comes before one that
  breaks a word.
- So the five examples of the Mermaid page draw at 80 columns. A diagram that is still too wide
  for the screen draws as the source under the width note.
- A frame title takes the room on the top edge of its own frame, as in a flowchart. So the
  Context example of the Mermaid page shows `BankBoundary0 [ENTERPRISE]` in full, and cuts only
  the outer names of a nested boundary with `…`.
- These draw as the source under a note that names the reason: a relation to a boundary
  (`a relation to the boundary b does not draw yet.`), a relation to an alias that the diagram does
  not declare (`line 3: no element has the alias ghost.`), a relation from an element to itself, a
  boundary with no elements, a boundary with no end and one alias for a boundary and an element.
  Mermaid refuses these, and they draw as the source with `line 2 does not parse.`: a `direction`
  line, a space before `(`, text after `)`, an unquoted last value, a `title` with `#`, and a call
  that Mermaid does not know, such as `UpdateBoundaryStyle` or `Lay_D`.

The syntax follows the [C4 diagram page](https://mermaid.js.org/syntax/c4.html) of Mermaid
12.3.0.

## An architecture diagram

An `architecture-beta` block draws with the layout of a flowchart. Each group draws as a dotted
frame. The title line is `── mermaid · architecture ──`. This source:

```text
  architecture-beta
    title Shop
    group cloud(cloud)[Cloud]
    group data(database)[Data] in cloud
    service cdn(internet)[CDN]
    service web(internet)[Web] in cloud
    service api(server)[API] in cloud
    service db(database)[Orders] in data
    cdn:B --> T:web
    web:B -[calls]-> T:api
    api{group}:B <--> T:db{group}
```

draws as:

```text
● The shop runs in one cloud:

  ── mermaid · architecture ─────────────────────────  [ copy ] [ copy drawing ]
  Shop
      ╭─────╮
      │ CDN │
      ╰──┬──╯
    ┌┄┄┄┄│┄ Cloud ┄┐
    ┆    ▼         ┆
    ┆ ╭─────╮      ┆
    ┆ │ Web │      ┆
    ┆ ╰──┬──╯      ┆
    ┆    │ calls   ┆
    ┆    ▼         ┆
    ┆ ╭─────╮      ┆
    ┆ │ API │      ┆
    ┆ ╰──┬──╯      ┆
    └┄┄┄┄│┄┄┄┄┄┄┄┄┄┘
         │ ⇄
  ┌┄┄┄┄┄┄│┄ Data in Cloud ┄┐
  ┆      │                 ┆
  ┆ ╭────┴───╮             ┆
  ┆ │ Orders │             ┆
  ┆ ╰────────╯             ┆
  └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

When most edges join a left side to a right side, the diagram draws left to right, and top down
when it does not fit:

```text
  ╭───────╮   ╭─────────╮ jobs ╭───────────╮
  │ Users │──▶│ Gateway │─────▶│ Job queue │
  ╰───────╯   ╰─────────╯      ╰───────────╯
```

- A service draws as a rounded box with its title. A service with no title shows its id.
- The terminal cannot draw an icon, so the icon of a service or a group does not show. Neither
  does the text of a text icon, such as `service a "icon"[A]`.
- A group draws as a frame with its title, or its id when it has no title. The frames do not nest.
  A group inside a group draws as its own frame, named from the inside out, such as
  `Data in Cloud`. A group that holds only other groups has no frame of its own.
- A junction draws as a small box with `●`, so each edge that meets it stays whole.
- `-->` draws an arrow head at the right service, and `<--` at the left service. `--` draws a line
  with no arrow head. `<-->` draws a line with no arrow head and `⇄` before its title. An edge
  title, such as `-[calls]->`, stands beside the line.
- The sides `L`, `R`, `T` and `B` choose the direction of the diagram, and which service of a line
  with no arrow head comes first. The layout places the boxes itself, so `align row` and
  `align column` draw nothing. `{group}` draws the edge to the service inside the frame.
- `title` draws its text in bold on the first line. `accTitle` and `accDescr` draw nothing.
- On the terminal, the services take the colours `suggestion`, `planMode` and `merged` in turn.
  The arrow heads are in `claude`. The lines, the frame borders and the edge titles are in
  `inactive`. The frame titles are bold.
- A diagram too wide for the screen draws as the source under the width note.
- These draw as the source under a note that names the reason, as Mermaid refuses them: an edge
  to a group (`line 5: an edge cannot end at the group api.`), an id that the diagram does not
  declare, a group or a service in a group that the diagram does not declare, a group declared
  after a group inside it, an id used twice, an edge from a service to itself, `{group}` on an
  edge inside one group, and an `align` line with one member or a member twice.

The syntax follows the [architecture page](https://mermaid.js.org/syntax/architecture.html) of
Mermaid 12.3.0.

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
| `diagrams`     | `on`     | `on` draws a mermaid diagram of a kind in [A diagram](#a-diagram). `off` draws it as its source     |
| `diagramHints` | `off`    | `on` adds one hint about mermaid diagrams, about 230 tokens, to each prompt that you type           |
| `tableStyle`   | `box`    | `box` draws a full box at 40 columns or more. `rules` draws rules between the columns               |
| `highlight`    | `on`     | `on` draws numbers, durations, versions and paths in their own colours. `off` draws them plain      |
| `headingStyle` | `banner` | `banner` draws a box around H1 and a rule under H2. `bold`, `underline` and `uppercase` draw no box |

| Command                  | Effect                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `/replies`               | Turns the reply view off or on for this session, and replies with the new mode     |
| `/replies hints`         | Turns the diagram hints off or on for this session, and replies with the new state |
| `/replies copy diagram`  | Copies the source of the last diagram of the last reply                            |
| `/replies copy chart`    | Copies the source of the last chart of the last reply                              |
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

- A mermaid block counts as a diagram and not as a code block. A block that holds a `pie`, an
  `xychart` or an `xychart-beta` counts as a chart and not as a diagram.
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
- A `subgraph` inside a `subgraph`, an edge to a `subgraph`, a sequence diagram with `box`,
  `create` or `destroy`, a state diagram with nested states, a fork, a join, a choice or a note,
  a class diagram with a namespace or a note, and every other kind of diagram draw as their
  source.
- A class diagram and an ER diagram always draw one box under the next, whatever their
  `direction`.
- An actor of a sequence diagram draws as a box.
