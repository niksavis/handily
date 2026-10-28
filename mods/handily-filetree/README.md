# handily-filetree

`filetree` shows the working folder of the session as a tree in a pane tab named `files`. Folders
come first. The mod lists a folder only when you open it.

The tab shows the git state of each file and a count on each folder. It marks which agent read or
edited each file, and how long ago. [docs/design.md](../../docs/design.md), section 4.11, gives
the design.

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
{agent: all} [ refresh ]
No git status here; git init adds it.
Now  nothing read or edited yet
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
Files  app · not a git repo                        {agent: all}  [ refresh ]
.git/  not listed
node_modules/  not listed
docs/
hooks/
scripts/
.gitignore
a.md
+4 more: a dock (fullscreen, 110 columns) shows the tree
```

In a git repo, each inline row starts with two columns for the git letter. A changed file shows
its letter there, and a folder shows its counts after its name:

```text
Files  app · main ↑1 · 6 changed                   {agent: all}  [ refresh ]
  .git/  not listed
  node_modules/  not listed
  docs/  M2 ?1
  hooks/  M1 D1
  scripts/
  .gitignore
M README.md
```

## Git status

In a git repo, the header shows the branch, the commits ahead and behind, and the count of
changed entries. A changed file shows its git state as a letter before its name. The letter and
the name draw in the colour of the state. A folder counts the states of the entries under it, and
each count draws in the colour of its letter. The test fixture, with `docs/` and `hooks/` open:

```text
Files  app · main ↑1 · 6 changed
{agent: all} [ refresh ]
Now  nothing read or edited yet
─────────────────────────────────────────
▸ .git/  not listed
▸ node_modules/  not listed
▾ docs/  M2 ?1
  M design.md
  ? filetree.md
    guide.md
    install.md
  M mocks.md
▾ hooks/  M1 D1
  ▸ dist/  not listed
  D old-pane.tsx
  M pane.tsx
    register.tsx
▸ scripts/
  .gitignore
M README.md
```

| Letter | State     | Colour of the letter and the name |
| ------ | --------- | --------------------------------- |
| `M`    | modified  | warning                           |
| `A`    | added     | success                           |
| `?`    | untracked | success                           |
| `D`    | deleted   | error                             |
| `R`    | renamed   | warning                           |
| `U`    | conflict  | error                             |

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
{agent: all} [ refresh ]
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

## Marks: which agent read or edited a file

A file that an agent read shows `◦`, and a file that an agent edited shows `✎`. The agent label
and the age follow the mark. A folder shows the latest mark of the files under it. The `Now`
block above the rule shows the latest file of each agent. The test fixture, after `main` edited
`hooks/pane.tsx` and the subagent `scout` read `docs/design.md`:

```text
Files  app · main ↑1 · 6 changed
{agent: all} [ refresh ]
Now  2 agents
✎ main      hooks/pane.tsx             4s
◦ scout     docs/design.md             2s
─────────────────────────────────────────
▸ .git/  not listed
▸ node_modules/  not listed
▾ docs/  M2 ?1            ◦ scout      2s
  M design.md             ◦ scout      2s
  ? filetree.md
    guide.md
    install.md
  M mocks.md
▾ hooks/  M1 D1           ✎ main       4s
  ▸ dist/  not listed
  D old-pane.tsx
  M pane.tsx              ✎ main       4s
    register.tsx
▸ scripts/
  .gitignore
M README.md
```

| Tool                            | Mark                                       |
| ------------------------------- | ------------------------------------------ |
| `Read`                          | `◦` on the file                            |
| `Edit`, `Write`, `NotebookEdit` | `✎` on the file                            |
| `Grep`                          | `◦` on the first 12 files that it found    |
| `Bash`, `PowerShell`            | `✎` on each file that changed while it ran |

- The main loop is `main`. A subagent shows the label that `handily-board` draws for it. When
  the board has no label for it yet, the mark shows its name, its type or the first 8
  characters of its id.
- A file that two or more agents touched shows the latest agent and a count: `✎ main +1`.
- The age uses the short form of the board: `9s`, `5m`, `1h`, `2d`. It rounds down.
- The mark shows while the call runs. When the call is denied, fails or ends in an error, the
  mark goes, and an earlier mark of the file shows again.
- A `Grep` that found 40 files marks 12. The `Now` line of the agent then reads
  `and 28 more files from one Grep`.
- At body 30 the age drops and the label cuts to 5 characters. Below body 28 the label drops,
  and the mark and the git letter stay. Inline, each flat row carries its mark.

### A Bash call

The mod does not read the command of a `Bash` or `PowerShell` call. It compares the files
before and after the call, and runs no `find` and no other process for it.

- In a git repo, the mod keeps the last git status. When a call starts, it reads the time stamp
  and the size of each changed file, and of each file that an `Edit`, a `Write` or a
  `NotebookEdit` changed. After the call ends, the git status runs once, as for every change. A
  file whose git state or time stamp changed gets `✎` with the agent that ran the call.
- Outside a git repo, the mod lists each open folder again after the call ends. A new entry, or
  a file whose size or time stamp changed, gets `✎`. A folder that is closed is not listed
  again, so a change in it shows only after you open it or press `[ refresh ]`.
- The age counts from the end of the call. For a call that still runs, it counts from the git
  status that found the change.
- The mod reads at most 1,000 time stamps for each snapshot. A file past that limit gets `✎`
  only when its git state changes.
- A call that the person denies marks no file.
- In a git repo, git status does not run while the `files` tab is not shown, so a call then
  marks no file. The next status starts a new comparison.

The `Now` block and the marked rows of the test fixture, after the subagent `scout` ran a `Bash`
call that changed `docs/design.md` and `hooks/pane.tsx`:

```text
Now  1 agent
✎ scout     docs/design.md             2s
  and 1 more file from one Bash

▾ docs/  M1               ✎ scout      2s
  M design.md             ✎ scout      2s
▾ hooks/  M1              ✎ scout      2s
  M pane.tsx              ✎ scout      2s
```

The mod never guesses one agent. When a file changed while calls of two or more agents ran,
the row shows how many agents, and the open row names them. A file that an `Edit` changed and
a later call did not change keeps the mark of the `Edit`. The test fixture, after a call of
`main` and a call of `scout` that ran at the same time:

```text
  M mocks.md              ✎ 2 agents   3s
      changed while Bash of main and
      scout ran 3s ago
```

Such a change does not show in the `Now` block, because the block names one agent for each line.

The agent filter `{agent: all}` shows the marks of one agent or of all. On the desktop app it is
a select. When you open the transcript of a subagent, the tab shows only that agent and says so:

```text
{agent: scout} [ refresh ]
scout is in view, so only scout shows
Now  scout
◦ scout     docs/design.md             2s
```

The marks and the filter stay in the memory of the mod for the session. They are not in
`$.state`, so a reload of the plugins clears them.

## Preview and diff

A press on a file row opens it. One row is open at a time. A press on another row opens that
row, and a second press on the open row closes it. The open row shows the agents that read or
edited the file, its git state and four buttons. The test fixture, after `scout` read
`docs/mocks.md` and `main` edited it 2 minutes later:

```text
  M mocks.md              ✎ main +1    1m
      edited by main 1m ago
      read by scout 3m ago
      modified, not staged
      [ preview ] [ diff ] [ copy path ]
      [ @ to prompt ]
```

| Button            | Effect                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| `[ preview ]`     | Shows the file in the tab                                              |
| `[ diff ]`        | Shows the change of the file against `HEAD`. Only in a git repo        |
| `[ copy path ]`   | Copies the path, such as `docs/mocks.md`, to the clipboard             |
| `[ @ to prompt ]` | Puts `@docs/mocks.md` in the prompt at the cursor. It does not send it |
| `[ back ]`        | Goes back to the tree                                                  |

The buttons have no key, because a key does not reach the tab inside tmux.

The preview of a code file, as the test fixture draws it:

```text
Files  app · main ↑1 · 6 changed
[ back ] [ diff ] [ copy path ]
hooks/pane.tsx  M · 3,000 lines
first 2,000 lines shown of 3,000
─────────────────────────────────────────
(the file in the Code element of Claude Code, with line numbers)
```

- The preview shows at most 2,000 lines. A drawing of a tab holds at most 100,000 characters, so
  the preview ends at the last whole line that fits. The note says how many lines it shows.
- A Markdown file shows in the Markdown element of Claude Code.
- A control or bidi character in the file shows as `\u001b`.
- A file that the mod does not show has a one-line note:

| File                                          | Note                                   |
| --------------------------------------------- | -------------------------------------- |
| A NUL character in the first 8,000 characters | `binary file, no preview`              |
| Over 4 MiB                                    | `over 4 MiB, no preview`               |
| Cannot be read                                | `Cannot read it: permission denied.`   |
| Deleted (`D`)                                 | `deleted; [ diff ] shows what it held` |

The diff of a changed file, as the test fixture draws it:

```text
Files  app · main ↑1 · 6 changed
[ back ] [ preview ] [ copy path ]
hooks/pane.tsx  M · +3 -2 vs HEAD
─────────────────────────────────────────
(the hunks in the Code element of Claude Code, in diff format)
```

- The mod runs this command once, with no shell. The counts `+3 -2` come from the lines of the
  diff.

  ```text
  git -c core.quotePath=false --literal-pathspecs diff HEAD --no-color --no-ext-diff --no-renames
      --src-prefix=a/ --dst-prefix=b/ --no-relative -- hooks/pane.tsx
  ```

  The options make the output the same under every git configuration. git prints each name as
  it is, and a name that starts with `:` or holds `*` is a path, not a pattern. A file moved by
  hand shows as a deleted file and a new file. The mod also reads a name that git still quotes,
  such as a name with `"`, a tab or a line break.

- The diff ends only at the end of a hunk. The note then reads `first 2 of 3 hunks shown`. When
  the first hunk of a file is larger than the pane, the mod shows its first lines under a header
  that counts them, and the note reads `hunk cut: 1,999 of 3,000 lines shown`.
- When the output of git is over 4 MiB, a file that git did not reach reads
  `not shown; git diff was cut at 4 MiB`.
- An untracked file, and every file in a repo with no commit, shows as one added hunk that the
  mod builds from the file text. No process runs for it.
- A deleted file shows what it held as removed lines.
- A binary change reads `binary file changed`. A file with no change reads
  `no change against HEAD`.

A press on the counts of a folder, such as `M2 ?1`, shows the diff of each changed file under it,
one Code element for each file:

```text
[ back ] [ copy path ]
docs/  3 changed files vs HEAD
─────────────────────────────────────────
docs/design.md  M +1 -1
(Code)
docs/filetree.md  ? new, 1 line
(Code)
docs/mocks.md  M +1 -0
(Code)
```

- One `git diff` runs for the tracked files of the folder. The mod reads each untracked file.
- The diff shows at most 50 files. Over 50, the note reads `first 50 of 60 changed files shown`,
  and `[ copy the git diff command ]` copies the command for the whole folder. Each argument
  that a shell would split or expand is in single quotes.
- The counts of an untracked folder, `?`, are not a button, because git status does not list the
  files in it. Open the folder and press a file in it: its diff is the whole file.
- When the 2,000 lines or the 100,000 characters are used, the next files read
  `not shown; the pane is full`.

## State

The mod keeps two lists in `$.state`: the open folders and the folders that show all entries.
`types/index.d.ts` declares them. The lists last for the session. The folder listings stay in the
memory of the mod, not in `$.state`.
