# Contributing to handily

handily has one maintainer. Every change goes through gates and refers to a record in the
tracker. This page is for a contributor. The release steps are in
[docs/maintaining.md](docs/maintaining.md).

## Contribution policy

- **Bug reports and ideas:** open a GitHub issue. This needs no setup.
- **Pull requests:** welcome. Every commit must pass the gates below and name a record that
  the tracker holds. For a change larger than a typo fix, open an issue first. Then the work
  can enter the tracker before you spend time on it.
- There is no guaranteed review time. A small change with one purpose has the best chance.
- Mods show and ask. They never enforce. A rule that must hold for every agent belongs in a git
  hook, not in a Claude Code mod.

## Development setup

You need Node.js 22 or later, the Claude Code CLI, and [uv](https://docs.astral.sh/uv/) with
Python 3.14 or later. The basicly git hooks run on Python.

```sh
npm ci
npm run types
uvx --from git+https://github.com/niksavis/basicly@v0.23.1 basicly hooks-build
```

Each mod commits its engine type snapshot in `mods/<name>/.claude-plugin/types/`. `npm run
types` loads each mod once, headless and without login, to lay the types again. When Claude
Code writes no types that way, the command fails and prints the `claude --plugin-dir` command
that lays them in an interactive session. `npm run check` refuses a snapshot file that git does
not track.

On WSL, use a Linux `node` on `PATH`. A Windows Node.js install does not work for the hooks.

## Quality gates

Run the gates before you push:

```sh
npm run check
```

`npm run check` runs validate, type check, lint and test. CI runs every gate in the table
through `basicly verify --mode full`.

| Gate | Command | What it refuses |
| --- | --- | --- |
| Validate | `npm run validate` | A manifest or marketplace error, a name mismatch between folder, manifest and marketplace, a marketplace file that differs from the `npm run marketplace` output |
| Type check | `npm run typecheck` | A type error against the Claude Code mod API |
| Lint | `npm run lint` | typescript-eslint strict type-checked findings, such as a promise that is not awaited |
| Format | `npm run format:check` | Code that Prettier would change. `npm run check` does not run it |
| Test | `npm test` | A failing test, or a mod with no `*.test.ts` |

The `markdownlint` pre-commit hook lints the Markdown files with the rules in
`.markdownlint-cli2.jsonc`. To run it by hand, use `npx --no-install markdownlint-cli2`.

Never bypass a failing gate. `--no-verify` is not allowed. Fix the cause.

## Add a mod

1. Read [docs/design.md](docs/design.md) and load the `plugin-authoring` skill in Claude Code.
2. Create `mods/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`,
   `hooks/register.ts`, a `tsconfig.json` that extends `./.claude-plugin/types/tsconfig.json`,
   and tests.
3. Run `npm run marketplace` and commit the generated `.claude-plugin/marketplace.json`. The
   generator takes the `version` and the `description` of the mod from its `plugin.json`. Do
   not edit the file by hand.
4. Run `npm run types`, then `npm run check`.
5. Load all mods in a session with `claude --plugin-dir mods`. A mod that needs another mod does
   not load alone.

## Commit conventions

Two `commit-msg` hooks gate every commit:

1. **Conventional Commits:** `type(scope): description`. The description is all lowercase, with
   letters, digits, spaces and hyphens only, and no end punctuation.
2. **Tracker reference:** the message names a record id that the tracker holds, for example
   `feat(handily-board): add the toggle command (handily-fwkt.4)`.

Create the record first and use the id that it prints:

```sh
python3 .basicly/core/kit/tracker/cli.py create .basicly/ledger --title "Title" --field issue_type=task
python3 .basicly/core/kit/tracker/cli.py ready .basicly/ledger
```

A change that a user sees adds a file to `changelog.d/`, and does not edit `CHANGELOG.md`.
[changelog.d/README.md](changelog.d/README.md) gives the format.

## Portability rules

- Never commit an absolute path of one machine or one user, a user name or a host name.
  Defaults must work on Windows, Linux and macOS.
- Never commit secrets. Use environment variables.

## License

Released under the [MIT License](LICENSE). By contributing you agree that your contributions
are released under the same license.
