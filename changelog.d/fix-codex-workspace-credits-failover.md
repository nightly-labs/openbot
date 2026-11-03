### Fixed

- An agent with backup models and "Ask before switching" off now moves to its next backup model when
  its ChatGPT workspace is out of credits before the agent starts to write. Before, the message failed
  with the Codex usage-limit error, and the agent stayed on the ChatGPT account that had no credits.
