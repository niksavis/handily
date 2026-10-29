- **reply-view can ask Claude for a mermaid diagram, with a measured cost.** The new
  `diagramHints` setting is `off` by default. When it is `on`, or after `/replies hints`, each
  prompt that you type carries one hint of 350 characters. The hint asks for a flowchart or a
  sequence diagram when a flow or an exchange reads better as a diagram. It costs about 140
  tokens for each prompt, measured on 2026-10-29. A prompt that a plugin or the Remote Control
  bridge sends carries no hint, and neither does a slash command. No hint goes out while the
  reply view is off or the `diagrams` setting is `off` (handily-5zzxk.8).
