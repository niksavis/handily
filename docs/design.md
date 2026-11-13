# handily — research and design

Status: revision 3 (record `handily-0m93`), with later decisions added in place. The mods are
built and released. `CHANGELOG.md` lists each release. Sections 4.3, 4.4 and 4.7 are historical.
Claude Code build used for the research: 2.1.293.

Revision 3 corrects errors in revision 2 and adds the decisions from the plan review and the
results of the P0 probes (handily-0m93). The approved mocks are in `docs/mocks.md`.

## 1. Purpose and boundary

handily is a general-purpose repository of Claude Code **mods** (plugins of function hooks)
and a Claude plugin marketplace. Any Claude Code user can install a mod. No mod needs basicly.
basicly, beads, br, beans and other trackers are supported through one provider mod.

**The boundary: mods show and ask. Mods never enforce.**

- A mod draws in Claude's screen and reacts in the session. No agent-agnostic layer can do that.
- Enforcement (commit rules, claim rules, tracker writes as process) belongs in git hooks or
  in a harness. A git hook holds for every agent and for a person at the shell.
- A mod writes to a tracker only on an explicit action of the person, and only through the
  tracker's own CLI, so the tracker's gates still apply.

basicly adapts to handily, not the reverse. basicly-side work is filed in the basicly tracker.

## 2. Decisions

### Decisions from the interview (2026-10-07)

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Where the mods live | This separate repo, a Claude plugin marketplace |
| 2 | Name | `handily` (repo and marketplace) |
| 3 | Tracker extension | Provider mod `workitems` with built-in readers and a CLI adapter contract |
| 4 | quiet-items scope | The screen only. The model still reads the full tool result |
| 5 | task-pane source | Claude's session tasks plus a saved queue per project. Changed by review decision 2 |
| 6 | session-board scope | All local sessions |
| 7 | Extra mods | Keep `work-status` and `item-toasts` (low priority). Drop `commit-link` and `handover`. Review decision 7 drops `work-status` |
| 8 | Mod names | `workitems`, `quiet-items`, `task-pane`, `session-board`, `item-toasts` (`work-status` dropped) |
| 9 | Toolchain | npm plus `typescript` as a dev dependency, for `tsc` checks |
| 10 | Setup scope | Repo, basicly install, this doc, the first epics, all gates and CI, public GitHub repo |
| 11 | Linter | typescript-eslint (strict type-checked) with Prettier |

Why `commit-link` and `handover` were dropped:

| Mod | Existing mechanism in basicly | Verdict |
| --- | --- | --- |
| commit-link | `tracker-commit-msg` and `tracker-claim` git hooks (commit-msg stage) | The git hook is the right layer and covers every agent |
| handover | basicly writes and reads `[session handover` notes and shows the last one at session start | Process logic belongs to the harness |

### Decisions from the plan review (2026-10-07)

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Mocks | The person approves an ASCII mock per mod, for terminal and desktop, before the lanes start |
| 2 | Tasks before a session | They come from the tracker's open items through `workitems`. `/task add` adds a task in any session. The out-of-session queue is dropped |
| 3 | Tracker source per repo | One source per repo. The first detected source is used, or the source named in `.handily.json`. The provider reports the other sources as ignored |
| 4 | Raw tracker edit | A direct `Write` or `Edit` of a tracker file draws a distinct "raw tracker edit" row |
| 5 | quiet-items toggle | The toggle is per session, in `$.state`. `userConfig` holds only the default |
| 6 | Mod versions | Each mod has one version. Bump only a mod that changed. Users update when the `plugin.json` version changes. `claude plugin tag mods/<name>` makes the release tag `<name>--v<version>`. The marketplace pins each mod with a `git-subdir` entry at its latest release tag and the commit of that tag, so a fresh install gets each mod at that tag (handily-lh63p0.4). A merge into `main` reaches no user until the mod is released and pinned |
| 7 | work-status | Dropped |
| 8 | bd data | Items that come from `.beads/issues.jsonl` for `bd` carry the label "possibly stale" |
| 9 | basicly read path | `basicly tracker items --json --status open --status in_progress --status blocked` from `PATH` only, in one call, after the person approves it (handily-8mjdz; it was one `basicly tracker list --status <s>` per open status). Without `basicly` on `PATH` the read fails by name. The repo's `cli.py` fallback was dropped by decision E |
| 10 | Approval key | For basicly: the repo root, the argv, the resolved `argv[0]` and the sha256 of every file under `.basicly/core/kit/tracker/`. A second key holds the same without the kit files. When the kit changed, the approved program's `--version` decides: 0.21.1 or later runs only the installed package, so the second key is enough. Below 0.21.1, or a version that does not parse, the kit files must match. No basicly command runs before approval (decision F). A program that resolves inside the repo root is refused. A CLI adapter needs no approval (decision E) |
| 11 | Repo config | `.handily.json` at the repo root holds data only: `source`, `globs`, `format` and `fields`. Its globs are confined to the root by `realPath`. It cannot name a command (decision E) |
| E | CLI adapter command (2026-10-08) | A repo never names a command to run. The person lists the adapter argv in `~/.config/handily/adapters.json`, keyed on the exact real path of the repo root. Typing that line is the consent, so the adapter runs with no approval ask. A repo `.handily.json` that names a command fails, names the user file and the root, and never repeats the command. The consent covers the command, not one version of the code |
| F | Ask once for basicly (2026-10-08, handily-szdh) | Ask once and keep the answer. No basicly command, `--version` included, runs before the person approves the repo. After approval, a kit change runs the approved program's `--version`. The verdict is kept in memory only, keyed on the approval key and the size and modification time of the program file, so a kit change or a reinstall at the same path runs `--version` again. The guarantee that holds on every path is older: `tracker items` first shipped in basicly 0.21.1, the release that stopped running the repo kit, so a basicly that runs repo kit code fails this read by name before any kit code runs (handily-8mjdz). An approval of `basicly tracker list` does not cover `basicly tracker items`, so the person approves once again. A read without approval through an isolated interpreter was dropped: two reviews each found a way for repo code to run before any check |

### Plugin names (2026-10-09, handily-wltuw)

The person decided on 2026-10-09 to start the plugin name of each mod with `handily-`. The
marketplace lists many plugins, and a short name such as `workitems` did not show that it
belongs to handily.

| Part | Choice |
| --- | --- |
| Plugin name, folder and marketplace entry | `handily-<mod>`, such as `handily-workitems` |
| Bundle | Keeps the name `handily` |
| Slash commands | Keep their short names: `/task`, `/simple`, `/replies`, `/agent-board`, `/session-board`, `/quiet-items`, `/handily` |
| Command description | Starts with `handily ·`, so the menu shows where a command comes from |
| `$.state` keys, `dependencies` and contract folders | Use the new name, because `$.state.set` writes only the value of the calling plugin |
| Model tools of task-pane | `mcp__handily-task-pane__<name>`, because the engine names a tool after its plugin |
| Release | One release of every mod. A new tag is `handily-<mod>--v<version>`. The old tags stay |
| Old ids | `/handily` names each old id that the user, project or local settings still hold, and prints `claude plugin uninstall <old id> --scope <scope>` |

On Claude Code 2.1.295 an update of the bundle from 0.2.0 to 0.3.0 did not install its new
dependency `reply-view` (measured by the person). So an update after the rename leaves the old
ids installed and the new ids missing. With both installed, the two copies collide (measured
with `--plugin-dir` beside the old installed ids): Claude Code refused the commands of one
copy, and `handily-workitems` did not load, because `workitems` had already added
`$.workitems`.

### Signals and colours (2026-10-09, handily-fwkt.8.14)

The person approved this set of marks on 2026-10-09. Every pane draws a state with the same mark
and the same colour. Each mark is one column wide, because an emoji such as ⚡ is two columns
wide in most terminals and breaks the row alignment. A test measures the width of each mark.

| Signal | Kanban meaning | Mark | Nerd | Colour | When the pane shows it |
| --- | --- | --- | --- | --- | --- |
| Doing | in progress | `▶` | `U+EB2C` nf-cod-play | orange | the task in progress, a running agent |
| Done | finished | `✓` | `U+EAB2` nf-cod-check | green | done tasks and agents |
| To do | in the backlog | `○` | `U+EBB5` nf-cod-circle_large | subtle | open tasks |
| Blocked | blocked tag | `■` | `U+EA87` nf-cod-error | red | an agent or a task whose last tool call failed twice |
| Waits for you | needs a person | `◆` | `U+EAA2` nf-cod-bell | yellow | a permission dialog, a question to you |
| Aging | aging dots | `·` `:` `⁝` | none | subtle, then yellow | the task in progress has run 5, 15 or 30 minutes without an update |
| Too much at once | limit on work in progress | `2▶` | none | yellow | more than one task in progress at the same time |
| Stale plan | no update | `⌀` | none | yellow | no plan change for 20 tool calls |
| Retry | rework | `↻` | none | subtle | the same tool call ran again after a failure |

The colours are theme colours of the engine, so they follow the person's theme: orange is
`claude`, green is `success`, red is `error`, yellow is `warning` and subtle is `subtle`. The
handover of 2026-10-09 also names `suggestion`; which signal uses it is open. The task pane
draws its author word in `suggestion`, so a title cannot imitate the author.

The Nerd column gives the Nerd Font icon of each signal when the setting Glyphs is `nerd`
(handily-5jdtf, see "Glyph sets" below). `scripts/signals.test.mjs` checks this column against
`scripts/fixtures/glyphs.mjs`.

`handily-board` keeps the first five signals in its `hooks/signals.ts`, because mods share no
code at run time. `scripts/signals.test.mjs` fails when the table differs from this one, when
another mod keeps a `hooks/signals.ts` that the test does not compare, or when a mark is not one
column wide. The tabs of `handily-board` map their states to the signals as follows. The aging
dots, `2▶`, `⌀` and `↻` are not built yet. In their place, the time of a task in progress reads
`stalled 16m` in `warning` after `STALLED_AFTER_MS` (handily-9uj3n.6, handily-y8t3v).

| Signal | this session: tasks | this session: agents | this machine |
| --- | --- | --- | --- |
| Doing | a task in progress | `running`, `waiting` (drawn as `on hold`) | `busy`, `working` |
| Done | a done task | `done`, `killed` | a session that ended without a failure |
| To do | an open task | `pending`, `idle` | `idle`, an unknown word |
| Blocked | none | `failed` | a session that ended with `failed` |
| Waits for you | none | none | `waiting`, `blocked`, any `waitingFor` |

On 2026-10-09 the person also asked the task pane to drop the author `claude` from each row.
The pane shows the author only for `you` and `tracker`.

The approved example of the task pane:

```text
Tasks  3 of 7 done · 22m
▶ 4 claude  Build the reply view   :  12m   ▸ Edit fold.ts · 14 tools
◆ 5 claude  Ask about the colours          waits for you
○ 6 claude  Release the mods
○ 7 you     Read the mock
[ +3 done ]
Agents  2 running
▶ lane-b   Build compact view   ▸ Bash npm test
■ scout    Probe the engine     ✗ npm test failed twice
```

### Glyph sets (2026-10-29, handily-5jdtf)

The person approved this design on 2026-10-29, with each recommendation. The mocks are in
`docs/mocks.md`, section 11. A mod cannot choose or install a font. A Nerd Font icon is a
Unicode private-use character, and only a Nerd Font draws it. So the plain marks stay the
default, and the Nerd Font icons are an opt-in.

Decisions:

- One setting, Glyphs, with the values `plain` and `nerd`. The default is `plain`. The bundle
  `handily` declares it in its `userConfig`. Six settings could drift apart, and a mod that is
  installed alone draws plain.
- The desktop app draws plain, whatever the setting is. The font of the app is not the font of
  the person's terminal. A render hook knows the surface. A toast does not, so a toast follows
  the setting.
- The git letters `M A ? D R U`, the arrows `↑ ↓`, the running-call mark `▸` and the row bullet
  `●` are the same in both sets.
- No file-type icons in this epic. Each row would lose 2 columns, and a type would mix with the
  git state column.
- The icons are codicons for the states, the family of the VS Code interface. The folders use
  nf-fa-folder and nf-fa-folder_open, because U+F07B is the only icon measured live. No md-
  (Material Design) icon, because those are in plane 15, where each is a surrogate pair.
- An icon right before a digit, as in the Tasks header (`▶1`), may clip the digit, because in
  WezTerm the icon is slightly wider than its cell. Record 5 (handily-5jdtf.5) checks it live.
  If the digit is clipped, both sets get a space, so that the layout stays the same.

Each role of the table changes with the setting. Source of the code points: nerd-fonts
`glyphnames.json` 3.5.1, dated 2026-08-21. The stand-in is the letter that the mocks draw.

| Role | Meaning | Who draws it | Plain | Nerd icon | Code point | Stand-in |
| --- | --- | --- | --- | --- | --- | --- |
| `doing` | in progress, a running agent | board (`signals.ts`), every toast | `▶` | nf-cod-play | `U+EB2C` | Ⓟ |
| `done` | finished | board, toasts | `✓` | nf-cod-check | `U+EAB2` | Ⓒ |
| `toDo` | open, pending, idle | board, toasts | `○` | nf-cod-circle_large | `U+EBB5` | Ⓞ |
| `blocked` | failed, refused | board (also `lanes.ts`), toasts, filetree | `■` | nf-cod-error | `U+EA87` | Ⓧ |
| `waitsForYou` | needs you | board (also `lanes.ts`, `attention.ts`, `vitals.ts`), toasts | `◆` | nf-cod-bell | `U+EAA2` | Ⓑ |
| `edited` | an agent edited the file | filetree `marks.ts` | `✎` | nf-cod-edit | `U+EA73` | Ⓔ |
| `read` | an agent read the file | filetree `marks.ts` | `◦` | nf-cod-eye | `U+EA70` | Ⓡ |
| `folderClosed` | a closed folder | filetree `pane.ts` | `▸` | nf-fa-folder | `U+F07B` | Ⓕ |
| `folderOpen` | an open folder | filetree `pane.ts` | `▾` | nf-fa-folder_open | `U+F07C` | ⓕ |
| `branch` | the separator before the branch in the Files header | filetree `gitview.ts` | `·` | nf-oct-git_branch | `U+F418` | Ⓨ |

The five nerd state icons have five different outlines: a triangle, a tick, a ring, a circled x
and a bell. So the states differ in shape without colour, as the plain marks do.

These marks stay the same in both sets:

| Mark | Meaning | Why it stays |
| --- | --- | --- |
| `▸` | a tool call runs now (`▸ Edit …`) | It means "runs now", not "a tool". A wrench would read as a tool on every row |
| `●` | the row bullet, the same as the engine's | A fallback row of the engine draws `●`, so icons would mix in one column |
| `M A ? D R U` | git state | The letter names the state without colour and matches `git status -s` |
| `↑ ↓` | ahead and behind | Every font has the arrows |
| `▰ ▱`, `━`, `─` | the progress bar, lane cells and rules | Geometry, not a state |
| `· … →` | separators, the cut mark, a status move | Text punctuation |
| `?` | an agent that the engine no longer lists | ASCII is safe in any font |
| `▼ ▶ ◀ ▲ ◇ × ▷ ◁` | diagram arrows and frames of reply-view | An icon would break the line that joins them |

The setting:

- `mods/handily/.claude-plugin/plugin.json` declares `userConfig.glyphs`: a string with the
  options `plain` and `nerd`, and the default `plain`.
- `hooks/glyphs.ts` holds the table and `glyphSettingOf(rows)`. It imports only types, so each
  mod keeps a byte-identical copy, as with `toast.ts`. In handily-5jdtf.1 only the bundle keeps
  it. handily-5jdtf.2 adds the other mods.
- A mod reads the setting from `$.config.list()`: the row whose plugin, without the marketplace
  part, is `handily` and whose key ends in `.glyphs`. It needs no `dependencies` entry. A mod
  reads it at `session.start` and after a `config.set` of that row, and keeps it in its own
  state key `glyphs`. A pane that reads the key draws again when the key changes.
- With no glyphs row of `handily`, `glyphSettingOf` returns `plain`. This is the documented
  default for a mod that is installed without the bundle.
- A row with another value makes `glyphSettingOf` throw
  `handily: userConfig glyphs is "nerdfont"; set it to plain or nerd in /config.` The caller
  logs it to the debug log and draws plain.
- `/handily glyphs` replies with the current setting and one line for each role: the plain
  mark and the nerd icon, each between bars, and the icon name. It shows both sets whatever the
  setting is, so the person can test the terminal before the switch. It reads the stored value
  from `pluginConfigs` in the settings, under the plugin id of the glyphs row, and names a
  value outside `plain` and `nerd`.
- The glyph setting is not tracker data, so the rule "read tracker data only through workitems"
  does not apply.

The width rule and the gate:

- `displayWidth` of each `width.ts` counts a private-use character as 1 column, in the BMP
  (U+E000 to U+F8FF) and in planes 15 and 16. The plain marks and the private-use characters
  are both East Asian Width "A" (ambiguous), and handily counts each ambiguous character as
  narrow. So the width rule does not change. `scripts/width.test.mjs` measures U+E000, U+F8FF,
  U+F0000 and U+10FFFD as 1 column in every copy.
- `scripts/glyphs.test.mjs` pins the table in `scripts/fixtures/glyphs.mjs`. It refuses an
  unlisted keeper of `hooks/glyphs.ts`, two copies that differ, a glyph of more than one code
  point, a glyph that any `width.ts` measures other than 1 column, an emoji glyph, a private-use
  plain glyph, a nerd glyph outside U+E000 to U+F8FF, two roles of one set that share a glyph and a
  table that differs from the fixture. It also refuses an import or an export of a value in
  `glyphs.ts`, also one that Prettier wraps over several lines. Each refusal has a positive
  control.
- The emoji check uses `\p{Emoji_Presentation}`, the rule of `isEmoji` in `width.ts`. The
  plain mark `▶` (U+25B6) has the Unicode property Emoji with text presentation, and every
  terminal draws it one column wide. So `\p{Emoji}` would refuse an approved mark.
- `scripts/copies.mjs` holds the byte-identical check of `toast.ts`, `copy-toast.ts` and
  `glyphs.ts`, so the rule is in one place.

Code facts for handily-5jdtf.2 to .4:

- `mods/handily-filetree/hooks/register.ts` writes the blocked mark in a literal text, not
  through `TOAST_MARKS`.
- `mods/handily-board/hooks/lanes.ts` writes `◆` and `■` in `END_MARKS`, not through `SIGNALS`.
- `toast.ts` finds a toast that holds for the time to act (10000 ms) by the characters `■` and
  `◆` (`MARKS_TO_ACT`). With the nerd set this rule must read the role.

Failure modes:

- **No Nerd Font, so boxes or blank cells.** The default is plain, and `/handily glyphs` is the
  test before the switch. An agent row keeps its words, but a task row has only its mark.
  Never make nerd the default.
- **A double-width font.** A Nerd Font that is not Mono draws each icon 2 columns wide, and a
  Propo font draws it proportional. Each icon then moves the rest of its row. handily cannot
  detect the font. The `/config` description and `/handily glyphs` name Nerd Font Mono.
- **A terminal that counts ambiguous characters as wide**, for example WezTerm
  `treat_east_asian_ambiguous_width_as_wide`, or a CJK locale. Both sets break the same way, so
  nerd adds no new risk.
- **Icons copied into a prompt.** A mouse selection of pane text pastes private-use characters.
  No handily copy button copies a mark.
- **Colour blindness.** Neither set depends on colour. The plain marks and the nerd outlines all
  differ in shape, and each agent, session and toast state also has a word.
- **A screen reader or a pipe.** An icon reads as nothing, and the words carry the meaning.
- **The first frame.** Before `session.start` stores the setting, a pane draws plain, then draws
  again as nerd. Only the marks change, never the widths.
- **A wrong stored value.** It draws plain without a sign, because the engine treats it as
  unset. Only `/handily glyphs` names it.
- **Nerd Fonts moves a code point.** The fixture pins each one.

Not verified:

- Only U+F07B was measured live at one cell (term-uy9muk). The other nine icons wait for the
  live check of handily-5jdtf.5.
- The key under `pluginConfigs` for a marketplace install. The engine types name `<name>` or
  `<name>@inline` for a `--plugin-dir` plugin. `/handily glyphs` reads only the key that equals
  the plugin id of the glyphs row it draws from, so two installs never mix. If the live engine
  keys `pluginConfigs` in another form, a wrong stored value is not named, and plain still draws.
- Whether `$.config.list()` shows the default or the stored value for a value outside the
  options. The test kit has no implementation of `config.list` or `settings.read`, so a test
  fakes both (measured 2026-10-29 in `claude plugin test`).
- The `config.set` matcher on `key`, and the `/config handily.glyphs=nerd` form.
- Measured in the test kit on 2026-10-29: `register(on, options)` receives `plain` for a stored
  value `nerdfont`, and the kit reports "option glyphs in settings is not one of plain, nerd; it
  reads as the default, plain".
- Only the terminal font of WezTerm is covered. Windows Terminal and the VS Code terminal may
  draw boxes.

### Colour pass (2026-10-29)

The person found the mods plainer than the originals: the tables, the diagrams, the board and
the filetree drew almost no colour. The cause was the rule in mocks 9.0, "The blocks are plain
text, with no look markup". The mocks named no colour, so the mods drew none. The person
approved the colour pass on 2026-10-29. The mocks and the theme keys are in `docs/mocks.md`,
section 12.

Decisions, each the recommended answer of mocks 12.9:

- Every mock names its colours in a `Colours:` line under the block, by theme key, never by hex.
  Each coloured state also has a mark, a shape or a word, so the mock still reads with no colour.
- The board draws a frame as text, `╭─ Title ──╮`, in the role key of its section: Session
  `claude`, Tasks `planMode`, Agents `merged`. The engine `Box` border has no title, and an
  absolute title position was never probed. Frames draw at body 41 and wider on the terminal
  only. Inline above the prompt the board draws no frame (mock B7b).
- Diagram lines and lifelines draw in `inactive`, not in `subtle`, because the lines carry the
  meaning and `subtle` has a contrast of 2.1 to 2.6 to 1. Table rules and box borders stay in
  `subtle`. This decision overrides the `subtle` lines in the Colours lines of mocks D1 to D4.
- The table header keeps `claude` and bold in every theme. In the light-daltonized theme the
  contrast is 2.1 to 1, a known failure. The bold text and the `═` rule still mark the header.
- On the desktop a diagram stays in the engine `Code` element until a desktop probe shows that
  rows of mono `Text` keep their joins.
- An opened agent shows one line of its answer.
- When idle, the receipt row shows the last turn dim, so the layout does not jump.
- The mode shows from the latest classic SessionStart, UserPromptSubmit or Stop event. A mode
  change while idle shows at the next prompt or turn end.
- A table cell that holds only a number draws in `planMode`.
- When a denied check is among the last 20, the gate row shows `1 denied` in `error` in place of
  the family counts. This decision overrides the counts in mock B1.
- The filetree colour record also shows the upstream name. handily-dxnxc keeps the @path reveal
  and the to-prompt button.

Engine facts (Claude Code 2.1.312, `.claude-plugin/types/claude-code/index.d.ts`):

- `ThemeKey` lists the keys. The `diff*` keys are line backgrounds, so `+N` draws in `success`.
- `Color` is a `ThemeKey` or a string. BoxProps has `borderStyle`, `borderColor`,
  `borderDimColor` and `backgroundColor`, and no border title.
- `dimColor` draws in the theme dim colour. `Link` draws an OSC 8 span, or its text and then the
  URL in dim, so a table cell draws the link text as `Text`.
- The model of a step is `TurnStepInput.model`. Its effort is `TurnStepInput.effort`, absent for
  a model without effort. No native event carries the permission mode. `permission_mode` is on
  the classic events.
- `TurnCompleteFields.answer` is the report that a subagent delivered, and `agentId` names it.
- `$.config.list()` returns the `theme` row, so a later record can adjust to a light theme.
- The filetree status call already returns `# branch.upstream`, so the upstream name needs no
  extra git call.

Not verified: whether the engine drops colour for `NO_COLOR`, the theme keys of the engine mode
footer, and whether the desktop draws `Box` borders.

## 3. Facts about the mod API

Sources: the bundled `plugin-authoring` skill (its `reference.md` and the generated
`claude-code.d.ts` of build 2.1.293), and the docs at
<https://code.claude.com/docs/en/plugins/mods/overview.md>,
<https://code.claude.com/docs/en/plugins/mods/create.md> and
<https://code.claude.com/docs/en/plugins/mods/reference.md>.

- A mod is a folder with three files: `.claude-plugin/plugin.json`, `hooks/hooks.json`
  (`{ "modules": ["./register.tsx"] }`) and `hooks/register.tsx`, which exports
  `register(on, options)`.
- A hook has the shape `($, e, next)`. The module runs with no DOM and no Node. It reaches
  everything through `$`: `$.fs`, `$.process.run`, `$.store`, `$.state`, `$.ui`, `$.tool`,
  `$.agent`, `$.clock` and more.
- **The API is early access and changes between releases.** The generated `.d.ts` file is the
  authority, not memory. Load the `plugin-authoring` skill at the start of each session.
- The engine writes the type files into each mod's `.claude-plugin/types/` folder at each
  load. That folder is generated. Gitignore it. The basicly comments gate covers `.ts`, and
  those files hold doc comments.
- Checks: `claude plugin validate <mod>`, `claude plugin test <mod>` (`*.test.ts` with
  `claude-code/testing`) and `tsc -p <mod>`.
- Development load: `claude --plugin-dir <mod>` or `CLAUDE_CODE_PLUGIN_DIRS`.
- Sharing: `.claude-plugin/marketplace.json` at the repo root lists each mod by a relative
  `source`. The install line is `/plugin install handily-<mod> --marketplace niksavis/handily`.
- A mod can add a typed noun to `$` in `engine.create` and ship its contract as
  `types/index.d.ts`. A dependent mod lists it under `dependencies` in `plugin.json`.
- `$.fs` has no watch function. A mod cannot watch a file through `$.fs`.

API surfaces each mod needs:

| Need | API |
| --- | --- |
| Replace a tool row on screen | `ui.render` on `{ component: 'ToolUse' }`. Props: `tool_use_id`, `tool`, `input`, `isRunning`, `isErrored`, `isInterrupted`, `output?`, `onScreen?` |
| Replace a tool's result row | `ui.render` on `{ component: 'ToolResult' }`. A standalone tool row draws its result in this separate component |
| Follow Claude's tasks | `tool.call` on `TaskCreate`, `TaskUpdate`, `TodoWrite`; results carry task ids and status |
| Sidebar or band | `$.ui.open({ id, title })` with `ui.render` on `Pane`; `ui.render` on `AbovePrompt` |
| Toggle | `$.command.register` and `command.run`; per-session state in `$.state`; a `userConfig` field for the default |
| Persist across sessions | `$.store` (JSON, max 4 MiB per plugin) |
| Agents of this session | `$.agent.list()`: id, description, type, status, parentId |
| Run a CLI | `$.process.run(argv, init)`. The argv is positional. The default timeout is 30 s. Each stream is cut at 4 MiB. CLI only, not in the desktop app |
| Status line and toasts | `$.ui.status(text)`, `$.ui.toast(text)` |

## 4. The mods

### 4.1 workitems (provider)

Adds the noun `$.workitems` with a typed contract. Other mods list `handily-workitems` under
`dependencies`.

Detection:

- The provider detects the tracker at `$.session.root()` only. It does not walk up to an
  ancestor folder.
- It detects again on `classic.CwdChanged`.
- "No tracker" is its own state. It is not an error.
- One source per repo (review decision 3). The provider uses the first detected source, or
  the source that `.handily.json` names. It reports each other source as ignored.

Snapshot, published as a typed `$.state` ref:

| Field | Meaning |
| --- | --- |
| `state` | One of `ok`, `failed`, `approval-needed`, `stale`, `no-tracker`, `terminal-only` |
| `reason` | Why the state is not `ok` |
| `at` | The time of the read |
| `root` | The repo root |
| `source` | The adapter name |
| `items` | The normalized work items |

A poll that finds no change does not publish the snapshot again. It publishes only the small
`$.state` value `checked`: the snapshot `version` and the time `at` of the check. The header
age of `lines()` uses the newer of `snapshot.checkedAt` and `checked.at` when both have the same
version (handily-fwkt.2.5).

A poll sends its checks at once: the root, the time, the detection of every source and the
signature of the last source at the last root. When the root or the source changed, it checks
the new one again before it reads. An unchanged poll of a 26 MB beads file took 2 to 4 ms in a
live session, measured with a probe that times `await $.workitems.refresh()` (handily-fwkt.2.5).

Normalized work item:

| Field | Meaning |
| --- | --- |
| `key` | `<source>:<id>`, unique across sources |
| `id` | The tracker's id, for example `handily-ab12` |
| `title` | The title |
| `status` | One of `open`, `in_progress`, `blocked`, `deferred`, `closed`, `other` |
| `rawStatus` | The tracker's own status word |
| `priority` | A number when the tracker has one |
| `type` | The work type when the tracker has one |
| `assignee` | The holder when the tracker has one |
| `updatedAt` | ISO time when the tracker has one |
| `source` | The adapter name |
| `url`, `labels`, `parent` | Optional, when the tracker has them |

Refresh:

- Refresh is single-flight and has a minimum interval.
- `refresh()` returns a diff: created, updated and closed items.
- Trigger: the provider polls file mtimes with `$.clock.every`. `watchPaths` with
  `classic.FileChanged` works for a file or a folder, but never for a glob. A team
  organization's security plugin can skip `classic.SessionStart` for user mods, so the mod
  does not use `watchPaths` (probe 2).

Sources, in order of detection:

| Tracker | Detect by | Read path |
| --- | --- | --- |
| basicly | `.basicly/ledger/template.json` | `basicly tracker items --json`, one call for every open status |
| beads (`bd`), beads_rust (`br`) | `.beads/issues.jsonl` | Built-in JSONL reader; over 4 MiB, streamed through a fixed system reader with no approval |
| beans | `.beans/**/<id>--<slug>.md` | Built-in front-matter reader |
| Any other | Globs and a field map in `.handily.json` | Generic JSON, JSONL or front-matter reader |
| Any other | An entry for the repo root in `~/.config/handily/adapters.json` | CLI adapter contract |

basicly:

- The ledger holds `template.json`, `pending-<branch>.jsonl` and `snapshot.jsonl`. Files
  `events-*.jsonl` appear only after a fold. So the provider detects basicly by
  `template.json`.
- The provider runs this command from `PATH` (review decision 9):
  `basicly tracker items --json --status open --status in_progress --status blocked`.
  basicly 0.21.1 or later runs only the installed package for this command. An older basicly
  also runs the repo code in `.basicly/core/kit/tracker`. Every basicly command runs only after
  approval (decision F). The key is the root, the resolved `argv[0]`, the argv and the sha256 of
  every file under `.basicly/core/kit/tracker/`, in every subfolder. A second key holds the
  root, the argv and the resolved `argv[0]`. When only the kit files differ, the provider runs
  `<argv[0]> --version`, and a `basicly X.Y.Z` of 0.21.1 or later approves the read. Any other
  output, or a non-zero exit, asks again. The provider runs the recorded `argv[0]`, refuses one
  inside the repo root, and checks the approval once per read, before the call.
- Without `basicly` on `PATH`, the read fails with "basicly is not on PATH. Install it to read
  this tracker." The provider never runs the repo's `cli.py` (decision E).
- `basicly` and `basicly --version` run with `PYTHONDONTWRITEBYTECODE=1` and
  `PYTHONPYCACHEPREFIX` set to a new folder that does not exist, so no cached `.pyc` file from
  the repo runs.
- `isStdoutTruncated` makes the read fail, and the reason names it.
- basicly leaves out tombstoned records.
- Field map: `id`, `title`, `rawStatus`, `priority`, `type`, `assignee` and `updatedAt`.
- `basicly tracker items --json` prints a JSON array of items in the adapter contract shape.

beads and br:

- Fields: `id`, `title`, `status`, `priority` (0 to 4), `issue_type`, `assignee`,
  `updated_at`.
- The reader skips a line whose `_type` is not `issue`. It skips a tombstone.
- `bd` stores its data in Dolt. So `.beads/issues.jsonl` can be stale. Items from `bd` carry
  the label "possibly stale" (review decision 8).
- Over 4 MiB the engine cannot read the file. The provider then streams it through
  `$.process.spawn` with a fixed system reader: `/bin/cat <absolute path>` on Linux and macOS,
  `%SystemRoot%\System32\cmd.exe /d /c type .beads\issues.jsonl` at the root on Windows. No
  repo file can change the reader, so there is no approval and no `br` run. A reader whose real
  path is inside the root fails by name. Lines are parsed as they arrive; a line whose only
  `"status":` key is closed or tombstone is skipped before `JSON.parse`. Only items that are
  not closed are kept, so the outcome is open-only: a missing item reads as closed. The poll
  signature is the size and mtime, so an unchanged file is not read. On Dolt (`bd`) a file
  over 4 MiB fails by name and runs nothing (handily-vli6x, handily-fwkt.2.4).

beans:

- Each item is a file `.beans/**/<id>--<slug>.md`.
- A file under `archive/` is closed.
- Priority is a word. The reader maps it to a number.
- beans has no assignee.

Limits and safety:

- A file over 4 MiB makes the read fail, and the reason names it. The one exception is
  `.beads/issues.jsonl`, which the provider then streams.
- `.handily.json` globs are confined to the root by `realPath`.
- basicly needs approval (review decision 10). The provider never asks for approval when the
  session is not interactive (`!isInteractive`).
- A repo never names a command to run (decision E). The CLI adapter argv comes only from
  `~/.config/handily/adapters.json`, which the person writes. The key of an entry is the exact
  real path of the repo root, with no patterns. A clone at another path does not match.
- The consent in `adapters.json` covers the command, not one version of the code. A pull that
  changes the script runs new code with no new ask. A clone placed later at the same path
  inherits the entry. With the working folder at the root, `npx`, `python -m`, `uv run` and the
  `require` of `node` load repo code. The check that the program is outside the root covers
  only `argv[0]`.
- The provider refuses a program whose real path is inside the repo root, or whose real path
  the engine does not give. Program lookup skips a relative or empty `PATH` entry, such as `.`.
  On Windows the root comparison ignores case.
- A kit file over 4 MiB, or a covered file whose name holds a control character or is over 256
  characters, makes the read fail. A failure reason or caveat that holds a control character
  or is over 1000 characters becomes a fixed text, so a repo name is never echoed.
- The adapter `name`, `writes`, `watch` and `statusMap` keys are refused when one holds a control
  character or is over 256 characters, or when a list has more than 100 entries.
- Each reader refuses an item whose `id`, `title` or raw status holds a control character or is
  too long. Every read of a tracker file stays inside the repo root.
- `$.process.run` works only in the CLI. In the desktop app a CLI source shows the state
  `terminal-only`.

CLI adapter contract (version 1):

- The person names the command in `~/.config/handily/adapters.json`:
  `{ "<real path of the repo root>": ["prog", "args..."] }`. A repo can ship the adapter script
  and document the command. A repo `.handily.json` that names a command fails, and the reason
  names the user file and the root but never repeats the command.
- `<command> items --json` prints a JSON array of normalized work items to stdout, exit 0.
- `<command> describe --json` prints `{ "name", "version", "contract": 1, "watch": [globs],
  "writes": [argv prefixes], "statusMap": {...} }`. The provider re-reads when a file under
  `watch` changes.
- The provider refuses a contract other than the number 1, and names the value it got.
- A non-zero exit, output that was cut off or bad JSON makes the provider report the adapter
  as failed. It never guesses.

The provider also tells the other mods which paths and which CLI commands are tracker
writes. quiet-items reads that list.

### 4.2 quiet-items (mod 1)

Match:

- Hooks `tool.call` on `Bash`, `Write` and `Edit`.
- A command parser decides with an allowlist (handily-gvul). A denylist missed shapes that
  ran code, such as `$'…'`, `python3 -c'…'`, `uv run --default-index=…` and `/tmp/br`.
- A verb allow-list per tracker comes from each CLI's own help. No `basicly-tracker` binary
  exists.

| Tracker CLI | Write verbs, from |
| --- | --- |
| `br` | `br capabilities` |
| `.basicly/core/kit/tracker/cli.py` | Its help (16 write verbs) |
| `basicly tracker` | `close`, `comments add`, `create`, `dep add`, `dep remove`, `gate report`, `update` |

- A command goes quiet only when all of these hold:
  - Each segment starts with `br`, `bd` or `basicly` as a bare word, or with
    `.basicly/core/kit/tracker/cli.py`. It can also start with `python3` or `python`
    directly followed by that kit path.
  - `uv run` is not allowed. It syncs the project first, and a build backend in the tree
    can run any code.
  - Each segment is a tracker write, or `cd` with one word. `--help`, `-h` and `--dry-run`
    are not writes.
  - No `cd` comes before a segment that runs the kit path, because the relative path then
    names a script in another directory. A `cd` before `br`, `bd` or `basicly` is allowed.
  - Only `&&` joins two segments.
  - Every word is a bare word of `[A-Za-z0-9._/:=@,+%-]`, a single-quoted string, or a
    double-quoted string without `$`, a backtick or a backslash.
  - No option of `python` appears.
  - The command has at most 8192 characters. The parser does not read a longer command,
    and it gives `opaque` with reason `syntax` when a tracker name appears.
- Every other command falls back to the engine row. The parser returns `opaque` when the
  command names a tracker program or the kit path, and `none` when it names neither. A
  script such as `bash close.sh` gives `none`, because the parser cannot see inside it.
- A trailing `echo` is the one exception to the `&&` rule. It holds only allowed words, `$?`
  is the one `$` that it may hold, and no word starts with `-`. After `;` or a newline, the
  mod goes quiet only when the last output line shows `$?` as `0`. After `&&`, a plain echo
  stays quiet, because the exit status of the list is the tracker's. `br close a; echo ok`
  falls back to the engine row.

Draw:

- After `next(e)` succeeds, the mod calls `workitems.refresh()`. It stores the diff in
  `$.state`, keyed by `tool_use_id`.
- `ToolUse` and `ToolResult` render from that state. Without state they return `next(e)`.
- A call that is errored, interrupted or still running returns `next(e)`.
- One row: `work item created  handily-ab12  <title cut to N chars>  open  P2`. The verb is
  created, updated, closed or commented. N comes from `userConfig` (default 60).
- A direct `Write` or `Edit` of a tracker file draws a distinct "raw tracker edit" row
  (review decision 4).
- `ToolUse` has no `isExpanded` prop. The mod cannot see the ctrl+o expanded state.
- It never rewrites what the model reads.

Toggle:

- The toggle is per session, in `$.state` (review decision 5).
- `userConfig` holds only the default. A config write reloads the module and acts on all
  sessions.

### 4.3 task-pane (mod 2)

Historical. Replaced by 4.9, `handily-board` (decision of the person, 2026-10-13). This section
stays as the record of the design. The plugin `handily-task-pane` is removed.

- Commands come first: `/task add` and `/task rm`. The `Pane` is optional, because the mobile
  app has no `Input`.
- The mod owns the task list (user decision, 2026-10-07). A default session has no task tool:
  probe 8 found neither `TaskCreate` nor `TodoWrite` in `$.tool.list()`. The `Task*` tools
  appear only with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, which a mod cannot set.
- At `session.start` the mod registers the model tools `task_add`, `task_update` and
  `task_list` through `$.tool.register`. It adds a system prompt section that tells the model
  to keep its plan in them. The list lives in `$.state`, so it survives a hot reload.
- The list resets on `session.end` with the reason `clear`.
- Failure mode: the model can ignore the tools. Where the variable is set, the built-in list
  also exists, and the pane does not show it.
- A `Pane` docks beside the transcript only in fullscreen mode. Unasked, it docks from 144
  columns. Once the person asks for it, it docks from 110 columns. When the person opens it,
  it docks at any width. Otherwise it draws inline, so the mod needs no `AbovePrompt` band.
- `/task pane` opens it. `userConfig` `mode`: `off`, `toggle` or `always`.
- When the person changes the list, the mod appends a note, so that the model knows. A pane
  Button that runs a tool opened no permission dialog (probe 8).
- Tasks before a session come from the tracker's open items through `workitems` (review
  decision 2). The out-of-session queue is dropped.
- No automatic replay. The person adds open items through an explicit "add N items" button.
- Optional action: promote a task to the tracker through the workitems CLI adapter.
- Risk: Claude can ignore a task added mid-turn until the turn ends.

### 4.4 session-board (mod 3)

Historical. Replaced by 4.9, `handily-board` (decision of the person, 2026-10-13). This section
stays as the record of the design. The plugin `handily-session-board` is removed.

- Main source: `claude agents --json`. It lists interactive and background sessions on
  this machine.

| Field | Meaning |
| --- | --- |
| `startedAt` | Epoch milliseconds |
| `id`, `state` | On a background row |
| `pid`, `status` | On an interactive row |
| `waitingFor` | Optional |

- `--all` adds sessions that ended.
- One call takes 0.73 s (measured three times with `/usr/bin/time`).
- Poll it every 15 s, and only while the pane is visible. One shared poll cache file holds
  the result and its age.
- Worktree and branch: `git -C <cwd> rev-parse --show-toplevel` and
  `git -C <cwd> branch --show-current`. The mod runs git only when a cwd changes.
- Time worked: the spans from `turn.start` to `turn.complete`, for sessions that run handily.
  Other sessions show the elapsed time.
- Completion estimate: completed tasks divided by all tasks, applied to the time since the
  first task. Always labelled `est.`.
  - No estimate until one task is complete.
  - No estimate for N minutes after a task is added.
- Optional extra data from sessions that run handily: the current task, task progress and the
  count of open tasks for the person, under one `$.store` key per session id. `$.store` merges
  writes per key across concurrent sessions that load the board from the same source (probe 6).
  A session started with `--plugin-dir` and an installed session do not share a store (probe
  handily-gmvyf3, Claude Code 2.1.322). The mod writes its key on task events,
  with the current session id. A key is stale when its session is absent from `claude agents`.
  The board does not read the engine's task files on disk, because their format is internal.
- `claude` on `PATH` in a desktop session is not measured (probe 8 needs the person). Until it
  is, the desktop board shows this session and its subagents only.
- This session's own subagents come from `$.agent.list()`.

### 4.5 work-status

Dropped (review decision 7).

### 4.6 item-toasts (lowest priority)

A toast when a work item changes state outside this session. It needs a rate limit.

The toast layout (approved 2026-10-27, handily-ftx0x.2) rests on the measured toast surface in
`docs/mocks.md` section 4. `$.ui.toast` takes plain text and `{ timeoutMs }` only. The box text
is 40 columns wide and shows at most 3 lines. A line break draws as a replacement mark, but a
part padded with spaces to 40 columns starts the next part on its own line.

| Line | Item change | Merged changes |
| --- | --- | --- |
| 1 | `✓ handily-ab12 closed` or `▶ handily-cd34 open → in_progress` | `3 items changed` |
| 2 | `"Draw text mocks for the mods"`, the tracker title, quoted | `✓ 2 closed  ○ 1 created` |
| 3 | A hint, only when there is one | `handily-ab12 handily-cd34 +1` |

- The marks are the approved signals: `✓` done, `○` new or open, `▶` in progress, `■` failed or
  refused, `◆` you must act. An item change takes the mark of the normalised status of its new
  state. `deferred` and `other` take `○`. The status words are the tracker's raw words.
- The title is escaped as the board quotes tracker text, and cut at a whole grapheme with `…`
  to fit its line. Any part longer than its line is cut with `…`, never wrapped into the next
  part. A part that a next part follows keeps 39 columns, so that its line ends in a space. A
  part of exactly 40 columns wraps a word onto the next line (measured on Claude Code 2.1.312,
  handily-ftx0x.2 record comment).
- `timeoutMs` is `2000 + 80` for each visible cell of all parts, at least 6000 and at most 15000.
  A toast with `■` or `◆` outside a quoted title stays at least 10000.
- A failure toast is `■ Work items unavailable`, then the first sentence of the reason, then the
  rest of the reason as the hint. A sentence end inside double quotes, such as quoted adapter
  text, does not split the reason. A recovery toast is `✓ Work items are back`, then the source
  and the open count.
- The 40-column width is `TOAST_COLUMNS` in `hooks/toast.ts`. That file is the one call site of
  `$.ui.toast` in the mod. It exports `TOAST_MARKS`, `toastText`, `toastMs` and `showToast`, and
  it measures width with the mod's copy of `width.ts`.
- `scripts/toast.test.mjs` refuses a mod with a `hooks/toast.ts` that its keeper list does not
  name, two copies that differ, and any use of the `toast` of `ui` in any other file under
  `mods/*/hooks`: a call, a `bind`, a bracket, a plain read or a destructure. `TOAST_MARKS`
  must equal the approved signal marks in `scripts/fixtures/signals.mjs`, which
  `scripts/signals.test.mjs` also reads.
- reply-view and simple-view draw their copy toasts with `showToast` (handily-ftx0x.3). A copy
  toast is `✓ Copied the plan block` or `✓ Copied the output`, then the line count, such as
  `2 lines`. A refused copy is `■ Not copied`, then the reason. A copy that throws is
  `■ Not copied`, then `the transcript shows why`, and the transcript holds the error. The texts
  are in `hooks/copy-toast.ts` of each mod. `scripts/toast.test.mjs` keeps the copies of that
  file equal, as it does for `hooks/toast.ts`.

### 4.7 agent-board (handily-cr7r)

Historical. Replaced by 4.9, `handily-board` (decision of the person, 2026-10-13). This section
stays as the record of the design. The plugin `handily-agent-board` is removed.

- Purpose: one pane that shows what each subagent of this session does. `session-board` shows
  the sessions of the machine. `agent-board` shows the subagents inside one session.
- Decision (2026-10-08, a design lane and a Codex second opinion): a new mod with its own
  `Pane`, not a second view of `session-board` and not an extension of the engine's own
  background agent view. No render component reaches the engine's task list.
- Two panes do not show at once. With both boards open, they are tabs.

Sources of a row:

| Source | Fields |
| --- | --- |
| `$.agent.list()` | `id`, `type`, `status`, `description`, `name?`, `parentId?` |
| `agent.spawn` | the result `{ model, agentId }`; the input `description`, `subagentType`, `name`, `parentAgentId` |
| `tool.call` | `agentId` in a subagent loop, none on the main loop; `tool`, `tool_use_id` and the tool's arguments |
| `turn.complete` | `agentId`, `durationMs`, `usage?` |

Facts from the live probe on Claude Code 2.1.294 (handily-v921):

- A `tool.call` of a subagent carries `agentId`. A main-loop call carries none.
- `agent.spawn` resolved with `model` and `agentId`. `agent.list` showed the Explore agent as
  `running`, then `completed`, and still listed it 90 s after the spawn. A main-loop spawn has
  no `parentId`.
- Two `agentId` values appeared in `tool.call` that `agent.list` never showed. The engine types
  say that the agents of a workflow and the own forks of the engine (compaction, memory) carry
  such ids. The consumer run of the mod saw one more, which called `AskUserQuestion`.

Design:

- Hot path: the `tool.call` hook passes a main-loop call on at once. For a subagent call it
  makes one `$.clock.now()` call and keeps the running call in memory until `next` settles.
  Memory per agent is bounded: a fixed set of fields, the calls in flight, and a target of at
  most 200 characters.
- Every hook on `session.end`, `tool.call`, `agent.spawn`, `turn.complete` and `ui.close` has a
  `.catch` that answers `next(e)`. The `next` of a `.catch` replays a settled call and does not
  run it again.
- Each `session.end` clears the rows. The types say that a `/clear` is a `session.end` with the
  reason `clear`, and that no `session.start` follows it. A resume also ends the session in the
  same process.
- The list and the drawing run only while the pane is drawn. A `$.clock.every(1000)` timer
  redraws while the pane is the shown tab, and stops when the pane closes.
- A loop that `agent.list` never names keeps its row, marked `not listed`. A spawned agent with
  no list row and no loop event gets the same mark, for example a remote workflow agent. The
  header counts these rows apart, so they do not block `all N done`.
- At most 20 rows that `agent.list` never named and that run no call stay. The row seen least
  recently goes first. A row that the list named, or a row with a call in flight, never goes.
- An agent that `agent.list` no longer shows keeps its row. When its turn ended, it stays
  `done`. When its last listed status was not an end and no turn end came, its status becomes
  `unknown` and its time stops at the last sight.

Limits:

- The rows live in the memory of the hooks module. A reload of the mod clears them.
- `agent.list` has no spawn time. An agent that the mod first saw in the list gets the time of
  that sight.
- The mod does not drop the row of an agent that `agent.list` named.

### 4.8 simple-view (handily-v921)

One row for each tool call, one `/simple` switch per session, and `/simple show N` to print a
call in full. The mocks are in `docs/mocks.md`, section 6.

Measured usage (2026-10-08, 94 local session transcripts, top level only): 13356 tool calls.
`Bash` made 11744 of them (88 percent), `Edit` 327 and `Write` 239. So the mod started with
these three tools. `Read`, `Grep` and `Glob` followed.

Generic row (handily-fwkt.8.23, 2026-10-14). The person asked for a row for every tool, with no
list of supported tools. The 6 tools above keep their rich rows. Every other tool draws one
generic row: the tool name (`server · tool` for `mcp__server__tool`), a summary of the input,
the state (`…`, `running`, `done`, `error`), and the line count of the result and the time.

- The summary is the first non-empty text of a fixed list of common field names (`title`,
  `description`, `url`, `query`, `path`, `prompt` and others, in `hooks/generic.ts`), else the
  first non-empty text value of the input. It reads any input shape, so a tool that a new
  release adds gets the row with no change to the mod.
- The line count is the count of lines of `text` in the `tool.call` answer. The API documents
  that field for every tool, while the shape of `result` changes per tool. The mod keeps it in
  `$.state` beside the time.
- An exclusion list keeps the engine row for each tool of the 2.1.300 tool table whose row you
  must read or answer. That covers questions, plans, messages and files to you, findings,
  offers and approvals, and `request_computer`, whose schema has no description. The mod README
  lists each tool and the reason.
- The tests assert what the mod returns: its row, an empty result block, or the element that
  `next(e)` gave. They do not pin the output shape of a tool, so a change of an engine-owned
  output does not break them.

Hand-off to other mods. The order of two plugins in the `user` tier is not in the types. In a
live check on 2.1.300 the chain was `handily-board`, `handily-reply-view`,
`handily-simple-view`, `handily-quiet-items`, then `cc-plugin-diff@builtin`. So the `ToolUse`
and `ToolResult` hook calls `next(e)` first. It draws only when the answer is the engine row
(`type: 'engine'`), and returns any other tree unchanged. A plugin above simple-view draws
before simple-view is asked. So a `handily-board` task row and a `quiet-items` row stay in
either order. The tests load an inline board in the `prepend`, `user` and `append` tiers.

Engine facts (Claude Code 2.1.294, from the generated types and two live probes):

| Fact | Consequence |
| --- | --- |
| `ToolUse` props carry no start time | The mod reads `$.clock.now()` before and after `next(e)` in `tool.call`, and keeps the time in `$.state` by `tool_use_id`. The time includes a permission wait |
| A `$.state` read while drawing subscribes the row | A `$.clock.every` of 1 s writes the running time, so the running row redraws. The timer stops when the call ends |
| An errored `Bash` output is a string `Error: Exit code N` and the stderr lines. A timeout is `Error: Exit code 143` (local transcripts, 2026-10-27) | The row shows `exit N` and the first non-empty line after it |
| A call that a `PreToolUse` hook refused has the output `Error: PreToolUse:Bash hook error: [<hook command>]: <message>`, over many lines (198 such outputs in the local transcripts, grep, 2026-10-27) | The row shows `refused` and the first line of the message, and `more` opens the whole message (handily-fwkt.8.26). A generic row shows `error` and an empty result block. The same shape for a tool other than `Bash` is assumed, not measured |
| Other errored `Bash` outputs start with `Error:` too: a permission denial, a refusal at the permission question, a guard of the engine (local transcripts, 2026-10-27) | The row shows `error` and the first non-empty line after `Error:`. A text without `Error:` draws the engine row |
| A successful `Bash` output has no exit code | The row shows `exit 0`, or `returnCodeInterpretation` when the engine gives one |
| `bashEditDiff` holds the per-file hunks of a `Bash` call | The `ToolResult` shows one line per file with its totals. Replacing that `ToolResult` hides the engine's diff body |
| With Bash edit tracking on, a write call carries `bashEditDiff` and a read-only call carries no field. With tracking off, a write call also carries no field (live probe, handily-s43cv) | A missing field does not prove that the call changed no file. The row draws no result line, and `/simple show N` prints `File diff: not reported by the engine.` (user decision 2026-10-08, option B) |
| The `CLAUDE_CODE_BASH_EDIT_DIFF` variable wins. Else the `bashEditDiffEnabled` setting turns tracking on or off. Else tracking is on only in `auto` or `bypassPermissions` mode, behind a feature gate that the mod cannot read (read in the 2.1.294 binary) | The mod cannot tell whether tracking was on for a call. `/simple show N` prints `File diff: none.` only for a tracked `Bash` call with no changed file |
| `bashEditDiff` with `unavailable` or `skipped` means that the engine did not track the call | The row says `File changes were not tracked for this call`, and `/simple show N` prints `File diff: not tracked by the engine.` |
| An errored `Bash` output is a string, so it carries no `bashEditDiff`. A failed command can still change a file | `/simple show N` prints `File diff: not reported by the engine.` for an errored `Bash` call |
| `Edit` and `Write` outputs hold `structuredPatch` | The totals are the `+` and `-` lines of the patch. A new file counts its content. An update with no patch shows the path only |
| ctrl+o reuses the settled render | No row can expand in place, so `/simple show N` prints the call |
| The normal view folds runs of `Bash` calls into one `ToolGroup` line | While the mode is on, the mod unfolds a group whose calls are all foreground `Bash`, `Read`, `Grep` or `Glob` calls (`isExpanded: true` on `ToolGroup`), so each call draws as its own row (handily-vxxvq). Any other group stays as the engine draws it |
| `$.state.set` on another plugin's key is refused (`quiet-items owns that value and only its owner writes it`) | `/simple` cannot set the `quiet-items` mode. It switches only its own mode |
| The engine folds MCP calls too, as `Called claude-in-chrome` (live, 2.1.300) | The unfold rule also takes a group whose calls draw the generic row (handily-fwkt.8.23) |
| `next(e)` answered `{ type: 'engine', ref: 1 }` for a row that no plugin changed (live probe, 2.1.300). The types say that `ref` 0 draws the original props | The mod reads `type` only. It cannot see a plugin beneath it that only rewrites the props of the engine row |
| The engine draws no row for `ToolSearch` (live, 2.1.300) | `ToolSearch` keeps the engine row and does not keep a group folded |
| A plugin that serves its own tool and stands above simple-view answers `tool.call` without `next` (`handily-board`, live, 2.1.300) | simple-view sees no such call: `/simple show N` does not keep it, and its generic row has no time and no line count |

Defer to quiet-items:

- `handily-simple-view` lists `handily-quiet-items` under `dependencies`, so the `quiet-items`
  contract types the read of its `rows` key.
- When `quiet-items` stored rows for a call and its `mode` key is not `off`, both renders go
  to `next(e)`. quiet-items stores rows also while its mode is off, so the mod reads the mode
  (unset means on, as in quiet-items).

`/simple show` memory:

- The mod keeps the last 50 calls of the main loop in a `StateFamily` of 50 slots, and a
  `count` key that it raises with `ifVersion`.
- It cuts each part (input, output, diff) at 8000 characters.
- `/simple show N` reads the slot of call `count - N` and checks the sequence number in it, so a
  slot that a lost write left behind is not shown as the wrong call.
- `session.end` (every reason, `/clear` and resume included) raises a `generation` key and
  sets `count` to 0. Each kept call holds its generation, and each time record is keyed
  `<generation>:<tool_use_id>`, so nothing of an ended session is reachable. `$.state` has no
  delete. The slots are written over, so they stay at 50. One time record stays per `Bash` call
  and per call with the generic row, and one line count per call with the generic row.
- A call of a tool other than the 6 rich tools prints `File diff: not reported by the engine.`

### 4.9 handily-board (handily-fwkt.8.19)

- Decision of the person (2026-10-13): one plugin, `handily-board`, replaces `task-pane`,
  `agent-board` and `session-board`. It has two panes, which the engine shows as two tabs:
  `this session` (tasks and this session's agents) and `this machine` (every local session).
- The old plugins are removed with no alias and no deprecation version. A release note tells a
  person who installed one how to uninstall it and install `handily-board`.
- The bundle `handily` lists `handily-board` in place of the three old plugins. `/handily`
  names `handily-task-pane@handily`, `handily-session-board@handily` and
  `handily-agent-board@handily` as old ids of `handily-board`, with the command that uninstalls
  each (handily-fwkt.8.19.4).
- Command: `/board`. `/board machine` shows the second tab. `/task` is dropped, because it sits
  next to the built-in `/tasks` (background jobs) in the slash menu.
- One plugin, not two, because each plugin has its own `$.store`, and a plugin opens only its own
  panes. With two plugins, the agent data of other sessions would sit in two stores, and
  `/board` could not show the machine tab.
- Facts measured in tmux on Claude Code 2.1.296:
  - A pane in a hidden tab does not draw. The poll of `claude agents --json` also runs only while
    its pane `isShown` (`index.d.ts`, `UiPane`).
  - A command that opens both panes gets both placed at 90 and at 120 columns in fullscreen.
  - A second `ui.open` of a hidden pane without `focus` does not bring it forward. With
    `focus: true` it does, and the pane takes the keyboard. So `/board` passes `focus` only when
    the asked tab is hidden.
- Facts measured in tmux on Claude Code 2.1.312 (handily-9uj3n.10), with a probe mod that logged
  each `ui.focus` event:
  - ctrl+x tab moves the keyboard in a cycle: from the prompt to the first pane in tab order, from
    each pane to the next, and from the last pane back to the prompt. Each pane it reaches comes
    forward.
  - After `/board`, the shown pane already holds the keyboard, because the open passed `focus`.
    Tab then reaches the Session line, the task rows and their buttons. After Esc, ctrl+x tab and
    Tab do the same.
  - ctrl+x tab pressed while the this session tab holds the keyboard gives it to the this machine
    tab. That tab draws cards with no button, so its ring holds only the engine's tab row and close
    mark. Every `ui.focus` event then named `requestId` `sessions`. This was the cause of the
    report that Tab never reached a task row. Neither tmux nor the buttons of the mods caused it.
  - The files pane behaves the same: Tab right after `/tree` reaches its agent filter.
  - Rechecked in tmux on Claude Code 2.1.312 (handily-ykphy): the hotkey `v` of the files tab fired
    right after `/tree`, and again after ctrl+x tab had cycled the keyboard to the files tab. So
    the earlier finding that `r` did not fire had the same cause: ctrl+x tab had moved the keyboard
    to another pane. Pane hotkeys fire while their pane holds the keyboard.
- Release 1 needs neither handily-fwkt.8.10 (needs you) nor handily-fwkt.8.11 (agents of other
  sessions). An agent with the status `waiting` draws as `on hold` until 8.10 proves which waits
  are the person's.
- The approved mock is `docs/mocks.md` section 8.
- The person drives the list as Claude does (handily-9uj3n). `/board done`, `/board start` and
  `/board open`, and the same buttons on an opened task, set a status through the `setStatus`
  that `task_update` uses. A change of the person no longer appends a note at once. It waits in
  `$.state` under `personChanges`, and the next prompt that enters carries one note with every
  change, as `prompt.submit` context. So the person can make many changes in one turn, and
  Claude reads them once. The cost: Claude does not see a change during the turn in which the
  person makes it, unless a task tool answer shows the list. A prompt takes the queue in one
  state update, which stores an empty queue. A prompt that is dropped or fails puts its changes
  back in front. So two prompts that overlap never tell one change twice or lose one.
- `/board clear` and `[ clear done ]` remove every done task (handily-9uj3n.2). Done tasks still
  count against the limit of 100 tasks, so the limit stays one simple rule. When the list is full
  and holds done tasks, the refusal counts them and names the remedy of the caller. The person
  gets `/board clear`. Claude and a subagent get `task_update` with the status `removed`. An
  add never removes a task to make room.
- The task header draws a bar of the done, in progress and pending tasks, with their counts,
  and `✓ all N done` with the time until the list became all done (handily-9uj3n.6). The
  activity keeps that moment as `doneAt`, set by `withClocks` with `isAllDone`. The bar of the
  header and the bar of a this machine card share `barCells` in `hooks/bar.ts`, so one rule
  splits the cells. The approved mock is `docs/mocks.md` 8.2d3.
- `task_add` takes `titles` for several tasks and `before` for a place (handily-9uj3n.5). It
  adds through `addTasks`, which checks the room for the whole batch first and then calls
  `addTask` for each title, so one bad title or a batch over the limit adds nothing. A batch of
  more than one task draws one transcript row of the kind `addedMany` (handily-lqssg). The row
  shows `Tasks`, the ids, `added`, `before N` when the call names a place, and the titles joined
  with a middle dot: `Tasks 3, 4 added  Write the mocks · Ask the person`. The titles are cut at
  the end, and `+N` counts the titles that are not shown. The head is never cut. Two ids read
  as `3, 4`, and three or more consecutive ids read as a range, `3-7`, as the orchestrator
  decided. Ids that are not consecutive are listed and cut with `+N`. The `/board` replies use
  `idsText` and write two consecutive ids as `1-2`, but the row lists them as `1, 2`. A refused
  batch draws the error row of Claude Code.
- `/board edit` gives a task a new title (handily-9uj3n.4). It uses `titleRefusal`, the title
  rule of `addTask`, so an add and an edit refuse the same titles. The task keeps its author: a
  task of Claude stays quoted as data in the list, also after the person gives it a new title.
- Every task row has `[ rm ]`, and `/board mv` places a task before another task or at an end
  of the list (handily-9uj3n.3). `/board mv` and `task_move` share `moveTask`, which now also
  takes the end of the list. Claude Code keeps the focus ring at the same index when a pane
  draws again (measured on 2.1.300). So the key of an `up` or `down` button holds the place of
  its task, and after a move the mod calls `$.ui.focus` with the key at the new place. That key
  exists only in the next drawing, so the engine waits for it and moves the focus after the
  draw. This rests on the documented wait of `$.ui.focus`. It is tested through the requested
  key only. A tmux check on 2.1.311 could not reach the task buttons (Tab cycled only the tab row
  and the close mark), so no live check has confirmed it.

#### The Session line, the checks and the agent states (handily-xsjad)

The person approved the design on 2026-10-27 (handily-xsjad.2). The approved mock is
`docs/mocks.md` section 8.10. The board draws a number only when an engine event or an engine
call reports it. The event names and fields come from the generated `index.d.ts` that Claude Code
2.1.300 wrote.

References: claude-flightdeck (github.com/scasella/claude-flightdeck) at commit `f9c3c523`, MIT
licence, by Stephen Casella. claude-agent-flow (github.com/Charlie0113-T/claude-agent-flow) at
commit `76ef8fb`, Apache-2.0 licence, by Charles Tao. handily only read them. It copies no code
from them and adds no dependency.

The engine event behind each number:

| Number on the board | Engine source |
| --- | --- |
| `ctx 62%`, `context 124k of 200k` | `session.measure`: `context.percent`, `context.tokens` and `context.window` |
| `$4.18` | `session.measure`: `cost.usd`, the total of the session |
| `turn +$0.31`, `last +$0.62` | `session.measure`: the growth of `cost.usd` since `turn.start` |
| `last turn 3m` | `turn.start` and `turn.complete` |
| `limits 5h 31% · 7d 13%`, `resets 5h in 2h` | `session.measure`: `rateLimits`, each with `kind`, `percentUsed` and `resetsAt` |
| `full ~1h`, `pace 5h full ~1h` | the readings of `rateLimits` over time, under "A pace for the usage limits" below |
| `ctx 48k · out 6.1k` on an agent | `turn.step`: `usage` of the last step with that `agentId`. Input tokens of all three kinds, and `output_tokens` |
| `stopped at max_tokens` | `turn.step`: `stopReason` |
| `checks 25 · 8 allowed · 16 asked · 1 denied` | `tool.check`: `decision`, with `tool`, `input` and `agentId` |
| `slow 45s`, `3 edits`, `0 errors` | `tool.call`: the time until `next(e)` settles, the count of edit calls, and `isError` |
| `quiet 3m` | the time since the last `turn.step`, `tool.check` or `tool.call` with the `agentId` of the agent |
| `needs you`, `◆ 1 waits`, the notice | `tool.check`: `decision` `ask` with `tool_use_id`, and no `tool_decision` record with that `tool_use_id` on `telemetry.log` to `collector` within 3 s |
| `failed`, `running`, `2 agents spawned` | `$.agent.list()`: `status` |
| `1 compaction` | `session.compact` |

The numbers that the engine does not give:

- No cost for each agent. `cost.usd` is the total of the session. `turn.step` gives tokens, not
  dollars, and the board does not price tokens.
- No context percent for an agent. `turn.step` gives no context window, so an agent row shows
  tokens only.
- No percent of the compaction window on the Session line. `session.measure` never carries the
  breakdown, and only the breakdown measures against the compaction window. The context parts of
  handily-u2exd show such a percent for each part, from a breakdown that the board asks for. The
  next section describes it.
- No sure signal that a permission dialog is open. A `tool.check` answer of `ask` is a verdict,
  and a classifier or a host can answer it with no dialog. The handily-xsjad.1 probe measured
  this on Claude Code 2.1.312 in tmux, with a subagent Bash call:
  - In the default mode, `tool.check` answered `ask` with the agent id and the tool use id. The
    dialog showed, and the `tool.call` of the same id ended 11 s later, after the approval.
  - `classic.PermissionRequest` never reached the probe. Claude Code said that the organisation
    plugin `cc-plugin-sec-default` runs first and sends the event on. `classic.Notification`
    recorded nothing.
  - While the dialog waited, `$.agent.list()` reported the agent as `running`, not `waiting`.
  - In auto mode, `tool.check` also answered `ask`, and the classifier settled the ask with no
    dialog. That quick call ended about 0.6 s later. The end of a call is not the time of the
    decision, because an allowed call ends only after it ran.
  - With the files pane given the keyboard by ctrl+x tab, the hotkey `r` did not fire. So the
    hotkeys `s` and `c` are not adopted, and section 8.7 holds. The recheck of handily-ykphy found
    that ctrl+x tab had moved the keyboard to another pane, and that pane hotkeys do fire. Adopting
    `s` and `c` is now a design choice, not a limit of the engine.

  The handily-bc7hqa probe found the decision on Claude Code 2.1.318 on 2026-11-04. When the
  dialog or the classifier settles an ask, the engine logs the record `tool_decision` on
  `telemetry.log` to `collector`. The record needs no telemetry setting, and it carries the
  attributes `tool_use_id`, `decision`, `source` and `permission_mode`. Then the tool runs.
  - In the default mode the record came 11 ms after the approval, with `decision` `accept` and
    `source` `user_temporary`. The dialog had been open for 5 s.
  - In auto mode the record came 0.4 s after the check, with `source` `config`.

  So the board forgets an ask at its `tool_decision` record, not at the end of the call. The
  hook passes every record on unchanged. An `ask` with no decision after 3 s is the only sign of
  a waiting person.
- No cost and no context where the host gives no usage. Then the Session line reads
  `no context or cost on this host` and draws no number.

The named thresholds:

| Name | Value | Effect |
| --- | --- | --- |
| `CONTEXT_HIGH` | 80 (percent) | From this context percent, the board adds `high` in the warning colour |
| `SLOW_CALL_MS` | 30000 | A call of an agent that runs longer makes the agent `slow` |
| `QUIET_MS` | 120000 | A running agent with no event for this time is `quiet` |
| `LANES_FROM` | body 80 | From this body width, the agent rows have a `ctx` column and a lane |
| `CHECKS_KEPT` | 20 | The board keeps the last 20 checks. `[ last 5 checks ]` shows 5 of them |
| `STALLED_AFTER_MS` | 900000 (15 minutes) | A task whose current run in progress is longer draws its time as `stalled 16m` in the warning colour (handily-9uj3n.6, handily-y8t3v). The clock keeps `runAt`, the start of the current run |

#### Plan tasks, tasks for you and the band (handily-9uj3n.7, .8 and .9)

The person approved the mocks on 2026-10-29, with every recommended answer of the designer. The
approved mocks are `docs/mocks.md` 8.11 (plan tasks), 8.12 (tasks for you) and 8.13 (the band).
Line numbers below are of the `index.d.ts` that Claude Code 2.1.312 wrote.

Decisions of the person (2026-10-29):

1. The sections are numbered 8.11, 8.12 and 8.13. A line in 8.0 says that the margin tags `8.10`
   and `8.11` name handily-fwkt records, not sections.
2. The tasks of an approved plan have the author `claude`. Claude wrote the steps and does them.
   With the author `person`, every row would read `You:` and look like work for the person. The
   note says that the person added them.
3. The band shows the plan offer while an approved plan waits (8.13f). The person approves the
   plan at the prompt, so the band is where they look, and the keyboard reaches it.
4. The setting `band` in `userConfig` takes `on` (the default) or `off`. The engine collapse of
   the band lasts only for the session.
5. The band shows whenever the this session tab is not shown: `isShown` false, and also a tab
   that waits undrawn (`isPlaced` false). The person cannot see the tasks in those states.
6. The tasks for you on a this machine card (8.12l) are built in a later record, handily-nvtbc.
   The store key of a session holds `openForYou`, the count of its open tasks for the person. A
   count over 0 makes the session need you, by the same rule as a permission wait.
7. The answers that Claude received fold under `[ +N answered ]`. They count against the limit
   of 100 tasks, and `[ clear done ]` and `/board clear` remove them, as done tasks.
8. The steps of a plan are the items of the first top-level numbered list with at least 2
   items. The block shows the count and the first two steps, so a wrong pick shows before the
   press. A list under a heading named "Steps" was the rejected choice, because it is fragile.
9. After the approval, when Claude adds tasks with `task_add`, the button stays and a warning
   line says that the steps may repeat (8.11f). The board never removes a repeat by itself.
10. An answer is one line of at most 1000 characters. The control and bidi rules of
    `titleRefusal` refuse it by name.

The band reads `stalled` before a stalled time since handily-crupjy.2. The pane task row reads
the same word since handily-y8t3v. Both take it from `runTime` in `hooks/activity.ts`.

Source of an approved plan (handily-9uj3n.7):

- The plan text arrives in the tool result, not in the input.
  `BuiltinToolInputs.ExitPlanMode` holds only the deprecated `allowedPrompts`.
  `BuiltinToolResults.ExitPlanMode` (`claude-code-tools/index.d.ts`) holds `plan: string | null`,
  `isAgent`, `filePath`, `planWasEdited`, `awaitingLeaderApproval` and `requestId`.
- The board hooks `tool.call` on `ExitPlanMode` and awaits `next(e)`, which runs the approval
  dialog. A result that is not an error and not a deny, from the main loop (no `agentId`), that
  is an object with a string `plan`, `isAgent` false and `awaitingLeaderApproval` not true, is an
  approved plan. When the person edits the plan, the result carries the edited text.
- Measured on Claude Code 2.1.312, interactive, in plan mode (handily-9uj3n.7 probe):
  - Approved: the tool result has no error. Its record is
    `{"plan": "1. Create a.txt\n2. Create b.txt\n3. Create c.txt\n", "isAgent": false, "filePath": …}`.
  - Rejected, with "Tell Claude what to change" or with Esc: the tool result is an error. Its
    text starts `The user doesn't want to proceed with this tool use.`, and its record is the
    string `User rejected tool use`, with no `plan` field.
  - So an errored call or a result that is not an object gets no offer. The tests use these
    shapes as fixtures.
- A fallback source carries only a path: `prompt.attachment` with `plan_mode_exit` gives
  `planFilePath` and `hasPlan`. The board does not use it.
- The transcript button goes on the `ToolResult` row of the call. `ui.render` allows "return it,
  wrap it", so the board draws `next(e)` and its line under it. The `UiFocusComponent` is
  `'Pane' | 'AbovePrompt'`, so a terminal person can only click the transcript button. The
  keyboard paths are the Plan block of the pane, the band and `/board plan`.
- A toast cannot hold a button: the `ui.toast` argument is `{ text, timeoutMs }`.
- Claude often goes on in the same turn after the approval and can call `task_add` itself. The
  warning of decision 9 covers that.

Tasks for you (handily-9uj3n.8):

- A task for the person is a task of the shared list with `for: 'person'` and a `kind` (`do`,
  `answer` or `decide`). It shares the ids and the limit of 100 tasks. The Tasks section, its
  header, the band and the this machine card count only the other tasks.
- The result of the person (`done`, `answered`, `chose` or `rejected`) is kept on the task, with
  `isSent` false. The next prompt that enters marks every unsent result as sent in one state
  update, and carries one note with the list changes of 8.6 and the answers. A prompt that is
  dropped or fails marks them unsent again. `[ undo ]` and `/board undo` clear an unsent result
  in one update of the list, so an undo never races a prompt. This differs from the designer's
  sketch, which queued each result in `personChanges`. There an undo had to change two state
  keys, and a prompt between the two writes could send an answer that the person had undone.
- `task_update` with the status `removed` withdraws a task for the person. The row stays, dim,
  as `withdrawn by Claude`, until the next prompt removes it. Any other status is refused by
  name. `task_move` refuses a task for the person.
- A withdraw of a task that the person answered, before the next prompt sent the answer,
  carries the answer in the `task_update` answer, once (review of 2026-10-29). The row reads
  `withdrawn by Claude · answer sent`. A refused withdraw was the other choice. It would block
  Claude on a task that it no longer needs, and Claude would still not have the words.
- `task_assign` and `task_list` do not count as a plan update for the plan warning, because
  they do not change the own list of Claude. Only the own tasks count for the empty-list note,
  the task list row, the `Tasks` header, the band and the this machine card. `listSummary` in
  `hooks/progress.ts` gives the card and the stored progress the same counts.
- `task_assign` refuses a call from a subagent, because a subagent has its own list, which the
  person does not see.

The band (handily-9uj3n.9):

- `AbovePrompt` has `hasSurvey` ("a hook yields to it"), `isWorking`, `maxRows`, `bodyColumns`
  and `view`. `bodyColumns` is the width of the column less the 5 columns of the engine's `[-]`.
  The band is raised on the terminal and desktop surfaces only. From Claude Code 2.1.323 it is
  also raised on mobile.
- From Claude Code 2.1.323 the engine asks `AbovePrompt` once for each plugin that hooks it, and
  `e.plugin` names that plugin. `plugin` is a default matcher key, so a hook that does not name
  it hears the rows of its own plugin only. The new `AbovePromptList` stacks the rows of all the
  plugins in a column. So the band of another mod is its own row and never comes from the
  `next(e)` of the board. Up to 2.1.322 the band is one chain over all the plugins.
- Hooks of one event nest by tier: `prepend`, `user`, `append`, `builtin`, `core`. The types do
  not give the order of two user plugins.
- A bare digit typed into an empty prompt presses a band Button that has a `hotkey`. So the band
  button has no hotkey, and a test checks it.
- The yield rule: the board returns `next(e)` when the setting is off, a survey holds the band,
  the this session tab is shown or nothing waits and no agent row shows. Otherwise it awaits
  `next(e)`. Only an engine
  element (`{ type: 'engine' }`) beneath gets the board's line. Any other drawing beneath is
  returned unchanged, so the board never covers another band mod. On 2.1.323 a drawing beneath
  the board comes from a hook that names `plugin: 'handily-board'` or `plugin: '*'`, and the
  band of another mod draws in its own row of the same band. The yield test registers its drawing
  both ways, so it sits beneath the board on 2.1.322 and on 2.1.323 (handily-fuqm8v).
- A call of a plugin on its own `$.ui.open` or `$.ui.close` runs only the hooks beneath it, so
  the board never sees its own opens. The board counts each open and close of its panes in the
  state key `paneChanges`. Only the band reads that key, so a change draws the band again and
  not the pane.
- The band draws again every 10 seconds while it shows a task in progress or an agent row, so its
  times move and a stalled time reads `stalled 16m` in the warning colour after 15 minutes. While
  it shows neither, it runs no timer (review of 2026-10-29).
- The engine raises no event when the person switches tabs: no `ui.*` event names a tab, and
  `isShown` is read only through `$.ui.panes()`. So the band follows what the board can see. A
  render of the this session pane or of the this machine pane after a switch counts a pane
  change at once. A switch from the this session tab to the tab of another plugin shows the band
  at the next tick of the redraw of the board panes, so within 10 seconds. This bound is
  measured in the test kit only.

Probes that are still open, each with a safe path in the code:

- What `next(e)` returns in an `AbovePrompt` render when no hook beneath draws. The test kit
  of Claude Code 2.1.312 has no drawing of its own: a mount with no test hook beneath fails with
  `no implementation for ui.render`. So the tests answer with an engine element, as the
  transcript row tests do. The test kits of 2.1.322 and 2.1.323 answer `{ type: 'engine', ref:
  1 }` (a probe mod in `claude plugin test`, 2026-11-13). If the live engine returns another
  shape, the board yields and draws no band.
- The order of two user plugins on the band, up to Claude Code 2.1.322. Two band mods that each
  yield to the other draw nothing. A second dummy band plugin in tmux can measure it. On
  2.1.323 the engine stacks one row for each plugin, so neither band yields to the other.

Repairs of the plan offer (review of 2026-10-29):

- A step that is empty after the markdown marks are removed, such as an image or an empty
  check box, is no step and does not count toward the 2 items.
- The warning about tasks that Claude added after the approval counts only the own tasks of
  Claude, so a task for the person raises no warning.
- A press locks the plan with the time of the press (`lockedAt`). A lock older than 10 seconds
  is free, so a write that fails or a reload between the lock and the result cannot keep the
  plan "being added" for ever.

Failure modes:

- Claude never reads the new tasks in the turn of the approval. It sees them at the next prompt,
  or in its next task tool answer, which returns the whole list.
- Plan text is model text. A step can imitate an author or hold a bidi character. A step goes
  through the rule of `titleRefusal`, and what the model reads quotes it with `JSON.stringify`.
  The answers of the person are quoted too.
- A keyboard person cannot press the transcript button. The pane, the band and `/board plan` are
  the keyboard paths, and the README says so.
- On the band and on the pane task row, the word `stalled` names a stalled time, so `NO_COLOR`
  and a red and green colour blindness keep it (handily-y8t3v).
- On the mobile app there is no band and no Input. An answer goes through `/board answer`, and
  the row says so (8.12k).
- With `-p` nothing draws. The tools and the notes still work, so Claude can assign a task that
  nobody sees.
- Undo after the answer was sent is impossible, and the button is gone. A person who answered
  wrongly tells Claude in the prompt.

#### The agent strip in the band (handily-crupjy.2)

The owner approved the mocks and the 8 recommended answers on 2026-11-10. The approved mocks are
`docs/mocks.md` section 16.

- The band reads the same agent rows as the pane (`agentView`, then the steps and the stalls). A
  row shows in the strip by its group, in this order: needs you, failed, done (with killed), then
  running (with asked, on hold, pending, idle and a not listed agent with a call in flight).
  Inside a group, the order is by spawn time.
- A done row (with killed) stays after `$.agent.list()` stops listing its agent. It leaves the
  band at the next prompt that the person sends. A done row of an agent that ended before that
  prompt does not show, also while Claude Code still lists the agent (handily-crupjy.3).
- A failed row stays after the next prompt and after the list drops its agent. It leaves the band
  when the this session tab draws, or when the person runs `/board` with no argument
  (handily-crupjy.3).
- The marks are `isAnswerSeen` and `isFailureSeen` on each stored agent in `$.state` `agents`. A
  person prompt marks each ended done or killed agent. The this session tab and `/board` mark
  each failed agent. A new run or a new turn end of the agent clears both marks, so a resumed
  agent shows its next end. `/clear` empties `agents`, and with it the marks. `stripGroup` in
  `hooks/band.ts` is the one rule that reads them.
- An agent in the `not listed` state with no call in flight still shows no row.
- The band shows at most 3 agent rows and a fold button for the rest. When `maxRows` is too small,
  running rows drop first, and a needs-you row never drops.
- With no open task, no task for the person and no plan offer, the head line reads
  `Agents  N · no open task` with `[ board ]`.
- The `open` button of a needs-you or a running row runs `/tasks`, as the pane does. On a failed or
  a done row, it adds the agent row (and the ended fold for a done row) to `expanded` and opens
  the this session tab. The fold button opens the this session tab.
- A change of an agent group or state word draws at once, because the band reads the agents state
  while it draws. The tool, the ctx, the stall time and the age of a row whose state did not
  change come from the rows kept at the last 10 second tick. So they change on the tick only.
- Every text from an agent or a tool target goes through `escaped`: the name, the tool and its
  target, the answer line and the plan step.

#### Context parts and a trend (handily-u2exd)

The person approved the design on 2026-10-29, with every recommended answer of the designer. The
approved mock is `docs/mocks.md` section 8.14. Line numbers below are of the `index.d.ts` that
Claude Code 2.1.312 wrote.

References: glowup and claude-flightdeck (github.com/scasella/claude-flightdeck), both MIT. The
survey of github.com/karanb192/awesome-claude-code-mods found them on 2026-10-28. handily only
read them. It copies no code from them and adds no dependency.

Decisions of the person (2026-10-29):

1. The breakdown is `summary`, not `full`. `summary` is a local estimate and sends no request
   (`ContextBreakdownDetail`, `:2153`). The parts say `estimated; /context counts exactly`.
2. The parts show on a press of `[ context parts ]`, not always. The details stay short, and the
   call stays rare.
3. The turns left come from the mean growth of the last 5 main turns, shown with `~`. One large
   turn does not swing the count.
4. The rows carry the names of the engine. The code branches on `kind` (`ContextCategoryKind`,
   `:2192`), never on the name, because a name can change between releases.

The engine source of each new number:

| Number on the board | Engine source |
| --- | --- |
| `trend ▁▂▂▃▄▅▅▆`, `8 turns` | `context.tokens` and `context.window` of `session.measure` (`:11814`): the last fresh context measure of each answered `turn.complete` of the main loop (`:4621`) |
| `+6k a turn` | the mean growth of the last 5 readings of the trend |
| `auto-compact at 167k` | `autoCompactThreshold` of the breakdown (`:11587`) |
| `auto-compact is off` | `isAutoCompactEnabled` of the breakdown (`:11591`) is false, or no threshold |
| `in ~7 turns` | the threshold less the last reading, divided by the mean growth; above 99 it reads `in over 99 turns` |
| `Messages 71k 36%` | a breakdown row of `kind` `used` (`ContextCategory`, `:2159`): `name`, `tokens`, and `tokens` over `rawMaxTokens` |
| `free 43k`, `compact buffer 33k`, `on demand 20k` | the rows of `kind` `free`, `buffer` and `deferred` |
| `1 compaction` and the restart of the trend | `session.compact` (`:4533`) of the main conversation, not skipped and not a `precompute` |

- **The breakdown.** `$.session.usage({ breakdown: 'summary' })` (`:2906`) gives
  `context.breakdown` (`SessionContextBreakdown`, `:11525`, and `:11633`). The board asks for it
  when the person opens the details or presses `[ context parts ]`, at each main turn end while a
  shown board pane shows the open details, and for `/board stats`. It never asks while the board
  is closed or the details are, and it starts no timer. When a board draws open details with no
  count yet, or with a count older than the last main turn end or compaction, it asks once. A
  reply with no breakdown reads `no breakdown on this host`. A rejected call reads
  `parts failed; /context shows them`, and the log row names the cause.
- **The trend.** The board keeps at most 20 readings in `$.state` under the key `trend`, so a hot
  reload keeps them. A reading is a fresh context measure, one for each main turn. A measure
  during a turn is kept, and the turn end makes the last one a reading. When a turn ends with no
  fresh measure, the next measure before the next turn starts is its reading. The live check of
  2026-10-29 on Claude Code 2.1.312 suggests that the measure comes after `turn.complete`. A
  measure after the turn end also replaces the reading of that turn. A turn with no fresh
  measure, such as an aborted turn, adds no reading. A compaction empties the trend and the kept
  measure. `/clear` and a resume empty the trend.
- **Two windows.** The breakdown counts against the compaction window (`rawMaxTokens`), and
  `context.tokens` counts against the window of the model. So the turns left are approximate,
  and they show `~`. The bars use the window of the model, the same as the `ctx` percent.

The named constants:

| Name | Value | Effect |
| --- | --- | --- |
| `TREND_TURNS` | 20 | The trend keeps the readings of the last 20 main turns |
| `PACE_TURNS` | 5 | The growth is the mean of the last 5 main turns |
| `PARTS_SHOWN` | 7 | The parts show 7 lines before `[ +1 more part ]` |
| `SOON_TURNS` | 2 | From 2 turns left, the line says `soon` in the warning colour |
| `BREAKDOWN_DETAIL` | `summary` | The breakdown is a local estimate |

#### A pace for the usage limits (handily-cver9)

The orchestrator approved the design on 2026-11-12, and the owner confirmed the two open answers.
The approved mock is `docs/mocks.md` section 8.15.

Reference: limit-watch (MIT). The survey of github.com/karanb192/awesome-claude-code-mods found
it on 2026-10-28. handily only read it. It copies no code and adds no dependency.

Known limit: the engine store has no compare-and-set. Two sessions that pass the read-back at the
same time both show the toast.

The engine source of each new number:

| Number on the board | Engine source |
| --- | --- |
| `full ~1h` on the Session line | `rateLimits` of `session.measure` and of `$.session.usage()`: `percentUsed` and `resetsAt` of each limit, kept as readings with the time of `$.clock` |
| `pace 5h full ~1h · 7d no growth` | the same readings |
| `◆ 5h limit at 80%` | `percentUsed` of the limit, and the store key of the limit kind |

- **Readings.** `hooks/pace.ts` keeps the readings of each limit kind in the vitals, at most 60.
  A reading less than 1 minute after the reading before the last replaces the last. A new reset
  time or a lower percent starts the readings again. A reset time that moves by 10 minutes or
  less is the same cycle. `/clear` keeps the readings, because the limits are the same for every
  session.
- **Projection.** The rise from the first kept reading to the last, over the time between them,
  projects 100 percent from the last reading. The Session line shows `full ~1h` only when that
  time comes before the reset. It shows nothing with fewer than 2 readings, less than 15 minutes
  of readings, flat or falling use, a last reading over 30 minutes old, no reset time, or a limit
  at 100 percent. A projected time that passed with no new reading shows no projection, and the
  details name the age of the last reading. With no limits, the details read
  `limits: none reported`. No number is invented.
- **Warnings.** `hooks/limit-warn.ts` warns once for each level, 80 and 95 percent, in each cycle
  of a limit. A jump past both levels warns only at 95. The store key `limit-warned:<kind>`, such
  as `limit-warned:five_hour`, holds `{ v: 1, kind, cycle, level, at, by }`. `cycle` is the reset
  time or null, and `by` is the session id. A session reads the key. When the key holds the same
  cycle at the same level or higher, it does nothing. Otherwise it writes the key, waits a random
  200 to 800 ms on `$.clock`, and reads the key back. It shows the toast only if `by` is still its
  own id. The first session that claims the key shows the toast. The session also keeps the last
  level that it warned, and it checks one limit kind at a time, so one session never warns twice
  for one level.
- **Stale keys.** A key is stale when its cycle is past, its cycle is more than 10 minutes from the
  reset time of the limit, or the board cannot read its `v`. With no reset time, a fall of 20
  points or more below the warned level starts a new cycle. The board deletes a stale key when it
  reads it, and at session start it deletes each key with a past cycle or a `v` it cannot read, as
  `deleteExpired` in `hooks/sessions.ts` does for the session keys.
- **Past resets.** A limit whose reset time is past, or does not parse, shows no toast and
  reads or deletes no key, so it never deletes the key of a new cycle.
- **Failures.** A store call that fails logs to the debug log and shows no toast.
- **Kinds.** The board warns only for a kind of lowercase letters, digits and `_`, at most 40
  characters, because the kind becomes part of a store key.

The named constants, all in `hooks/pace.ts`:

| Name | Value | Effect |
| --- | --- | --- |
| `PACE_SPAN_MS` | 900000 (15 minutes) | The readings must span this time before a projection shows |
| `PACE_STALE_MS` | 1800000 (30 minutes) | A last reading older than this shows no projection |
| `READING_STEP_MS` | 60000 | A reading closer than this to the reading before the last replaces the last |
| `READINGS_KEPT` | 60 | The readings kept for each limit kind |
| `CYCLE_APART_MS` | 600000 (10 minutes) | Two reset times this close are the same cycle |
| `NEW_CYCLE_FALL` | 20 (points) | With no reset time, a fall this large below the warned level starts a new cycle |
| `WARN_LEVELS` | 80 and 95 (percent) | The levels that show a toast |
| `LEVEL_WORDS` | none at 80, `nearly full` at 95 | The word after the percent in the toast |
| `WARN_MARK` | the `waitsForYou` role (`◆` in the plain set) | The mark at the start of the toast, drawn from the glyph set |
| `CLAIM_WAIT_MS` | 200 to 800 | The random wait before the read-back |

#### The Inbox (handily-fwkt.8.28)

Step 1 of the F1 inbox, the owner pick of 2026-11-12. The Inbox at the top of the this machine
tab lists what waits for the person in the other sessions of this machine. The mocks are
`docs/mocks.md` section 8.16. They are the test captures, because the F1 draft mocks are not in
this repository.

Known limits:

- **A plan approval and a tool permission look the same in `claude agents`.** `claude agents
  --json` gives `waitingFor` `permission prompt` for both (probe handily-gmvyf3). A row from it
  reads `waits` and the raw text, and never names a plan. A board wait tells them apart by the
  tool: `AskUserQuestion` publishes `question`, and `ExitPlanMode` publishes `waits` with the
  tool name, because its input holds no plan that proves a plan approval.
- **A session that ended shows until the next poll.** A session that ends leaves `claude agents`
  at once, and its store key stays. The Inbox draws only the sessions of the last poll, so the
  rows of an ended session stay until the next poll answers, at most 15 seconds later while the
  tab shows. The test `a session that died still draws its waits until the next poll, under the
  age of the last read, and no row after it` asserts it.
- **A session first seen while it waits has no age.** The poll keeps the time of the last state
  change (`stateSince`). When it equals the start time, the poll did not see the wait begin, and
  the row shows `—`.
- **Two sources share no store.** A session that loads the board from another source sees the
  other only through `claude agents`, as a `waits` row.
- **No end reason.** `claude agents` gives no reason when a session ends.

The sources:

| Row | Source |
| --- | --- |
| `permission` | the store key `session:<session id>` of that session: a `tool.check` ask with no decision after `NEEDS_YOU_AFTER_MS` (3 s), with the agent name, the tool, the masked target and the time of the ask |
| `question` | the same key: an ask of `AskUserQuestion` after 3 s, with the first line of the first question, masked, or the tool name, by `askWait` in `hooks/waits.ts` |
| `waits` with `ExitPlanMode` | the same key: an ask of `ExitPlanMode` after 3 s, by the same `askWait` |
| `decide`, `answer`, `do` | the same key: the open tasks for the person, after the permission waits |
| `waits` | `claude agents --json`: the `waitingFor` text of a session that needs the person and has no wait in its key, or `an answer` with no text, by `waitsForOf` in `hooks/cards.ts`, the rule of the card |
| `waits` with `N tasks for you` | a key from an earlier version that has `openForYou` and no wait list |

- **Which sessions.** The Inbox reads the sessions that the last poll lists as not ended, other
  than this session. A background job that `isOldBackground` hides from the cards still draws its
  key waits and its `waitingFor` text, but no `an answer` row. A key written more than 60 seconds
  before its session started shows no row.
- **The key.** It keeps at most `WAITS_AT_MOST` (5) waits and counts the rest by kind in
  `waitsMore`. The agent name and the tool keep `WAIT_NAME_AT_MOST` (40) characters, and the
  target and a title `WAIT_TEXT_AT_MOST` (80). A key over 4096 bytes sheds waits into the count
  before the board refuses it. The decision, a forgotten ask, the end of the agent turn and
  `/clear` remove the wait of an ask.
- **The order.** `permission`, `question`, `waits`, `decide`, `answer`, then `do`, the order of
  `WAIT_KINDS` in `hooks/waits.ts`. Inside a kind, the oldest first.
- **The fold.** The Inbox draws at most `INBOX_ROWS_AT_MOST` (5) rows. The fold button
  `machine:inbox` counts the rest by kind, with the waits that the keys counted in `waitsMore`.
  It is the only button of the Inbox. No row answers a permission prompt or a question, because a
  mod shows and asks and never acts for the person in another session.
- **The width.** From 60 columns, each wait is one row. Below, the detail goes on a second line.
  When the head does not fit, the read age drops first. When a row does not fit, the session name
  shortens to the room that the mark, the kind and the age leave, to 5 columns at least. So the
  age stays whole, also `report 57s` at body 30.
- **Failures.** A store that cannot be read logs to the debug log, and the Inbox keeps the `waits`
  rows of `claude agents`. From the first failed poll, each row shows the age of the last report,
  and the mark, the kind and the wait count draw dim, not in the colour of needs you. While the
  poll fails, the Inbox cannot see that a session ended, so the rows of that session stay until a
  poll answers, and none of them reads as a live wait (handily-7sx9q6).
- **Escaping.** Every name, tool, target, title and `waitingFor` text goes through `escaped`.

### 4.10 reply-view: tables, code and diagrams (handily-5zzxk)

The person approved the design on 2026-10-27 (handily-5zzxk.2). reply-view draws the tables,
the code blocks and the mermaid diagrams of a reply for the terminal. The approved mocks are in
`docs/mocks.md`, section 9.

Reference: prismantis (github.com/NahumLitvin/prismantis) at commit `ed085d7c`, MIT licence,
by Nahum Litvin. handily copies no code from it and adds no dependency. prismantis bundles
diagram code of a third party, so handily writes its own text renderer.

Tables:

- A long cell wraps inside its column. A word stays whole when the column has room for it.
  Else the word splits at the column width.
- Below 40 columns, a table draws one block for each row.
- A table never scrolls sideways. `BoxProps.overflow` has only `visible` and `hidden`, and no
  `scroll` (engine types of reply-view, 2.1.300).

Code:

- The engine `Code` element highlights the code. reply-view has no highlighter of its own.
- A code block that holds a drawing and is wider than the reply keeps each line on one row. The
  `Code` element cuts the row at the edge with `…` (`wrap: 'truncate-end'`), and one dim note
  names the width: `drawing cut: it takes 87 columns, the screen has 78. Widen the window to see
  this drawing.` Only a block with no tag or a plain-text tag is cut. It needs at least 2
  drawing lines, and each line wider than the reply is a drawing line or stands between two. A
  box-drawing character, a rule such as `+---+`, a tree branch or an arrow such as `-->` marks a
  drawing line. Any other code block wraps as before, because a cut hides the end of a command
  (handily-2dpxv0.25).

Diagrams:

- reply-view has its own text renderer for twenty-two kinds of mermaid diagram:

  | Header keyword | Kind | Record |
  | --- | --- | --- |
  | `flowchart` or `graph`, with `TD`, `TB` or `LR` | flowchart | handily-5zzxk.5 |
  | `sequenceDiagram` | sequence diagram | handily-5zzxk.7 |
  | `stateDiagram-v2` or `stateDiagram` | state diagram | handily-36bsx.7 |
  | `classDiagram` | class diagram | handily-36bsx.7 |
  | `erDiagram` | ER diagram | handily-36bsx.7 |
  | `pie` | pie chart | handily-36bsx.6 |
  | `xychart` or `xychart-beta` | bar or line chart | handily-36bsx.6 |
  | `gantt` | gantt chart | handily-2dpxv0.4 |
  | `gitGraph` | git graph | handily-2dpxv0.1 |
  | `mindmap` | mind map | handily-2dpxv0.2 |
  | `timeline` | timeline | handily-2dpxv0.3 |
  | `journey` | user journey | handily-2dpxv0.5 |
  | `quadrantChart` | quadrant chart | handily-2dpxv0.6 |
  | `kanban` | kanban board | handily-2dpxv0.11 |
  | `packet` or `packet-beta` | packet diagram | handily-2dpxv0.13 |
  | `sankey` or `sankey-beta` | sankey diagram | handily-2dpxv0.12 |
  | `radar-beta` | radar diagram | handily-2dpxv0.17 |
  | `treemap-beta` or `treemap` | treemap | handily-2dpxv0.19 |
  | `block` or `block-beta` | block diagram | handily-2dpxv0.10 |
  | `requirementDiagram` | requirement diagram | handily-2dpxv0.7 |
  | `C4Context`, `C4Container`, `C4Component`, `C4Dynamic` or `C4Deployment` | C4 diagram | handily-2dpxv0.8 |
  | `architecture-beta` | architecture diagram | handily-2dpxv0.9 |

- `DRAWN_DIAGRAM_KINDS` in `hooks/mermaid.ts` lists the header keywords, and `DIAGRAM_NAMES`
  gives each kind its plain name. A chart takes its name from its plot, such as `bar chart`.
  Tests check the list against the parser, the diagram hint
  names the kinds from the list, and the fold row takes the plain name (handily-2dpxv0.27).
  The hint names the five C4 kinds once, as `C4Context and the other C4 kinds`, to stay under
  its limit of 540 characters (handily-2dpxv0.8).
- A flowchart `subgraph` draws as a frame with a dotted border around its boxes, with its title
  on the top edge. A box belongs to the first subgraph that names it, as in Mermaid. The frames
  keep one order in every level, and each frame is only as wide as its boxes and its title need.
- Another diagram kind draws as its source. So do a `subgraph` inside a `subgraph`, an edge to a
  `subgraph`, a `direction` line outside a `subgraph`, `box`, `create` and `destroy`. A flowchart
  draws as its source when a loop needs its box last in a level where the frames keep another
  order. One dim note above the source names the reason.
- A diagram draws whole or as its source. Only the preview of a folded reply shows a part of a
  tall diagram.
- A block diagram draws its blocks in a grid of `columns`, with one width for all columns of a
  group. A group draws as a dotted frame. A link draws only as a straight line between two blocks.
  The gap between two blocks side by side grows to hold the label of their link.
  A link that needs a bend or crosses a block draws the diagram as its source, with a note
  (handily-2dpxv0.10).
- A flowchart `LR` that is too wide draws as `TD`. A box label that is too wide wraps at spaces at
  16 columns, then at 12 columns, and a longer word stays whole. Only when that does not fit, a
  word breaks inside at the room of its level, keeping every character. An edge label is cut to
  12 columns.
- A C4 diagram that is too wide moves the elements of a wide level onto more rows, keeping each
  boundary together, and then wraps its edge labels at 8 columns (handily-2dpxv0.8). A flowchart
  keeps one row per level.
- A drawn diagram has two buttons: `[ copy ]` and `[ copy drawing ]`.
- When the fold of a reply ends inside a diagram, the preview shows the whole diagram when it
  then takes 60 rows or fewer. Else it shows the title line and the first rows when at least 5
  rows of the drawing fit, and the fold row names the kind and the hidden rows. Else the preview
  ends before the diagram. The preview never shows the title line alone (handily-2dpxv0.26).

Limits of one diagram. Over a limit, the diagram draws as its source, and the note names the limit:

| Limit | Value |
| --- | --- |
| Source lines | 80 |
| Source characters | 8000 |
| Boxes | 40 |
| Edges | 60 |
| Participants | 12 |
| Drawn rows | 120 |

Settings and commands:

| Setting or command | Default or use | Record |
| --- | --- | --- |
| `diagrams` | On. Off, a mermaid block draws as today | handily-5zzxk.6 |
| `diagramHints` | Off. On, a typed prompt carries one hint about diagrams | handily-5zzxk.8 |
| `/replies hints` | The command of the diagram hints | handily-5zzxk.8 |
| `/replies copy diagram`, `/replies copy table`, `/replies copy code` | Copies a block of the last reply from the keyboard | handily-5zzxk.9 |

- The hint names the Mermaid kinds that do not draw, from `MERMAID_KINDS` less
  `DRAWN_DIAGRAM_KINDS`, and names the C4 family once while none of it draws. It has 474
  characters and costs 215 tokens, measured with `claude -p` on 2026-11-05 with Claude Code
  2.1.318 (reply-view README). prismantis states about 630 prompt tokens for its diagram hints (its
  README).
- A transcript button takes a click only. The `/replies copy` forms give a path from the keyboard.

### 4.11 handily-filetree (handily-02b2v)

The person approved the design on 2026-10-27 (handily-02b2v.1). handily-filetree shows a file
tree that marks which agent read or edited each file, and the git state of each file. The
approved mocks are in `docs/mocks.md`, section 10.

Reference: claude-code-filetree (github.com/data-goblin/claude-code-filetree) at commit
`b98495f8`, MIT licence, by Kurt Buhler. handily copies no code from it.

Decisions:

- Command: `/tree`. The tab label is `files`.
- handily-filetree is a new mod in the `handily` bundle, because a tree needs the full width of
  a pane.
- handily-filetree depends on handily-board. The board owns the task ids and the agent labels.
  So a row of the tree shows the same agent label as the board, and the board links a task to
  the files that were touched while it ran.
- The default view is the work view: only the files that an agent touched or that git shows
  as changed. `[ all files ]` shows the whole tree.
- Marks: `✎` an agent edited the file, `◦` an agent read it. The agent label and the age follow
  the mark.
- Release 1 marks no read by a Bash call.
- One `git status --porcelain=v2` call runs for each change. No call runs while nothing changes.
- The mod reads no environment variable.
- Out of scope: `find`, `du`, a treemap, a preview of media files, and open in an editor.

Keys, only while the pane has the focus:

| Key | Action |
| --- | --- |
| `p` | Preview |
| `d` | Diff |
| `y` | Copy the path |
| `v` | View |
| `r` | Refresh |
| `b` | Back |
| `c` | Clear the task filter |

Limits of release 1:

| Limit | Value |
| --- | --- |
| Entries drawn per folder, before a more button | 200 |
| Rows of the tree | 1000, to be measured |
| Rows of the work view | 40 |
| Rows inline above the prompt | 8 |
| Files revealed per Grep call | 12 |

#### Step through the edits of the last turn (handily-dqmse)

The person approved the design on 2026-10-29, with each recommended answer (handily-rt74l). The
files tab gets the button `[ last turn: 3 edits ]`. A press opens a step view that shows one edit
at a time, with the patch of that edit. The approved mocks are in `docs/mocks.md`, section
10.11. Reference: replay-theater in claude-code-mods (MIT licence), read during the survey of
github.com/karanb192/awesome-claude-code-mods on 2026-10-28. handily copies no code from it.

Decisions:

- The last turn runs from the previous main `turn.complete` up to the latest one. An edit by a
  subagent counts for the main turn in which it ended, so an edit between two turns is not lost.
- An edit is an Edit, Write or NotebookEdit call that ended without an error or a deny. An edit
  by a Bash command, such as `sed -i`, is not listed, and the empty state says so.
- Each edit shows its own patch, from the tool result. No `git diff` runs. The diff against HEAD
  stays on the `[ diff ]` button of the tree.
- No status line. The status line of the board is for attention, and the button carries the
  count.
- The step view draws no `[ preview ]`. So the key `p` presses `[ prev ]` there. After `[ back ]`
  the tree is as before.
- `/tree edits` opens edit 1, and `/tree edits 2` opens edit 2. The command opens the pane with
  the focus, and the focus ring starts on `[ next ]`.
- The edits stay in the memory of the mod for the session, as the marks do. No toast and no
  setting.

Engine facts, from the generated types of Claude Code 2.1.312 (`claude-code-tools/index.d.ts`
and `claude-code/index.d.ts` under `.claude-plugin/types/`):

| Fact | Where |
| --- | --- |
| The Edit result holds `structuredPatch` (`oldStart`, `oldLines`, `newStart`, `newLines`, `lines`), `userModified` and `staged` | tools `BuiltinToolResults.Edit` |
| `staged: true` means the engine held the edit for review, and the file is unchanged | tools `BuiltinToolResults.Edit` and `.Write` |
| The Write result holds `type` (`create` or `update`), `content` and `structuredPatch`. The patch is empty when nothing changed, when the diff timed out, or when the old content was too large | tools `BuiltinToolResults.Write` |
| `turn.complete` fires for the main loop and for each subagent; `agentId` is absent on the main loop | `TurnCompleteFields.agentId` |
| A Code element with format `diff` checks the hunk counts. A source whose counts do not match is drawn as plain code, and the engine logs why | measured in `claude plugin test`, 2026-10-29 |
| A Button with `autoFocus` starts the focus ring of its site when the site takes the keyboard | `ButtonProps.autoFocus` |
| Two Buttons with one `hotkey` clash, and the later one wins | `ButtonProps.hotkey` |

Keys in the step view, only while the pane has the focus:

| Key | Action |
| --- | --- |
| `l` | Opens the last turn, from the tree |
| `n` | Next edit |
| `p` | Previous edit |
| `b` | Back to the tree |
| `y` | Copy the path |

Limits:

| Limit | Value |
| --- | --- |
| Edits kept per turn (`EDITS_KEPT`) | 50 |
| Patch lines kept per edit (`PATCH_LINES`) | 400 |
| Rows of the step view inline above the prompt | 8 |

## 5. Repo layout (proposed)

```text
handily/
  .claude-plugin/marketplace.json   generated from mods/*/.claude-plugin/plugin.json
  mods/
    handily/                the bundle
    handily-workitems/      .claude-plugin/plugin.json, hooks/, types/index.d.ts, tests
    handily-quiet-items/
    handily-board/
    handily-item-toasts/
    handily-simple-view/
    handily-reply-view/
  docs/design.md
  package.json      typescript, linter, scripts that run tsc, validate and test on each mod
```

## 6. TypeScript gates as a basicly pilot

handily is the first TypeScript repo that basicly manages. It pilots the TypeScript gates and
rules that basicly can later distribute as a `typescript` technology tag.

- Fact: the basicly catalog has only the `python` technology tag.
- Fact: the basicly comments gate already covers `.ts`, `.tsx` and `.mjs`.
- Fact: basicly reads skill sources only from `.basicly/core/skills`, which install manages.
  A consumer has no local skill overlay, so handily's mod rules are an overlay fragment
  scoped to `mods/**`.
- basicly tracks this pilot as `basicly-975f0xc` (filed 2026-10-07).

What is in place (handily-fwkt.1):

| Gate | Tool | `basicly.toml` check |
| --- | --- | --- |
| Validate | `claude plugin validate --strict`, plus a name check across folder, manifest and marketplace | `mods-validate` |
| Type check | `tsc` 6.0.3 per mod | `mods-typecheck` |
| Lint | ESLint 10 with typescript-eslint 8.71 `strictTypeChecked` | `eslint` |
| Format | Prettier 3.9 | `prettier` (with a fix command) |
| Test | `claude plugin test`; a mod with no test fails | `mods-test` |

Measured facts behind these choices:

- typescript-eslint 8.71.1 accepts TypeScript `>=4.8.4 <6.1.0` (from `npm view`), so
  TypeScript is pinned to 6.0.3, not 7.
- A headless `claude --plugin-dir <mod> -p ok` with an empty config folder and no login
  writes no types (measured on Claude Code 2.1.295, 2.1.296 and 2.1.299). The 2.1.299
  plugin-authoring reference says that Claude Code never writes in a `--plugin-dir` folder
  under `claude -p`. Only an interactive load of a logged-in session lays them, so each mod
  commits its engine type snapshot and CI typechecks against it. `npm run check` refuses a
  snapshot file that git does not track (handily-b1heu), and `npm run types` fails with the
  lay command when a laid tsconfig misses a dependency (handily-1fp3v). The types step also
  compares the `// Written by Claude Code X.` header of each laid `claude-code/index.d.ts`
  with `claude --version`. A header that names another version, or no header, fails by name
  with the lay command (handily-fwkt.24).
- `no-misused-promises` with its default `checksVoidReturn` ran over 80 s on a 9-line mod,
  because it compares callbacks with the large overloads of `on`. With
  `checksVoidReturn: false` it takes about 0.5 s. `no-floating-promises` stays at full
  strength and refused a planted unawaited `$.store.set` in about 0.5 s.
- `claude plugin validate --strict` refuses a marketplace with no plugins. Until the first
  mod exists, the runner validates the marketplace without `--strict` and says so.
- `$.ui.toast` and `$.ui.status` return `void`, not a promise.

## 7. Open questions for the implementation session

Closed:

- **Q1. basicly read path.** Closed by review decision 9 and decision E: `basicly tracker list
  --status <s>` from `PATH` only. Every basicly read runs only after approval. The approval
  covers the kit files only for a basicly below 0.21.1 (decision F). The repo's `cli.py`
  fallback was dropped. handily-8mjdz replaced the three list calls with one
  `basicly tracker items` call.
- **Q2. Repo config file.** Closed by review decision 11: `.handily.json` at the repo root.
- **Q4. Linter.** Decided 2026-10-07: typescript-eslint with Prettier (section 6).
- **Q6. Ignore rules.** Done 2026-10-07: `.claude-plugin/types/` and `node_modules/`.
- **Q7. basicly ready set.** Closed by review decision 9. The basicly tracker needs a recorded
  INVEST/C3 review before a record is ready. So the provider reads each open status, not
  only "ready" records.
- **Q8. Mod release process.** Closed by review decision 6. A release rests on the
  `plugin.json` version and its release tag. Users update when that version changes. Each mod
  has one version, and only a changed mod gets a bump. `claude plugin tag mods/<name>` makes a
  `<name>--v<version>` tag. The command needs a clean tree. Since handily-lh63p0.4 the
  marketplace pins each mod with a `git-subdir` entry at its latest release tag and the commit
  of that tag, so a fresh install gets each mod at that tag. A pinned entry has no `version`
  field. `docs/maintaining.md` gives the release steps.

Closed by the P0 probes (handily-0m93, Claude Code 2.1.293):

- **Q3. Sidecar location.** One `$.store` key per session. No write was lost in 4 rounds of
  concurrent sessions.
- **Q5. Task tools.** `$.tool.call` on `TaskCreate` reaches the main task list. It draws no
  row. It did not ask for permission in a headless session.

| # | Probe | Result |
| --- | --- | --- |
| 1 | `TaskCreate` through `$.tool.call` | Reaches the list. No row. No prompt when headless |
| 2 | `watchPaths` and `classic.FileChanged` | File and folder work. Globs fail. Blocked on a team org |
| 3 | Types of a dependency | Laid when both mods load. A dependent alone does not load |
| 4 | `claude plugin test` in parallel | Safe in 5 rounds |
| 5 | `$.config.set` on the mod's own `userConfig` | Not measured headless. Nothing depends on it |
| 6 | `$.store` from concurrent sessions | No loss. Merged per key |
| 7 | Task-list files on disk | One folder per session, one JSON file per task. Internal |
| 8 | Prompts from pane buttons; task tools in a TUI session | No dialog. No task tool unless the variable is set. Desktop not run |

## 8. Delivery plan

- Each child carries EARS criteria, a file scope, a budget, an integrity level, a demo
  command, the expected reading, and an ASCII mock for terminal and desktop.
- The person approves the mocks per mod before the lanes start (review decision 1).
- `basicly.toml` sets `[worktree] base_branch = "main"`. A lane branch name carries the
  record id.
- A generator writes `marketplace.json` from `mods/*/.claude-plugin/plugin.json`, with the
  versions. A `generate --check` gate refuses a stale file.
- Types are laid again when a dependency contract is newer. The development load is
  `claude --plugin-dir mods`.
- A full verify runs after each landing rebase.

| Phase | Content |
| --- | --- |
| P0 | Decisions, mocks, probes, this doc fix |
| P1 | workitems core: noun, contract, snapshot, beads reader, parser prefilter table, marketplace generator, types re-lay |
| P2 | Lanes A1 then A2, B, C, D, E1. E2 after P1, with a confirmed CI edit |
| P3 | Review, consumer runs, the person's review, then release |
| P4 | Extras |
