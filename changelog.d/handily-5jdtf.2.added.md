- **Toasts draw their marks from the Glyphs setting.** The toasts of `handily-board`,
  `handily-filetree`, `handily-item-toasts`, `handily-reply-view` and `handily-simple-view`
  draw the Nerd Font icons when Glyphs is `nerd`, and the plain marks otherwise. A toast
  without the bundle `handily`, or with a stored value other than `plain` or `nerd`, draws
  plain. Each mod reads the setting when the session starts and after a change of it in
  `/config`. A blocked toast and a toast that waits for you stay 10 seconds in both sets, and
  every toast stays on screen for the same time in both sets. The panes of the board and of the
  files tab still draw plain (handily-5jdtf.2).
