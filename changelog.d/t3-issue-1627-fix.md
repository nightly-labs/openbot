### Fixed

- Let a desktop client stop an agent on a remote server after the computer wakes from a long
  sleep. Before, the server could close the connection during the sleep while the client still
  showed it as connected. Each stop then failed with "The WebRTC channel is not open." The client
  now connects again when the server closes the connection, and sends a request that did not go
  out once more on the new connection.
