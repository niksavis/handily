- **simple-view keeps the row of a file call when the session root cannot be read.** A successful
  `Edit`, `Write` or `Read` call fell back to the engine row, and its diff or result block stayed
  hidden. Now the simple-view row draws with the full path of the file, and a running `Read` row
  does the same. (handily-gv64u)
