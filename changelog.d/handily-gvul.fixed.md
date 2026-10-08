- **quiet-items goes quiet only for a command with an allowed shape.** Before, the parser
  used a denylist, and a command that also ran other code could draw one quiet row and hide
  the result. Examples are a `$'…'` quote, a command substitution, a redirection, an env
  assignment, `python3 -c'…'`, `uv run` with an option, `uvx`, `npx` and a path such as
  `/tmp/br`. Now each segment must start with a bare `br`, `bd` or `basicly`, or run the
  relative kit path through `python3`, `python` or `uv run python`, with no option. Each word
  must be a plain word, a single-quoted string, or a double-quoted string without `$`, a
  backtick or a backslash (handily-gvul).
- **quiet-items draws the full row when a later command hides the exit status of a tracker
  write.** Only `&&` may join two segments of a quiet row. `br close a; br close b` and
  `br close a || br close b` draw the full row (handily-gvul).
- **quiet-items goes quiet for a tracker write that ends with a plain `echo`.** The echo can
  hold only allowed words and `$?`. After `;`, the row is quiet only when the last output
  line shows an exit status of 0, as in `exit=0`. After `&&`, the exit status of the command
  decides. `br close x; echo ok` draws the full row, because the echo hides the exit status
  of the tracker command (handily-gvul).
