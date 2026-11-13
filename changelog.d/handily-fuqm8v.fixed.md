- **The reply view passes validation on Claude Code 2.1.323 and draws a minimized prompts pane.**
  Claude Code 2.1.323 adds the `widget` placement, the small form of a minimized pane on the
  desktop app. `claude plugin validate --strict` refused the reply view, because the prompts
  pane took only `dock` and `inline`. Now a prompts pane in the `widget` placement draws its
  header line only, such as `Prompts 12 · at 9`, with no buttons, because a click may not reach
  a widget. Any other new placement draws as `dock`. The board test of the band that yields to
  a drawing beneath it passes again on 2.1.323. The board code did not change. (handily-fuqm8v)
