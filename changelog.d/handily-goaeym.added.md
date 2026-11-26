- **reply-view writes a capability file at each session start.** The file
  `handily-reply-view.json` follows capability file v1, a format that basicly owns. It lists the
  Mermaid header words that the reply view draws, so a basicly skill draws a Mermaid diagram only
  when the reply view can show it, and prints plain text otherwise. The folder is
  `BASICLY_CAPABILITIES_DIR` when it is absolute, else `basicly/capabilities` under
  `LOCALAPPDATA` on Windows or under `XDG_STATE_HOME` or `HOME/.local/state` elsewhere. The mod
  writes in place, and only when the content changed or the file is more than 12 hours old. A
  failed write logs one debug line. (handily-goaeym)
