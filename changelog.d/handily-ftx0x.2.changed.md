- **item-toasts shows each part of a toast on its own line and keeps it long enough to read.**
  Line 1 is the signal mark, the id and the change, such as `✓ handily-ab12 closed` or
  `▶ handily-cd34 open → in_progress`. Line 2 is the tracker title in double quotes, cut with
  `…` to fit the 40-column box. A merged toast reads `3 items changed`, then the counts with
  their marks, then the ids. A failure toast puts its hint on line 3. A toast stays 2000 ms plus
  80 ms for each visible cell, at least 6 s and at most 15 s, and at least 10 s for `■`. A new
  gate, `scripts/toast.test.mjs`, keeps every toast of a mod in its `hooks/toast.ts`
  (handily-ftx0x.2).
