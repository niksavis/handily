- **A wide board gives each agent row a ctx column and a lane.** From a body of 80 columns, each
  agent row of `/board` shows the context of its latest model request and a lane on one time
  axis, from the first spawn to now. The lane of an agent that waits for you ends in `◆`, and
  the lane of a failed agent ends in `■`. Below 80 columns the rows stay as they were
  (handily-xsjad.8).
