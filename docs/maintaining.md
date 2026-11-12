# Maintain handily

This page is for the maintainer. It gives the release steps, the CI workflows and the pinned
versions. [CONTRIBUTING.md](../CONTRIBUTING.md) gives the setup and the gates for a change.

## Supported Claude Code version

The mods support only the latest Claude Code. CI pins one Claude Code version. When a new Claude
Code version comes out, move the pin to it and fix each mod that breaks. Do not keep a
fallback for an older version.

## Versions

Each mod has its own version, in `mods/<name>/.claude-plugin/plugin.json`. The marketplace file
pins each mod at its latest release tag. Its entry has a `git-subdir` source that names the tag
as `ref` and the commit of the tag as `sha`. So a fresh install gets each mod at the commit of
its release tag. A merge into `main` reaches no user until the mod is released and pinned.
Claude Code offers users an update only when the `version` of a mod changes. Release only a mod
that changed, and do not change the version of another mod.

A pinned entry has no `version` field. `claude plugin tag` refuses a release with
`Version mismatch` when the entry has a version that differs from `plugin.json`. A new mod has
no entry until its first release. `npm run marketplace` leaves it out and prints a note.

The `handily` mod is the bundle. Its `plugin.json` lists every other mod under `dependencies`,
and `/handily` reads that list. When you add a mod to the bundle or remove one, change that list
and release a new version of `handily`. A release of another mod alone does not change the
version of the bundle.

This repository does not use `basicly release`, because it writes a basicly version file and
one tag for the whole repository.

## Release a mod

The release takes two commits: the release commit, then the pin commit. The pin cannot go in
the release commit, because the pin names the commit of the tag, and the tag points at the
release commit.

1. Choose the new version with [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Set
   it as `version` in `mods/<name>/.claude-plugin/plugin.json`. Do not change the marketplace
   file. Its entry still pins the previous tag, and `npm run marketplace` keeps that pin.
2. Fold the changelog by hand. In `CHANGELOG.md`, add a dated section below
   `## [Unreleased]`:

   ```markdown
   ## <name> <version> - <YYYY-MM-DD>
   ```

3. Move the text of each `changelog.d/<id>.<category>.md` file of the mod into that section.
   Put it under the `###` heading of its category: `Added`, `Changed`, `Deprecated`, `Removed`,
   `Fixed` or `Security`. Then delete those fragment files.
   [changelog.d/README.md](../changelog.d/README.md) gives the fragment format.
4. Run the gates:

   ```sh
   npm run check
   ```

5. Commit the version, the changelog and the deleted fragments in one release commit. The
   subject starts with `chore(release)`, because the changelog gate refuses an edit of
   `CHANGELOG.md` in any other commit. The subject names a record id. Put the version in the
   body, because the hook refuses a dot in the subject.
6. Create the tag on the release commit. The command validates the mod first. It refuses a
   dirty tree, an existing tag, and a marketplace entry with a version that differs from
   `plugin.json`.

   ```sh
   claude plugin tag mods/<name> --dry-run
   claude plugin tag mods/<name>
   ```

7. Pin the mod at the new tag, and commit `.claude-plugin/marketplace.json` alone in the pin
   commit. The command writes the tag and the commit of the tag into the entry of the mod. The
   subject names the record id of the release.

   ```sh
   npm run marketplace -- --pin <name>
   ```

8. Push the tag that the command created, then `main`. The tag has the format
   `<name>--v<version>`, such as `handily-board--v0.2.0`. Push the tag first, so that the tag is
   on GitHub before the marketplace file on `main` names it. Push each tag in its own
   `git push`. GitHub starts no workflow when one push carries more than three tags.

   ```sh
   git push origin <name>--v<version>
   git push origin main
   ```

## Test time gate on a developer machine

The "Test time limit" section of [CONTRIBUTING.md](../CONTRIBUTING.md) gives the rule of the test
time gate: the run alone of a test over a third, the `NOTE`, the `WARN` and the count file in the
git common directory.

## CI

| Workflow | Starts on | What it does |
| --- | --- | --- |
| `.github/workflows/basicly-gates.yml` | A push or a pull request to `main` that changes more than the tracker ledger | Checks the commit messages, runs the basicly drift checks, then `basicly verify --mode full` on a checkout with the full history and all tags, so that validate can read each release tag |
| `.github/workflows/release.yml` | A pushed tag that matches `*--v*` | Checks that the tag and `plugin.json` agree and that the marketplace file is generated, checks the tag with `claude plugin tag`, runs `npm run check` on a checkout with all tags, then publishes a GitHub release with the notes of the `CHANGELOG.md` section of the version |

## Pinned versions

| Tool | Version | Where it is pinned |
| --- | --- | --- |
| Claude Code CLI | See the workflow files | `.github/workflows/basicly-gates.yml` and `.github/workflows/release.yml` |
| basicly | v0.23.1 | `.github/workflows/basicly-gates.yml`, `.vscode/tasks.json` and the setup command in [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Node.js | 24 | `node-version` in both workflows |
| npm dev dependencies | exact versions | `package.json` and `package-lock.json` |
