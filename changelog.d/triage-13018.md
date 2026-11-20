### Fixed

- After OpenBot restarts or installs an update, an agent on a backup model no longer goes back to its main
  account before the usage limit resets. Before, when OpenBot had seen that the account was at its limit but
  could not read its usage again later, the agent went back too early, got a refusal, and stayed on the backup
  model. On a joined server, the server must also be on this version.
