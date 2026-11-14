### Fixed

- A tool of an MCP server that you signed in to no longer fails with "OpenBot could not reach the
  server" when one new connection to the server fails, for example on a VPN. OpenBot now tries to
  connect once more. It does not send a request again when the server could have received it.
