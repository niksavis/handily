- **The board projects when the usage limits fill.** The Session line shows `full ~1h` after a limit
  when its use rises over at least 15 minutes of readings and reaches 100 percent before its reset.
  The opened details show a `pace` line for each limit. Fewer readings, flat or falling use, or a
  last reading over 30 minutes old show no projection. At 80 and 95 percent of a limit, one session
  of this machine shows one toast for each level and cycle, through the store key
  `limit-warned:<kind>`. Known limit: the store has no compare-and-set, so two sessions that read
  the key back at the same time can both show the toast. (handily-cver9)
