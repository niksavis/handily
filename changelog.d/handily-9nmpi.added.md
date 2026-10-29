- **filetree work view fits a large repo.** A chain of folders with one child folder at each
  level now shows as one row, such as `src/api/`, with the git counts of its top folder. A
  folder that the person closed ends the chain. The work view shows at most 40 rows. A more
  row such as `[ +9 changed in 6 folders ]` counts the hidden files that git shows as changed
  and the folders that hold them. When no hidden file is changed, it reads `[ +21 more ]` and
  counts the hidden rows. A press on it shows them all. The tree stops at 1,000 rows and says
  so: `1,000 rows drawn, the most a pane takes.` with `Close a folder, or [ work only ].` While
  an agent is picked or in view, the folder rows keep their git counts (handily-9nmpi).
