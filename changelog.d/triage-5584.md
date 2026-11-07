### Fixed

- Sign in to an MCP server that refuses `127.0.0.1` redirect addresses at registration. OpenBot now
  registers again with `localhost`. Before, the sign-in stopped with "Client registration failed."
  before the browser opened.
