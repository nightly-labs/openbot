### Fixed

- Keep the connection to a server when a desktop client that is connected to it reconnects to the
  signal server while the connection still works. Before, each such reconnect restarted the
  connection path, and after 10 restarts the server closed the connection. The chat then stopped
  for a few seconds while the client connected again.
