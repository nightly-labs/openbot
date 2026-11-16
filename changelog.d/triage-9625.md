### Fixed

- An agent can now add a remote MCP server that needs more than 10 seconds to start. The connection
  test now waits 30 seconds for the server, so it no longer stops a working server too early.
