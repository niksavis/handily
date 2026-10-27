- **filetree shows the git state of each file and a count on each folder.** A file shows `M`,
  `A`, `?`, `D`, `R` or `U` in its colour, a folder shows counts such as `M2 ?1`, and the header
  shows the branch, the commits ahead and behind and the count of changed entries. A deleted file
  shows in its folder, and a renamed file names the file it came from. The mod reads the branch
  from `HEAD` and polls the stamps of the git `index` and `HEAD` every 2 s while the tab is shown.
  It runs one `git status --porcelain=v2` for each change, after a Bash, PowerShell, Edit or Write
  call, on a prompt and on focus, one at a time and at least 2 s apart. No process runs while
  nothing changes, and none outside a git repo. A failed, slow or missing git shows a line, and
  the tree stays (handily-02b2v.3).
