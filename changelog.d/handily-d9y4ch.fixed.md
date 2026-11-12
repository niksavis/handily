- **The plain install gate runs again on the pinned marketplace.** `npm run install-gate` read
  the version of each mod from its marketplace entry, and a pinned entry has no version. Now the
  gate copies the mods of the working tree into a scratch marketplace with relative sources and
  reads each version from the `plugin.json` of the mod. The install, update, disable, enable and
  bundle checks run on it. The gate never writes `.claude-plugin/marketplace.json`.
  (handily-d9y4ch)
