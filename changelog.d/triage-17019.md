### Fixed

- The connection test of an MCP server no longer says "OpenBot could not reach the server" when one
  new connection to the server does not open, for example on a VPN, while the tools of the server
  work. The test now tries that connection once more, as the tool calls do.
