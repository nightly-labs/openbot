### Fixed

- When an agent cannot start an MCP server, the "MCP server not started" message now gives the
  cause in two more cases. When the server answers that it is not available, it tells you to wait a
  few minutes and try again. When the agent cannot reach the server, it tells you to check the
  address of the server in Marketplace, Apps, and that the server is running. Before, both cases
  showed only a general text. For an agent on a joined server, the server must also be on the new
  version.
