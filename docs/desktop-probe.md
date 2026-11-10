# The desktop probe

This page is for the owner of the repository. It tells you how to load the desktop probe in the
Claude desktop app on Windows, and which readings to send back.

## Why the probe exists

Nobody has measured six facts about the Claude desktop app yet:

- whether `$.process.run` runs a command
- whether `claude` is on the PATH of the app
- whether a `Box` draws its border and a `Text` draws a hex colour
- whether three rows of mono `Text` join into one frame
- whether a `Button` hotkey presses the button
- whether a toast shows

Claims in [design.md](design.md) rest on these facts. The workitems mod refuses tracker commands on
the desktop because of one of them. The probe shows each fact in one pane, so that one reading
settles them.

The probe is in `probes/desktop/`. It is not a released mod. The marketplace file does not list it,
and no repository gate tests it.

## Use native Windows, not WSL

Plugins do not load in a desktop session that runs in WSL. The vendor page
[Claude Code Desktop in WSL](https://code.claude.com/docs/en/desktop-wsl.md) says:

> **Plugins**: not available in WSL sessions

So open a native Windows folder, such as `C:\probe-work`, in the desktop app. Do not open a
`\\wsl.localhost\...` folder.

## Load the probe

The vendor documentation gives no step that loads a plugin folder in the desktop app for one
session. `--plugin-dir` is a flag of the `claude` command in a shell, and the
[desktop page](https://code.claude.com/docs/en/desktop.md) does not name it. Two routes follow from
the documentation. Nobody has tried them in the desktop app yet. Try route 1 first.

### Route 1: a plugin in the skills folder

The vendor page [Publish plugins](https://code.claude.com/docs/en/plugins/publish.md) says:

> they move the plugin directory, with its `.claude-plugin/plugin.json`, under `~/.claude/skills/`.
> From then on Claude Code loads it at startup

The vendor page [Plugin loading](https://code.claude.com/docs/en/plugins/loading.md) names the
desktop app for such a plugin:

> **From the desktop app, in a worktree**: the plugin loads from the main checkout's
> `.claude/skills/` rather than the worktree's.

1. Copy the folder `probes/desktop` of the repository to
   `%USERPROFILE%\.claude\skills\handily-desktop-probe` on Windows. The folder must hold
   `.claude-plugin\plugin.json` and `hooks\register.ts`.
2. Quit the desktop app fully, and start it again.
3. Open the **Code** tab, and start a local session on the native Windows folder. Accept the folder
   trust dialog.
4. Type `/probe` and press Enter. One pane opens with the readings.

If `/probe` is not in the list of slash commands, the probe did not load. Then try route 2.

### Route 2: install from a local marketplace

The vendor page [Install plugins](https://code.claude.com/docs/en/plugins/install.md) says:

> The terminal, the desktop app's local sessions, and the VS Code extension on one computer read the
> same settings files, so a plugin you install at user scope in any of them is available in the
> other two.

This route needs the `claude` command in a native Windows shell, such as PowerShell.

1. Make a folder `C:\handily-probes`. Copy the folder `probes/desktop` of the repository to
   `C:\handily-probes\desktop`.
2. Make the file `C:\handily-probes\.claude-plugin\marketplace.json` with this text:

   ```json
   {
     "name": "handily-probes",
     "owner": { "name": "niksavis" },
     "plugins": [{ "name": "handily-desktop-probe", "source": "./desktop" }]
   }
   ```

3. In PowerShell, run these two commands:

   ```sh
   claude plugin marketplace add C:\handily-probes
   claude plugin install handily-desktop-probe@handily-probes
   ```

4. Quit the desktop app fully, start it again, and do steps 3 and 4 of route 1.

Do not put the marketplace file in `probes/desktop`. With that file in the folder,
`claude plugin validate --strict probes/desktop` fails.

### Remove the probe

- Route 1: delete the folder `%USERPROFILE%\.claude\skills\handily-desktop-probe`.
- Route 2: run `claude plugin uninstall handily-desktop-probe@handily-probes` and
  `claude plugin marketplace remove handily-probes`.

## The pane

The pane has one row for each reading, from `a` to `h`:

| Row | What it shows                                                                   |
| --- | ------------------------------------------------------------------------------- |
| a   | The surfaces that the session reports, and the surface that draws the pane      |
| b   | The exit code and the first output line of `git --version`, or the error        |
| c   | The exit code and the first output line of `claude --version`, or the error     |
| d   | The value that the toast call returned, or the error. A toast also shows        |
| e   | A box with a round border                                                       |
| f   | Three colours, each with its hex value as text                                  |
| g   | Three rows of mono text that must join into one frame                           |
| h   | A `count` button with the hotkey `c`, and the number of presses                 |

An error shows as `threw` with the error name and the error message. The probe runs only the two
fixed commands of rows b and c. It reads no input from you.

## The readings to send back

Send these readings:

1. The version of the desktop app. Type `/status` in the session and copy the version.
2. A statement that the session ran on native Windows and not in WSL, and the route that loaded
   the probe.
3. The theme of the desktop app: light, dark or system.
4. The text of rows a, b, c and d, as the pane shows it.
5. Whether a toast with the text `handily-desktop-probe: the toast of row d` showed, and where.
6. Whether row e shows a border.
7. Whether row f shows three different colours.
8. Whether the three rows of row g join into one closed frame, with no gaps between the rows.
9. Whether a click on `count` raises the number in row h.
10. Whether the key `c` raises the number in row h. Click in the pane first, so that the pane has
    the focus.
11. One screenshot of the whole pane.
