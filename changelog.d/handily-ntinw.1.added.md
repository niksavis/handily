- **The board shows a Log, a richer gate, agent cards and more on the main line.** The Session
  frame title ends with the waits and then `▶ working` or `○ idle`. The context row shows the
  tokens over the window, such as `124k/200k`. The model row counts the main loop requests as
  `N req` and shows the latest time to first token as `ttft 1.2s`. From body 56 each limit shows
  when it resets. The gate row shows the total, a counts row shows allowed, asked and denied,
  and three plain buttons with the hotkeys `f`, `s` and `o` show the last 5 checks of the file,
  shell and other families. Agents that fit side by side draw as cards with their state, task,
  type, tokens, steps and a clock that ticks each second while the tab shows. The digits 1 to 5
  open and close an agent. When the cards do not fit, a terminal body of 80 or more draws the
  lanes and a narrower body draws rows. The new Log shows the prompts, spawns, completions,
  edits, errors and denials, newest first, and an open card or a transcript in view filters it
  to that agent. `/board stats` adds the requests, the time to first token, the tokens over the
  window, the resets and the verdicts in words, and `/board log [agent]` prints the kept log
  (handily-ntinw.1).
- **A Palette setting and `/handily palette`.** The bundle `handily` declares the setting
  Palette in `/config`, `theme` or `catppuccin-mocha`, with the default `theme`. With
  `catppuccin-mocha` on a dark theme or the theme `auto`, the board frames, the gauge fill and
  the rules draw the Catppuccin Mocha colours (MIT). An ANSI theme keeps the theme keys. States
  keep the theme keys. `/handily palette` names the stored value and the theme and prints each
  role with its theme key and hex (handily-ntinw.1).
