- **handily-board 0.1.1 polls the sessions at once when the this machine tab becomes
  shown.** The 15 second poll skips its turn while the tab is hidden. Before this fix,
  a switch back to the tab showed old data, such as `Sessions 4 · 38s ago`, until the
  next turn. Now the tab polls `claude agents --json` at once when its data is 15
  seconds old or older, and polls nothing extra when the data is newer
  (handily-fwkt.8.20).
