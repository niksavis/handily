- **The line at the end of a turn shows its duration and end time in colour.** On the terminal
  handily-reply-view draws the line such as `✻ Baked for 6m 20s · done 2:32 PM` again. It keeps
  the word of Claude Code, and the duration and the end time draw in the number colour of the
  palette. The end time has the format of Claude Code: the `Time format` and `timeZone` settings
  and the locale of `LC_ALL`, `LC_TIME` or `LANG`. A line whose end time the mod did not see
  shows no time. When the line is wider than the screen, `done` drops first, then the end time.
  Claude Code still draws the line while an agent of the session runs, in the ctrl+o view, when
  `Show turn duration` is off, when the `Time format` is a pattern, when `/replies` is off and on
  the desktop app. The line of the mod does not show the token budget or the count of hidden
  messages. It does not see a background shell, monitor or workflow, so it can say done while one
  still runs (handily-0noeh).
