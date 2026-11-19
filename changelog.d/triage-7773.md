### Fixed

- After OpenBot restarts or installs an update, an agent on a backup model no longer goes back to its main
  account while that account is still at its usage limit. OpenBot first checks the account's usage, and the
  agent goes back when the limit resets. On a joined server, the server must also be on this version.
