- **Tables in replies draw in a full box by default.** The `tableStyle` setting of
  handily-reply-view now has the default `box`. On a screen of 40 columns or more a table draws
  in a box with a double rule under its header and a rule between every row, and the copy
  buttons stand under the box. A stored value other than `rules` or `box` draws the box, and
  the debug log names the value. On the desktop app a table draws in the `rules` style, whatever
  the setting. `/config` › Table style › `rules` restores the earlier look (handily-36bsx.1).
- **Numbers, paths and inline code in replies draw in their own colours.** On the terminal
  reply-view draws every reply. The numbers, durations, versions, paths and inline code in its
  paragraphs, list items and table cells draw in three colours, by the rules of
  `docs/mocks.md` 14.5. Words such as `p95`, `x86_64`, `sha256`, `and/or`, `1/2` and a URL stay
  plain. The new `highlight` setting `off` leaves out only these colours. Copy and copy as text
  copy the same text with the highlight on or off. Headings, quotes, links and HTML keep the
  look of Claude Code (handily-36bsx.1).
- **reply-view follows the Palette setting.** With the `handily` Palette `catppuccin-mocha` and
  a dark theme, or the theme `auto`, the table header, the rules, the numbers, the inline code,
  the paths, the links and the diagram parts draw the Catppuccin Mocha colours (MIT) on the
  terminal. A light or ANSI theme and the desktop app keep the theme keys (handily-36bsx.1).
