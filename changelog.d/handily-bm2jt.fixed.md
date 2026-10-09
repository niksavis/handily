- **handily-reply-view 0.5.1 keeps the prompt row of Claude Code, with its grey background
  band, and frames it with a coloured rule.** In 0.5.0 the mod drew its own prompt row without
  the band, so a prompt was hard to find when you scrolled. Now a prompt that you type draws a
  blank line, a rule labelled `you` and the time in the `suggestion` colour of your theme, and
  then the prompt row as Claude Code draws it. The rule spans the width of the transcript. A
  prompt that you type while Claude works now shows its time too: 0.5.0 kept the time only for
  a prompt typed while the session was idle. A prompt longer than 60000 characters now also
  gets the rule (handily-bm2jt).
