# Maintain handily

This page is for the maintainer. It gives the release steps, the CI workflows and the pinned
versions. [CONTRIBUTING.md](../CONTRIBUTING.md) gives the setup and the gates for a change.

## Supported Claude Code version

The mods support only the latest Claude Code. CI pins one Claude Code version. When a new Claude
Code version comes out, move the pin to it and fix each mod that breaks. Do not keep a
fallback for an older version.

## Versions

Each mod has its own version, in `mods/<name>/.claude-plugin/plugin.json`. Claude Code offers
users an update only when that `version` changes. A tag alone does not reach users. A tag
matters only to a user who pins a version range. Release only a mod that changed, and do not
change the version of another mod.

The `handily` mod is the bundle. Its `plugin.json` lists every other mod under `dependencies`,
and `/handily` reads that list. When you add a mod to the bundle or remove one, change that list
and release a new version of `handily`. A release of another mod alone does not change the
version of the bundle.

This repository does not use `basicly release`, because it writes a basicly version file and
one tag for the whole repository.

## Release a mod

1. Choose the new version with [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Set
   it as `version` in `mods/<name>/.claude-plugin/plugin.json`.
2. Generate the marketplace file again, so that the entry of the mod has the same version:

   ```sh
   npm run marketplace
   ```

3. Fold the changelog by hand. In `CHANGELOG.md`, add a dated section below
   `## [Unreleased]`:

   ```markdown
   ## <name> <version> - <YYYY-MM-DD>
   ```

4. Move the text of each `changelog.d/<id>.<category>.md` file of the mod into that section.
   Put it under the `###` heading of its category: `Added`, `Changed`, `Deprecated`, `Removed`,
   `Fixed` or `Security`. Then delete those fragment files.
   [changelog.d/README.md](../changelog.d/README.md) gives the fragment format.
5. Run the gates:

   ```sh
   npm run check
   ```

6. Commit the version, the marketplace file, the changelog and the deleted fragments in one
   commit. The subject starts with `chore(release)`, because the changelog gate refuses an edit
   of `CHANGELOG.md` in any other commit. The subject names a record id. Put the version in the
   body, because the hook refuses a dot in the subject.
7. Create the tag. The command validates the mod first. It refuses a dirty tree, an existing
   tag, and a `plugin.json` version that differs from the marketplace entry.

   ```sh
   claude plugin tag mods/<name> --dry-run
   claude plugin tag mods/<name>
   ```

8. Push the commit, then the tag that the command created. The tag has the format
   `<name>--v<version>`, such as `handily-board--v0.2.0`. Push each tag in its own `git push`.
   GitHub starts no workflow when one push carries more than three tags.

   ```sh
   git push origin main
   git push origin <name>--v<version>
   ```

## CI

| Workflow | Starts on | What it does |
| --- | --- | --- |
| `.github/workflows/basicly-gates.yml` | A push or a pull request to `main` that changes more than the tracker ledger | Checks the commit messages, runs the basicly drift checks, then `basicly verify --mode full` |
| `.github/workflows/release.yml` | A pushed tag that matches `*--v*` | Checks that the tag, `plugin.json` and the marketplace file agree, runs `npm run check`, then publishes a GitHub release with the notes of the `CHANGELOG.md` section of the version |

## Pinned versions

| Tool | Version | Where it is pinned |
| --- | --- | --- |
| Claude Code CLI | 2.1.300 | `.github/workflows/basicly-gates.yml` and `.github/workflows/release.yml` |
| basicly | v0.23.1 | `.github/workflows/basicly-gates.yml`, `.vscode/tasks.json` and the setup command in [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Node.js | 24 | `node-version` in both workflows |
| npm dev dependencies | exact versions | `package.json` and `package-lock.json` |
