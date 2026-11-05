- **Wide C4 diagrams draw at 80 columns.** In reply-view, when the elements of one level of a C4
  diagram do not fit side by side, they move onto more rows, and the elements of one boundary stay
  together. An element with no relation joins the level of its boundary. The five C4 examples of
  the Mermaid page now draw at 80 columns, where the context example showed its source before. A
  wrapped box label in a flowchart or a C4 diagram now breaks between words, and only a word longer
  than the box is cut with `…` (handily-2dpxv0.8).
- **A frame title uses the width of its frame.** In reply-view, when the labels of a flowchart or
  a C4 diagram wrap, a frame title is no longer cut to the label width. It takes the room on the
  top edge of its own frame, so the Context example shows `BankBoundary0 [ENTERPRISE]` where it
  showed `BankBoundar…` (handily-2dpxv0.8).
