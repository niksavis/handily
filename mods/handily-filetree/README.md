# handily-filetree

`filetree` shows the working folder of the session as a tree in a pane tab named `files`. Folders
come first. The mod lists a folder only when you open it.

This release lists files only. It does not show the git state of a file, and it does not mark
which agent read or edited a file. [docs/design.md](../../docs/design.md), section 4.11, gives the
plan for those.

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

Docked, body 41, with `docs/` open, as the test fixture draws it:

```text
Files  app
[ refresh ]
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
Files  app                                                       [ refresh ]
.git/  not listed
node_modules/  not listed
docs/
hooks/
scripts/
.gitignore
a.md
+4 more: a dock (fullscreen, 110 columns) shows the tree
```

## State

The mod keeps two lists in `$.state`: the open folders and the folders that show all entries.
`types/index.d.ts` declares them. The lists last for the session. The folder listings stay in the
memory of the mod, not in `$.state`.
