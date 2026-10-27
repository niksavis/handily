- **filetree is a new mod: `/tree` opens a `files` tab that lists the working folder.** Folders
  come first, and the mod lists a folder only when you open it. `.git`, `node_modules`, `target`,
  `.venv`, `__pycache__`, `dist` and `.next` show `not listed`. A file whose name starts with a
  dot is dim. A folder draws 200 entries and a more button for the rest. Inline above the prompt,
  the tab draws a flat list of at most 8 rows. `/tree` on a shown tab and `/tree close` close it.
  This release shows no git state and no agent marks. The mod depends on `handily-board`
  (handily-02b2v.2).
