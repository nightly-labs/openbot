### Fixed

- An agent step in a workflow can end with nothing to report and stay silent in the chat. Before, the
  agent was told to write its result anyway, so each run, such as a scheduled run every 30 minutes,
  put a "nothing happened" message in the agent's chat.
