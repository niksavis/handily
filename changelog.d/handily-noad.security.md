- **workitems checks UNC and long-path repo roots on Windows.** The check that a
  tracker program is outside the repo root now ignores case for a UNC root such as
  `\\server\share` and treats a `\\?\` or `\\?\UNC\` prefix as the same root. The check
  that a tracker file is inside the root compares with case, apart from the drive letter,
  so a case-sensitive share such as `\\wsl.localhost` cannot reach a sibling folder
  (handily-noad).
