- **The first release of a new mod passes the release workflow.** At the commit of its first
  release tag, a mod has a tag and no marketplace entry yet, because the pin commit follows the
  tag. `npm run marketplace` and `npm run validate` refused it, so `release.yml` failed. Now
  both leave the mod out with a note that names the pin command. A released mod with no entry
  on a later commit still fails by name. (handily-b52ga0)
