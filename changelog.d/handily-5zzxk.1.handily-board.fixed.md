- **handily-board measures an emoji sequence as 2 columns.** Before, the board counted each code
  point of a sequence. The technologist emoji took 4 columns, a family of three 6, a family of
  four 8, a flag 4 and a thumbs up with a skin tone 4. The warning sign with VS16 and the keycap
  one took 1. So a task title with such an emoji was cut at the wrong column. The board now
  measures one grapheme at a time, the same way as handily-reply-view and handily-simple-view.
  An emoji sequence, a flag, a keycap and an emoji with VS16 take 2 columns. A pictograph with
  no emoji presentation, such as the thermometer without VS16, took 2 columns and now takes 1.
  Every character that Unicode 16 East Asian Width marks wide or fullwidth now takes 2 columns,
  such as Tangut, the Kana supplements, the small form variants and the Yijing hexagrams. The
  circled numbers on a black square, U+3248 to U+324F, are ambiguous width and now take 1
  column. A long agent name that ends in an emoji sequence is now cut between graphemes, so the
  cut never leaves half of a keycap. `scripts/width.test.mjs` runs one table of cases against
  the width file of each mod (handily-5zzxk.1).
