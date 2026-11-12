- **A fresh install gets each mod at its release tag.** The marketplace pins each mod with a
  `git-subdir` source at its latest release tag and the commit of that tag. Before, each entry
  named the folder of the mod on `main`. So a merge into `main` reached a fresh install before
  its release, under the version label of the last release. Now work on `main` reaches users
  only with the release of its mod. An installed mod keeps its version until its next update.
  (handily-lh63p0)
