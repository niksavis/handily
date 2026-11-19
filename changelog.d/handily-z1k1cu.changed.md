- **simple-view: a failed call draws one row and one reason line, and more keeps the row in
  place.** A failed call inside a REPL script, which Claude Code 2.1.328 draws with no output,
  takes its reason from the error text of its `tool.call`. A failed `Edit`, `Write`, `Read`,
  `Grep`, `Glob` or other tool now draws its own row with the first line of the error, in place
  of the red rows of the engine. Under 60 columns the reason wraps to two lines and is cut with
  `more`. `more` no longer opens the output under the row: in fullscreen from 110 columns it
  shows the call in a `call` tab that stays open, and below that the row names
  `/simple open N`. The new `/simple open N` and `/simple open error` show a kept call in the
  tab. (handily-z1k1cu)
- **reply-view: a message from another session draws one row, and the reply fold keeps its
  place.** `Message from @name: name: …` becomes `> from name  first words  3 lines  [ more ]`,
  and ctrl+o still shows the whole message. `more` on a long reply keeps the preview and the
  button at their lines and draws the rest of the reply under the fold row, with no rule above
  the preview. (handily-z1k1cu)
