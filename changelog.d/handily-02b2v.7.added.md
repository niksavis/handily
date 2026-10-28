- **filetree shows the preview and the diff of a file.** A press on a file row opens it with
  `[ preview ]`, `[ diff ]`, `[ copy path ]` and `[ @ to prompt ]`. The preview shows at most
  2,000 lines in the Code element, or a Markdown file in the Markdown element. A binary file, a
  file over 4 MiB and a file that the mod cannot read each show a one-line note. The diff runs one
  `git diff HEAD` and is cut only at the end of a hunk. An untracked file, or a repo with no
  commit, shows as one added hunk with no process. A press on the counts of a folder shows the
  diff of at most 50 changed files under it (handily-02b2v.7).
