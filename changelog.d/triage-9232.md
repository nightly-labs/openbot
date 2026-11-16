### Fixed

- Adding an MCP server that uses an account sign-in now shows Sign in when the server answers 403,
  such as Adobe's. Before, OpenBot asked for an API key that the service does not give, and Sign in
  opened no browser. On a joined server, the server must also be on this version.
