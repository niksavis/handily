- **One line installs every mod.** The new `handily` plugin is a bundle that lists the five
  mods as dependencies, so `/plugin install handily@handily` installs and enables all of
  them. Its `/handily` command lists each mod with its version and whether it loaded, gives
  the `/plugin install` or `/plugin enable` line for a mod that is missing or disabled, and
  ends with a summary such as `handily: 5 of 5 mods loaded`. To remove the bundle, run
  `/plugin uninstall handily@handily`, then `claude plugin prune` (handily-325f).
