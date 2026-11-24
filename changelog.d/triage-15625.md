### Fixed

- Custom agents: an agent that needs more than 30 s to start, such as antigravity-acp on Windows, now
  starts. Before, each message stopped with "did not finish starting within 30 s", and the agent never
  answered.
