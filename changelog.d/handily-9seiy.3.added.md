- **The files tab colours folders by their git state and shows line counts and the upstream.**
  A folder name draws in error for `U` or `D` below it, else in warning for `M` or `R`, else in
  success for `A` or `?`. After each git status with a tracked change, one
  `git diff --numstat` gives each changed file and folder `+N` in success and `-N` in error, and
  the header the totals. A binary file shows `bin`, and an untracked file shows no count. When
  the count fails or times out, the tree stays and a dim note at the foot names the cause, with
  `[ retry ]`. After two runs over 5 s the count stops, and the note says so. The ahead count
  draws in success and the behind count in warning, and a second header line shows the upstream
  name dim. Below body 41 the counts drop and the colours stay. Inline above the prompt the
  upstream name drops (handily-9seiy.3).
