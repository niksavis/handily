- **handily-simple-view 0.4.0 draws one row for each `Read`, `Grep` and `Glob` call, and
  unfolds a group of calls that each draw as one row.** A `Read` row shows the path relative to
  the session root and the line count, or the range of a partial read, such as
  `Read  docs/design.md  lines 160-239 of 674`. A `Grep` or `Glob` row shows the pattern, the
  folder and the count. Claude Code 2.1.295 offered no `Grep` or `Glob` tool in a live check, so
  only tests cover those two rows. While the mode is on, a group of foreground `Bash`, `Read`,
  `Grep` and `Glob` calls draws as rows in place of the line of the engine, such as
  `Read 2 files, listed 1 directory, ran 1 shell command`. A `Bash` row no longer shows a time
  under 1 second. When an error line follows the description, the description keeps up to 40
  cells and the terminal cuts the error line first (handily-vxxvq).
