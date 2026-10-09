- **handily-reply-view 0.3.0 draws a wide table in wrapped columns, and a reply folds only after
  30 lines.** A table that does not fit the screen wraps its long cells inside their columns, and
  the rows stay aligned. Only a screen narrower than 40 columns draws one block for each row. The
  `copy` and `copy as text` buttons stand on the first header line, so they take no line of their
  own. A heading that reaches into the room of the buttons moves down to a second header line.
  `copy as text` drops markdown marks, backslash escapes and entities, and keeps the address of a
  link. A reply folds only when it is longer than 30 lines, not 12. While a reply streams, Claude
  Code still draws it itself, so the look of the reply changes once when it is complete
  (handily-cvqn7).
