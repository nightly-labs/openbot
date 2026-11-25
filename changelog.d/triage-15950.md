### Fixed

- A Gemini agent no longer stays "working" with no end when one of its steps does not finish. After
  30 minutes with no progress from that step, OpenBot ends the turn and says so, and the agent's
  next messages run. On a joined server, the server must also be on this version.
