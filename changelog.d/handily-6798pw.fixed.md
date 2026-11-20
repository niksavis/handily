- **A copy or a prompt fill that no app answered now says so.** Claude Code 2.1.329 adds the
  `unanswered` reason: an app was asked and none answered, so the text may still have landed.
  The copy toasts of reply-view and simple-view, the copy path and @ to prompt toasts of the files
  tab, and the "not filled" line of the board's machine tab now say that no app answered and that
  the text may still be there. Before this fix, the files tab showed no toast for such a copy, and
  the machine tab showed the bare word `unanswered`. (handily-6798pw)
