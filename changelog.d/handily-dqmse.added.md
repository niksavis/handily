- **The files tab steps through the edits of the last turn.** After a main turn ends, the files
  tab shows `[ last turn: 3 edits ]` (key `l`). A press shows `edit 1 of 3` with the patch of
  that Edit or Write call, not the file against HEAD. `[ prev ]` and `[ next ]` (keys `p` and
  `n`) walk the edits in turn order, and `[ back ]` (key `b`) returns to the tree. A subagent edit
  counts for the main turn in which it ended and shows the agent label of the board. An edit held
  for review says `held`. `/tree edits` opens edit 1, and `/tree edits 2` opens edit 2. The tab
  keeps the first 50 edits and 400 lines of each patch (handily-dqmse).
