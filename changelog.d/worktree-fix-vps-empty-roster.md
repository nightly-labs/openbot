### Fixed

- A server that wakes from sleep no longer shows "Set up" with the provider choice before its agents
  load. Before, the server sent an empty agent list while it started, until a reconnect sent the
  agents.
