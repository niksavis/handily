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

`npm run check` runs validate, type check, lint and test. The pre-commit and pre-push hooks
run validate, type check, lint, format and test only for the mods that a change reaches, as the
section on changed checks below describes. CI
runs every gate in the table, the checks of `basicly verify --mode full`, with the mod tests
split into parallel jobs by `node scripts/mods.mjs test --shard <n>/<count>` and the scripts
tests in `npm run test-scripts`.
The shards balance by the time of each test file in `scripts/test-times.json`. A file with no
time there counts by its bytes. To update the times, save the log of each mod test job with
`gh run view --job <id> --log > <file>`, then run `node scripts/mods.mjs test-times <file>...`.

| Gate | Command | What it refuses |
| --- | --- | --- |
| Validate | `npm run validate` | A manifest or marketplace error, a name mismatch between folder, manifest and marketplace, a marketplace file that differs from the `npm run marketplace` output, an entry that does not pin a release tag and the commit of that tag, a released mod with no entry, except at the commit of its first release tag |
| Type check | `npm run typecheck` | A type error against the Claude Code mod API |
| Lint | `npm run lint` | typescript-eslint strict type-checked findings, such as a promise that is not awaited |
| Format | `npm run format:check` | Code that Prettier would change. `npm run check` does not run it |
| Test | `npm test` | A failing test, a mod with no `*.test.ts`, or a test that takes more than a third of its time limit in the suite run and again when it runs alone |

### One test file

`npm test -- --file mods/<name>/<file>.test.ts` runs only that test file of the mod, with the
rest of its folder, through the same copy that the gate uses for a test that runs again alone.
Give `--file` more than once to run more files. It refuses a path that is not a test file of a
mod, and it does not go together with `--shard`. No gate passes `--file`.

### Changed checks in the pre-commit and pre-push hooks

The pre-commit hook and the pre-push hook run the `fast` checks of `basicly.toml`. Each of
these checks runs its command with `--changed`, so it runs only for the mods that the change
reaches:

| Check | Command | What it runs |
| --- | --- | --- |
| `mods-validate-changed` | `node scripts/mods.mjs validate --changed` | `claude plugin validate --strict` for each reached mod. The marketplace checks run only when the change reaches every mod, or when a path in a `.claude-plugin` folder changed |
| `mods-typecheck-changed` | `node scripts/mods.mjs typecheck --changed` | `tsc` for each reached mod |
| `eslint-changed` | `node scripts/mods.mjs lint --changed` | The hidden character check and ESLint over the folders of the reached mods and the changed `.mjs` files under `scripts/` |
| `prettier-changed` | `node scripts/mods.mjs format-check --changed` | `prettier --check` over the changed files under `mods`, `probes`, `scripts` and `eslint.config.mjs`. Its fix command writes the format before the gate |
| `mods-test-changed` | `node scripts/mods.mjs test --changed` | Every test file of each reached mod, and the scripts tests that the list below names |

The commands read the changed paths from one of two sources:

| Hook | Changed paths |
| --- | --- |
| pre-commit | The staged paths, from `git diff --cached --name-only` |
| pre-push | The pushed paths of each pushed ref, from `git diff --name-only` against the remote commit, or against `origin/main` for a new branch |

The pre-push hook gives the pushed refs in the `BASICLY_PUSH_REFS` variable. When that variable is
set but empty, the commands read `git diff --name-only origin/main...HEAD`. Both hooks use the
same map from a changed path to the mods, `changedMods` in `scripts/staged.mjs`:

- A changed Markdown file reaches no mod.
- A changed file in the folder of a mod reaches that mod.
- A changed file outside the folder of a mod that a file of the mod imports reaches that mod.
- A reached mod also reaches each mod that names it in the `dependencies` of its `plugin.json`,
  directly or through other mods.
- A change of `package.json`, `package-lock.json`, `eslint.config.mjs`, `.prettierrc.json`, a
  root `tsconfig*.json`, `scripts/staged.mjs`, or `scripts/mods.mjs` and the files that it
  imports reaches every mod.
- A changed file that maps to no mod reaches every mod. So an unmapped path runs every mod.
  Examples are a file directly under `probes/`, a file of the root `.claude-plugin/` folder, and a
  root file such as `basicly.toml`. A changed file under `scripts/` that no mod imports reaches no
  mod.

When the change reaches every mod, validate, the type check, lint and the format check run as
their full commands. The test check does not use the every-mod rule. It runs the tests of a mod
only for a changed file in the folder of the mod or in the import closure of its source files. A
generated `.claude-plugin/types` file reaches its mod for validate, the type check and lint, but
it runs no test. The test check also runs these scripts tests:

- A changed scripts test runs.
- A scripts test runs when it imports a changed file, directly or through other imports.
- The file-name rule: a scripts test runs when it, or a script that it imports, names the file
  name of a changed file in a string. For example, `scripts/mods.test.mjs` starts
  `scripts/mods.mjs`, and `scripts/width.test.mjs` reads `hooks/width.ts` of each mod. The rule
  also selects a test that only writes a file of that name in a fixture, such as `register.ts`.

A commit of Markdown files only reaches no mod. `prettier-changed` still checks a changed
Markdown file under `mods`, `probes` or `scripts`. When no path changed, or the change
reaches nothing, each `--changed` command says that it runs nothing, names the full command and
passes. `test --changed` does not go together with `--file` or `--shard`. The full gates stay in
CI. The `full` checks `mods-validate`, `mods-typecheck`, `eslint`, `prettier` and `mods-test`
run the full commands, and the `basicly-gates` workflow runs them on every pull request and every
push to `main`, with the mod tests in shards.

### Test time limit

A mod test has a time limit of 5000 ms, unless its `TestOptions` set `timeoutMs`. `npm test`
refuses a test that takes more than a third of its time limit in the suite run and also when it
runs again alone. Make the test faster, or set its `timeoutMs`.

Load on the machine makes a test slower. The pre-commit hook runs its checks in parallel, and a
mod runs its test files at the same time. In the measurement of handily-5rspdc on 2026-11-12, 9
of 10 quiet runs of handily-reply-view had no test over a third. 5 of 10 runs beside the
handily-board tests had 1 to 3 tests over. So the gate measures a test over a third once more:

1. After every mod ran, the gate runs each test file that has a test over a third once more,
   alone. `claude plugin test` cannot run one test or one file in place. So the gate copies the
   mod to a new temporary folder without its other test files, and runs the copy. It removes
   only a folder that this run created under the temporary folder of the system. It fails by
   name when it does not remove the copy.
2. A test that is at most a third alone passes. The gate prints a `NOTE` with both times and
   the load average of the machine.
3. A test that is over a third in both runs fails. A test that prints no time alone also fails.
   The refusal names the mod, the test file, the test, both times, the load average and the
   limit.
4. The limits, the share of a third and the reference times are the same for both runs.

The gate counts the runs alone of each test in `handily-test-reruns.json` in the git common
directory, which `git rev-parse --git-common-dir` prints. All worktrees of a clone share this
file, and git does not track it. The gate prints a `WARN` that names the test, with its count
and its share of the limit, when one of these is true:

- The test ran again alone in 3 or more of its last 5 gate runs.
- The test took more than a quarter of its limit alone.

Such a test comes near its limit. Make it faster, or set its `timeoutMs`. When git does not
answer, the gate prints a `NOTE`, keeps no count, and still refuses a test by its times.

On GitHub Actions, the gate runs no test again and keeps no count. It prints the line of a test
over a third as a `NOTE` and does not fail. A CI runner is slower, and there the time limit of
each test is the gate.

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

A slower developer machine scales the share. `npm test` compares five reference tests with
their reference times in `referenceTestTimes` in `scripts/mods.mjs`. These times were measured
with `npm test` in three runs on one Linux developer machine on 2026-10-27. When the median
ratio is above 1, the gate multiplies each limit by that ratio before it compares the share, and
it prints the ratio. At a ratio of 3 or more, only the time limit itself refuses a test, as on CI.
A ratio at or below 1 keeps the share of a third. Measure the reference times again when one
of these tests changes, or when its title changes.

The `markdownlint` pre-commit hook lints the Markdown files with the rules in
`.markdownlint-cli2.jsonc`. To run it by hand, use `npx --no-install markdownlint-cli2`.

Never bypass a failing gate. `--no-verify` is not allowed. Fix the cause.

## Add a mod

1. Read [docs/design.md](docs/design.md) and load the `plugin-authoring` skill in Claude Code.
2. Create `mods/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`,
   `hooks/register.ts`, a `tsconfig.json` that extends `./.claude-plugin/types/tsconfig.json`,
   and tests.
3. Do not add the mod to `.claude-plugin/marketplace.json`. A mod gets its entry at its first
   release, when `npm run marketplace -- --pin <name>` pins it at its release tag. Until then
   `npm run marketplace` leaves the mod out and prints a note. Do not edit the file by hand.
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
