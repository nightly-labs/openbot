### Fixed

- When a joined server did not open because of a problem on your own computer, the app said "The host
  is not reachable." with `transport/connect_failed`, also when the server was running. Now the app
  says that the security key of the server is missing or changed (`transport/host_key_missing`), or
  that it could not start the connection on this computer (`transport/bridge_failed`). Only the app
  that connects must be on this version.
