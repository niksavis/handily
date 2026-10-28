- **reply-view draws a mermaid sequence diagram in a reply as a diagram.** A complete reply with
  a `mermaid` block that holds a `sequenceDiagram` shows the drawing in place of the source, under
  the title line `── mermaid · sequence ──`, with the `[ copy ]` and `[ copy drawing ]` buttons.
  Each participant gets a box and a lifeline. A message draws its label above a solid or dashed
  arrow. A message to the same participant draws as a loop. Notes, `autonumber` and the blocks
  `loop`, `alt`, `opt`, `par`, `critical`, `break` and `rect` draw too. A label wraps to fit the
  screen in at most 3 lines. A diagram that is still too wide draws as its source under the note
  `diagram not drawn: it takes 50 columns, the screen has 38.` The note
  `sequenceDiagram does not draw yet` is gone (handily-5zzxk.7).
