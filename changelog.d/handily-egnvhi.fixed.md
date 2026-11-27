- **Sessions on one basicly ledger share one tracker read.** Each session ran
  `basicly tracker items` on its own. For a vault ledger it ran twice a minute in every
  session, all in the same second. One run costs about 1.2 CPU seconds and 320 MB, so 5
  sessions ran 10 of them a minute in bursts. Now the first session writes the result to a cache
  file under `~/.cache/handily/workitems`, and the other sessions read it for up to 60 seconds.
  A lock file lets one session run the command while the others wait for the cache. A vault
  ledger is read again once a minute. The poll also stops when no mod read the work items for 5
  minutes, and the next read starts it again. (handily-egnvhi)
