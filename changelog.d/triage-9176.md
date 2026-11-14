### Fixed

- An MCP server that takes an API key and has no sign-in, such as Coolify, no longer shows a Sign
  in card. Before, the sign-in opened no browser and ended with "The server answered 419.". Now
  OpenBot says that the server takes an API key and tells you how to enter it under Headers. It
  says the same when the Authorization header holds only the key, without Bearer. On a joined
  server, the server must also be on this version.
