- **The `workitems` mod gives other mods one typed list of work items.** It adds `$.workitems`,
  reads beads and br data from `.beads/issues.jsonl` at the session root, and publishes a
  snapshot in `$.state`. `npm run marketplace` now writes `.claude-plugin/marketplace.json`
  from the mods, and `npm run types` lays the contract of each dependency (handily-fwkt.2.1).
