- **board prints the session figures and the agents as text with `/board stats`.** The reply
  has the Session line with its waits, context and cost, the details with the context of the
  window, the compactions, the last turn and the limits with their resets, the checks, each
  waiting agent, and each agent with its state and context. The board does not need to be open.
  When the host gives no usage, the reply says `no context or cost on this host` and shows no
  context, cost or limit. `/board frob` now lists `/board stats` (handily-xsjad.10).
