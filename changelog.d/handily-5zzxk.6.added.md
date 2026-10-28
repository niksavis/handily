- **reply-view draws a mermaid flowchart in a reply as a diagram.** A complete reply with a
  `mermaid` block that holds a `flowchart` or `graph` shows the drawing in place of the source,
  under the title line `── mermaid · flowchart ──`. `[ copy ]` copies the source and
  `[ copy drawing ]` copies the drawn lines, and each toast names what it copied. A block that
  does not draw keeps the look of a fenced block, under one dim note with the reason, such as
  `diagram not drawn: it takes 59 columns, the screen has 38.` A diagram draws whole or as its
  source. A sequence diagram draws as its source for now, with the note
  `diagram not drawn: sequenceDiagram does not draw yet.` A later version draws it. When a long
  reply folds inside a diagram, only the title line of the diagram shows. The new setting
  `diagrams` is `on` by default, and `off` draws every mermaid block as before (handily-5zzxk.6).
