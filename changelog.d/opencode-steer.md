### Added

- An OpenCode agent takes a message into its running turn when the busy-message mode is "steer",
  as Claude and Codex agents do. Before, the message waited in the queue until the turn ended.
  This needs an OpenCode release with mid-turn steering (2.3.0 has it). With an older release, and
  on a joined server that has an older OpenBot version, the message waits in the queue as before.
