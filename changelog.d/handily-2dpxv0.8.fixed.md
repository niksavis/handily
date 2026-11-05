- **Wide C4 diagrams draw at 80 columns.** In reply-view, when the elements of one level of a C4
  diagram do not fit side by side, they move onto more rows, and the elements of one boundary stay
  together. An element with no relation joins the level of its boundary. The five C4 examples of
  the Mermaid page now draw at 80 columns, where the context example showed its source before. A
  wrapped box label in a flowchart, a state diagram or a C4 diagram now wraps at spaces and keeps a
  long word whole while its box can widen. A word breaks inside only when the drawing does not
  fit otherwise, and it keeps every character (handily-2dpxv0.8).
- **A frame title uses the width of its frame.** In reply-view, when the labels of a flowchart or
  a C4 diagram wrap, a frame title is no longer cut to the label width. It takes the room on the
  top edge of its own frame, so the Context example shows `BankBoundary0 [ENTERPRISE]` where it
  showed `BankBoundar…` (handily-2dpxv0.8).
- **A C4 diagram that does not fit refuses fast.** In reply-view, the C4 Context example at 38
  columns showed its note after about 2.5 s. It now takes about 0.25 s, because the layout draws
  each box shape once and wraps a description once (handily-2dpxv0.8).
