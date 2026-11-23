### Fixed

- Test connection on an MCP server showed "Connected" when the server listed its tools but its
  sign-in server could not register OpenBot, so the tools then failed with "Authentication
  required". The test now says that the server needs a sign-in app. On a joined server, the server
  must also be on this version.
