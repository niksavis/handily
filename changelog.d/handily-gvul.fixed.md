- **quiet-items draws the full row when a tracker command also runs other code.** Before, a
  command substitution in double quotes, a backtick, a redirection, an env assignment, or
  `uvx`, `uv run` or `npx` with a flag that fetches code drew one quiet row and hid the
  result. A substitution inside single quotes stays quiet, because the shell does not expand
  it. Every redirection draws the full row, also a redirection to `/dev/null` (handily-gvul).
- **quiet-items goes quiet for a tracker write that ends with a plain `echo`.** The echo can
  hold only literal words and `$?`. After `;`, the row is quiet only when the last output
  line shows an exit status of 0, as in `exit=0`. After `&&`, the exit status of the command
  decides. `br close x; echo ok` draws the full row, because the echo hides the exit status
  of the tracker command (handily-gvul).
