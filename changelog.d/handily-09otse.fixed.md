- **handily-reply-view: a flowchart line with a semicolon between two statements draws.**
  Mermaid accepts `A --> B; B --> C` and `graph LR; A --> B`, and the reply view refused them
  with `line 2 does not parse`. Now a semicolon outside a label ends a statement, as a new line
  does. A semicolon inside a quoted label, a bracket label, a pipe label or a text link such as
  `-- a; b -->` stays in the label. (handily-09otse)
