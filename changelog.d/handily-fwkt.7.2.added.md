- **A pushed mod tag publishes a GitHub release.** The `release` workflow runs
  on a tag `<name>--v<version>`. It refuses the tag by name when the version in
  `mods/<name>/.claude-plugin/plugin.json` differs, when the committed
  marketplace file differs from `npm run marketplace`, or when `CHANGELOG.md`
  has no section `## <name> <version> - <date>`. Then it runs
  `claude plugin tag --dry-run`, `npm run check`, and publishes the release with
  that section as the notes (handily-fwkt.7.2).
