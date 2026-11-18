### Fixed

- A ChatGPT (Codex) agent that gets a message together with many other agents now waits and tries
  again when its chat does not open in time. Before, the message failed with "Codex request timed
  out: thread/resume", and the agent that sent the request was told that it failed. On a joined server, the
  server must also be on this version.
