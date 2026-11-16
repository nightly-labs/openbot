### Added

- A custom agent takes a message into its running turn when the busy-message mode is "steer", if
  the agent reports mid-turn steering (the `_session/steering` request that OpenCode uses). Before,
  the message waited in the queue until the turn ended. A custom agent that does not report it keeps
  "Send now", and the message waits in the queue as before. On a joined server, the server must also
  be on the new version.
