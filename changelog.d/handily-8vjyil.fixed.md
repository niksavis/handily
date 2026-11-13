- **A person with no GitHub SSH key can install and update the mods again.** Since each mod
  installs from its release tag, the marketplace named the repository as `niksavis/handily`.
  Claude Code clones that short form over SSH when an SSH check to GitHub succeeds, and the
  plugin install does not fall back to HTTPS. So an install or update failed with
  `Permission denied (publickey)`. Now every entry names
  `https://github.com/niksavis/handily.git`, which Claude Code clones over HTTPS. The release
  tags and commits of the mods did not change. (handily-8vjyil)
