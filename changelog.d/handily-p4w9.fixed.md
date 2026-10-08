- **The `session-board` mod shows no row for a session that `claude agents` does not list.**
  Before, each stored key of an earlier session showed a row with the state `not listed`. Now
  the board shows such a row only for this session, when the last poll does not list it yet. A
  listed session whose key was written more than 60 s before its start shows `(stale)` after
  its task and no estimate. A poll still deletes a key that is older than 24 hours
  (handily-p4w9).
