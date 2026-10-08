- **A pushed mod tag publishes a GitHub release.** The `release` workflow runs
  on a tag `<name>--v<version>`. It refuses the tag by name when the version in
  `mods/<name>/.claude-plugin/plugin.json` differs, when the committed
  marketplace file differs from `npm run marketplace`, or when `CHANGELOG.md`
  has no section `## <name> <version> - <date>`. Then it runs
  `claude plugin tag --dry-run`, `npm run check`, and publishes the release with
  that section as the notes. The checks run with a read-only token that git
  does not keep. Only the publish job can write, and it runs no repository
  code. Each action is pinned by its commit SHA (handily-fwkt.7.2).
