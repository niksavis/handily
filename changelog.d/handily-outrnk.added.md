- **The files tab follows the repository where the agents work.** When Claude or a subagent
  edits a file in another git repository than the session folder, the files tab shows the tree of
  that repository and names it in the header, with its branch and git status. The newest edit
  picks the repository. An edit in the session folder, or a prompt that names a file of it after
  an `@`, brings the tree back. Reads, Bash calls and edits outside any git repository do not move
  the tree, and the mod never runs `/cd`. (handily-outrnk)
