### Fixed

- A message to a Hermes Agent agent now waits and starts when the agent is free, after you stop a
  turn whose command still runs. Before, each message failed with "Internal error: session_busy".
