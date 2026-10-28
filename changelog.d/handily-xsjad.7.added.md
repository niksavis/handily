- **board shows the context and the output tokens of a subagent on its opened row.** The line of
  the tool calls reads `7 tool calls · ctx 48k · out 6.1k`, from the usage of the latest model
  request of the agent that the engine event `turn.step` reports. A request that stopped at its
  output limit shows `stopped at max_tokens · ctx 198k`. The board passes the response of a main
  loop request on as it arrives and reads none of it (handily-xsjad.7).
