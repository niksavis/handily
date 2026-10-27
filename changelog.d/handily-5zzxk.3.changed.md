- **handily-reply-view keeps each word of a table cell whole when the room allows.** When a
  table is wider than the screen, each long column now gets at least the width of its longest
  word, if the longest words of all long columns fit together and each long column keeps at
  least 6 cells. So a name such as `handily-simple-view` no longer splits inside the word.
  Otherwise, a long word splits at the column width as before. Below 40 columns, or when a long
  column gets fewer than 6 cells, the table still draws one block for each row
  (handily-5zzxk.3).
