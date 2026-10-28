- **board marks a slow or a quiet subagent on its row.** A running agent whose tool call has run
  for more than 30 seconds reads `slow 45s`, with the time of that call. A running agent with no
  event for 2 minutes reads `quiet 3m`, with the time since its last event. The word takes the
  warning colour and the mark stays `▶`. The board starts no timer for these states: a shown tab
  reads them when it draws again every 10 seconds (handily-xsjad.6).
