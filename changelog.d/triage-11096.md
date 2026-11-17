### Fixed

- Start a new session for a Cline agent when Cline loses its session. Before, each message to the
  agent failed with "Internal error: session not found", also after a restart of OpenBot. On a joined
  server, the server must also be on this version.
