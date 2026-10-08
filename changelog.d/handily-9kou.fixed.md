- **Codex no longer offers the Claude Code mods.** Codex reads `.agents/plugins/marketplace.json`
  before `.claude-plugin/marketplace.json`. That file now lists no plugins, so Codex shows none
  and no longer warns that it cannot parse `hooks/hooks.json`. `npm run validate` refuses a
  missing file or a listed plugin. The README lists all five install lines (handily-9kou).
