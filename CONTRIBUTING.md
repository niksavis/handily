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
types` loads each mod once, headless and without login, to lay the types again. A headless run
lays no types. So after a Claude Code upgrade, the command fails for each mod whose
`claude-code/index.d.ts` header names a version other than `claude --version`. It prints the
`claude --plugin-dir` command that lays the types in an interactive session. `npm run check`
refuses a snapshot file that git does not track.

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
| Test | `npm test` | A failing test, a mod with no `*.test.ts`, or a test that takes more than a third of its time limit |

### Test time limit

A mod test has a time limit of 5000 ms, unless its `TestOptions` set `timeoutMs`. `npm test`
refuses a test that takes more than a third of its time limit. The refusal names the mod, the
test file, the test, its time and its limit. Make the test faster, or set its `timeoutMs`.

On GitHub Actions, the gate prints the same line as a `NOTE` and does not fail. A CI runner is
slower, and there the time limit of each test is the gate.

The gate reads `timeoutMs` from the `test` call in the source of the test file. It reads a
number, or a `const` of a number in the same file, also through an object spread. It finds the
test by its `describe` and `test` names. A name can be a string, a template or a `const`
string. When the gate cannot read the limit of a test, it uses 5000 ms. When the names of
two tests can match one test title, the gate uses the smaller limit. A test whose name the gate
cannot read keeps 5000 ms for every title in its `describe`.

The share is a third, not the half in the tracker record:

- In handily-fwkt.8.24, one handily-board test took about 2100 ms on a developer machine. On
  CI it took 4445 ms in a green run, and 5436 and 5964 ms in two red runs. So a CI runner took
  2.1 to 2.8 times as long. The red runs stopped at the limit, so their real factor was 2.8 or more.
- Half of 5000 ms is 2500 ms. Half does not refuse that 2100 ms test, which timed out on CI.
- A third of 5000 ms is 1667 ms. At 2.8 times, a 1667 ms test takes about 4700 ms on CI.
- A quarter leaves more room on CI. But then a developer machine 1.4 times slower than the
  measured one refuses the 900 ms item-toasts test, which passes on CI.

The five slowest tests, measured with `npm test` in three runs on one Linux developer machine on
2026-10-27. No test takes more than a third of its time limit.

| Mod | Test | Time (ms) | Limit (ms) |
| --- | --- | --- | --- |
| handily-board | a draw with 30 agents of 20 tasks reads the state 5 times | 1826 to 1887 | 30000 |
| handily-board | a session from a version that kept no agentPlans draws every plan on the first draw | 1100 to 1161 | 30000 |
| handily-item-toasts | ignores a call that completes after its session ended | 831 to 900 | 5000 |
| handily-item-toasts | closes a background call after 30 minutes without a notification | 548 to 596 | 5000 |
| handily-board | the this session tab draws each Button once, under its own key | 400 to 436 | 5000 |

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
