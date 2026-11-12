### Fixed

- An agent can now turn off an MCP server that is running. Before, the agent tested the server
  first, and a server that lets only one copy run failed the test, so it stayed on. A server that
  is off is now saved without a test.
