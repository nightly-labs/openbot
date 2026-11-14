### Fixed

- A custom provider that runs on Pi now works with a model that has reasoning efforts. Before, Pi
  sent the agent's instructions in a role that many OpenAI-compatible servers (for example EXAONE)
  do not accept, and each turn failed with error 400.
