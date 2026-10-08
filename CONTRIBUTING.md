# Contributing to handily

handily is maintained by a single maintainer. Every change goes through a gated,
tracker-backed pipeline.

## Contribution policy

- **Bug reports and ideas:** open a GitHub issue. This needs no setup.
- **Pull requests:** welcome. Every commit must pass the mechanical gates below and
  reference a record that the tracker holds. For anything larger than a typo fix, open an
  issue first, so the work can enter the tracker before you spend time on it.
- There is no guaranteed review time. Small, focused changes have the best odds.

## Development setup

You need Node.js 22 or later, the Claude Code CLI, and [uv](https://docs.astral.sh/uv/)
with Python 3.14 or later (the basicly git hooks run on it).

```sh
npm ci
npm run types
uvx --from git+https://github.com/niksavis/basicly@v0.20.2 basicly hooks-build
```

`npm run types` loads each mod once, headless and without login, so that Claude Code
writes the mod's types into `mods/<name>/.claude-plugin/types/`. Those files belong to
your Claude Code build. Git ignores them.

On WSL, use a Linux-native `node` on `PATH`. A Windows Node.js install does not work for
the hooks.

## Quality gates

Run the gates before you push. CI runs the same set through `basicly verify --mode full`.

```sh
npm run check
```

| Gate | Command | What it refuses |
| --- | --- | --- |
| Validate | `npm run validate` | A manifest or marketplace error, a name mismatch between folder, manifest and marketplace, a marketplace file that differs from the `npm run marketplace` output |
| Type check | `npm run typecheck` | A type error against the Claude Code mod API |
| Lint | `npm run lint` | typescript-eslint strict type-checked findings, an unawaited promise among them |
| Format | `npm run format:check` | Code that Prettier would change |
| Test | `npm test` | A failing test, or a mod with no `*.test.ts` |

The `markdownlint` pre-commit hook lints the Markdown files with the rules in
`.markdownlint-cli2.jsonc`. To run it by hand, use `npx --no-install markdownlint-cli2`.

Never bypass a failing gate. `--no-verify` is not allowed. Fix the cause.

## Add a mod

1. Read [docs/design.md](docs/design.md) and load the `plugin-authoring` skill in Claude Code.
2. Create `mods/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`,
   `hooks/register.ts`, a `tsconfig.json` that extends
   `./.claude-plugin/types/tsconfig.json`, and tests.
3. Run `npm run marketplace` and commit the generated
   `.claude-plugin/marketplace.json`. The generator takes the `version` and the
   `description` of the mod from its `plugin.json`. Do not edit the file by hand.
4. Run `npm run types`, then `npm run check`.
5. Load it in a session: `claude --plugin-dir mods/<name>`.

## Release a mod

Each mod has its own version, in `mods/<name>/.claude-plugin/plugin.json`.
Claude Code offers users an update only when that `version` changes. A tag
alone does not reach users. A tag matters only to a user who pins a version
range. Release only a mod that changed, and do not change the version of
another mod.

This repository does not use `basicly release`, because it writes a basicly
version file and one tag for the whole repository.

1. Choose the new version with
   [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Set it as
   `version` in `mods/<name>/.claude-plugin/plugin.json`.
2. Generate the marketplace file again, so that the entry of the mod has the
   same version:

   ```sh
   npm run marketplace
   ```

3. Fold the changelog by hand. In `CHANGELOG.md`, add a dated section below
   `## [Unreleased]`:

   ```markdown
   ## <name> <version> - <YYYY-MM-DD>
   ```

4. Move the text of each `changelog.d/<id>.<category>.md` file of the mod into
   that section. Put it under the `###` heading of its category: `Added`,
   `Changed`, `Deprecated`, `Removed`, `Fixed` or `Security`. Then delete those
   fragment files.
5. Run the gates:

   ```sh
   npm run check
   ```

6. Commit the version, the marketplace file, the changelog and the deleted
   fragments in one commit. The subject names a record id. Put the version in
   the body, because the hook refuses a dot in the subject.
7. Create the tag. The command validates the mod first. It refuses a dirty
   tree, an existing tag, and a `plugin.json` version that differs from the
   marketplace entry.

   ```sh
   claude plugin tag mods/<name> --dry-run
   claude plugin tag mods/<name>
   ```

8. Push the commit, then the tag `<name>--v<version>` that the command created. Push each
   tag in its own `git push`: GitHub starts no workflow when one push carries more than three
   tags.

   ```sh
   git push origin main
   git push origin <name>--v<version>
   ```

## Commit conventions

Two `commit-msg` hooks gate every commit:

1. **Conventional Commits:** `type(scope): description`. The description is all
   lowercase, with letters, digits, spaces and hyphens only, and no end punctuation.
2. **Tracker reference:** the message names a record id that the tracker holds, for example
   `feat(task-pane): add the toggle command (handily-fwkt.4)`.

Create the record first and use the id that it prints:

```sh
python3 .basicly/core/kit/tracker/cli.py create .basicly/ledger --title "Title" --field issue_type=task
python3 .basicly/core/kit/tracker/cli.py ready .basicly/ledger
```

A user-facing change adds a file to [changelog.d/](changelog.d/README.md) instead of an
edit to `CHANGELOG.md`.

## Portability rules

- Never commit a machine-specific or user-specific absolute path, a user name or a host
  name. Defaults must work on Windows, Linux and macOS.
- Never commit secrets. Use environment variables.

## License

Released under the [MIT License](LICENSE). By contributing you agree that your
contributions are released under the same license.
