- **Headings, lists, task lists, quotes, alerts and links in replies draw in their own look.** On
  the terminal handily-reply-view now draws these blocks itself, by `docs/mocks.md` 15.1. A
  heading draws without its `#` marks. The new `headingStyle` setting picks its look: `banner`,
  the default, draws a box around H1 and a `━` rule under H2, and `bold`, `underline` and
  `uppercase` draw no box. A stored value outside the options draws `banner`, and the debug log
  names the value. A list draws the bullets `•`, `◦` and `▪` by its level, and level 4 and
  deeper keep the indent of level 4. A done task draws `[✓]` with its text dim and struck
  through, and a task list of 3 or more tasks ends with a dim line such as `2 of 5 done`. Each
  level of a quote draws its own `▌`. A quote that starts with `[!NOTE]`, `[!TIP]`,
  `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` draws as a box with the kind as a word on its top
  edge, and under 40 columns as a bar with the word on its first line. A link draws as a link,
  and the host of its address follows in dim when the text differs from the address. A
  `javascript:` or `data:` address draws as text. The `highlight` setting `off` leaves these
  looks as they are. With the `catppuccin-mocha` palette on a dark theme, the boxes of a diagram
  cycle 6 colours, and with the theme keys 3. On the desktop app prose keeps the look of Claude
  Code. A block that the view cannot prove simple keeps the look of Claude Code, and copy and
  copy as text copy the same text as before (handily-36bsx.2).
