- **handily-board: an Inbox on the this machine tab lists what waits for you in the other
  sessions.** Each row names the session, the kind (`permission`, `question`, `waits`, `decide`,
  `answer` or `do`), the detail and the age. A permission ask with no decision after 3 seconds
  goes into the store key of its session, with the agent, the tool and the masked target. A
  question of `AskUserQuestion` reads `question` with the first question, and a plan approval of
  `ExitPlanMode` reads `waits`. A session that publishes no wait shows the `waitingFor` text of
  `claude agents`, where a plan approval and a tool permission both read `permission prompt`.
  The Inbox shows at most 5 rows and a fold that counts the rest by kind. No row answers a
  prompt. Sessions that load the board from different sources share no store.
  (handily-fwkt.8.28)
