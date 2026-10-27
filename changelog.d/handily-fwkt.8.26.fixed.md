- **simple-view draws a tool call that a hook refused as one short row.** Before, a `Bash`
  call that a `PreToolUse` hook refused drew the full multi-line error block of Claude Code. The
  row now shows the description, the program, `refused` in the error colour and the first line
  of the hook message. `more` opens the whole message under the row, and `copy` copies it. Any
  other errored `Bash` text that starts with `Error:`, such as a permission denial, shows
  `error` and its first line in the same way. A generic row of a call that a hook refused shows
  `error`, and the error block of Claude Code under it is gone (handily-fwkt.8.26).
