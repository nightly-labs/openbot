### Fixed

- After OpenBot restarts or installs an update, an agent on a backup model no longer goes back to its main
  account before the usage limit resets. Before, when OpenBot could not read the usage of that account again,
  the agent went back too early, got a refusal, and stayed on the backup model. On a joined server, the
  server must also be on this version.
