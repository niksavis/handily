- **quiet-items draws the full row when a tracker command also runs other code.** Before, a
  command substitution in double quotes, a backtick, a redirection, an env assignment, or
  `uvx`, `uv run` or `npx` with a flag that fetches code drew one quiet row and hid the
  result. A substitution inside single quotes stays quiet, because the shell does not expand
  it. Every redirection draws the full row, also a redirection to `/dev/null` (handily-gvul).
