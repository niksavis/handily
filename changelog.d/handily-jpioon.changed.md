- **CI also runs the mod tests on the newest Claude Code release.** A separate job of
  `basicly-gates.yml`, `mods on newest Claude Code`, installs `@anthropic-ai/claude-code@latest`,
  prints the version that it resolved, and runs `npm test`. A daily schedule starts the workflow,
  so a new Claude Code release is tested with no push. The pinned job stays as it was, so a red
  result names the newest release apart from the pin. `scripts/pins.test.mjs` keeps the pin rule:
  every exact pin names one version, and the engine types of every mod match it. The one other
  value that it accepts is the word `latest`. It refuses a second fixed version, a third value
  and an unknown word. (handily-jpioon)
