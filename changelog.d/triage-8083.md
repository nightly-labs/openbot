### Fixed

- Grok agents now get MCP servers that need up to 60 seconds to start, as long as the MCP connection
  test waits. Before, Grok stopped such a server after 30 seconds, so the test showed it as ready but
  the agent could not find its tools.
- When Grok cannot start an MCP server, OpenBot now shows "MCP server not started" with the server
  name and the cause. Before, the server's tools were missing with no message.
