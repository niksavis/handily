# handily-filetree

`filetree` shows the working folder of the session as a tree in a pane tab named `files`. Folders
come first. The mod lists a folder only when you open it.

The tab shows the git state of each file and a count on each folder. It does not mark which agent
read or edited a file yet. [docs/design.md](../../docs/design.md), section 4.11, gives the plan
for that.

`filetree` depends on `handily-board`. Load both with `claude --plugin-dir mods`.
[docs/install.md](../../docs/install.md) gives the install, update and uninstall steps.

## Commands

| Command       | Effect                                                           |
| ------------- | ---------------------------------------------------------------- |
| `/tree`       | Opens the `files` tab. On a shown `files` tab, it closes the tab |
| `/tree close` | Closes the `files` tab                                           |

Replies, from the tests:

```text
/tree          Tree opened: files.
/tree          Tree closed.
/tree close    The tree is not open. Run /tree to open it.
/tree frob     Unknown argument "frob". Use /tree to open or close the files tab, or /tree close.
```

When the `files` tab is hidden behind another tab, `/tree` opens it with `focus`, so it comes
forward and takes the keyboard. Esc gives the keyboard back.

## The files tab

Docked, body 41, in a folder that is not in a git repo, with `docs/` open, as the test fixture
draws it:

```text
Files  app · not a git repo
[ refresh ]
No git status here; git init adds it.
─────────────────────────────────────────
▸ .git/  not listed
▸ node_modules/  not listed
▾ docs/
    design.md
    guide.md
    install.md
    mocks.md
▸ hooks/
▸ scripts/
  .gitignore
  README.md
```

- A press on a folder opens it or closes it. The mod lists a folder when you open it, and not
  before.
- The mod does not list `.git`, `node_modules`, `target`, `.venv`, `__pycache__`, `dist` and
  `.next`. Each shows `not listed`, and you cannot open it.
- A file whose name starts with a dot is dim.
- A folder draws at most 200 entries. A button `[ +1,640 more in gen/ ]` draws the rest of that
  folder.
- The mod keeps each listing for the session. A redraw, such as a scroll step, lists nothing
  again. The mod lists a folder again when you open it, and every folder again on
  `[ refresh ]`, on `r` while the tab has the keyboard, and after the tab closes. Claude Code
  gives a mod no file watch, so a new file shows only after one of these.
- A folder that the mod cannot list shows `Cannot list hooks/: permission denied.` under it, in
  the error colour. The rest of the tree stays.
- A row that is wider than the pane ends with `…`. This includes the more button and the
  cannot-list row.
- A link shows as an entry, and the mod does not follow it.
- A control or bidi character in a name shows as `\u202e`, so a name cannot change how the row
  reads.

Inline above the prompt, the tab draws a flat list of the working folder in at most 8 rows. When
the folder holds more entries, the last row says how many more there are. The test fixture, at
body 76:

```text
Files  app · not a git repo                                      [ refresh ]
.git/  not listed
node_modules/  not listed
docs/
hooks/
scripts/
.gitignore
a.md
+4 more: a dock (fullscreen, 110 columns) shows the tree
```

## Git status

In a git repo, the header shows the branch, the commits ahead and behind, and the count of
changed entries. A file shows its git state as a letter, and a folder counts the states of the
entries under it. The test fixture, with `docs/` and `hooks/` open:

```text
Files  app · main ↑1 · 6 changed
[ refresh ]
─────────────────────────────────────────
▸ .git/  not listed
▸ node_modules/  not listed
▾ docs/  M2 ?1
    design.md           M
    filetree.md         ?
    guide.md
    install.md
    mocks.md            M
▾ hooks/  M1 D1
  ▸ dist/  not listed
    old-pane.tsx        D
    pane.tsx            M
    register.tsx
▸ scripts/
  .gitignore
  README.md             M
```

| Letter | State     | Colour  |
| ------ | --------- | ------- |
| `M`    | modified  | warning |
| `A`    | added     | success |
| `?`    | untracked | success |
| `D`    | deleted   | error   |
| `R`    | renamed   | warning |
| `U`    | conflict  | error   |

- A deleted file shows in its folder with `D`, although it is not on the disk.
- A renamed file shows the file it came from under it: `renamed from api.ts · staged`.
- An untracked folder shows `?` and no count. Each entry in it shows `?`.
- A new repo with no files says `no commits yet`. A repo with no change says `clean`.

How the mod reads the state:

- The mod finds the repo from the working folder upward. It reads a `.git` folder, or the
  `gitdir:` line of a `.git` file, as a worktree has. It reads the branch from `HEAD`, and runs no
  process for it. With no `.git` above, it runs no git process.
- Every 2 s, while the tab is shown, the mod reads the time stamps of the git `index` and `HEAD`.
  It reads `HEAD` again only when its stamp changes. While nothing changes, no process runs.
- When a stamp changes, the mod runs
  `git --no-optional-locks status --porcelain=v2 --branch -z --untracked-files=normal -- .` once.
  It also runs it after a Bash, PowerShell, Edit or Write call ends, on a prompt, when the tab
  gets the keyboard, on `[ refresh ]` and on `[ retry ]`.
- One run at a time, and at least 2 s from the start of one run to the start of the next. A
  request during a run starts one more run after it.
- After two runs that take over 5 s, the mod adds `--untracked-files=no` and says so.

When git fails, the tree stays, and the header says what failed:

```text
Files  app · git status failed
[ refresh ]
git status failed: exit 128.
Run git status in a shell to see why.
retry in 10s  [ retry ]
```

- After the first failure, the mod tries again in 10 s. After the next failure, `[ retry ]` runs
  it again.
- When git gives no answer in 10 s, the line reads `git status failed: no answer in 10 s.`
- When git is not on the PATH, the header reads `git not found`, and no run follows.
- While a run takes over 5 s, the header shows the age of the last status, such as `2m old`.
- When the output of git is over 4 MiB, the mod drops the record that the limit cut. The tree
  ends with `git status is over 4 MiB; the first 61,204 entries are marked.`

## State

The mod keeps two lists in `$.state`: the open folders and the folders that show all entries.
`types/index.d.ts` declares them. The lists last for the session. The folder listings stay in the
memory of the mod, not in `$.state`.
