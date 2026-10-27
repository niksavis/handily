- **handily-simple-view measures every wide character as 2 columns.** Before, some characters
  that Unicode 16 East Asian Width marks wide took 1 column, such as the trigrams, the Yijing
  hexagrams, the Tai Xuan Jing symbols, the counting rod numerals, Kana Extended-B and the
  Tangut supplement. They now take 2. The circled numbers on a black square, U+3248 to U+324F,
  are ambiguous width, so they now take 1 column, not 2. The simple view measures a grapheme the
  same way as handily-board and handily-reply-view. `scripts/width.test.mjs` runs one table of
  cases against the width file of each mod (handily-5zzxk.1).
