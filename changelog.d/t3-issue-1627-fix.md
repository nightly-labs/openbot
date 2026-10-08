### Fixed

- Let a desktop client stop an agent on a remote server after the computer wakes from a long
  sleep. Before, the server could close the connection during the sleep while the client still
  showed it as connected. Each stop then failed with "The WebRTC channel is not open." Now the
  client connects again when the server closes the connection. When a request could not go out on
  the closed connection, the client sends it again on the new connection.
