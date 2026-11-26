### Fixed

- Keep a server signed in when an agent damages its keyring. Before, an agent that stopped or replaced
  the keyring service, or deleted the keyring file, made the server sign out at its next start for
  good. Now the server keeps a copy of the keyring that only root can read, and restores it at the
  next start. The server must be on the new version.
