### Fixed

- A Claude agent waits up to 60 seconds for a local MCP server to start, as the connection test does.
  A server that starts slowly, for example in the first routine run of the day, no longer loses its
  tools after 30 seconds.
