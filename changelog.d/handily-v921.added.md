- **simple-view draws one short row for each Bash, Edit and Write call.** A Bash row shows the
  description, the program, `exit 0` or `exit N` with the first error line, the stdout line
  count and the time. The result block under it has one `Updated` line per changed file with
  its totals. An Edit or Write row shows the path and its added and removed line totals.
  `/simple` switches the view off and on for the session. `/simple show N` prints the input,
  the output and the file diff of the N-th last call, from the last 50 calls with each part
  cut at 8000 characters. The mod depends on quiet-items, and a row that quiet-items drew
  stays as quiet-items drew it. `/simple` does not change the quiet-items mode, because Claude
  Code refuses a write to the state of another plugin (handily-v921).
