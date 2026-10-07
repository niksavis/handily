- **The `workitems` mod reads beans and the files of any other tracker.** It reads the beans
  files under `.beans/`, or under the folder that `.beans.yml` names, and closes an archived
  bean. `.handily.json` at the repo root names the source to read, or the globs, the format and
  the field map of a JSON, JSON Lines or front matter tracker. A glob that leads outside the
  repo root by its real path makes the read fail with its name. The mod reads one source per
  repo and reports the others as ignored (handily-fwkt.2.2).
