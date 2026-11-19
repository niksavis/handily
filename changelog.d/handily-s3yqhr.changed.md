- **The this machine tab of `handily-board` reads a session store folder.** The tab no longer
  polls `claude agents --json`. It reads `<store>/sessions/<session id>.json` and
  `<store>/asks/<record>.json` every 15 seconds while it is shown, and lists the open owner asks
  first and then every session with its state: `dead`, `stale`, `needs you`, `working` or
  `quiet`. Set the new option `store` in `/config` to the absolute path of the folder. With no
  `store`, the tab names the option and reads nothing. The new option `answerWindow` names the
  session whose board fills the prompt box when you press an option of an ask. The board never
  sends it. A file that the tab cannot read shows under `files not read` with its reason.
- **Removed without a replacement:** the Inbox, the cards of other sessions with their tasks,
  agents and context, and the store keys `agents` and `session:<id>` that each session wrote for
  the others. Old keys stay in the store of the board and are not read. There is no setting to
  bring the old tab back. (handily-s3yqhr)
