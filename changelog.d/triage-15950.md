### Fixed

- A Gemini agent no longer stays "working" with no end when one of its steps does not finish. When
  the agent sends nothing for 30 minutes while a step is open, OpenBot ends the turn and says so, and
  the agent's next messages run. On a joined server, the server must also be on this version.
