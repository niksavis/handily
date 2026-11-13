- **handily-board: the status line and the desktop notice no longer say permission for a
  question or a plan approval.** They take the kind from `askWait`, the same rule as the Inbox.
  An `AskUserQuestion` ask reads `asks a question` with the first question, such as
  `app needs you: Claude asks a question: Which region?`. An `ExitPlanMode` ask reads `waits`,
  such as `app needs you: Claude waits: ExitPlanMode`. Two or more waiting agents that are not
  all tool permissions read `2 agents wait for you`. (handily-6u0cq5)
