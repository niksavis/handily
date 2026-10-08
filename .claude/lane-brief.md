# Common brief for every handily lane

Read this brief fully before you start. You build ONE tracker record to green in your own git
worktree, and commit it on your worktree branch. The main session holds the claim, reviews and
merges. You do not merge to main, push, or write to the tracker or the ledger.

## Start

1. Run `git merge --ff-only main`, because your worktree may start behind main. Then merge any
   unlanded branch that your record builds on, as the main session names it. Rebase on main when
   that branch lands.
2. Run `npm ci`, then `npm run types` after you create your mod folder.
3. Read `basicly tracker show <record>`: the acceptance criteria and the Scope list in the
   description. Stay inside the scope. `npm run marketplace` generates the marketplace file, and
   you may commit its output.
4. Read docs/design.md, docs/mocks.md (your mod's section: its texts are the spec),
   .claude/CLAUDE.md, AGENTS.md, .claude/rules/mod-authoring.md, and mods/workitems/README.md
   with mods/workitems/types/index.d.ts for the provider contract.
5. Load the `plugin-authoring` skill before mod code. The generated
   `.claude-plugin/types/claude-code/index.d.ts` is the API authority: grep it. Write mods in
   `mods/<name>/`, not in the skill's session folder.

## Rules and traps

- plugin.json carries `"author": { "name": "niksavis" }` and version `0.1.0`. A mod that uses
  workitems lists it under `dependencies`. Load with `claude --plugin-dir mods`, because a
  dependent mod does not load alone.
- No comments or docstrings in `.ts`, `.tsx` or `.mjs`. No machine paths, user names or host
  names in any file or fixture.
- `$.process.run(argv, init)` is positional, CLI only, with a 4 MiB cap. `$.fs` has no watch.
  `$.fs.read` refuses files over 4 MiB. A Pane docks only in fullscreen.
- Do not turn on `checksVoidReturn` in no-misused-promises. `rm -rf` is denied: move files away.
- Never rewrite history: no `git reset`, `git rebase -i`, `commit --amend` or force push, even on
  your own branch. To undo a commit, add a `git revert` commit. Rebasing on main is the only
  rewrite allowed. Never write a raw invisible or bidi character into source: write `\uXXXX`.
- Tests are `*.test.ts` and import from `claude-code/testing`. Assert what a caller or the
  person sees. Every criterion has a test, and a bug fix has a regression test.
- A commit subject is Conventional Commits with a lowercase description of letters, digits,
  spaces and hyphens, ending with the record id in parentheses. Run `git commit` alone. Never
  use `--no-verify`. Fix a hook refusal at its cause.
- Add `changelog.d/<record>.added.md` or `.fixed.md` in the style of the other fragments.

## Done means

- `npm run check` prints `check: passed`, and `basicly verify --mode fast` prints PASS.
- A consumer run where the record names one. For an interactive check, use tmux on a private
  server named after your record: `tmux -L <record> new-session -d`, and `-L <record>` on every
  later tmux command. Never run `tmux kill-server` on the default server.
- Return a change-summary: files, commands with their summary lines, each criterion with its
  test, anything doubtful, your branch and head commit.

## Lessons from the first round (2026-10-07)

- A worktree lane forks from origin/main, so push main before you start lanes.
- The comments kit misreads a JSX closing tag (basicly-x5orgwc). Build elements with function
  calls.
- Prettier rewrites markdown tables under `mods/`. Its padded form passes markdownlint.
- `claude plugin test` loads only code files, and not a mod's dependencies. Put fixtures in `.ts`
  files, and fake `$.workitems` in a dependent's tests.
- A Team org's security plugin bypasses user-tier `classic.SessionStart` and `prompt.compose`.
  Do not rely on either.
- `refresh()` returns `{ created, updated, closed, version }`. Read the version before a tool
  call, and pass it as `since` after it.
- Every lane gets a correctness review before merge. Each review in round one found a major
  defect that the lane's own tests missed.
