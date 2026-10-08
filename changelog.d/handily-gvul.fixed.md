- **quiet-items draws the full row when a tracker command also runs other code.** Before, a
  command substitution in double quotes, a backtick, a redirection, an env assignment, `uvx`,
  `npx`, or `uv run` with a flag that picks the code or the environment drew one quiet row
  and hid the result. A substitution inside single quotes stays quiet, because the shell does
  not expand it. Every redirection draws the full row, also a redirection to `/dev/null`
  (handily-gvul).
- **quiet-items draws the full row when a later command hides the exit status of a tracker
  write.** Only `&&` may join two tracker writes in a quiet row. `br close a; br close b` and
  `br close a || br close b` draw the full row (handily-gvul).
- **quiet-items goes quiet for a tracker write that ends with a plain `echo`.** The echo can
  hold only literal words and `$?`. After `;`, the row is quiet only when the last output
  line shows an exit status of 0, as in `exit=0`. After `&&`, the exit status of the command
  decides. `br close x; echo ok` draws the full row, because the echo hides the exit status
  of the tracker command (handily-gvul).
