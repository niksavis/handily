- **The markdownlint hook lints the Markdown files.** It skipped before, because
  `markdownlint-cli2` was not installed. It is now a pinned dev dependency, and
  `.markdownlint-cli2.jsonc` sets the line length to 100 and skips generated
  files (handily-vodf).
